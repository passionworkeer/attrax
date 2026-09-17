"""Tests for the 2026-09-17 parallel-fetch pass + cooperative deadline.

Covered here:
  - ``run_pass`` fans the sources out over a thread pool instead of walking
    them serially.
  - A source that raises is isolated: it lands in errors.json while its
    siblings still get processed.
  - A 304 NotModified is a clean "unchanged", not an error.
  - ``fetch_deadline`` actually curtails ``fetch_url``'s retry loop — this is
    the mechanism that makes the orchestrator's per-source cap real, since
    Python cannot interrupt a thread blocked in a socket read.
"""
from __future__ import annotations

import json
import sys
import threading
import time
import urllib.error
from pathlib import Path
from unittest.mock import patch

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.watchdog import orchestrator  # noqa: E402
from scripts.watchdog.collectors import base as collectors_base  # noqa: E402
from scripts.watchdog.collectors.base import (  # noqa: E402
    FetchDeadlineExceeded,
    NotModified,
    RegulationUpdate,
    fetch_deadline,
    fetch_url,
)
from scripts.watchdog.state import text_hash  # noqa: E402


def _update(source_id: str, text: str, market: str = "EU") -> RegulationUpdate:
    return RegulationUpdate(
        source_id=source_id,
        market=market,
        source_type="gov_html",
        source_url=f"https://example.com/{source_id}",
        title=f"title {source_id}",
        text=text,
        content_hash=text_hash(text),
    )


@pytest.fixture()
def isolated_pass(tmp_path, monkeypatch):
    """Point the orchestrator's source file + supplements dir at a tmp dir."""
    supplements = tmp_path / "supplements"
    sources_path = tmp_path / "official_sources.json"
    monkeypatch.setattr(orchestrator, "SUPPLEMENTS_DIR", supplements)
    monkeypatch.setattr(orchestrator, "SOURCES_PATH", sources_path)
    # Auto-ingest off keeps the pass to the fetch/diff path under test —
    # the ingestor has its own suite.
    monkeypatch.setenv("ATTRAX_REGWATCH_AUTO_INGEST", "false")
    return sources_path, supplements


def _write_sources(path: Path, entries: list[dict]) -> None:
    path.write_text(json.dumps(entries), encoding="utf-8")


def _entry(source_id: str, market: str = "EU") -> dict:
    return {
        "id": source_id,
        "market": market,
        "source_type": "gov_html",
        "source_url": f"https://example.com/{source_id}",
        "title": f"title {source_id}",
    }


# ── run_pass concurrency + isolation ─────────────────────────────────────


def test_run_pass_fetches_sources_concurrently(isolated_pass):
    """Four sources that each block finish only if all four are in flight at
    the same time — a serial walk would deadlock on the barrier."""
    sources_path, _ = isolated_pass
    ids = [f"src-{i}" for i in range(4)]
    _write_sources(sources_path, [_entry(i) for i in ids])

    barrier = threading.Barrier(len(ids), timeout=5)

    def _slow_collect(entry: dict) -> RegulationUpdate:
        # A barrier only releases once every source is in flight at the same
        # time — proof of concurrency, not just of a fast loop.
        barrier.wait()
        return _update(entry["id"], f"body of {entry['id']}")

    with patch.object(orchestrator, "collect_source", side_effect=_slow_collect):
        code = orchestrator.run_pass()

    # Four brand-new sources are "added" on the first pass → changes pending.
    assert code == orchestrator.EXIT_CHANGES_PENDING
    assert barrier.broken is False


def test_run_pass_isolates_a_failing_source(isolated_pass):
    """One source raising must not stop the others from being processed."""
    sources_path, supplements = isolated_pass
    _write_sources(sources_path, [_entry("ok-a"), _entry("boom"), _entry("ok-b")])

    def _fake_collect(entry: dict) -> RegulationUpdate:
        if entry["id"] == "boom":
            raise urllib.error.URLError("connection refused")
        return _update(entry["id"], f"body of {entry['id']}")

    with patch.object(orchestrator, "collect_source", side_effect=_fake_collect):
        code = orchestrator.run_pass()

    # The two healthy sources are new → real changes; changes outrank errors
    # in the exit-code ladder. The isolation claim is about errors.json and
    # the store, asserted below.
    assert code == orchestrator.EXIT_CHANGES_PENDING

    run_date = time.strftime("%Y-%m-%d", time.gmtime())
    out_dir = supplements / f"watchdog-{run_date}"
    errors = json.loads((out_dir / "errors.json").read_text(encoding="utf-8"))
    assert [e["sourceId"] for e in errors] == ["boom"]
    assert "URLError" in errors[0]["error"]

    # The healthy siblings were still processed: both show up in diff.json.
    # (With auto-ingest off their "added" changes are deliberately NOT
    # snapshotted until --ack, so on the next pass they re-report — that is
    # the documented c46fb3c semantics, not a regression.)
    diff = json.loads((out_dir / "diff.json").read_text(encoding="utf-8"))
    assert sorted(c["sourceId"] for c in diff["changes"]) == ["ok-a", "ok-b"]
    assert all(c["kind"] == "added" for c in diff["changes"])


def test_run_pass_treats_304_as_unchanged(isolated_pass):
    """A NotModified outcome is a clean no-op: no error, no diff."""
    sources_path, supplements = isolated_pass
    _write_sources(sources_path, [_entry("cached")])

    body = "first body"

    def _collect(entry: dict) -> RegulationUpdate:
        return _update(entry["id"], body)

    # Seed the baseline so the source is no longer "new".
    with patch.object(orchestrator, "collect_source", side_effect=_collect):
        assert orchestrator.run_pass() == orchestrator.EXIT_CHANGES_PENDING

    run_date = time.strftime("%Y-%m-%d", time.gmtime())
    out_dir = supplements / f"watchdog-{run_date}"
    (out_dir / "diff.json").unlink()  # clear pass-1 output so pass 2 is the only writer

    def _collect_304(entry: dict) -> RegulationUpdate:
        raise NotModified(f"https://example.com/{entry['id']}")

    with patch.object(orchestrator, "collect_source", side_effect=_collect_304):
        assert orchestrator.run_pass() == orchestrator.EXIT_CLEAN

    assert not (out_dir / "errors.json").exists()
    assert not (out_dir / "diff.json").exists()


def test_run_pass_records_deadline_exceeded(isolated_pass):
    """A source that burns its fetch budget lands in errors.json."""
    sources_path, supplements = isolated_pass
    _write_sources(sources_path, [_entry("slow")])

    def _collect(entry: dict) -> RegulationUpdate:
        raise FetchDeadlineExceeded(f"{entry['id']}: budget gone")

    with patch.object(orchestrator, "collect_source", side_effect=_collect):
        code = orchestrator.run_pass()

    assert code == orchestrator.EXIT_PARTIAL_FAILURE
    run_date = time.strftime("%Y-%m-%d", time.gmtime())
    errors = json.loads(
        (supplements / f"watchdog-{run_date}" / "errors.json").read_text(encoding="utf-8")
    )
    assert errors[0]["sourceId"] == "slow"
    assert errors[0]["error"].startswith("FetchDeadlineExceeded")


def test_run_pass_outputs_are_ordered_by_source_id(isolated_pass):
    """Two passes over the same failing set write byte-identical errors.json
    — the serial apply step sorts, so thread completion order cannot leak
    into the artifacts."""
    sources_path, supplements = isolated_pass
    _write_sources(sources_path, [_entry("z-last"), _entry("a-first"), _entry("m-mid")])

    def _boom(entry: dict) -> RegulationUpdate:
        raise urllib.error.URLError(f"down: {entry['id']}")

    run_date = time.strftime("%Y-%m-%d", time.gmtime())
    errors_path = supplements / f"watchdog-{run_date}" / "errors.json"

    with patch.object(orchestrator, "collect_source", side_effect=_boom):
        orchestrator.run_pass()
        first = errors_path.read_bytes()
        orchestrator.run_pass()
        second = errors_path.read_bytes()

    assert first == second
    assert [e["sourceId"] for e in json.loads(first)] == ["a-first", "m-mid", "z-last"]


# ── cooperative deadline ─────────────────────────────────────────────────


def _always_fail_response():
    raise urllib.error.URLError("network is down")


def test_fetch_deadline_curtails_retries():
    """With a short budget, fetch_url stops retrying and raises
    FetchDeadlineExceeded instead of burning all three attempts."""
    attempts = {"n": 0}

    def _open(request, timeout=30):  # noqa: ARG001
        attempts["n"] += 1
        raise urllib.error.URLError("down")

    started = time.monotonic()
    with patch.object(collectors_base.urllib.request, "urlopen", side_effect=_open):
        with fetch_deadline(1.0):
            with pytest.raises(FetchDeadlineExceeded):
                # retries=10 × 2 s backoff would be ~20 s without the budget.
                fetch_url("https://example.com/slow", retries=10)
    elapsed = time.monotonic() - started

    assert elapsed < 3.0
    assert attempts["n"] < 10


def test_fetch_deadline_expired_before_first_attempt():
    """An already-spent budget fails fast, without touching the network."""
    attempts = {"n": 0}

    def _open(request, timeout=30):  # noqa: ARG001
        attempts["n"] += 1
        raise AssertionError("should not have been called")

    with patch.object(collectors_base.urllib.request, "urlopen", side_effect=_open):
        with fetch_deadline(-1.0):
            with pytest.raises(FetchDeadlineExceeded):
                fetch_url("https://example.com/nope")

    assert attempts["n"] == 0


def test_fetch_deadline_is_scoped_to_the_thread():
    """The budget must not leak to other threads (or to the caller)."""
    assert collectors_base._remaining_budget() is None

    with fetch_deadline(5.0):
        assert collectors_base._remaining_budget() is not None

        seen: list[float | None] = []

        def _probe() -> None:
            seen.append(collectors_base._remaining_budget())

        t = threading.Thread(target=_probe)
        t.start()
        t.join()

    assert seen == [None]
    assert collectors_base._remaining_budget() is None


def test_fetch_deadline_nesting_keeps_the_tighter_budget():
    """A nested deadline may shrink the budget but never extend it."""
    with fetch_deadline(10.0):
        outer = collectors_base._remaining_budget()
        with fetch_deadline(30.0):
            assert collectors_base._remaining_budget() <= outer
    assert collectors_base._remaining_budget() is None
