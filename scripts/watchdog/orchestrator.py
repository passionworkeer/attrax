"""Regulation watchdog orchestrator — scheduled single-pass entry point.

Run modes:
- ``python -m scripts.watchdog.orchestrator``          — daemon: run one pass
  immediately, then sleep until the next daily run time (ATTRAX_REGWATCH_RUN_AT,
  default 03:00 **server-local** — Asia/Shanghai on lighthouse) and repeat.
- ``python -m scripts.watchdog.orchestrator --once``   — single pass, exit
- ``python -m scripts.watchdog.orchestrator --dry-run``— detect changes but do
  not write outputs or update the snapshot DB

Why an internal scheduler (2026-09-13 incident): the original design relied on
pm2 ``cron_restart`` to relaunch the single-pass process daily. That never
fired — pm2's cron_restart only acts on *online* processes, and a fork-mode
app that exits cleanly goes to "stopped", which cron_restart ignores. Keeping
the scheduler inside the process (plain ``time.sleep`` loop, still stdlib-only)
means pm2 supervises a permanently-online app and ``autorestart`` covers
crashes; the timeslot config lives in one place (ATTRAX_REGWATCH_RUN_AT).

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
5. Auto-rebuild gate: cosmetic-only changes (similarity ≥ 0.95) snapshot and
   move on. Any real change writes pending_review.json — the rebuild is a
   human decision, never automatic.

Exit codes (single-pass mode): 0 = clean / cosmetic only · 2 = real changes
awaiting review · 3 = one or more sources failed (others still processed) ·
1 = fatal. Daemon mode logs the per-pass code and keeps running.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import logging
import os
import signal
import sys
import time
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

# Default daily run time, server-local. The old docs said "03:00 UTC" — that
# was wrong: pm2 cron and this loop both use the daemon's local zone
# (Asia/Shanghai on lighthouse), so 03:00 CST = 19:00 UTC.
DEFAULT_RUN_AT = "03:00"
_SHUTDOWN = False


def _request_shutdown(signum, frame):  # noqa: ARG001 — signal handler signature
    global _SHUTDOWN
    _SHUTDOWN = True
    logger.info("received signal %s — shutting down after current step", signum)


def _seconds_until_next_run(run_at: str) -> float:
    """Seconds from now until the next HH:MM (server-local), min 60s guard."""
    try:
        hour_s, minute_s = run_at.split(":", 1)
        hour, minute = int(hour_s), int(minute_s)
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            raise ValueError
    except ValueError:
        logger.warning("invalid ATTRAX_REGWATCH_RUN_AT %r — using %s", run_at, DEFAULT_RUN_AT)
        hour, minute = 3, 0
    now = _dt.datetime.now()
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= now:
        target += _dt.timedelta(days=1)
    return max(60.0, (target - now).total_seconds())


def load_sources() -> list[dict]:
    with SOURCES_PATH.open(encoding="utf-8") as handle:
        entries = json.load(handle)
    if not isinstance(entries, list) or not entries:
        raise SystemExit(f"{SOURCES_PATH} contains no source entries")
    return entries


def ack_sources(ids: set[str] | None) -> int:
    """Approve pending changes: snapshot the CURRENT live content of the
    acked sources as the new baseline, and prune them from today's
    diff.json / pending_review.json.

    Pairs with the "real changes are not snapshotted until reviewed" rule
    (see run_pass): without this command, an un-reviewed source would keep
    re-appearing in pending_review on every pass with no way to clear it.
    ``ids=None`` means ack everything (``--ack-all``).
    """
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    entries = load_sources()
    store = SourceStateStore(SUPPLEMENTS_DIR)
    acked: list[str] = []
    for entry in entries:
        source_id = entry.get("id") or entry.get("source_url") or "unknown"
        if ids is not None and source_id not in ids:
            continue
        try:
            update = collect_source(entry)
        except Exception as exc:  # noqa: BLE001 — ack what we can, report rest
            logger.warning("ack: source %s failed to fetch: %s", source_id, exc)
            continue
        store.bulk_snapshot([(source_id, update.text, update.content_hash)])
        acked.append(source_id)
    store.close()

    acked_set = set(acked)
    run_date = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%d")
    out_dir = SUPPLEMENTS_DIR / f"watchdog-{run_date}"
    for fname in ("diff.json", "pending_review.json"):
        path = out_dir / fname
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(data, dict) or not isinstance(data.get("changes"), list):
            continue
        remaining = [
            c for c in data["changes"] if c.get("sourceId") not in acked_set
        ]
        if remaining:
            data["changes"] = remaining
            data["changeCount"] = len(remaining)
            path.write_text(
                json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
            )
        else:
            path.unlink()

    logger.info("acked %d source(s): %s", len(acked), ", ".join(acked) or "(none)")
    return EXIT_CLEAN


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
    # Auto-ingest (2026-09-13 user directive): real changes are applied to
    # the regulation library automatically — no manual review gate. The
    # ingest itself is the "review": on success the baseline snapshot moves
    # forward; on ingest failure the source stays un-snapshotted and keeps
    # re-appearing (the c46fb3c un-reviewed-changes semantics).
    auto_ingest_enabled = (os.environ.get("ATTRAX_REGWATCH_AUTO_INGEST") or "true").strip().lower() not in {
        "0", "false", "no", "off",
    }
    ingestor = None
    if auto_ingest_enabled and not dry_run:
        from scripts.watchdog.auto_ingest import AutoIngestor

        ingestor = AutoIngestor(run_date)

    real_changes: list[Change] = []
    cosmetic_changes: list[Change] = []
    snapshots: list[tuple[str, str, str]] = []
    errors: list[dict] = []
    updates_by_id: dict[str, object] = {}
    entries_by_id: dict[str, dict] = {}

    for entry in entries:
        source_id = entry.get("id") or entry.get("source_url") or "unknown"
        entries_by_id[source_id] = entry
        try:
            update = collect_source(entry)
        except Exception as exc:  # noqa: BLE001 — per-source isolation
            logger.warning("source %s failed: %s", source_id, exc)
            errors.append(
                {"sourceId": source_id, "error": f"{type(exc).__name__}: {exc}"}
            )
            if ingestor is not None:
                ingestor.record_failure(source_id, entry)
            continue
        if ingestor is not None:
            ingestor.record_success(source_id)
            updates_by_id[source_id] = update

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
    # until they are either auto-ingested (default) or manually approved
    # (--ack, when auto-ingest is disabled) — otherwise subsequent passes
    # would report no change and lose track of un-applied modifications.
    real_change_source_ids = {c.source_id for c in real_changes}
    ingest_report = None
    if ingestor is not None and real_changes:
        ingest_report = ingestor.apply(entries_by_id, updates_by_id, real_changes)  # type: ignore[arg-type]
        for item in ingest_report.to_dict()["failed"]:
            logger.warning("auto-ingest failed for %s: %s", item["sourceId"], item["error"])

    if not dry_run:
        if ingestor is not None:
            if ingest_report is not None and real_changes:
                (out_dir / "applied.json").write_text(
                    json.dumps(
                        {
                            "date": run_date,
                            "mode": "auto",
                            **ingest_report.to_dict(),
                        },
                        indent=2,
                        ensure_ascii=False,
                    ),
                    encoding="utf-8",
                )
            # Sources whose change ingested cleanly (or had no real change)
            # advance the baseline; ingest failures stay un-snapshotted so
            # they keep re-appearing until they apply or the operator --acks.
            failed_ids = {f["sourceId"] for f in (ingest_report.failed if ingest_report else [])}
            blocked_ids = (
                real_change_source_ids & failed_ids if ingest_report else set()
            ) if real_changes else set()
            store.bulk_snapshot(
                [s for s in snapshots if s[0] not in blocked_ids]
            )
        else:
            # Auto-ingest disabled: c46fb3c semantics — real changes are not
            # snapshotted until a human runs --ack.
            store.bulk_snapshot(
                [s for s in snapshots if s[0] not in real_change_source_ids]
            )
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
            # Auto-ingest off → real changes need a human (--ack) before the
            # baseline moves. Auto-ingest on → applied.json is the record.
            if ingestor is None:
                (out_dir / "pending_review.json").write_text(
                    json.dumps(
                        {
                            "date": run_date,
                            "reason": "structural content changes detected",
                            "changes": [c.to_dict() for c in real_changes],
                            "nextStep": (
                                "Review diff.json, then run"
                                " python -m scripts.watchdog.orchestrator --ack-all"
                                " (or --ack <sourceId>) to approve."
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
    if ingest_report is not None:
        body_lines.append(
            "ingested:        {} created / {} updated / {} marked / {} evidence-only".format(
                len(ingest_report.created),
                len(ingest_report.updated),
                len(ingest_report.marked),
                len(ingest_report.evidence_only),
            )
        )
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
        description="attrax regulation watchdog (single pass or daily scheduler)"
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="run exactly one pass and exit (no scheduling)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="detect changes but do not write outputs or update the snapshot DB",
    )
    parser.add_argument(
        "--ack",
        action="append",
        default=None,
        metavar="SOURCE_ID",
        help=(
            "approve a pending change: snapshot the source's current live"
            " content as the new baseline and remove it from today's"
            " pending_review.json. Repeatable."
        ),
    )
    parser.add_argument(
        "--ack-all",
        action="store_true",
        help="approve every pending change (snapshot all sources as baseline)",
    )
    args = parser.parse_args(argv)

    if args.ack or args.ack_all:
        return ack_sources(set(args.ack) if args.ack else None)

    if args.once:
        return run_pass(dry_run=args.dry_run)

    # Daemon mode: one immediate pass (catch-up for any missed timeslot),
    # then sleep until the next daily run time. Signal-aware so `pm2 stop`
    # shuts down within one sleep chunk.
    signal.signal(signal.SIGTERM, _request_shutdown)
    signal.signal(signal.SIGINT, _request_shutdown)
    run_at = (os.environ.get("ATTRAX_REGWATCH_RUN_AT") or DEFAULT_RUN_AT).strip()

    logger.info("regwatch daemon starting — run_at=%s (server-local)", run_at)
    code = run_pass(dry_run=args.dry_run)
    logger.info("initial pass finished with exit code %d", code)

    while not _SHUTDOWN:
        wait = _seconds_until_next_run(run_at)
        next_at = (
            _dt.datetime.now() + _dt.timedelta(seconds=wait)
        ).strftime("%Y-%m-%d %H:%M:%S")
        logger.info("sleeping %.0fs — next pass at %s", wait, next_at)
        # Chunked sleep so SIGTERM is honoured within 30s.
        deadline = time.monotonic() + wait
        while not _SHUTDOWN and time.monotonic() < deadline:
            time.sleep(min(30, max(0.1, deadline - time.monotonic())))
        if _SHUTDOWN:
            break
        code = run_pass(dry_run=args.dry_run)
        logger.info("scheduled pass finished with exit code %d", code)

    logger.info("regwatch daemon stopped")
    return code


if __name__ == "__main__":
    sys.exit(main())
