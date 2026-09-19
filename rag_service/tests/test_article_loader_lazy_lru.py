"""Tests for article_loader's lazy + LRU cache layout (2026-09-19).

Validates that the lazy migration preserves the cache staleness guard and
adds the new guarantees:
  1. cold start does NOT pre-parse every YAML on disk
  2. repeated access populates the LRU but never exceeds maxsize
  3. concurrent misses on the same id populate the LRU exactly once
  4. stamp change clears the LRU and ticks the generation
  5. legacy _load_all() returns the LRU snapshot, not a full rebuild
  6. list_regulation_ids() is O(1) after the first call (no IO)
"""
from __future__ import annotations

import sys
import threading
from collections import OrderedDict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

from rag_service.retrieval import article_loader  # noqa: E402


REG_YAML = """id: {reg_id}
official_citation: Test
license: public
last_verified: '2026-09-19'
language: en
source_kind: official_verbatim
articles:
- id: art-1
  title: T
  text: {text}
raw_file: null
checksum_sha256: null
schema_version: 1
source_url: https://example.com/x
notes: test fixture
"""


@pytest.fixture()
def fixture_library(tmp_path, monkeypatch):
    reg_dir = tmp_path / "eu"
    reg_dir.mkdir()
    (reg_dir / "TEST-LAZY-A.yaml").write_text(
        REG_YAML.format(reg_id="TEST-LAZY-A", text="body A"), encoding="utf-8"
    )
    (reg_dir / "TEST-LAZY-B.yaml").write_text(
        REG_YAML.format(reg_id="TEST-LAZY-B", text="body B"), encoding="utf-8"
    )
    monkeypatch.setattr(article_loader, "_regulations_root", tmp_path)
    article_loader.invalidate_cache()
    yield tmp_path
    monkeypatch.setattr(
        article_loader, "_regulations_root", article_loader._DEFAULT_REGULATIONS_ROOT
    )
    article_loader.invalidate_cache()


class TestLazyColdStart:
    def test_first_list_does_not_parse_every_yaml(self, fixture_library, monkeypatch):
        """Cold start: list_regulation_ids() must do glob+stat only, no yaml parse.

        Count calls to the private _load_one; that function is the only
        caller of yaml.safe_load.
        """
        calls = []
        original_load_one = article_loader._load_one

        def tracked_load_one(reg_id):
            calls.append(reg_id)
            return original_load_one(reg_id)

        monkeypatch.setattr(article_loader, "_load_one", tracked_load_one)
        ids = article_loader.list_regulation_ids()
        assert sorted(ids) == ["TEST-LAZY-A", "TEST-LAZY-B"]
        # No _load_one calls during list (only the index build runs)
        assert calls == [], f"_load_one called {len(calls)} times during cold list"

    def test_first_load_regulation_parses_only_target_yaml(self, fixture_library, monkeypatch):
        """Single load_regulation() reads ONE file, not all of them."""
        calls = []
        original_load_one = article_loader._load_one

        def tracked_load_one(reg_id):
            calls.append(reg_id)
            return original_load_one(reg_id)

        monkeypatch.setattr(article_loader, "_load_one", tracked_load_one)
        reg = article_loader.load_regulation("TEST-LAZY-A")
        assert reg is not None
        assert reg["id"] == "TEST-LAZY-A"
        # Exactly one load happened (the requested file)
        assert calls == ["TEST-LAZY-A"]


class TestLRUEviction:
    def test_repeated_access_populates_lru_without_eviction(self, fixture_library):
        """Hits within maxsize never evict."""
        for _ in range(5):
            reg = article_loader.load_regulation("TEST-LAZY-A")
            assert reg is not None
        assert article_loader._cache is not None
        assert len(article_loader._cache) == 1
        assert "TEST-LAZY-A" in article_loader._cache

    def test_lru_maxsize_evicts_least_recently_used(self, fixture_library, monkeypatch):
        """Populating beyond maxsize evicts in LRU order."""
        # Lower maxsize for this test
        monkeypatch.setattr(article_loader, "_LRU_MAXSIZE", 2)
        # Write extra files
        (fixture_library / "eu" / "TEST-LAZY-C.yaml").write_text(
            REG_YAML.format(reg_id="TEST-LAZY-C", text="body C"), encoding="utf-8"
        )
        (fixture_library / "eu" / "TEST-LAZY-D.yaml").write_text(
            REG_YAML.format(reg_id="TEST-LAZY-D", text="body D"), encoding="utf-8"
        )
        article_loader.invalidate_cache()

        article_loader.load_regulation("TEST-LAZY-A")
        article_loader.load_regulation("TEST-LAZY-B")
        article_loader.load_regulation("TEST-LAZY-C")
        # LRU size is 2; TEST-LAZY-A should be evicted
        assert article_loader._cache is not None
        assert "TEST-LAZY-A" not in article_loader._cache
        assert "TEST-LAZY-B" in article_loader._cache
        assert "TEST-LAZY-C" in article_loader._cache

        # Touching TEST-LAZY-B should mark it recent
        article_loader.load_regulation("TEST-LAZY-B")
        # Now inserting D evicts C (LRU), not B
        article_loader.load_regulation("TEST-LAZY-D")
        assert "TEST-LAZY-B" in article_loader._cache
        assert "TEST-LAZY-C" not in article_loader._cache
        assert "TEST-LAZY-D" in article_loader._cache


class TestConcurrency:
    def test_concurrent_misses_parse_each_file_once(self, fixture_library, monkeypatch):
        """100 threads racing on the same cold id must produce ONE disk parse.

        Counts yaml.safe_load invocations (the actual parse), not _load_one
        calls — every thread legitimately enters _load_one; the contract is
        that all but the first hit the LRU inside the lock.

        NOTE: capture the original safe_load function object BEFORE patching —
        `article_loader.yaml` IS the yaml module, so calling
        `article_loader.yaml.safe_load` from inside the tracker recurses.
        """
        original_safe_load = article_loader.yaml.safe_load
        parses = []
        lock = threading.Lock()

        def tracked_safe_load(stream):
            with lock:
                parses.append(1)
            return original_safe_load(stream)

        monkeypatch.setattr(article_loader.yaml, "safe_load", tracked_safe_load)

        # Build the index first so the race is purely on the LRU miss path.
        article_loader.list_regulation_ids()
        parses.clear()

        results = []

        def hit():
            r = article_loader.load_regulation("TEST-LAZY-A")
            results.append(r)

        threads = [threading.Thread(target=hit) for _ in range(100)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # All threads got the same dict object (LRU hit after first insert)
        assert len(results) == 100
        assert all(r is results[0] for r in results)
        assert results[0] is not None
        # Exactly one disk parse despite 100 concurrent cold misses
        assert len(parses) == 1, f"expected 1 parse, got {len(parses)}"


class TestStampInvalidation:
    def test_stamp_change_clears_lru_and_ticks_generation(self, fixture_library):
        article_loader.load_regulation("TEST-LAZY-A")  # populate LRU
        assert article_loader._cache is not None
        assert "TEST-LAZY-A" in article_loader._cache
        gen_before = article_loader.cache_generation()

        # Edit a YAML on disk
        (fixture_library / "eu" / "TEST-LAZY-A.yaml").write_text(
            REG_YAML.format(reg_id="TEST-LAZY-A", text="UPDATED body A"),
            encoding="utf-8",
        )

        # Trigger re-stamp via any read path
        article_loader.list_regulation_ids()
        # LRU should have been cleared on stamp change
        # (subsequent reads will populate it again)
        gen_after = article_loader.cache_generation()
        assert gen_after == gen_before + 1, "generation must tick on real library change"

        # New content is visible
        reg = article_loader.load_regulation("TEST-LAZY-A")
        assert reg is not None
        text = (reg.get("articles") or [{}])[0].get("text", "")
        assert "UPDATED" in text


class TestLegacyLoadAll:
    def test_load_all_returns_lru_snapshot_not_full_rebuild(self, fixture_library, monkeypatch):
        """_load_all() now returns the LRU contents, NOT every YAML on disk."""
        load_calls = []
        original_load_one = article_loader._load_one

        def tracked_load_one(reg_id):
            load_calls.append(reg_id)
            return original_load_one(reg_id)

        monkeypatch.setattr(article_loader, "_load_one", tracked_load_one)

        # Populate just one id
        article_loader.load_regulation("TEST-LAZY-A")
        load_calls.clear()

        # Call _load_all — should NOT trigger new parses
        all_data = article_loader._load_all()
        assert "TEST-LAZY-A" in all_data
        assert "TEST-LAZY-B" not in all_data  # B was never loaded, not in LRU
        assert load_calls == [], f"_load_all re-parsed {len(load_calls)} files instead of using LRU"


class TestListIsO1:
    def test_repeated_list_parses_no_yaml_and_reuses_index(self, fixture_library, monkeypatch):
        """list_regulation_ids() is stat-only: no YAML parse, index reused.

        The stat walk (_library_stamp) still runs per call — that is the
        staleness detector and costs ~30ms/724 files. What must NOT happen
        is a YAML parse or an index rebuild when nothing changed on disk.
        """
        original_safe_load = article_loader.yaml.safe_load
        parses = []

        def tracked_safe_load(stream):
            parses.append(1)
            return original_safe_load(stream)

        monkeypatch.setattr(article_loader.yaml, "safe_load", tracked_safe_load)

        article_loader.list_regulation_ids()
        index_after_first = article_loader._index
        assert index_after_first is not None

        article_loader.list_regulation_ids()
        article_loader.list_regulation_ids()

        # No YAML parse on any call
        assert parses == [], f"{len(parses)} YAML parses during list calls"
        # Index dict object reused (not rebuilt) while files are unchanged
        assert article_loader._index is index_after_first


class TestReadinessProbeCheap:
    """The /ready path in main.py calls list_regulation_ids() per poll (5min).
    The lazy layout must keep this O(1) — no per-poll yaml parse."""

    def test_readiness_poll_does_not_parse(self, fixture_library, monkeypatch):
        load_calls = []
        original_load_one = article_loader._load_one

        def tracked_load_one(reg_id):
            load_calls.append(reg_id)
            return original_load_one(reg_id)

        monkeypatch.setattr(article_loader, "_load_one", tracked_load_one)
        for _ in range(10):
            article_loader.list_regulation_ids()
        assert load_calls == [], f"readiness poll caused {len(load_calls)} yaml parses"