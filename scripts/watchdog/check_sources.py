"""Live health check for the regulation source registry.

The 2026-09-17 audit found nine of thirty-five registry entries pointing at
endpoints that answered 403 / 404 to every automated client — added on
2026-09-16, never fetched successfully, failing on every nightly pass since.
Nothing in the codebase could have caught that: ``human_view_status`` is a
hand-written field, and the orchestrator only records failures into
``errors.json`` where nobody was reading them.

This script is the guard. It dispatches each entry through the *real*
collector (not a HEAD probe), so a source that fetches but whose parser
rejects the payload is reported as broken too. Run it after any registry
edit, and periodically against production.

Usage::

    python -m scripts.watchdog.check_sources              # probe everything
    python -m scripts.watchdog.check_sources --json       # machine-readable
    python -m scripts.watchdog.check_sources --only uk-weee-regulations-guidance
    python -m scripts.watchdog.check_sources --include-skipped

Exit codes: 0 = every checked source fetched cleanly · 3 = at least one
failed · 1 = the registry itself is malformed.
"""
from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from scripts.watchdog.collectors.base import (
    FetchDeadlineExceeded,
    NotModified,
    collect_source,
    fetch_deadline,
)
from scripts.watchdog.orchestrator import _is_fetchable, load_sources

EXIT_OK = 0
EXIT_FAILURES = 3
EXIT_BAD_REGISTRY = 1

#: Per-source budget for the probe. Deliberately tighter than the watchdog's
#: 60 s — a health check that takes as long as the pass it is checking is
#: not much of a health check.
PROBE_TIMEOUT_SECS = 45
PROBE_WORKERS = 8

#: A source that fetches but yields a digest shorter than this is almost
#: certainly a JavaScript shell: the page returns 200, the stdlib HTML
#: parser sees only the <title> / breadcrumb text, and the digest then sits
#: frozen forever while the regulation world moves — a source that *looks*
#: tracked but is not. The content-bearing HTML sources in this registry
#: run 1 KB–180 KB, so 500 cleanly separates the two populations.
THIN_DIGEST_CHARS = 500

#: Only HTML-scraped sources are subject to the thin check. A JSON API
#: returning a handful of records produces a legitimately small digest —
#: flagging it would be a false positive that trains the operator to
#: ignore the warning. An API that fails returns no records (which the
#: window filter shows up as an empty digest) rather than a page shell.
_HTML_SOURCE_TYPES = frozenset({"gov_html", "direct_url"})

#: Fields every entry must carry. ``source_type`` and ``source_url`` are
#: load-bearing; ``human_view_url`` is required because the registry's whole
#: premise is that a human can open what the watchdog tracks.
REQUIRED_FIELDS = ("id", "market", "source_type", "source_url", "human_view_url")


def validate_registry(entries: list[dict]) -> list[str]:
    """Structural problems that are cheaper to catch than to debug at 03:00."""
    problems: list[str] = []
    seen: dict[str, int] = {}
    for index, entry in enumerate(entries):
        entry_id = entry.get("id") or f"<entry #{index}>"
        for field in REQUIRED_FIELDS:
            if not str(entry.get(field) or "").strip():
                problems.append(f"{entry_id}: missing required field {field!r}")
        if entry_id in seen:
            problems.append(f"{entry_id}: duplicate id (also at index {seen[entry_id]})")
        seen[entry_id] = index
    return problems


def probe(entry: dict) -> dict:
    """Run one source through its collector. Returns a result record."""
    source_id = entry.get("id", "?")
    source_type = entry.get("source_type", "?")
    try:
        with fetch_deadline(PROBE_TIMEOUT_SECS):
            update = collect_source(entry)
    except NotModified:
        # A 304 means the upstream is alive and our copy is current. That is
        # a healthy source, not a failure.
        return {"sourceId": source_id, "sourceType": source_type, "status": "not-modified"}
    except FetchDeadlineExceeded as exc:
        return {"sourceId": source_id, "sourceType": source_type, "status": "timeout", "error": str(exc)}
    except Exception as exc:  # noqa: BLE001 — the point is to catch everything
        return {
            "sourceId": source_id,
            "sourceType": source_type,
            "status": "failed",
            "error": f"{type(exc).__name__}: {exc}",
        }
    chars = len(update.text)
    result = {
        "sourceId": source_id,
        "sourceType": source_type,
        "status": "ok",
        "bytes": chars,
        "hash": update.content_hash[:12],
    }
    if chars < THIN_DIGEST_CHARS and source_type in _HTML_SOURCE_TYPES:
        result["status"] = "thin"
        result["error"] = (
            f"only {chars} chars of trackable text — likely a JS shell; "
            f"the digest would never change"
        )
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Probe every regulation source live.")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument("--only", action="append", metavar="SOURCE_ID", help="probe just these (repeatable)")
    parser.add_argument(
        "--include-skipped",
        action="store_true",
        help="also probe entries the orchestrator skips (fetch_status=unreachable)",
    )
    parser.add_argument(
        "--workers", type=int, default=PROBE_WORKERS, help=f"concurrency (default {PROBE_WORKERS})"
    )
    args = parser.parse_args(argv)

    entries = load_sources()

    problems = validate_registry(entries)
    if problems:
        for problem in problems:
            print(f"registry: {problem}", file=sys.stderr)
        return EXIT_BAD_REGISTRY

    if args.only:
        wanted = set(args.only)
        entries = [e for e in entries if e.get("id") in wanted]
        missing = wanted - {e.get("id") for e in entries}
        if missing:
            print(f"unknown source id(s): {', '.join(sorted(missing))}", file=sys.stderr)
            return EXIT_BAD_REGISTRY

    if not args.include_skipped:
        entries = [e for e in entries if _is_fetchable(e)]

    with ThreadPoolExecutor(max_workers=max(1, args.workers), thread_name_prefix="probe") as pool:
        results = list(pool.map(probe, entries))
    results.sort(key=lambda r: r["sourceId"])

    failed = [r for r in results if r["status"] in {"failed", "timeout"}]
    thin = [r for r in results if r["status"] == "thin"]

    if args.json:
        print(
            json.dumps(
                {
                    "checked": len(results),
                    "failed": len(failed),
                    "thin": len(thin),
                    "results": results,
                },
                indent=2,
            )
        )
    else:
        markers = {
            "ok": "  ok ",
            "not-modified": " 304 ",
            "thin": "thin ",
            "timeout": "TIME",
            "failed": "FAIL",
        }
        for result in results:
            detail = result.get("error") or f"{result.get('bytes', 0)} chars"
            print(f"{markers[result['status']]}  {result['sourceId']:<48} [{result['sourceType']}] {detail}")

        print()
        summary = (
            f"checked {len(results)} source(s): "
            f"{len(results) - len(failed) - len(thin)} healthy, "
            f"{len(thin)} thin, {len(failed)} failed"
        )
        print(summary)

        if failed:
            print()
            print("Sources that need a working endpoint or fetch_status: unreachable:")
            for result in failed:
                print(f"  - {result['sourceId']}: {result.get('error')}")

        if thin:
            print()
            print("Sources whose digest is too thin to track (see fetch_status: shell_only):")
            for result in thin:
                print(f"  - {result['sourceId']}: {result.get('error')}")

    return EXIT_FAILURES if failed else EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
