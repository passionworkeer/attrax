"""Human review CLI for the watchdog's auto-ingest output.

Auto-ingest is on by default: a detected change is written straight into
``data/regulations/{region}/{id}.yaml`` on the same pass. That keeps the
library current without an operator in the loop, but it also means a bad
fetch can land in the KB unattended. This CLI is the oversight half of that
trade: it lists what a given day's pass actually changed, shows the raw
bytes behind any single change, and restores a regulation from the backup
the ingestor wrote before touching it.

Usage::

    # What did today's pass change? (default action)
    python -m scripts.watchdog.review --date 2026-09-17

    # Show the raw fetch, its metadata, and the diff for one regulation
    python -m scripts.watchdog.review --date 2026-09-17 --show EU-2011-65

    # Undo one auto-update (backup -> live YAML, then rebuild the index)
    python -m scripts.watchdog.review --date 2026-09-17 --revert EU-2011-65

Add ``--dry-run`` to either action to print the plan without writing.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import shutil
import sys
from pathlib import Path

# 与 check_sources.py 相同：让文件路径直跑也能 import scripts.*。
_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from scripts.watchdog.auto_ingest import AutoIngestor

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SUPPLEMENTS_DIR = PROJECT_ROOT / "data" / "regulation_supplements"
REGULATIONS_ROOT = PROJECT_ROOT / "data" / "regulations"

EXIT_OK = 0
EXIT_NOTHING_TO_DO = 4
EXIT_BAD_INPUT = 5


def _resolve_date(raw: str | None) -> str:
    if raw:
        try:
            _dt.date.fromisoformat(raw)
        except ValueError as exc:
            raise SystemExit(f"--date must be YYYY-MM-DD (got {raw!r})") from exc
        return raw
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%d")


def _load_applied(run_date: str) -> dict | None:
    """Read the day's applied.json, or None when the pass wrote no changes."""
    path = SUPPLEMENTS_DIR / f"watchdog-{run_date}" / "applied.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise SystemExit(f"unreadable {path}: {exc}") from exc


def _load_errors(run_date: str) -> list[dict]:
    path = SUPPLEMENTS_DIR / f"watchdog-{run_date}" / "errors.json"
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return data if isinstance(data, list) else []


def _find_live_yaml(reg_id: str) -> Path | None:
    """Locate the live YAML for ``reg_id`` anywhere in the library tree."""
    matches = sorted(REGULATIONS_ROOT.glob(f"*/{reg_id}.yaml"))
    if not matches:
        return None
    return matches[0]


def _backup_path(run_date: str, reg_id: str) -> Path:
    return SUPPLEMENTS_DIR / f"auto-{run_date}" / "backup" / f"{reg_id}.yaml"


def list_changes(run_date: str) -> int:
    applied = _load_applied(run_date)
    errors = _load_errors(run_date)

    if applied is None:
        print(f"{run_date}: no auto-ingest output (no real changes detected)")
        if errors:
            print(f"\n{len(errors)} source(s) failed to fetch:")
            for item in errors:
                print(f"  - {item.get('sourceId')}: {item.get('error')}")
        return EXIT_NOTHING_TO_DO

    records = applied.get("records") or []
    print(f"{run_date}: {len(records)} change(s) ingested")
    print()

    if records:
        header = f"  {'ACTION':<14} {'REGULATION':<26} {'SOURCE':<34} KIND"
        print(header)
        print("  " + "-" * (len(header) - 2))
        for row in records:
            print(
                f"  {row.get('action', '?'):<14} "
                f"{row.get('regulationId') or '—':<26} "
                f"{row.get('sourceId', '?'):<34} "
                f"{row.get('changeKind', '?')} (sim {row.get('similarity', 0):.3f})"
            )
    else:
        # Older passes predate the records[] audit trail; fall back to the
        # flat lists so a historic day is still reviewable.
        for action in ("created", "updated", "marked"):
            items = applied.get(action) or []
            if items:
                print(f"  {action}: {', '.join(items)}")

    if applied.get("failed"):
        print(f"\n{len(applied['failed'])} ingest failure(s):")
        for item in applied["failed"]:
            print(f"  - {item.get('sourceId')}: {item.get('error')}")

    if errors:
        print(f"\n{len(errors)} fetch failure(s):")
        for item in errors:
            print(f"  - {item.get('sourceId')}: {item.get('error')}")

    print()
    print(f"Review one:  --date {run_date} --show <REGULATION_ID>")
    print(f"Revert one:  --date {run_date} --revert <REGULATION_ID>")
    return EXIT_OK


def _records_for_regulation(run_date: str, reg_id: str) -> list[dict]:
    applied = _load_applied(run_date) or {}
    return [
        row for row in (applied.get("records") or [])
        if row.get("regulationId") == reg_id
    ]


def show_change(run_date: str, reg_id: str) -> int:
    rows = _records_for_regulation(run_date, reg_id)
    if not rows:
        print(f"{reg_id}: no ingest record for {run_date}", file=sys.stderr)
        return EXIT_NOTHING_TO_DO

    for row in rows:
        print(f"=== {reg_id} ===")
        print(f"  action      : {row.get('action')}")
        print(f"  change kind : {row.get('changeKind')} (similarity {row.get('similarity')})")
        print(f"  source      : {row.get('sourceId')} [{row.get('sourceType')}]")
        print(f"  source url  : {row.get('sourceUrl')}")
        print(f"  content hash: {row.get('contentHash')}")

        evidence_dir = Path(str(row.get("evidenceDir") or ""))
        meta_path = evidence_dir / "meta.json"
        if meta_path.exists():
            print("\n--- meta.json ---")
            print(meta_path.read_text(encoding="utf-8").rstrip())

        diff_path = evidence_dir / "diff.txt"
        if diff_path.exists():
            print("\n--- diff.txt ---")
            print(diff_path.read_text(encoding="utf-8").rstrip())

        raw_files = sorted(evidence_dir.glob("raw.*"))
        for raw in raw_files:
            size = raw.stat().st_size
            print(f"\n--- raw: {raw} ({size} bytes) ---")
            # Show a bounded head — an EU Cellar RDF is ~9 MB and would
            # otherwise bury the rest of the review output.
            with raw.open(encoding="utf-8", errors="replace") as handle:
                head = handle.read(4000)
            print(head.rstrip())
            if size > 4000:
                print(f"\n... truncated; full document at {raw}")
        print()

    backup = _backup_path(run_date, reg_id)
    if backup.exists():
        print(f"Pre-change backup available: {backup}")
        print(f"Revert with: --date {run_date} --revert {reg_id}")
    return EXIT_OK


def revert_change(run_date: str, reg_id: str, *, dry_run: bool) -> int:
    backup = _backup_path(run_date, reg_id)
    if not backup.exists():
        print(
            f"{reg_id}: no backup at {backup} — nothing to restore.\n"
            "Only regulations the ingestor UPDATEd have a pre-change backup; "
            "auto-CREATEd regulations have no prior state to return to.",
            file=sys.stderr,
        )
        return EXIT_NOTHING_TO_DO

    live = _find_live_yaml(reg_id)
    if live is None:
        print(
            f"{reg_id}: backup exists but no live YAML found under "
            f"{REGULATIONS_ROOT} — refusing to guess where it belongs.",
            file=sys.stderr,
        )
        return EXIT_BAD_INPUT

    print(f"Restore {backup}")
    print(f"     -> {live}")
    if dry_run:
        print("\n(dry run — nothing written)")
        return EXIT_OK

    live.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(backup, live)
    AutoIngestor._rebuild_index()
    print(f"\nRestored. {REGULATIONS_ROOT / 'regulations_index.json'} rebuilt.")
    print("Note: the next watchdog pass re-fetches this source; if upstream really")
    print("did change, the same update is re-applied. To keep the revert, fix the")
    print("source mapping or disable auto-ingest for that source first.")
    return EXIT_OK


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Review and roll back the watchdog's auto-ingest output."
    )
    parser.add_argument(
        "--date",
        default=None,
        metavar="YYYY-MM-DD",
        help="pass date to review (default: today, UTC — matches the orchestrator)",
    )
    action = parser.add_mutually_exclusive_group()
    action.add_argument(
        "--show",
        metavar="REGULATION_ID",
        help="print the raw fetch, metadata and diff behind one change",
    )
    action.add_argument(
        "--revert",
        metavar="REGULATION_ID",
        help="restore the regulation from its pre-change backup and rebuild the index",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="print the plan without writing anything",
    )
    args = parser.parse_args(argv)

    run_date = _resolve_date(args.date)

    if args.show:
        return show_change(run_date, args.show)
    if args.revert:
        return revert_change(run_date, args.revert, dry_run=args.dry_run)
    return list_changes(run_date)


if __name__ == "__main__":
    sys.exit(main())
