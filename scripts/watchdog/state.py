"""SQLite-backed source-state cache + similarity-based change detection.

The watchdog's core question is: "did source X's content change since the
last successful check?" We answer it with two signals:

1. A SHA-256 hash of the normalized text (fast path — identical hash means
   no change, no diff needed).
2. When the hash differs, a ``difflib.SequenceMatcher`` similarity ratio
   against the previous text. Cosmetic changes (HTML boilerplate refresh,
   timestamp bumps) typically score ≥ 0.99 and are ignored; anything below
   ``SIMILARITY_THRESHOLD`` (default 0.95) is reported as a real change.

The cache lives at ``data/regulation_supplements/.cache.db`` (SQLite) so the
process can exit between runs without losing state.
"""
from __future__ import annotations

import difflib
import hashlib
import json
import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

SIMILARITY_THRESHOLD = 0.95
_DEFAULT_DB_NAME = ".cache.db"

# 2026-09-13 production incident: a genuinely-changed EU Cellar source
# (~9 MB normalized RDF) drove ``difflib.SequenceMatcher`` (O(n²) worst case)
# at 100% CPU for 2.5+ hours. Above this budget the similarity score falls
# back to an O(n) line-hash Jaccard, which separates cosmetic churn (≥0.95)
# from real edits just as reliably for whole-document comparisons, and the
# unified diff is replaced by a bounded first-divergence excerpt.
SEQUENCE_MATCHER_MAX_CHARS = 500_000
# The line-hash Jaccard on giant documents reads higher than the exact
# SequenceMatcher ratio for the same edit (one changed line costs 2 set
# slots out of ~300k). A real amendment of a 300k-line RDF moves thousands
# of lines (≈0.96-0.98) while cosmetic churn moves a handful (≥0.999), so
# the giant-doc cosmetic gate sits at 0.99 instead of 0.95.
JACCARD_SIMILARITY_THRESHOLD = 0.99
# When the line-Jaccard stays high but Ratcliff-Obershelp shape similarity
# (line LCS) drops, the doc was likely reordered rather than reworded —
# e.g. a regulation publisher moved 100 clauses to the end. Jaccard would
# happily call that "cosmetic" because line membership is identical, but
# the document structure did change. We treat that combination as a real
# modification regardless of the Jaccard cosmetic gate.
#
# 0.99 (not 0.95): for the EU Cellar (~33k lines) reordering 100 lines
# reads as line_lcs ≈ 0.9939 — a 5% threshold would let a publisher
# quietly move 100 clauses through the gate. 1% catches even modest
# section reshuffles without false-positiving on single-line typos.
SEQ_SHIFT_LINE_LCS_THRESHOLD = 0.99
_DIFF_EXCERPT_LINES = 40
# Context window (lines before / after the first divergence) shown in the
# bounded diff for giant docs. Five is enough to spot the moved chunk
# without ballooning the excerpt when every block changed.
_DIFF_CONTEXT_LINES = 5


@dataclass
class _SimilarityResult:
    """Internal bundle returned by ``_similarity_and_exact`` so the caller can
    decide between the regular threshold and the seq-shift sensitive branch."""

    similarity: float
    exact: bool
    jaccard: float | None = None
    line_lcs: float | None = None

    @property
    def seq_shift_sensitive(self) -> bool:
        """True when line membership looks identical (high Jaccard) but the
        Ratcliff-Obershelp shape similarity on lines is materially lower —
        i.e. lines were reordered, not rewritten."""
        if self.jaccard is None or self.line_lcs is None:
            return False
        return (
            self.jaccard >= JACCARD_SIMILARITY_THRESHOLD
            and self.line_lcs < SEQ_SHIFT_LINE_LCS_THRESHOLD
        )


def _similarity_and_exact(before: str, after: str) -> _SimilarityResult:
    """Similarity in two regimes:

    Small docs (≤ ``SEQUENCE_MATCHER_MAX_CHARS``): the canonical
    ``difflib.SequenceMatcher`` ratio on the raw text.

    Large docs: combine two signals — line-hash Jaccard (O(n) on line
    hashes) and Ratcliff-Obershelp on the line stream (Myers diff, O((n+m)*d)).
    The reported similarity is the **minimum** of the two so neither alone
    can whitewash a real edit. When Jaccard stays high but the line LCS
    collapses, ``seq_shift_sensitive`` flips on the lineage-detect branch
    even if Jaccard alone would have read cosmetic — that's the
    "moved 100 lines to the end without rewriting them" case.
    """
    if max(len(before), len(after)) <= SEQUENCE_MATCHER_MAX_CHARS:
        ratio = difflib.SequenceMatcher(None, before, after).ratio()
        return _SimilarityResult(similarity=ratio, exact=True)

    before_lines = before.splitlines()
    after_lines = after.splitlines()
    before_hashes = {hash(line) for line in before_lines}
    after_hashes = {hash(line) for line in after_lines}
    if not before_hashes and not after_hashes:
        return _SimilarityResult(similarity=1.0, exact=False, jaccard=1.0, line_lcs=1.0)

    jaccard = len(before_hashes & after_hashes) / len(before_hashes | after_hashes)

    # Ratcliff-Obershelp on lines (autojunk=False → Myers diff, no quick-ratio
    # shortcut). Myers is O((n+m) * d) where d is the edit distance — for a
    # genuine reordering d is large but the worst-case for SequenceMatcher on
    # the raw string was the 9MB incident we are guarding against. The line
    # stream keeps each match unit short, so the Myers backend stays cheap.
    line_lcs = difflib.SequenceMatcher(
        a=before_lines, b=after_lines, autojunk=False
    ).ratio()

    return _SimilarityResult(
        similarity=min(jaccard, line_lcs),
        exact=False,
        jaccard=jaccard,
        line_lcs=line_lcs,
    )


def _bounded_unified_diff(before: str, after: str, source_id: str) -> str:
    """Unified diff for small docs; bounded first-divergence excerpt for big ones.

    Large-doc excerpt (2026-09-17): instead of dumping the first 5 changed
    lines with no surrounding context, we anchor on the first divergence,
    print its line number, then emit ``±_DIFF_CONTEXT_LINES`` lines of
    context on both sides. That gives an operator enough to identify the
    moved chunk without bloating the ``unifiedDiff`` field in diff.json.
    """
    if max(len(before), len(after)) <= SEQUENCE_MATCHER_MAX_CHARS:
        diff_lines = list(
            difflib.unified_diff(
                before.splitlines(),
                after.splitlines(),
                fromfile=f"{source_id}@before",
                tofile=f"{source_id}@after",
                lineterm="",
            )
        )
        return "\n".join(diff_lines[:120])

    before_lines = before.splitlines()
    after_lines = after.splitlines()
    head = [
        f"{source_id}: document too large for a full inline diff "
        f"({len(before)} → {len(after)} chars); first divergence excerpt follows."
    ]
    shown = 0
    for index, (old, new) in enumerate(zip(before_lines, after_lines)):
        if old != new:
            anchor = index + 1
            ctx_start = max(0, index - _DIFF_CONTEXT_LINES)
            ctx_end = min(len(after_lines), anchor + _DIFF_CONTEXT_LINES)
            head.append(f"@@ line {anchor} @@")
            for line in before_lines[ctx_start:index]:
                head.append(f"  {line[:200]}")
            head.append(f"- {old[:200]}")
            for line in after_lines[index:ctx_end]:
                head.append(f"+ {line[:200]}")
            shown += 1
            if shown >= 3:
                break
    if shown == 0:
        # Divergence is purely in length (lines appended/removed).
        anchor = min(len(before_lines), len(after_lines)) + 1
        head.append(f"@@ line {anchor} @@")
        tail_source = before_lines if len(before_lines) > len(after_lines) else after_lines
        sign = "-" if len(before_lines) > len(after_lines) else "+"
        tail_start = min(len(before_lines), len(after_lines))
        for line in tail_source[tail_start : tail_start + _DIFF_CONTEXT_LINES]:
            head.append(f"{sign} {line[:200]}")
    return "\n".join(head[:_DIFF_EXCERPT_LINES])


@dataclass
class Change:
    kind: str  # "added" | "removed" | "modified" | "cosmetic"
    source_id: str
    similarity: float
    before_hash: str | None
    after_hash: str
    unified_diff: str = ""
    metadata: dict = field(default_factory=dict)
    # True when the line-hash Jaccard stayed high but Ratcliff-Obershelp on
    # lines dropped — the caller is expected to treat the change as real
    # even though the giant-doc Jaccard gate would otherwise have read
    # cosmetic. Surfaced on ``to_dict()`` so reviewers can grep for it.
    seq_shift_sensitive: bool = False

    def to_dict(self) -> dict:
        return {
            "kind": self.kind,
            "sourceId": self.source_id,
            "similarity": round(self.similarity, 4),
            "beforeHash": self.before_hash,
            "afterHash": self.after_hash,
            "unifiedDiff": self.unified_diff[:8000],
            "metadata": self.metadata,
            "seqShiftSensitive": self.seq_shift_sensitive,
        }


def normalize_text(raw: str | bytes) -> str:
    """Collapse whitespace so HTML re-indentation does not read as a change.

    Both per-line indentation *and* internal runs of spaces/tabs are folded
    (``" ".join(line.split())``) — attribute re-flow inside a long HTML tag
    otherwise shows up as a low-similarity diff.
    """
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", errors="replace")
    return "\n".join(
        normalized
        for normalized in (" ".join(line.split()) for line in raw.splitlines())
        if normalized
    )


def text_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()


class SourceStateStore:
    def __init__(self, base_dir: Path, db_name: str = _DEFAULT_DB_NAME) -> None:
        self.db_path = Path(base_dir) / db_name
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.db_path)
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS source_state (
                source_id TEXT PRIMARY KEY,
                last_hash TEXT,
                last_text TEXT,
                last_modified TEXT,
                last_checked_at REAL,
                last_status TEXT,
                check_count INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        self._conn.commit()

    # ── read / write ────────────────────────────────────────────────────

    def get(self, source_id: str) -> dict | None:
        row = self._conn.execute(
            "SELECT source_id, last_hash, last_text, last_modified,"
            " last_checked_at, last_status, check_count FROM source_state"
            " WHERE source_id = ?",
            (source_id,),
        ).fetchone()
        if row is None:
            return None
        keys = (
            "source_id",
            "last_hash",
            "last_text",
            "last_modified",
            "last_checked_at",
            "last_status",
            "check_count",
        )
        return dict(zip(keys, row))

    def upsert(
        self,
        source_id: str,
        *,
        text: str,
        content_hash: str,
        last_modified: str | None,
        status: str,
    ) -> None:
        self._conn.execute(
            """
            INSERT INTO source_state
                (source_id, last_hash, last_text, last_modified,
                 last_checked_at, last_status, check_count)
            VALUES (?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT(source_id) DO UPDATE SET
                last_hash = excluded.last_hash,
                last_text = excluded.last_text,
                last_modified = excluded.last_modified,
                last_checked_at = excluded.last_checked_at,
                last_status = excluded.last_status,
                check_count = source_state.check_count + 1
            """,
            (source_id, content_hash, text, last_modified, time.time(), status),
        )
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    # ── change detection ────────────────────────────────────────────────

    def detect_changes(
        self,
        source_id: str,
        current_text: str,
        *,
        metadata: dict | None = None,
        max_diff_lines: int = 120,
    ) -> list[Change]:
        """Compare ``current_text`` (already normalized) against the stored
        snapshot. Returns [] when unchanged; a single Change otherwise."""
        current_hash = text_hash(current_text)
        previous = self.get(source_id)

        if previous is None:
            return [
                Change(
                    kind="added",
                    source_id=source_id,
                    similarity=0.0,
                    before_hash=None,
                    after_hash=current_hash,
                    metadata=metadata or {},
                )
            ]

        if previous["last_hash"] == current_hash:
            return []

        before_text = previous["last_text"] or ""
        sim = _similarity_and_exact(before_text, current_text)
        threshold = SIMILARITY_THRESHOLD if sim.exact else JACCARD_SIMILARITY_THRESHOLD

        # Two ways out of the "real change" gate:
        #   1. The combined similarity fell below the threshold (text was
        #      rewritten).
        #   2. Line membership looked identical (Jaccard above the gate)
        #      but Ratcliff-Obershelp on lines dropped — text was reordered,
        #      not rewritten. Cosmetic by Jaccard's measure, but a real edit
        #      for our purposes.
        seq_shift = sim.seq_shift_sensitive
        below_threshold = sim.similarity < threshold
        if not below_threshold and not seq_shift:
            # Cosmetic churn — record the new snapshot but do not report.
            return [
                Change(
                    kind="cosmetic",
                    source_id=source_id,
                    similarity=sim.similarity,
                    before_hash=previous["last_hash"],
                    after_hash=current_hash,
                    metadata=metadata or {},
                )
            ]

        return [
            Change(
                kind="modified",
                source_id=source_id,
                similarity=sim.similarity,
                before_hash=previous["last_hash"],
                after_hash=current_hash,
                unified_diff=_bounded_unified_diff(
                    before_text, current_text, source_id
                ),
                metadata=metadata or {},
                seq_shift_sensitive=seq_shift,
            )
        ]

    def bulk_snapshot(self, updates: Iterable[tuple[str, str, str]]) -> None:
        """Persist (source_id, normalized_text, hash) triples after a pass in a single atomic transaction."""
        now = time.time()
        with self._conn:
            for source_id, text, content_hash in updates:
                self._conn.execute(
                    """
                    INSERT INTO source_state
                        (source_id, last_hash, last_text, last_modified,
                         last_checked_at, last_status, check_count)
                    VALUES (?, ?, ?, ?, ?, ?, 1)
                    ON CONFLICT(source_id) DO UPDATE SET
                        last_hash = excluded.last_hash,
                        last_text = excluded.last_text,
                        last_modified = excluded.last_modified,
                        last_checked_at = excluded.last_checked_at,
                        last_status = excluded.last_status,
                        check_count = source_state.check_count + 1
                    """,
                    (source_id, content_hash, text, None, now, "ok"),
                )

    def export_report(self) -> str:
        rows = self._conn.execute(
            "SELECT source_id, last_status, last_checked_at, check_count"
            " FROM source_state ORDER BY source_id"
        ).fetchall()
        return json.dumps(
            [
                {
                    "sourceId": row[0],
                    "lastStatus": row[1],
                    "lastCheckedAt": row[2],
                    "checkCount": row[3],
                }
                for row in rows
            ],
            indent=2,
            ensure_ascii=False,
        )
