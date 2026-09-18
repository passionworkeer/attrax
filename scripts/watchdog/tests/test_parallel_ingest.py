"""Tests for 2026-09-18 H16/M20: per-source ingest on a bounded worker pool.

Covered here:
  - ``run_pass`` dispatches each landed change's ingest (evidence + YAML)
    while the remaining sources are still being fetched. A source whose
    fetch blocks on an "ingest started" event proves the overlap: with the
    old deferred-ingest design that wait times out and the source lands in
    errors.json instead of applied.json.
  - The index rebuild stays a single, final, single-threaded step.
  - An ingest failure stays isolated to its source and keeps that source
    un-snapshotted, so the next pass re-reports it (the pre-existing
    blocked-source semantics, preserved across the parallel refactor).
"""
from __future__ import annotations

import json
import sys
import threading
import time
from pathlib import Path
from unittest.mock import patch

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.watchdog import orchestrator  # noqa: E402
from scripts.watchdog import auto_ingest as ai  # noqa: E402
from scripts.watchdog.auto_ingest import AutoIngestor  # noqa: E402
from scripts.watchdog.collectors.base import (  # noqa: E402
    RegulationUpdate,
    _recall_conditional,
    _remember_conditional,
)
from scripts.watchdog.state import text_hash  # noqa: E402


def _update(source_id: str, text: str) -> RegulationUpdate:
    return RegulationUpdate(
        source_id=source_id,
        market="EU",
        source_type="gov_html",
        source_url=f"https://example.com/{source_id}",
        title=f"title {source_id}",
        text=text,
        content_hash=text_hash(text),
    )


def _entry(source_id: str) -> dict:
    """A gov_html source with an explicit regulation mapping so the CREATE
    path writes a predictable ``regs/eu/EU-<ID>.yaml``."""
    return {
        "id": source_id,
        "market": "EU",
        "source_type": "gov_html",
        "source_url": f"https://example.com/{source_id}",
        "title": f"title {source_id}",
        "regulation_id": f"EU-{source_id.upper()}",
    }


def _write_sources(path: Path, entries: list[dict]) -> None:
    path.write_text(json.dumps(entries), encoding="utf-8")


def _run_date() -> str:
    return time.strftime("%Y-%m-%d", time.gmtime())


@pytest.fixture()
def isolated_pass(tmp_path, monkeypatch):
    """Point the orchestrator AND the ingestor at tmp dirs.

    Auto-ingest is ON (the path under test); the fetch itself is patched by
    each test via ``orchestrator.collect_source``.
    """
    supplements = tmp_path / "supplements"
    sources_path = tmp_path / "official_sources.json"
    regs = tmp_path / "regulations"
    for sub in ("eu", "us"):
        (regs / sub).mkdir(parents=True)

    monkeypatch.setattr(orchestrator, "SUPPLEMENTS_DIR", supplements)
    monkeypatch.setattr(orchestrator, "SOURCES_PATH", sources_path)
    monkeypatch.setattr(ai, "SUPPLEMENTS_DIR", supplements)
    monkeypatch.setattr(ai, "REGULATIONS_ROOT", regs)
    monkeypatch.setattr(ai, "INDEX_PATH", regs / "regulations_index.json")
    monkeypatch.setenv("ATTRAX_REGWATCH_AUTO_INGEST", "true")
    return sources_path, supplements, regs


def test_ingest_starts_while_other_fetches_are_still_running(isolated_pass, monkeypatch):
    """The gate source's fetch blocks until another source's ingest has
    begun — impossible with a fetch-then-ingest two-phase pass."""
    sources_path, supplements, _regs = isolated_pass
    ids = ["alpha", "gate", "beta"]
    _write_sources(sources_path, [_entry(i) for i in ids])

    ingest_started = threading.Event()
    real_store = AutoIngestor._store_evidence

    def _spy(self, source_id, entry, update, change, reg_id=None):
        ingest_started.set()
        return real_store(self, source_id, entry, update, change, reg_id)

    monkeypatch.setattr(AutoIngestor, "_store_evidence", _spy)

    def _collect(entry: dict) -> RegulationUpdate:
        if entry["id"] == "gate":
            # Released only by an ingest that started while this fetch was
            # still in flight. On timeout the assertion fails inside the
            # fetch worker, so the source lands in errors.json and the
            # assertions below catch the regression.
            assert ingest_started.wait(10), "no ingest ran during the fetch phase"
        return _update(entry["id"], f"body of {entry['id']}")

    with patch.object(orchestrator, "collect_source", side_effect=_collect):
        code = orchestrator.run_pass()

    assert code == orchestrator.EXIT_CHANGES_PENDING
    out_dir = supplements / f"watchdog-{_run_date()}"
    assert not (out_dir / "errors.json").exists()
    applied = json.loads((out_dir / "applied.json").read_text(encoding="utf-8"))
    assert sorted(r["sourceId"] for r in applied["records"]) == sorted(ids)


def test_index_is_rebuilt_exactly_once_per_pass(isolated_pass, monkeypatch):
    """The rebuild is the final single-threaded step: four ingested sources
    must still produce exactly one index write for the pass."""
    sources_path, _supplements, regs = isolated_pass
    ids = [f"src{i}" for i in range(4)]
    _write_sources(sources_path, [_entry(i) for i in ids])

    calls: list[int] = []
    real_rebuild = AutoIngestor._rebuild_index

    def _spy() -> None:
        calls.append(1)
        real_rebuild()

    monkeypatch.setattr(AutoIngestor, "_rebuild_index", staticmethod(_spy))

    with patch.object(
        orchestrator, "collect_source", side_effect=lambda e: _update(e["id"], f"body {e['id']}")
    ):
        assert orchestrator.run_pass() == orchestrator.EXIT_CHANGES_PENDING

    assert len(calls) == 1
    index = json.loads((regs / "regulations_index.json").read_text(encoding="utf-8"))
    assert index["count"] == 4


def test_ingest_failure_is_isolated_and_blocks_only_that_source(isolated_pass, monkeypatch):
    """One source's ingest blowing up must not stop its sibling, and the
    failed source stays un-snapshotted so the next pass re-reports it."""
    sources_path, supplements, regs = isolated_pass
    _write_sources(sources_path, [_entry("alpha"), _entry("beta")])

    real_store = AutoIngestor._store_evidence
    fail_alpha = {"pending": True}

    def _flaky(self, source_id, entry, update, change, reg_id=None):
        if source_id == "alpha" and fail_alpha["pending"]:
            fail_alpha["pending"] = False
            raise OSError("disk full")
        return real_store(self, source_id, entry, update, change, reg_id)

    monkeypatch.setattr(AutoIngestor, "_store_evidence", _flaky)

    def _collect(entry: dict) -> RegulationUpdate:
        return _update(entry["id"], f"body of {entry['id']}")

    with patch.object(orchestrator, "collect_source", side_effect=_collect):
        assert orchestrator.run_pass() == orchestrator.EXIT_CHANGES_PENDING

    out_dir = supplements / f"watchdog-{_run_date()}"
    applied = json.loads((out_dir / "applied.json").read_text(encoding="utf-8"))
    assert [f["sourceId"] for f in applied["failed"]] == ["alpha"]
    assert "OSError" in applied["failed"][0]["error"]
    assert [r["sourceId"] for r in applied["records"]] == ["beta"]
    assert (regs / "eu" / "EU-BETA.yaml").exists()
    assert not (regs / "eu" / "EU-ALPHA.yaml").exists()

    # Pass 2, healthy ingest: beta was snapshotted in pass 1 → no change;
    # alpha was blocked → it re-reports and only now gets ingested.
    (out_dir / "diff.json").unlink()
    with patch.object(orchestrator, "collect_source", side_effect=_collect):
        assert orchestrator.run_pass() == orchestrator.EXIT_CHANGES_PENDING

    diff = json.loads((out_dir / "diff.json").read_text(encoding="utf-8"))
    assert [c["sourceId"] for c in diff["changes"]] == ["alpha"]
    assert (regs / "eu" / "EU-ALPHA.yaml").exists()


def test_unapplied_change_drops_the_conditional_cache(isolated_pass, monkeypatch):
    """M19 gap: the cached ETag belongs to the post-change bytes. If the
    ingest did not apply, the next pass must re-fetch and re-detect — a 304
    against the un-applied upstream bytes would hide the change forever."""
    sources_path, _supplements, _regs = isolated_pass
    _write_sources(sources_path, [_entry("alpha"), _entry("beta")])

    # Simulate the pass that fetched both sources and cached their validators.
    for source_id in ("alpha", "beta"):
        _remember_conditional(
            source_id, f"https://example.com/{source_id}", '"E2"', None
        )

    real_store = AutoIngestor._store_evidence
    fail_alpha = {"pending": True}

    def _flaky(self, source_id, *args, **kwargs):
        if source_id == "alpha" and fail_alpha["pending"]:
            fail_alpha["pending"] = False
            raise OSError("disk full")
        return real_store(self, source_id, *args, **kwargs)

    monkeypatch.setattr(AutoIngestor, "_store_evidence", _flaky)

    with patch.object(
        orchestrator,
        "collect_source",
        side_effect=lambda e: _update(e["id"], f"body {e['id']}"),
    ):
        orchestrator.run_pass()

    # alpha's baseline did not move → its validators are gone (re-fetch next pass).
    assert _recall_conditional("alpha", "https://example.com/alpha") == (None, None)
    # beta was ingested and snapshotted → its validators are still honest.
    assert _recall_conditional("beta", "https://example.com/beta") == ('"E2"', None)
