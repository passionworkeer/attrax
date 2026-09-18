"""Auto-ingest: apply watchdog-detected changes into the regulation library.

Design (user directive 2026-09-13): no manual review — a real change is
ingested automatically the moment it is detected, with conservative
update/create/mark semantics ("更新删改"):

- **UPDATE** — source maps to an existing ``data/regulations/{region}/{id}.yaml``:
  refresh ``last_verified`` / ``checksum_sha256`` / ``raw_file`` /
  ``source_url`` and append an audit note. The original YAML is backed up to
  ``data/regulation_supplements/auto-{date}/backup/`` so any bad auto-update
  is one file copy away from being reverted. ``articles[]`` is never
  rewritten mechanically (verbatim official text extraction stays an
  explicit follow-up; see regulation ``notes``).
- **CREATE** — source is mappable (EU CELEX → ``EU-{year}-{number}``) but no
  YAML exists (e.g. WEEE 2012/19): create a minimal public entry carrying
  the derived citation + raw file pointer, ``articles: []`` pending
  extraction.
- **MARK (删)** — nothing is ever hard-deleted automatically: a network flake
  must not be able to destroy the KB. Sources that keep failing for
  ``STALE_AFTER_CONSECUTIVE_FAILURES`` days get ``status: stale`` on their
  target YAML; Federal Register documents whose action/title indicates
  removal/revocation set ``status: repealed``. Both remain visible in the
  index for a human to act on.
- **EVIDENCE** — every changed source (mapped or not) stores its raw fetched
  document + metadata + unified diff under
  ``data/regulation_supplements/auto-{date}/{source_id}/`` so the ingest is
  auditable end-to-end.

After applying, ``regulations_index.json`` is rebuilt from the YAML tree and
the ingested sources are snapshotted (baseline moves forward) — replacing
the manual ``--ack`` flow, which remains available when auto-ingest is
disabled via ``ATTRAX_REGWATCH_AUTO_INGEST=false``.
"""
from __future__ import annotations

import concurrent.futures
import contextlib
import itertools
import json
import logging
import os
import re
import shutil
import sys
import threading
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import yaml

logger = logging.getLogger("attrax.regwatch.auto_ingest")

# 与 check_sources.py 相同：让 `python3 scripts/watchdog/auto_ingest.py` 直跑也能
# import scripts.*（-m 方式不需要，但文件路径方式的 sys.path[0] 不含仓库根）。
_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from scripts.watchdog.collectors.base import RegulationUpdate
from scripts.watchdog.state import Change

REPO = Path(__file__).resolve().parents[2]
REGULATIONS_ROOT = REPO / "data" / "regulations"
SUPPLEMENTS_DIR = REPO / "data" / "regulation_supplements"
INDEX_PATH = REGULATIONS_ROOT / "regulations_index.json"
AUTO_STATE_PATH = SUPPLEMENTS_DIR / ".auto_state.json"

STALE_AFTER_CONSECUTIVE_FAILURES = 7

# Bounded pool for per-source ingest (2026-09-18 H16/M20). The ingest work is
# disk-bound (evidence raw files run to ~9 MB per source; a busy pass writes
# ~180 MB + 20 YAML rewrites), so four workers overlap those writes with each
# other and with the orchestrator's remaining fetches instead of serializing
# them on the orchestrator's main thread. Deliberately small: the writer is
# one disk, and more workers would only deepen the write queue.
INGEST_WORKERS = 4

# Temp-file suffix disambiguator for _write_atomic. A per-call counter makes
# the temp name unique across *threads in one process* (pid alone would not:
# two ingest workers writing under the same pid would collide if they ever
# targeted the same path, and the counter keeps that impossible even if a
# future caller forgets the per-regulation lock).
_TMP_COUNTER = itertools.count()

# CELEX → regulation id, e.g. "32011L0065" → ("EU-2011-65", "Directive 2011/65/EU")
_CELEX_RE = re.compile(r"^3(\d{4})([LRD])(\d{4})$")
# Canada Justice Laws XML URLs encode the statutory instrument id
# (SOR for English, DORS for French) — used as the canonical reg_id stem.
_CA_INSTRUMENT_RE = re.compile(r"/((?:S|D(?:O|ORS)|SOR))-(\d{4})-(\d+)\.xml", re.IGNORECASE)
_REGION_DIRS: dict[str, str] = {
    "EU": "eu", "US": "us", "CN": "cn", "UK": "uk", "AU": "au",
    "UN": "un", "CA": "ca", "NZ": "nz", "JP": "jp", "KR": "kr",
    "SA": "sa", "AE": "ae", "BR": "br", "IN": "in", "SG": "sg",
    "MX": "mx", "DE": "de", "FR": "fr", "IT": "it",
}
_RAW_SUFFIX = {
    "eu_celex": ".rdf",
    "ecfr_part": ".json",
    "cpsc_recall_api": ".json",
    "canada_justice_xml": ".xml",
    "gov_html": ".html",
    "direct_url": ".html",
    "safety_gate": ".xml",
    "openfda_recalls": ".json",
}
_REPEAL_KEYWORDS = ("removal", "revok", "repeal", "revocation", "withdraw")


def _write_atomic(path: Path, content: str) -> None:
    """Write ``content`` to ``path`` without ever leaving a half-written file.

    ``Path.write_text`` truncates the target first and then writes the new
    bytes — a SIGKILL or ENOSPC in between leaves the YAML / index / state
    file empty or corrupt, which ``safe_load`` then silently skips on the
    next pass. The watchdog runs unattended, so a single bad write means
    the whole library drifts from the snapshot until a human notices.

    The temp file is sibling to ``path`` so the rename is a single ``rename(2)``
    on the same filesystem (atomic on POSIX, which is what the aliyun-sz
    production host runs). ``os.replace`` is the cross-POSIX rename; on
    Windows it would overwrite, but we do not deploy there.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    # Unique per call: pid separates processes, the counter separates threads
    # inside one process (ingest workers may write concurrently).
    tmp = tmp.with_name(f"{tmp.name}.{os.getpid()}.{next(_TMP_COUNTER)}")
    try:
        with open(tmp, "w", encoding="utf-8", newline="") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    except Exception:
        # Don't leave a stale temp file lying around — next call to this
        # helper for the same path would skip the rename.
        with contextlib.suppress(OSError):
            tmp.unlink()
        raise


# Citation text templates for the auto-CREATE path. These mirror the
# editorial style used elsewhere in the library (see data/regulations/
# eu/EU-*.yaml "official_citation" fields). The fallback in
# _citation_from_entry() returns entry["title"] verbatim when nothing
# matches.
_CITATION_TEMPLATES: dict[str, str] = {
    "us": "16 CFR Part {part}",
    "uk": "UK {title}",
    "nz": "{title} (NZ)",
    "ca": "{instrument} {year}/{number}",
    "jp": "{title} (JP)",
    "kr": "{title} (KR)",
    "sa": "{title} (SA)",
    "ae": "{title} (AE)",
    "br": "{title} (BR)",
    "in": "{title} (IN)",
    "sg": "{title} (SG)",
    "mx": "{title} (MX)",
}


def _region_dir(market: str) -> str | None:
    """Lowercase directory name for the regulation library root."""
    return _REGION_DIRS.get(str(market or "").strip().upper())


def _slug_to_reg_id(slug: str, market: str) -> str | None:
    """Build a stable regulation_id from an official_sources entry id slug.

    Used as a fallback when no explicit ``regulation_id`` is declared on the
    entry. Strategy: drop the leading market token and a small English
    stop-word list, then take up to three significant tokens, uppercased.

    Examples:
        uk-weee-regulations-guidance           → UK-WEEE
        uk-packaging-epr-who-is-affected...    → UK-Packaging-EPR
        uk-hse-svhc-overview                    → UK-HSE-SVHC
        nz-product-safety-standards-2005        → NZ-Product-Safety-Standards
    """
    parts = slug.split("-")
    if not parts or not parts[0]:
        return None
    significant: list[str] = []
    stop = {"regulations", "regulation", "guidance", "overview", "compliance",
            "standard", "standards", "the", "of", "and", "for", "to",
            "is", "are", "what", "do", "who", "affected"}
    for token in parts[1:]:
        if not token or token in stop:
            continue
        # Drop trailing year-only tokens (handled by last_verified/last_verified_by)
        if token.isdigit() and len(token) == 4:
            continue
        significant.append(token)
        if len(significant) >= 3:
            break
    if not significant:
        return None
    return f"{market.upper()}-{'-'.join(p.upper() for p in significant)}"


def _infer_reg_id_from_entry(entry: dict) -> str | None:
    """Per-source-type reg_id inference. Returns None when the source type
    has no mechanical rule (e.g. recalls / RSS feeds are not regulation
    texts)."""
    source_type = entry.get("source_type", "")

    # Backward compat: if source_type is absent but a CELEX is present, treat
    # as EU Cellar (the legacy convention pre-2026-09-16). New entries
    # always set source_type explicitly.
    if not source_type:
        if entry.get("celex"):
            celex = str(entry["celex"]).strip()
            match = _CELEX_RE.match(celex)
            if match:
                year, _type, number = match.groups()
                return f"EU-{year}-{int(number)}"
        return None

    if source_type == "eu_celex":
        celex = str(entry.get("celex") or "").strip()
        if not celex:
            return None
        match = _CELEX_RE.match(celex)
        if not match:
            return None
        year, _type, number = match.groups()
        return f"EU-{year}-{int(number)}"

    if source_type == "ecfr_part":
        title = entry.get("ecfr_title")
        part = entry.get("ecfr_part")
        if not title or not part:
            return None
        return f"US-{int(title)}-CFR-{int(part)}"

    if source_type == "canada_justice_xml":
        url = str(entry.get("source_url", ""))
        match = _CA_INSTRUMENT_RE.search(url)
        if not match:
            return None
        instrument = match.group(1).upper().replace("DORS", "DORS").replace("SOR", "SOR")
        # Normalize S/D variants: DORS (French) → keep, SOR (English) → keep.
        # The library's id space prefers SOR- for visibility; DORS and SOR
        # are the same instrument family.
        if instrument.startswith("D"):
            family = "DORS"
        else:
            family = "SOR"
        year, num = match.group(2), int(match.group(3))
        return f"CA-{family}-{year}-{num}"

    if source_type in {"gov_html", "direct_url"}:
        market = str(entry.get("market", "")).strip().upper()
        if not _region_dir(market):
            return None
        slug = entry.get("id", "")
        if not slug:
            return None
        return _slug_to_reg_id(slug, market)

    # Discovery / signal streams. They tell an operator that something moved,
    # but they are not themselves a regulation text, so no YAML is created or
    # updated — the raw fetch still lands under auto-{date}/ as evidence.
    #   - openfda_recalls  : FDA device / food enforcement reports
    #   - cpsc_recall_api  : CPSC recalls via the SaferProducts.gov API
    return None


def regulation_for_source(entry: dict) -> tuple[str, Path] | None:
    """Map an official_sources entry to (regulation_id, yaml_path), or None.

    Resolution order:
    1. Explicit ``entry["regulation_id"]`` if present (canonical hand-curated
       mapping — preferred; survives future slug renames).
    2. Per-source-type inference (EU CELEX → ``EU-{year}-{number}``;
       eCFR → ``US-{title}-CFR-{part}``; Canada Justice → ``CA-SOR-...``;
       gov_html / direct_url → ``<MARKET>-<slug>``).

    Returns None when no rule matches (e.g. RSS feeds are not regulation
    texts; those stay evidence-only).
    """
    explicit = str(entry.get("regulation_id") or "").strip()
    if explicit:
        # Honor the on-disk location implied by the id prefix when possible.
        # ``EU-...`` → eu/, ``US-...`` → us/, etc. Falls back to the
        # entry's market directory for non-conforming ids.
        prefix = explicit.split("-", 1)[0].upper()
        candidate_dir = _REGION_DIRS.get(prefix)
        market_dir = _region_dir(str(entry.get("market", "")))
        region_dir = candidate_dir or market_dir
        if region_dir:
            return explicit, REGULATIONS_ROOT / region_dir / f"{explicit}.yaml"
        return None

    inferred = _infer_reg_id_from_entry(entry)
    if not inferred:
        return None
    market_dir = _region_dir(str(entry.get("market", "")))
    # Fallback: when the entry lacks an explicit market (legacy fixtures
    # pre-2026-09-16), infer from the reg_id's first segment.
    if not market_dir:
        market_dir = _REGION_DIRS.get(inferred.split("-", 1)[0].upper())
    if not market_dir:
        return None
    return inferred, REGULATIONS_ROOT / market_dir / f"{inferred}.yaml"


def _citation_from_celex(celex: str) -> str:
    match = _CELEX_RE.match(celex)
    if not match:
        return celex
    year, type_letter, number = match.groups()
    if type_letter == "R":
        return f"Regulation (EU) {year}/{int(number)}"
    if type_letter == "D":
        return f"Decision (EU) {year}/{int(number)}"
    return f"Directive {year}/{int(number)}/EU"


def _citation_from_entry(entry: dict) -> str:
    """Build a citation string from any source-type's registry entry.

    Used by the auto-CREATE path so non-EU sources get a sensible citation
    instead of falling back to the raw title verbatim.
    """
    # CELEX first (independent of source_type) — some call sites pass a
    # bare {id, celex} dict (e.g. the CREATE-path test fixture) and we
    # still want a real "Directive YYYY/NNN/EU" instead of the id slug.
    celex = str(entry.get("celex") or "").strip()
    if celex and _CELEX_RE.match(celex):
        return _citation_from_celex(celex)
    source_type = entry.get("source_type", "")
    if source_type == "eu_celex":
        return _citation_from_celex(celex)
    if source_type == "ecfr_part":
        title = entry.get("ecfr_title")
        part = entry.get("ecfr_part")
        if title and part:
            return _CITATION_TEMPLATES["us"].format(part=part)
    if source_type == "canada_justice_xml":
        url = str(entry.get("source_url", ""))
        match = _CA_INSTRUMENT_RE.search(url)
        if match:
            return _CITATION_TEMPLATES["ca"].format(
                instrument=match.group(1).upper(),
                year=match.group(2),
                number=int(match.group(3)),
            )
    market = str(entry.get("market", "")).strip().lower()
    template = _CITATION_TEMPLATES.get(market)
    if template:
        return template.format(title=entry.get("title", entry.get("id", "")))
    return entry.get("title", entry.get("id", ""))


@dataclass
class IngestReport:
    created: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    marked: list[str] = field(default_factory=list)
    evidence_only: list[str] = field(default_factory=list)
    failed: list[dict] = field(default_factory=list)
    #: Per-source audit rows (sourceId → regulationId → action → evidence).
    #: The flat lists above stay for backward compatibility with existing
    #: consumers and tests; ``records`` is what the review CLI reads.
    records: list[dict] = field(default_factory=list)

    @property
    def touched_regulations(self) -> set[str]:
        return set(self.created) | set(self.updated) | set(self.marked)

    def to_dict(self) -> dict:
        return {
            "created": self.created,
            "updated": self.updated,
            "marked": self.marked,
            "evidenceOnly": self.evidence_only,
            "failed": self.failed,
            "records": self.records,
        }


def _citation_from_celex(celex: str) -> str:
    match = _CELEX_RE.match(celex)
    if not match:
        return celex
    year, type_letter, number = match.groups()
    if type_letter == "R":
        return f"Regulation (EU) {year}/{int(number)}"
    if type_letter == "D":
        return f"Decision (EU) {year}/{int(number)}"
    return f"Directive {year}/{int(number)}/EU"


def _title_from_rdf(text: str) -> str:
    """Best-effort English title from Cellar RDF (dc:/dcterms: title)."""
    for tag in ("dc:title", "dcterms:title"):
        for lang in ('xml:lang="en"', 'xml:lang="eng"'):
            match = re.search(
                rf"<{tag}[^>]*{lang}[^>]*>\s*([^<{{}}]{{3,300}})\s*</{tag}>", text
            )
            if match:
                return match.group(1).strip()
        match = re.search(rf"<{tag}[^>]*>\s*([^<{{}}]{{3,300}})\s*</{tag}>", text)
        if match:
            return match.group(1).strip()
    return ""


def _looks_like_repeal(update: RegulationUpdate) -> bool:
    """FR API documents whose type/title announces removal/revocation."""
    blob = f"{update.title} {update.metadata.get('recentTitles', '')}".lower()
    return any(keyword in blob for keyword in _REPEAL_KEYWORDS)


# ── Verbatim extraction (verbatim replacement pass, 2026-09-16) ──────────
# The pre-existing UPDATE path never rewrote article bodies — see the
# module docstring for the rationale. With J08 / §4.4 layer 3 governance
# in place (``source_kind: unverified`` blocks verbatim quoting), we can
# safely auto-promote a few sources where the article boundaries are
# well-structured. The extractor below is deliberately conservative:
#
#   - EU Cellar RDF: split on literal ``Article <n>`` / ``Article <n><letter>``
#     markers after collapsing the RDF into readable text.
#   - Generic text: split on numbered headings like ``Article 4.`` /
#     ``Section 5`` / ``§ 12``.
#   - Only slots that actually had an entry in the previous YAML get
#     filled; orphan sections in the new text are dropped.
#   - If we can't cleanly align the slots, we return ``articles=[]`` and
#     the caller leaves ``source_kind`` at ``unverified`` (a human will
#     spot-check later via the applied.json record).

# Order matters: longer patterns first so "Article 12A" doesn't lose the
# suffix to a "Article 12" match. Anchored to line starts to avoid
# matching mid-sentence citations like "...in Article 4 above".
# Each branch uses a unique group name; _match_group() picks the first
# non-None group when extracting the article id.
_ARTICLE_PATTERNS: tuple[str, ...] = (
    r"^\s*Article\s+(?P<art_id_a>\d+[A-Za-z]*)\s*\.?\s*$",
    r"^\s*Article\s+(?P<art_id_b>\d+[A-Za-z]*)\s+",
    r"^\s*Section\s+(?P<sec_id>\d+[A-Za-z\.\-]*)\s*\.?\s*$",
    r"^\s*§\s*(?P<sec_id_alt>\d+[A-Za-z\.\-]*)\s*\.?\s*$",
    r"^\s*(?:ARTICLE|Article)\s+(?P<rom_id>[IVX]+)\s*\.?\s*$",  # Roman numerals
)
_ARTICLE_RE = re.compile("|".join(_ARTICLE_PATTERNS), re.MULTILINE)


def _match_group(match: re.Match, names: tuple[str, ...]) -> str | None:
    for n in names:
        v = match.group(n)
        if v is not None:
            return v
    return None


@dataclass
class _ExtractedArticles:
    articles: list[dict]
    promoted_kind: str  # "official_summary" or "official_verbatim"
    matched_slots: int
    unmatched_previous: int


def _extract_articles_from_text(
    text: str,
    previous_articles: list[dict],
    source_type: str,
) -> _ExtractedArticles:
    """Split a freshly fetched regulation text into per-article chunks.

    Returns an empty list when the text does not appear to be structured
    by articles (so the UPDATE path leaves ``source_kind`` at
    ``unverified`` and a human can later patch the YAML by hand).

    Promotion tier:
      - ``eu_celex`` RDF is verbatim from the official Cellar feed → ``official_verbatim``
      - Everything else → ``official_summary`` (faithful chunking of the
        fetched text, but the upstream is not guaranteed verbatim)
    """
    if not text or not previous_articles:
        return _ExtractedArticles(articles=[], promoted_kind="unverified", matched_slots=0, unmatched_previous=len(previous_articles))

    # Find article boundaries and slice text into (id, body) pairs.
    boundaries = []
    for match in _ARTICLE_RE.finditer(text):
        aid = _match_group(match, ("art_id_a", "art_id_b", "sec_id", "sec_id_alt", "rom_id"))
        if not aid:
            continue
        boundaries.append((match.start(), aid))
    boundaries.sort(key=lambda b: b[0])

    if not boundaries:
        return _ExtractedArticles(articles=[], promoted_kind="unverified", matched_slots=0, unmatched_previous=len(previous_articles))

    chunks: list[tuple[str, str]] = []
    for index, (offset, aid) in enumerate(boundaries):
        end = boundaries[index + 1][0] if index + 1 < len(boundaries) else len(text)
        body = text[offset:end].strip()
        # Drop the heading line itself so the body is just the prose.
        first_newline = body.find("\n")
        body = body[first_newline + 1:].strip() if first_newline != -1 else ""
        chunks.append((aid, body))

    # Align to previous slot ids (case-insensitive, strip trailing dot).
    prev_ids = {str(a.get("id") or "").strip().rstrip(".").lower(): a for a in previous_articles}
    matched = []
    unmatched = 0
    for aid, body in chunks:
        # Try several normalisations to handle "Article 4" / "art-4" / "Article 4A"
        candidates = [aid.lower(), aid.lower().rstrip("."), f"art-{aid.lower()}", f"art-{aid.lower().rstrip('.')}", aid.lower().replace("article ", "")]
        prev = None
        for c in candidates:
            if c in prev_ids:
                prev = prev_ids[c]
                break
        if prev is None:
            # No previous slot — skip the chunk; don't pollute the YAML.
            continue
        if not body:
            unmatched += 1
            continue
        new_article = dict(prev)  # preserve title + structural fields
        new_article["text"] = body
        matched.append(new_article)

    if not matched:
        return _ExtractedArticles(articles=[], promoted_kind="unverified", matched_slots=0, unmatched_previous=len(previous_articles))

    promoted = "official_verbatim" if source_type == "eu_celex" else "official_summary"
    return _ExtractedArticles(articles=matched, promoted_kind=promoted, matched_slots=len(matched), unmatched_previous=unmatched)


@dataclass
class IngestOutcome:
    """Result of ingesting one source, returned instead of touching the report.

    2026-09-18 H16/M20: per-source ingest now runs on worker threads, so a
    worker cannot append to the shared ``IngestReport`` — it returns this
    and the collecting thread folds it in (``AutoIngestor._merge``), which
    also keeps the report ordering deterministic.
    """

    source_id: str
    action: str  # "created" | "updated" | "evidence-only"
    reg_id: str | None
    evidence_dir: Path
    record: dict
    #: e.g. "EU-2011-65:repealed" — mirrors the old report.marked append.
    marked: str | None = None


class AutoIngestor:
    def __init__(self, run_date: str | None = None) -> None:
        self.run_date = run_date or date.today().isoformat()
        self.batch_dir = SUPPLEMENTS_DIR / f"auto-{self.run_date}"
        self.report = IngestReport()
        # One lock per regulation id so two sources mapped to the same YAML
        # serialize their read-modify-write (and their backup copy) instead
        # of clobbering each other's audit note. ``self.report`` is only ever
        # touched by the collecting thread.
        self._reg_locks: dict[str, threading.Lock] = {}
        self._reg_locks_guard = threading.Lock()

    def _regulation_lock(self, reg_id: str) -> threading.Lock:
        """Per-regulation write lock (same id → same lock instance)."""
        with self._reg_locks_guard:
            lock = self._reg_locks.get(reg_id)
            if lock is None:
                lock = self._reg_locks[reg_id] = threading.Lock()
            return lock

    # ── public entry ───────────────────────────────────────────────────

    def apply(
        self,
        entries_by_id: dict[str, dict],
        updates: dict[str, RegulationUpdate],
        changes: list[Change],
    ) -> IngestReport:
        """Ingest every non-cosmetic change, over a bounded worker pool.

        Sources that ingest cleanly are returned via report; callers advance
        their snapshot for those. Report ordering is by ``changes`` order,
        not by thread completion, so two passes over the same input write
        byte-identical ``applied.json``.
        """
        changed = [c for c in changes if c.kind in {"added", "modified"}]
        jobs: list[tuple[str, dict, RegulationUpdate, Change]] = []
        missing: list[str] = []
        for change in changed:
            entry = entries_by_id.get(change.source_id)
            update = updates.get(change.source_id)
            if entry is None or update is None:
                missing.append(change.source_id)
            else:
                jobs.append((change.source_id, entry, update, change))

        outcomes: dict[str, tuple[IngestOutcome | None, str | None]] = {
            source_id: (None, "missing entry/update") for source_id in missing
        }
        if jobs:
            with concurrent.futures.ThreadPoolExecutor(
                max_workers=max(1, min(INGEST_WORKERS, len(jobs))),
                thread_name_prefix="regwatch-ingest",
            ) as pool:
                futures = [
                    (
                        source_id,
                        pool.submit(
                            self.ingest_source, source_id, entry, update, change
                        ),
                    )
                    for source_id, entry, update, change in jobs
                ]
                for source_id, future in futures:
                    outcomes[source_id] = self._resolve(future)

        for change in changed:
            outcome, error = outcomes[change.source_id]
            self._merge(change.source_id, outcome, error)

        if self.report.touched_regulations:
            self._rebuild_index()
        return self.report

    def collect_parallel(
        self,
        jobs: list[tuple[str, "concurrent.futures.Future[IngestOutcome]"]],
    ) -> IngestReport:
        """Drain ingest futures that were submitted during the fetch phase.

        The orchestrator dispatches ``ingest_source`` into a bounded pool the
        moment a source's fetch+diff lands, so the evidence writes overlap the
        remaining fetches (H16/M20). This call waits for every job, folds the
        outcomes in (source_id order — deterministic), and rebuilds the index
        exactly once, single-threaded, after all writers have stopped.
        """
        collected: list[tuple[str, IngestOutcome | None, str | None]] = []
        for source_id, future in jobs:
            outcome, error = self._resolve(future)
            collected.append((source_id, outcome, error))

        for source_id, outcome, error in sorted(collected, key=lambda item: item[0]):
            self._merge(source_id, outcome, error)

        if self.report.touched_regulations:
            self._rebuild_index()
        return self.report

    @staticmethod
    def _resolve(
        future: "concurrent.futures.Future[IngestOutcome]",
    ) -> tuple[IngestOutcome | None, str | None]:
        """Per-source failure isolation across the thread boundary: an
        exception in one worker becomes a ``failed[]`` entry, never a crash
        of the pass."""
        try:
            return future.result(), None
        except Exception as exc:  # noqa: BLE001 — per-source isolation
            return None, f"{type(exc).__name__}: {exc}"

    def _merge(
        self, source_id: str, outcome: IngestOutcome | None, error: str | None
    ) -> None:
        """Fold one per-source result into the shared report (collector
        thread only) — the append order mirrors the old serial loop."""
        if outcome is None:
            self.report.failed.append(
                {"sourceId": source_id, "error": error or "unknown ingest failure"}
            )
            return
        if outcome.action == "created":
            self.report.created.append(outcome.reg_id)
        elif outcome.action == "updated":
            self.report.updated.append(outcome.reg_id)
        else:
            self.report.evidence_only.append(source_id)
        if outcome.marked:
            self.report.marked.append(outcome.marked)
        self.report.records.append(outcome.record)

    # ── per-source ─────────────────────────────────────────────────────

    def ingest_source(
        self,
        source_id: str,
        entry: dict,
        update: RegulationUpdate,
        change: Change,
    ) -> IngestOutcome:
        """Ingest one source. Thread-safe: the only shared state it touches
        is the per-regulation lock (evidence and YAML paths are per-source /
        per-regulation). Used by ``apply`` and by the orchestrator's ingest
        pool via ``collect_parallel``."""
        return self._ingest_one(source_id, entry, update, change)

    def _ingest_one(
        self,
        source_id: str,
        entry: dict,
        update: RegulationUpdate,
        change: Change,
    ) -> IngestOutcome:
        # Resolve the mapping first so the evidence pin (meta.json) can record
        # which regulation this fetch is backing — that link is what the
        # review CLI uses to go from a regulation id back to its raw bytes.
        mapping = regulation_for_source(entry)
        reg_id = mapping[0] if mapping is not None else None

        # 1. Evidence layer (always, mapped or not).
        evidence_dir = self._store_evidence(source_id, entry, update, change, reg_id)
        raw_name = "raw" + _RAW_SUFFIX.get(update.source_type, ".bin")

        if mapping is None:
            return IngestOutcome(
                source_id=source_id,
                action="evidence-only",
                reg_id=None,
                evidence_dir=evidence_dir,
                record=self._record(
                    source_id, entry, update, change, None, "evidence-only", evidence_dir
                ),
            )
        reg_id, yaml_path = mapping

        status_mark = "repealed" if _looks_like_repeal(update) else None

        # Everything below mutates the regulation YAML (and its backup), so it
        # runs under the per-regulation lock: a second source mapped to the
        # same regulation — or record_failure's stale-marking — must serialize
        # against this read-modify-write instead of clobbering the audit note.
        with self._regulation_lock(reg_id):
            # 2. UPDATE path.
            if yaml_path.exists():
                payload = yaml.safe_load(yaml_path.read_text(encoding="utf-8")) or {}
                backup_dir = self.batch_dir / "backup"
                backup_dir.mkdir(parents=True, exist_ok=True)
                shutil.copy2(yaml_path, backup_dir / f"{reg_id}.yaml")

                payload["last_verified"] = self.run_date
                payload["last_verified_by"] = "regwatch-auto"
                payload["checksum_sha256"] = update.content_hash
                payload["raw_file"] = str(evidence_dir / raw_name)
                payload["source_url"] = update.source_url
                if status_mark:
                    payload["status"] = status_mark

                # Verbatim replacement pass (2026-09-16): when the regulation
                # YAML is still flagged ``source_kind: unverified`` (article
                # bodies are KB-condensed summaries that must not enter the
                # exact-quote flow), AND the newly fetched text looks like it
                # contains structured article boundaries, swap the
                # summaries for the official text and promote the source_kind
                # to ``official_summary`` so the verifier can quote-match
                # against the real text from the next pass onward.
                #
                # Conservative gates:
                # 1. source_kind must currently be ``unverified`` (or unset,
                #    which the spec treats as NOT-verbatim-allowed).
                # 2. Extractor must yield at least one new article whose text
                #    differs from the existing slot.
                # 3. New articles list must be at least as long as the old
                #    one — never shrink the coverage footprint.
                #
                # If any gate fails, we leave the YAML's source_kind alone and
                # append a "verbatim pending human spot-check" note instead.
                current_kind = str(payload.get("source_kind") or "").strip()
                if current_kind in {"", "unverified"}:
                    extracted = _extract_articles_from_text(
                        update.text,
                        payload.get("articles") or [],
                        entry.get("source_type", ""),
                    )
                    if extracted.articles and len(extracted.articles) >= len(payload.get("articles") or []):
                        payload["articles"] = extracted.articles
                        payload["source_kind"] = extracted.promoted_kind
                        audit_kind = f"verbatim {extracted.promoted_kind}"
                    else:
                        audit_kind = "verbatim pending (extractor found no clean split)"
                else:
                    audit_kind = "verbatim skipped (already official)"

                audit = (
                    f"regwatch auto-{change.kind} {self.run_date}: similarity "
                    f"{change.similarity:.3f}, {audit_kind}, "
                    f"evidence in auto-{self.run_date}/{source_id}/."
                )
                payload["notes"] = f"{payload.get('notes') or ''} {audit}".strip()
                self._write_yaml(yaml_path, payload)
                return IngestOutcome(
                    source_id=source_id,
                    action="updated",
                    reg_id=reg_id,
                    evidence_dir=evidence_dir,
                    record=self._record(
                        source_id, entry, update, change, reg_id, "updated", evidence_dir
                    ),
                    marked=f"{reg_id}:{status_mark}" if status_mark else None,
                )

            # 3. CREATE path (mappable but no YAML — e.g. WEEE 2012/19 or any
            # newly-tracked non-EU source whose backing YAML has not been
            # committed yet). Under the same lock so a create and an update
            # for one regulation can never interleave.
            citation = _citation_from_entry(entry)
            # RDF title extraction is EU-Cellar specific; for everything else
            # the registry entry's title is the best we have on hand.
            if entry.get("source_type") == "eu_celex":
                title = _title_from_rdf(update.text) or citation
            else:
                title = entry.get("title") or citation
            region = str(entry.get("market", "")).strip().upper() or "EU"
            payload = {
                "id": reg_id,
                "official_citation": citation,
                "short_name": title[:200],
                "region": region,
                "license": "public",
                "last_verified": self.run_date,
                "last_verified_by": "regwatch-auto",
                "language": "en",
                "articles": [],
                "raw_file": str(evidence_dir / raw_name),
                "checksum_sha256": update.content_hash,
                "schema_version": 1,
                "source_url": update.source_url,
                "notes": (
                    f"Auto-created by regwatch {self.run_date} from official source"
                    f" {source_id} ({entry.get('source_type', 'unknown')});"
                    f" articles pending extraction from the stored raw file."
                    f" Authoring note: a KB anchor in data/kb/anchors/{reg_id}.yaml"
                    f" is required to surface this regulation in generator"
                    f" must-check output — see docs/WATCHDOG.md §CREATE."
                ),
            }
            yaml_path.parent.mkdir(parents=True, exist_ok=True)
            self._write_yaml(yaml_path, payload)
            return IngestOutcome(
                source_id=source_id,
                action="created",
                reg_id=reg_id,
                evidence_dir=evidence_dir,
                record=self._record(
                    source_id, entry, update, change, reg_id, "created", evidence_dir
                ),
            )

    @staticmethod
    def _record(
        source_id: str,
        entry: dict,
        update: RegulationUpdate,
        change: Change,
        reg_id: str | None,
        action: str,
        evidence_dir: Path,
    ) -> dict:
        """One row of the source→regulation audit trail.

        ``applied.json`` carries these so an operator can answer "which
        official source moved this YAML, and where are the bytes" without
        cross-referencing the evidence tree by hand.
        """
        return {
            "sourceId": source_id,
            "regulationId": reg_id,
            "action": action,
            "changeKind": change.kind,
            "similarity": round(change.similarity, 4),
            "sourceType": update.source_type,
            "market": update.market,
            "sourceUrl": update.source_url,
            "contentHash": update.content_hash,
            "evidenceDir": str(evidence_dir),
        }

    def _store_evidence(
        self,
        source_id: str,
        entry: dict,
        update: RegulationUpdate,
        change: Change,
        reg_id: str | None = None,
    ) -> Path:
        evidence_dir = self.batch_dir / source_id
        evidence_dir.mkdir(parents=True, exist_ok=True)
        suffix = _RAW_SUFFIX.get(update.source_type, ".bin")
        (evidence_dir / f"raw{suffix}").write_text(update.text, encoding="utf-8")
        (evidence_dir / "meta.json").write_text(
            json.dumps(
                {
                    "sourceId": source_id,
                    "regulationId": reg_id,
                    "market": update.market,
                    "sourceType": update.source_type,
                    "sourceUrl": update.source_url,
                    "title": update.title,
                    "contentHash": update.content_hash,
                    "similarity": round(change.similarity, 4),
                    "changeKind": change.kind,
                    "fetchedAt": self.run_date,
                    "metadata": update.metadata,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        if change.unified_diff:
            (evidence_dir / "diff.txt").write_text(change.unified_diff, encoding="utf-8")
        return evidence_dir

    # ── failure-streak marking (删 without deleting) ────────────────────

    def record_failure(self, source_id: str, entry: dict) -> None:
        """Increment the consecutive-failure counter; at the threshold, mark
        the mapped regulation YAML ``status: stale`` (never delete)."""
        state = self._load_auto_state()
        streak = int(state.get("failureStreaks", {}).get(source_id, 0)) + 1
        state.setdefault("failureStreaks", {})[source_id] = streak

        if streak >= STALE_AFTER_CONSECUTIVE_FAILURES:
            mapping = regulation_for_source(entry)
            if mapping:
                reg_id, yaml_path = mapping
                marked = False
                # Same per-regulation lock the ingest workers take, so the
                # stale-marking read-modify-write cannot interleave with a
                # concurrent ingest of the same YAML (H16/M20). The index
                # rebuild stays outside the critical section.
                with self._regulation_lock(reg_id):
                    if yaml_path.exists():
                        payload = yaml.safe_load(yaml_path.read_text(encoding="utf-8")) or {}
                        payload["status"] = "stale"
                        payload["notes"] = (
                            f"{payload.get('notes') or ''} regwatch: source unreachable"
                            f" for {streak} consecutive days as of {self.run_date}."
                        ).strip()
                        self._write_yaml(yaml_path, payload)
                        marked = True
                if marked:
                    if reg_id not in self.report.marked:
                        self.report.marked.append(f"{reg_id}:stale")
                    self._rebuild_index()
        self._save_auto_state(state)

    def record_success(self, source_id: str) -> None:
        state = self._load_auto_state()
        if source_id in state.get("failureStreaks", {}):
            state["failureStreaks"].pop(source_id, None)
            self._save_auto_state(state)

    def _auto_state_path(self) -> Path:
        # Derived at call time (not a module constant) so patched/test
        # SUPPLEMENTS_DIR roots are honoured.
        return SUPPLEMENTS_DIR / ".auto_state.json"

    def _load_auto_state(self) -> dict:
        path = self._auto_state_path()
        if path.exists():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                pass
        return {"failureStreaks": {}}

    def _save_auto_state(self, state: dict) -> None:
        path = self._auto_state_path()
        _write_atomic(
            path, json.dumps(state, ensure_ascii=False, indent=2) + "\n"
        )

    # ── yaml + index ───────────────────────────────────────────────────

    @staticmethod
    def _write_yaml(path: Path, payload: dict) -> None:
        _write_atomic(
            path,
            yaml.safe_dump(payload, allow_unicode=True, sort_keys=False, width=120),
        )

    @staticmethod
    def _rebuild_index() -> None:
        """Mirror of build_regulation_library.build_index() (kept inline so the
        daemon does not import the heavy ENRICHMENT table at runtime)."""
        records = []
        for path in sorted(REGULATIONS_ROOT.glob("*/*.yaml")):
            try:
                data = yaml.safe_load(path.read_text(encoding="utf-8"))
            except (OSError, yaml.YAMLError) as exc:
                # 2026-09-18 H15: previously `continue`ed silently, so a
                # half-written regulation vanished from the index without
                # any operator signal. Log so the next pass's
                # check_sources/health probe can flag the drift.
                logger.error("safe_load failed for %s: %s", path, exc)
                continue
            if isinstance(data, dict):
                records.append(data)
        index = {
            "schema_version": 1,
            "generated_at": date.today().isoformat(),
            "count": len(records),
            "regulations": [
                {
                    "id": r.get("id", ""),
                    "region": r.get("region", ""),
                    "license": r.get("license", ""),
                    "official_citation": r.get("official_citation", ""),
                    "short_name": r.get("short_name", r.get("id", "")),
                    "source_url": r.get("source_url"),
                    "purchase_url": r.get("purchase_url"),
                    "article_count": len(r.get("articles", []) or []),
                    **({"status": r["status"]} if r.get("status") else {}),
                }
                for r in records
            ],
        }
        INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
        _write_atomic(
            INDEX_PATH,
            json.dumps(index, ensure_ascii=False, indent=2) + "\n",
        )
