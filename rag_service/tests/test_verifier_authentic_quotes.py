import pytest
from rag_service.pipeline.nodes.verifier import (
    _ARTICLE_TEXT_CACHE,
    _sync_article_cache,
    verifier_node,
    _attach_canonical_excerpts,
)
from rag_service.pipeline.state import GraphState
from rag_service.retrieval import article_loader


def test_attach_canonical_excerpts_preserves_authentic_quotes():
    # Pre-populate cache
    _ARTICLE_TEXT_CACHE[("EU-2023-1542", "art-13")] = (
        "From 18 August 2024, batteries shall be marked with the CE symbol and the QR code."
    )

    citations = [
        {
            "doc_id": "EU-2023-1542",
            "article_id": "art-13",
            "quote": "Batteries must have CE mark.",
            "match_status": "fallback_article_only",
        }
    ]

    attached = _attach_canonical_excerpts(citations)
    assert attached == 1
    assert citations[0]["match_status"] == "fallback_article_only"
    # Authentic LLM quote must NOT be overwritten!
    assert citations[0]["quote"] == "Batteries must have CE mark."
    # Canonical excerpt attached
    assert "From 18 August 2024" in citations[0]["canonical_excerpt"]
    assert citations[0]["quote_provenance"] == "llm_paraphrase_unverified"


def test_attach_canonical_excerpts_skips_matched_or_unmatched():
    citations = [
        {
            "doc_id": "EU-2023-1542",
            "article_id": "art-13",
            "quote": "Exact verbatim text",
            "match_status": "matched",
        },
        {
            "doc_id": "UNKNOWN",
            "article_id": "art-1",
            "quote": "Random text",
            "match_status": "unmatched",
        },
    ]

    attached = _attach_canonical_excerpts(citations)
    assert attached == 0
    assert "canonical_excerpt" not in citations[0]
    assert "canonical_excerpt" not in citations[1]


def test_verifier_node_empty_citations():
    state: GraphState = {
        "report_package": {
            "citations": [],
        }
    }

    result = verifier_node(state)
    assert result["agent_trace"][0]["node"] == "verify"
    assert result["agent_trace"][0]["status"] == "no_citations"


def test_verifier_node_with_real_citations():
    _ARTICLE_TEXT_CACHE[("EU-2023-1542", "art-13")] = (
        "Batteries shall be marked with the CE symbol."
    )
    # J08: the verifier now syncs its cache against the library generation
    # and drops it when the library was reloaded in between (other tests in
    # the suite call article_loader.invalidate_cache()). A pre-populated
    # fixture entry must pin the current generation so it is adopted, not
    # cleared, on the next verifier_node call.
    import rag_service.pipeline.nodes.verifier as verifier_mod
    verifier_mod._ARTICLE_TEXT_CACHE_GENERATION = article_loader.cache_generation()

    state: GraphState = {
        "report_package": {
            "citations": [
                {
                    "doc_id": "EU-2023-1542",
                    "article_id": "art-13",
                    "quote": "Batteries shall be marked with the CE symbol.",
                }
            ],
            "auditMetadata": {},
        }
    }

    result = verifier_node(state)
    assert result["agent_trace"][0]["status"] == "success"
    assert result["agent_trace"][0]["matched"] == 1
    rp = result["report_package"]
    assert rp["auditMetadata"]["verificationMode"] == "kb_exact_quote"
    assert "evidencePack" in rp


# ── cache staleness guard (plan 2026-09-14 J08) ────────────────────────


class TestArticleCacheInvalidation:
    """The (doc_id, article_id) cache must not outlive a library edit.

    The 2026-09-14 governance pass rewrote EU-2009-48 articles; without a
    guard a running process would keep matching new quotes against the
    old placeholder text. The loader ticks `cache_generation()` whenever
    the on-disk library changes; the verifier drops its cache on a tick.
    """

    def teardown_method(self):
        # Leave the module as a fresh process would look: empty cache,
        # un-adopted generation, so later tests that pre-populate the
        # cache (their own fixture) adopt rather than clear.
        import rag_service.pipeline.nodes.verifier as verifier_mod
        verifier_mod._ARTICLE_TEXT_CACHE.clear()
        verifier_mod._ARTICLE_TEXT_CACHE_GENERATION = -1


    def test_cache_cleared_when_library_generation_ticks(self):
        _ARTICLE_TEXT_CACHE.clear()
        _ARTICLE_TEXT_CACHE[("EU-2023-1542", "art-13")] = "stale text"
        # Simulate a first verifier run adopting the current generation.
        _sync_article_cache()
        assert ("EU-2023-1542", "art-13") in _ARTICLE_TEXT_CACHE

        # Library changes on disk → loader rebuild ticks the generation.
        article_loader.invalidate_cache()
        _sync_article_cache()
        assert ("EU-2023-1542", "art-13") not in _ARTICLE_TEXT_CACHE
        # ... and a fresh run reloads from the files.
        verifier_node({
            "report_package": {
                "citations": [
                    {"doc_id": "EU-2023-1542", "article_id": "art-13", "quote": "x"}
                ],
            },
        })
        assert ("EU-2023-1542", "art-13") in _ARTICLE_TEXT_CACHE
        _ARTICLE_TEXT_CACHE.clear()

    def test_first_call_adopts_generation_without_clearing(self, monkeypatch):
        # Tests pre-populate the cache as a fixture before the first
        # verifier_node call — adoption must not wipe it (regression
        # guard for test_verifier_node_with_real_citations semantics).
        import rag_service.pipeline.nodes.verifier as verifier_mod
        _ARTICLE_TEXT_CACHE.clear()
        _ARTICLE_TEXT_CACHE[("EU-2023-1542", "art-13")] = "fixture text"
        # Reset the adopted-generation marker to simulate a fresh process.
        monkeypatch.setattr(verifier_mod, "_ARTICLE_TEXT_CACHE_GENERATION", -1)
        _sync_article_cache()
        assert ("EU-2023-1542", "art-13") in _ARTICLE_TEXT_CACHE
        _ARTICLE_TEXT_CACHE.clear()

    def test_article_loader_reloads_edited_file(self, tmp_path, monkeypatch):
        # End-to-end: editing a regulation YAML between loads must be
        # visible through load_article_text without process restart.
        reg_dir = tmp_path / "eu"
        reg_dir.mkdir()
        (reg_dir / "TEST-X.yaml").write_text(
            "id: TEST-X\n"
            "official_citation: Test\n"
            "license: public\n"
            "last_verified: '2026-09-14'\n"
            "language: en\n"
            "source_kind: unverified\n"
            "articles:\n"
            "- id: art-1\n"
            "  title: T\n"
            "  text: first body\n"
            "raw_file: null\n"
            "checksum_sha256: null\n"
            "schema_version: 1\n"
            "source_url: https://example.com/x\n"
            "notes: test fixture\n"
        )
        monkeypatch.setattr(article_loader, "_regulations_root", tmp_path)
        article_loader.invalidate_cache()
        assert article_loader.load_article_text("TEST-X", "art-1") == "first body"

        import os, time
        target = reg_dir / "TEST-X.yaml"
        stat = target.stat()
        # Rewrite with new content and force a different mtime (mtime_ns
        # granularity may not tick within the same clock read on fast
        # filesystems; bump size AND mtime explicitly).
        os.utime(target, ns=(stat.st_atime_ns, stat.st_mtime_ns + 10_000_000))
        target.write_text(
            "id: TEST-X\n"
            "official_citation: Test\n"
            "license: public\n"
            "last_verified: '2026-09-14'\n"
            "language: en\n"
            "source_kind: unverified\n"
            "articles:\n"
            "- id: art-1\n"
            "  title: T\n"
            "  text: second body with more characters\n"
            "raw_file: null\n"
            "checksum_sha256: null\n"
            "schema_version: 1\n"
            "source_url: https://example.com/x\n"
            "notes: test fixture\n"
        )
        assert article_loader.load_article_text("TEST-X", "art-1") == (
            "second body with more characters"
        )
        # Restore the real root for the rest of the suite.
        monkeypatch.setattr(article_loader, "_regulations_root", article_loader._DEFAULT_REGULATIONS_ROOT)
        article_loader.invalidate_cache()
