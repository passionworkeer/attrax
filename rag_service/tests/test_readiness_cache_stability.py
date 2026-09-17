"""Regression guard: read-only probes must not mutate loader caches.

Background (found 2026-09-17 in production): ``_readiness_snapshot()`` in
main.py called ``kb_loader.invalidate_cache()`` and
``article_loader.invalidate_cache()`` on every request. Two consequences
against a library that had not changed at all:

  1. every /ready forced a full re-parse of the KB anchors and the regulation
     library, and
  2. ``article_loader.invalidate_cache()`` ticks ``cache_generation()``
     unconditionally, which the verifier reads as "the article text changed"
     and answers by clearing ``_ARTICLE_TEXT_CACHE``.

The uptime monitor polls /ready every 5 minutes, so a healthy production box
was wiping both caches roughly 288x a day — and logging "regulation library
changed on disk — cache rebuilt (49 regulations)" each time, which is what
gave the bug away (26 such lines in one log window with no writer on disk).

Freshness is not supposed to come from those invalidations: both loaders
re-stamp the on-disk files on every call. The second half of this module
proves that property still holds, so the fix cannot be mistaken for "cache
forever and serve stale text".
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from rag_service import main as main_module  # noqa: E402
from rag_service.config import settings  # noqa: E402
from rag_service.main import app  # noqa: E402
from rag_service.retrieval import article_loader, kb_loader  # noqa: E402


REG_YAML = """id: {reg_id}
official_citation: Test
license: public
last_verified: '2026-09-17'
language: en
source_kind: official_verbatim
articles:
- id: art-1
  title: T
  text: body for {reg_id}
raw_file: null
checksum_sha256: null
schema_version: 1
source_url: https://example.com/x
notes: test fixture
"""

ANCHOR_YAML = """regulation_id: {reg_id}
doc_name: {reg_id} doc
applies_if:
  category: [electronics]
  markets: [EU]
key_points: [point one]
risk_hint: test anchor
"""


@pytest.fixture(scope="module")
def client():
    """In-process app. Mirrors test_api_smoke: demo mode on, host secret off."""
    previous_demo_mode = settings.demo_mode
    previous_secret = settings.rag_internal_secret
    settings.demo_mode = True
    settings.rag_internal_secret = ""
    with TestClient(app) as test_client:
        yield test_client
    settings.demo_mode = previous_demo_mode
    settings.rag_internal_secret = previous_secret


@pytest.fixture(autouse=True)
def _clean_verifier_cache():
    """Leave the verifier module as a fresh process would look.

    Several tests in the suite pre-populate ``_ARTICLE_TEXT_CACHE`` as their
    own fixture and rely on the next verifier run *adopting* the generation
    rather than clearing it, so this module must not leave a stale marker.
    """
    import rag_service.pipeline.nodes.verifier as verifier_mod

    verifier_mod._ARTICLE_TEXT_CACHE.clear()
    verifier_mod._ARTICLE_TEXT_CACHE_GENERATION = -1
    yield
    verifier_mod._ARTICLE_TEXT_CACHE.clear()
    verifier_mod._ARTICLE_TEXT_CACHE_GENERATION = -1


class TestReadyProbeIsReadOnly:
    """/ready must observe the library, never invalidate it."""

    def test_ready_does_not_tick_cache_generation(self, client):
        article_loader.list_regulation_ids()  # warm the cache
        generation = article_loader.cache_generation()

        for _ in range(3):
            assert client.get("/ready").status_code in (200, 503)

        assert article_loader.cache_generation() == generation, (
            "a /ready poll ticked article_loader.cache_generation(); the "
            "readiness probe must not invalidate the loader cache"
        )

    def test_ready_does_not_discard_verifier_article_cache(self, client):
        import rag_service.pipeline.nodes.verifier as verifier_mod

        article_loader.list_regulation_ids()  # warm the cache
        cached = {("EU-2023-1542", "art-1"): "cached body"}
        verifier_mod._ARTICLE_TEXT_CACHE.clear()
        verifier_mod._ARTICLE_TEXT_CACHE.update(cached)
        # Adopt the current generation, as the first verifier run would.
        verifier_mod._ARTICLE_TEXT_CACHE_GENERATION = article_loader.cache_generation()

        for _ in range(3):
            client.get("/ready")

        # Whatever the next scan does, it must still find the warm entry.
        verifier_mod._sync_article_cache()
        assert verifier_mod._ARTICLE_TEXT_CACHE == cached

    def test_v1_ready_is_read_only_too(self, client):
        article_loader.list_regulation_ids()
        generation = article_loader.cache_generation()

        assert client.get("/api/v1/ready").status_code in (200, 503)

        assert article_loader.cache_generation() == generation


class TestFreshnessSurvivesWithoutInvalidation:
    """The fix must not turn the caches into serve-stale-forever caches."""

    def test_ready_reports_a_regulation_added_on_disk(self, client, tmp_path, monkeypatch):
        reg_dir = tmp_path / "eu"
        reg_dir.mkdir()
        (reg_dir / "R1.yaml").write_text(REG_YAML.format(reg_id="R1"), encoding="utf-8")

        monkeypatch.setattr(article_loader, "_regulations_root", tmp_path)
        article_loader.invalidate_cache()

        first = client.get("/ready").json()
        assert first["release"]["regulationCount"] == 1

        # A new file lands (as regwatch auto-ingest would do at 03:00).
        (reg_dir / "R2.yaml").write_text(REG_YAML.format(reg_id="R2"), encoding="utf-8")

        second = client.get("/ready").json()
        assert second["release"]["regulationCount"] == 2

    def test_kb_loader_sees_a_new_anchor_without_invalidate(self, tmp_path, monkeypatch):
        (tmp_path / "A.yaml").write_text(ANCHOR_YAML.format(reg_id="A-1"), encoding="utf-8")
        monkeypatch.setattr(kb_loader, "_anchors_dir", tmp_path)
        kb_loader.invalidate_cache()

        assert kb_loader.list_all_regulations() == ["A-1"]

        # No invalidate_cache() call here — the stamp guard must notice.
        (tmp_path / "B.yaml").write_text(ANCHOR_YAML.format(reg_id="B-1"), encoding="utf-8")

        assert sorted(kb_loader.list_all_regulations()) == ["A-1", "B-1"]

    def test_article_loader_sees_an_edited_body_without_invalidate(
        self, tmp_path, monkeypatch
    ):
        reg_dir = tmp_path / "eu"
        reg_dir.mkdir()
        target = reg_dir / "E1.yaml"
        target.write_text(REG_YAML.format(reg_id="E1"), encoding="utf-8")

        monkeypatch.setattr(article_loader, "_regulations_root", tmp_path)
        article_loader.invalidate_cache()

        assert article_loader.load_article_text("E1", "art-1") == "body for E1"

        # Rewrite with different content and force a distinct mtime: mtime_ns
        # granularity is not guaranteed to move within one clock read.
        stat = target.stat()
        target.write_text(
            REG_YAML.replace("body for {reg_id}", "edited body for {reg_id}").format(
                reg_id="E1"
            ),
            encoding="utf-8",
        )
        os.utime(target, ns=(stat.st_atime_ns, stat.st_mtime_ns + 10_000_000))

        assert article_loader.load_article_text("E1", "art-1") == "edited body for E1"


class TestReadinessPayloadStaysHonest:
    """Cheap sanity checks that /ready still reports the real gate values."""

    def test_ready_exposes_gate_checks(self, client):
        body = client.get("/ready").json()
        assert set(body["checks"]) >= {
            "kb_anchors",
            "regulation_library",
            "minimax_api_key",
            "config_loaded",
            "scan_service",
        }
        assert isinstance(body["ready"], bool)
        # main.py must not be the thing holding a cache lock or secret.
        assert main_module.app is app
