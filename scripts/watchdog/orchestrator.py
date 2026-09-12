"""Regulation watchdog orchestrator — single-pass entry point.

Run modes:
- ``python -m scripts.watchdog.orchestrator``          — one pass, then exit
- ``python -m scripts.watchdog.orchestrator --once``   — same (explicit)

Scheduling is external by design: pm2's ``cron_restart: "0 3 * * *"`` boots
this module once a day (see scripts/ecosystem.config.cjs → ``regwatch``).

Pass outline:
1. Load the 25 source entries from data/regulation_sources/official_sources.json
2. Dispatch each entry to its collector (per-source failure isolation)
3. Diff every fetched update against the SQLite snapshot (state.py)
4. Write outputs to data/regulation_supplements/watchdog-{date}/:
   - no_change.json    — every source unchanged
   - diff.json         — real changes (added / removed / modified)
   - pending_review.json — changes that require human approval before the
                           regulation library is rebuilt
   - errors.json       — per-source fetch failures
5. Auto-rebuild gate: when every change is *cosmetic* (similarity ≥ 0.95)
   and ATTRAX_REGWATCH_AUTO_REBUILD=true, snapshot state and exit 0. Any
   real change writes pending_review.json and exits 2 — the rebuild is a
   human decision, never automatic.

Exit codes: 0 = clean / cosmetic only · 2 = real changes awaiting review ·
3 = one or more sources failed (others still processed) · 1 = fatal.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import logging
import os
import sys
from pathlib import Path

from scripts.watchdog.collectors.base import collect_source
from scripts.watchdog.notify import build_notifiers, notify_all
from scripts.watchdog.state import Change, SourceStateStore

logger = logging.getLogger("attrax.regwatch")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SOURCES_PATH = PROJECT_ROOT / "data" / "regulation_sources" / "official_sources.json"
SUPPLEMENTS_DIR = PROJECT_ROOT / "data" / "regulation_supplements"

EXIT_CLEAN = 0
EXIT_CHANGES_PENDING = 2
EXIT_PARTIAL_FAILURE = 3
EXIT_FATAL = 1


def load_sources() -> list[dict]:
    with SOURCES_PATH.open(encoding="utf-8") as handle:
        entries = json.load(handle)
    if not isinstance(entries, list) or not entries:
        raise SystemExit(f"{SOURCES_PATH} contains no source entries")
    return entries


def run_pass(*, dry_run: bool = False) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    if (os.environ.get("ATTRAX_REGWATCH_ENABLED") or "true").strip().lower() in {
        "0",
        "false",
        "no",
        "off",
    }:
        logger.info("ATTRAX_REGWATCH_ENABLED is off — nothing to do")
        return EXIT_CLEAN

    entries = load_sources()
    run_date = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%d")
    out_dir = SUPPLEMENTS_DIR / f"watchdog-{run_date}"
    if not dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)

    store = SourceStateStore(SUPPLEMENTS_DIR)
    notifiers = build_notifiers()

    real_changes: list[Change] = []
    cosmetic_changes: list[Change] = []
    snapshots: list[tuple[str, str, str]] = []
    errors: list[dict] = []

    for entry in entries:
        source_id = entry.get("id") or entry.get("source_url") or "unknown"
        try:
            update = collect_source(entry)
        except Exception as exc:  # noqa: BLE001 — per-source isolation
            logger.warning("source %s failed: %s", source_id, exc)
            errors.append(
                {"sourceId": source_id, "error": f"{type(exc).__name__}: {exc}"}
            )
            continue

        changes = store.detect_changes(
            source_id,
            update.text,
            metadata={
                "market": update.market,
                "sourceType": update.source_type,
                "sourceUrl": update.source_url,
                "title": update.title,
                **update.metadata,
            },
        )
        for change in changes:
            if change.kind == "cosmetic":
                cosmetic_changes.append(change)
            else:
                real_changes.append(change)
        snapshots.append((source_id, update.text, update.content_hash))

    # Persist snapshots for unchanged and cosmetic-only sources.
    # Real changes (added / modified) must NOT overwrite the baseline snapshot
    # until reviewed and approved, otherwise subsequent passes would report no change
    # and lose track of un-reviewed regulatory modifications!
    real_change_source_ids = {c.source_id for c in real_changes}
    safe_snapshots = [s for s in snapshots if s[0] not in real_change_source_ids]
    if not dry_run:
        store.bulk_snapshot(safe_snapshots)
    store.close()

    # ── write outputs ─────────────────────────────────────────────────
    if not dry_run:
        if not real_changes and not cosmetic_changes and not errors:
            (out_dir / "no_change.json").write_text(
                json.dumps(
                    {"date": run_date, "sourcesChecked": len(entries)},
                    indent=2,
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
        if real_changes:
            (out_dir / "diff.json").write_text(
                json.dumps(
                    {
                        "date": run_date,
                        "changeCount": len(real_changes),
                        "changes": [c.to_dict() for c in real_changes],
                    },
                    indent=2,
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            # Real changes need a human before the KB is rebuilt.
            (out_dir / "pending_review.json").write_text(
                json.dumps(
                    {
                        "date": run_date,
                        "reason": "structural content changes detected",
                        "changes": [c.to_dict() for c in real_changes],
                        "nextStep": (
                            "Review diff.json, then run"
                            " scripts/build_regulation_library.py to rebuild"
                            " data/regulations + data/kb/anchors."
                        ),
                    },
                    indent=2,
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
        if cosmetic_changes:
            (out_dir / "cosmetic.json").write_text(
                json.dumps(
                    [c.to_dict() for c in cosmetic_changes],
                    indent=2,
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
        if errors:
            (out_dir / "errors.json").write_text(
                json.dumps(errors, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )

    # ── notify ────────────────────────────────────────────────────────
    title = f"regwatch {run_date}: {len(real_changes)} change(s), {len(errors)} error(s)"
    body_lines = [
        f"sources checked: {len(entries)}",
        f"real changes:    {len(real_changes)}",
        f"cosmetic:        {len(cosmetic_changes)}",
        f"errors:          {len(errors)}",
    ]
    for change in real_changes[:5]:
        body_lines.append(
            f"- [{change.kind}] {change.source_id} (similarity {change.similarity:.3f})"
        )
    notify_all(notifiers, title, "\n".join(body_lines), payload={
        "date": run_date,
        "changes": [c.to_dict() for c in real_changes],
        "errors": errors,
    })

    # ── exit code ─────────────────────────────────────────────────────
    if errors and not real_changes:
        return EXIT_PARTIAL_FAILURE
    if real_changes:
        return EXIT_CHANGES_PENDING
    return EXIT_CLEAN


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="attrax regulation watchdog (single pass)"
    )
    parser.add_argument(
        "--once", action="store_true", help="explicit single-pass mode (default)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="detect changes but do not write outputs or update the snapshot DB",
    )
    args = parser.parse_args(argv)
    del args.once  # single-pass is the only mode; flag kept for operator habit
    return run_pass(dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
