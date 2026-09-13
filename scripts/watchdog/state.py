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
_DIFF_EXCERPT_LINES = 40


def _similarity_and_exact(before: str, after: str) -> tuple[float, bool]:
    """Return (similarity ratio, used_exact_sequence_matcher)."""
    if max(len(before), len(after)) <= SEQUENCE_MATCHER_MAX_CHARS:
        return difflib.SequenceMatcher(None, before, after).ratio(), True
    before_lines = {hash(line) for line in before.splitlines()}
    after_lines = {hash(line) for line in after.splitlines()}
    if not before_lines and not after_lines:
        return 1.0, False
    return len(before_lines & after_lines) / len(before_lines | after_lines), False


def _bounded_unified_diff(before: str, after: str, source_id: str) -> str:
    """Unified diff for small docs; bounded first-divergence excerpt for big ones."""
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
            head.append(f"@@ line {index + 1} @@")
            head.append(f"- {old[:200]}")
            head.append(f"+ {new[:200]}")
            shown += 1
            if shown >= 5:
                break
    if shown == 0:
        # Divergence is purely in length (lines appended/removed).
        head.append(f"@@ line {min(len(before_lines), len(after_lines)) + 1} @@")
        tail_source = before_lines if len(before_lines) > len(after_lines) else after_lines
        sign = "-" if len(before_lines) > len(after_lines) else "+"
        for line in tail_source[min(len(before_lines), len(after_lines)) :][:5]:
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

    def to_dict(self) -> dict:
        return {
            "kind": self.kind,
            "sourceId": self.source_id,
            "similarity": round(self.similarity, 4),
            "beforeHash": self.before_hash,
            "afterHash": self.after_hash,
            "unifiedDiff": self.unified_diff[:8000],
            "metadata": self.metadata,
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
        similarity, exact = _similarity_and_exact(before_text, current_text)
        threshold = SIMILARITY_THRESHOLD if exact else JACCARD_SIMILARITY_THRESHOLD

        if similarity >= threshold:
            # Cosmetic churn — record the new snapshot but do not report.
            return [
                Change(
                    kind="cosmetic",
                    source_id=source_id,
                    similarity=similarity,
                    before_hash=previous["last_hash"],
                    after_hash=current_hash,
                    metadata=metadata or {},
                )
            ]

        return [
            Change(
                kind="modified",
                source_id=source_id,
                similarity=similarity,
                before_hash=previous["last_hash"],
                after_hash=current_hash,
                unified_diff=_bounded_unified_diff(
                    before_text, current_text, source_id
                ),
                metadata=metadata or {},
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
