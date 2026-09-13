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

import json
import re
import shutil
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import yaml

from scripts.watchdog.collectors.base import RegulationUpdate
from scripts.watchdog.state import Change

REPO = Path(__file__).resolve().parents[2]
REGULATIONS_ROOT = REPO / "data" / "regulations"
SUPPLEMENTS_DIR = REPO / "data" / "regulation_supplements"
INDEX_PATH = REGULATIONS_ROOT / "regulations_index.json"
AUTO_STATE_PATH = SUPPLEMENTS_DIR / ".auto_state.json"

STALE_AFTER_CONSECUTIVE_FAILURES = 7

# CELEX → regulation id, e.g. "32011L0065" → ("EU-2011-65", "Directive 2011/65/EU")
_CELEX_RE = re.compile(r"^3(\d{4})([LRD])(\d{4})$")
_REGION_DIRS = {"EU": "eu", "US": "us", "CN": "cn", "UK": "uk", "AU": "au", "UN": "un"}
_RAW_SUFFIX = {
    "eu_celex": ".rdf",
    "ecfr_part": ".json",
    "cpsc_rss": ".xml",
    "canada_justice_xml": ".xml",
    "gov_html": ".html",
    "direct_url": ".html",
}
_REPEAL_KEYWORDS = ("removal", "revok", "repeal", "revocation", "withdraw")


@dataclass
class IngestReport:
    created: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    marked: list[str] = field(default_factory=list)
    evidence_only: list[str] = field(default_factory=list)
    failed: list[dict] = field(default_factory=list)

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
        }


def regulation_for_source(entry: dict) -> tuple[str, Path] | None:
    """Map an official_sources entry to (regulation_id, yaml_path), or None.

    Only EU CELEX sources are mechanically mappable to the library's id
    convention (EU-{year}-{number}); eCFR/CA/UK/NZ sources have no
    regulation YAML counterpart today and are ingested evidence-only.
    """
    celex = str(entry.get("celex") or "").strip()
    if not celex:
        return None
    match = _CELEX_RE.match(celex)
    if not match:
        return None
    year, type_letter, number = match.groups()
    reg_id = f"EU-{year}-{int(number)}"
    region_dir = _REGION_DIRS.get("EU", "eu")
    return reg_id, REGULATIONS_ROOT / region_dir / f"{reg_id}.yaml"


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


class AutoIngestor:
    def __init__(self, run_date: str | None = None) -> None:
        self.run_date = run_date or date.today().isoformat()
        self.batch_dir = SUPPLEMENTS_DIR / f"auto-{self.run_date}"
        self.report = IngestReport()

    # ── public entry ───────────────────────────────────────────────────

    def apply(
        self,
        entries_by_id: dict[str, dict],
        updates: dict[str, RegulationUpdate],
        changes: list[Change],
    ) -> IngestReport:
        """Ingest every non-cosmetic change. Sources that ingest cleanly are
        returned via report; callers advance their snapshot for those."""
        changed_ids = [c.source_id for c in changes if c.kind in {"added", "modified"}]
        change_by_id = {c.source_id: c for c in changes}

        for source_id in changed_ids:
            entry = entries_by_id.get(source_id)
            update = updates.get(source_id)
            if entry is None or update is None:
                self.report.failed.append(
                    {"sourceId": source_id, "error": "missing entry/update"}
                )
                continue
            try:
                self._ingest_one(source_id, entry, update, change_by_id[source_id])
            except Exception as exc:  # noqa: BLE001 — per-source isolation
                self.report.failed.append(
                    {"sourceId": source_id, "error": f"{type(exc).__name__}: {exc}"}
                )

        if self.report.touched_regulations:
            self._rebuild_index()
        return self.report

    # ── per-source ─────────────────────────────────────────────────────

    def _ingest_one(
        self,
        source_id: str,
        entry: dict,
        update: RegulationUpdate,
        change: Change,
    ) -> None:
        # 1. Evidence layer (always, mapped or not).
        evidence_dir = self._store_evidence(source_id, entry, update, change)
        raw_name = "raw" + _RAW_SUFFIX.get(update.source_type, ".bin")

        mapping = regulation_for_source(entry)
        if mapping is None:
            self.report.evidence_only.append(source_id)
            return
        reg_id, yaml_path = mapping

        status_mark = "repealed" if _looks_like_repeal(update) else None

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
            audit = (
                f"regwatch auto-{change.kind} {self.run_date}: similarity "
                f"{change.similarity:.3f}, evidence in auto-{self.run_date}/{source_id}/."
            )
            payload["notes"] = f"{payload.get('notes') or ''} {audit}".strip()
            self._write_yaml(yaml_path, payload)
            self.report.updated.append(reg_id)
            if status_mark:
                self.report.marked.append(f"{reg_id}:{status_mark}")
            return

        # 3. CREATE path (mappable but no YAML — e.g. WEEE 2012/19).
        citation = _citation_from_celex(str(entry.get("celex", "")))
        title = _title_from_rdf(update.text) or citation
        payload = {
            "id": reg_id,
            "official_citation": citation,
            "short_name": title[:200],
            "region": "EU",
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
                f" {source_id}; articles pending extraction from the stored raw file."
            ),
        }
        yaml_path.parent.mkdir(parents=True, exist_ok=True)
        self._write_yaml(yaml_path, payload)
        self.report.created.append(reg_id)

    def _store_evidence(
        self,
        source_id: str,
        entry: dict,
        update: RegulationUpdate,
        change: Change,
    ) -> Path:
        evidence_dir = self.batch_dir / source_id
        evidence_dir.mkdir(parents=True, exist_ok=True)
        suffix = _RAW_SUFFIX.get(update.source_type, ".bin")
        (evidence_dir / f"raw{suffix}").write_text(update.text, encoding="utf-8")
        (evidence_dir / "meta.json").write_text(
            json.dumps(
                {
                    "sourceId": source_id,
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
                if yaml_path.exists():
                    payload = yaml.safe_load(yaml_path.read_text(encoding="utf-8")) or {}
                    payload["status"] = "stale"
                    payload["notes"] = (
                        f"{payload.get('notes') or ''} regwatch: source unreachable"
                        f" for {streak} consecutive days as of {self.run_date}."
                    ).strip()
                    self._write_yaml(yaml_path, payload)
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
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    # ── yaml + index ───────────────────────────────────────────────────

    @staticmethod
    def _write_yaml(path: Path, payload: dict) -> None:
        path.write_text(
            yaml.safe_dump(payload, allow_unicode=True, sort_keys=False, width=120),
            encoding="utf-8",
        )

    @staticmethod
    def _rebuild_index() -> None:
        """Mirror of build_regulation_library.build_index() (kept inline so the
        daemon does not import the heavy ENRICHMENT table at runtime)."""
        records = []
        for path in sorted(REGULATIONS_ROOT.glob("*/*.yaml")):
            try:
                data = yaml.safe_load(path.read_text(encoding="utf-8"))
            except (OSError, yaml.YAMLError):
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
        INDEX_PATH.write_text(
            json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8"
        )
