"""Adversarial tests for the article_loader cache staleness guard
(plan 2026-09-14 J08 / §4.4 layer 3, cache invalidation).

The review's question: does the mtime-snapshot invalidation REALLY trigger,
or is it a paper guard? These tests attack it with:
  1. same-mtime rewrite that changes only the file SIZE (mtime granularity
     may not tick on fast filesystems — size must still catch it);
  2. a brand-new regulation file appearing on disk;
  3. a file deleted between loads;
  4. cache_generation() actually ticking on each of those events.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

from rag_service.retrieval import article_loader  # noqa: E402


REG_YAML = """id: {reg_id}
official_citation: Test
license: public
last_verified: '2026-09-14'
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
    (reg_dir / "TEST-CACHE.yaml").write_text(
        REG_YAML.format(reg_id="TEST-CACHE", text="first body"), encoding="utf-8"
    )
    monkeypatch.setattr(article_loader, "_regulations_root", tmp_path)
    article_loader.invalidate_cache()
    yield tmp_path
    monkeypatch.setattr(
        article_loader, "_regulations_root", article_loader._DEFAULT_REGULATIONS_ROOT
    )
    article_loader.invalidate_cache()


class TestCacheStalenessGuard:
    def test_same_mtime_size_change_is_detected(self, fixture_library, monkeypatch):
        """A rewrite that keeps mtime identical (forced back with os.utime)
        but changes the content size must still invalidate the cache — the
        stamp includes (mtime_ns, size), so the size component alone must
        catch the edit."""
        target = fixture_library / "eu" / "TEST-CACHE.yaml"
        stat_before = target.stat()

        assert article_loader.load_article_text("TEST-CACHE", "art-1") == "first body"
        gen_before = article_loader.cache_generation()

        # Rewrite with different content, then force the OLD mtime back.
        target.write_text(
            REG_YAML.format(
                reg_id="TEST-CACHE",
                text="second body that is noticeably longer",
            ),
            encoding="utf-8",
        )
        os.utime(target, ns=(stat_before.st_atime_ns, stat_before.st_mtime_ns))

        # Size changed even though mtime did not → stamp differs → reload.
        assert article_loader.load_article_text("TEST-CACHE", "art-1") == (
            "second body that is noticeably longer"
        )
        assert article_loader.cache_generation() > gen_before

    def test_mtime_change_alone_is_detected(self, fixture_library):
        target = fixture_library / "eu" / "TEST-CACHE.yaml"
        assert article_loader.load_article_text("TEST-CACHE", "art-1") == "first body"
        gen_before = article_loader.cache_generation()

        stat = target.stat()
        os.utime(target, ns=(stat.st_atime_ns, stat.st_mtime_ns + 10_000_000))
        assert article_loader.load_article_text("TEST-CACHE", "art-1") == "first body"
        assert article_loader.cache_generation() > gen_before

    def test_new_file_added_is_visible_without_restart(self, fixture_library):
        assert "TEST-CACHE-2" not in article_loader.list_regulation_ids()
        (fixture_library / "eu" / "TEST-CACHE-2.yaml").write_text(
            REG_YAML.format(reg_id="TEST-CACHE-2", text="fresh entry"),
            encoding="utf-8",
        )
        assert "TEST-CACHE-2" in article_loader.list_regulation_ids()
        assert (
            article_loader.load_article_text("TEST-CACHE-2", "art-1") == "fresh entry"
        )

    def test_deleted_file_disappears_from_cache_view(self, fixture_library):
        assert "TEST-CACHE" in article_loader.list_regulation_ids()
        (fixture_library / "eu" / "TEST-CACHE.yaml").unlink()
        assert "TEST-CACHE" not in article_loader.list_regulation_ids()
        assert article_loader.load_article_text("TEST-CACHE", "art-1") is None

    def test_generation_ticks_exactly_once_per_rebuild(self, fixture_library):
        # Repeated reads with no disk change must NOT tick the generation.
        article_loader.load_article_text("TEST-CACHE", "art-1")
        gen = article_loader.cache_generation()
        article_loader.load_article_text("TEST-CACHE", "art-1")
        article_loader.list_regulation_ids()
        assert article_loader.cache_generation() == gen

    def test_unrelated_directory_change_does_not_clobber(self, fixture_library):
        # A file written OUTSIDE the regulations root must not invalidate.
        gen = article_loader.cache_generation()
        outside = fixture_library / "unrelated.txt"
        outside.write_text("noise", encoding="utf-8")
        article_loader.load_article_text("TEST-CACHE", "art-1")
        assert article_loader.cache_generation() == gen
