"""Edge-case tests for fusion + must_check + bm25 edge cases.

The main test_retrieval.py covers the happy path; this file locks in the
boundary behaviors that have regressed before (empty inputs, un-built index,
single-element normalization, must-check dedup against existing results).
"""
from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rag_service.retrieval.fusion import rrf_fuse, normalize_scores
from rag_service.retrieval.bm25_retriever import BM25Retriever, _tokenize
from rag_service.retrieval.must_check import (
    get_must_check_regulations,
    apply_must_check,
    CATEGORY_REGULATIONS,
)


# ── fusion edge cases ────────────────────────────────────────────────────────

def test_rrf_fuse_empty_inputs_returns_empty_list():
    assert rrf_fuse([], [], k=25) == []


def test_rrf_fuse_dense_only_preserves_order():
    dense = [
        {"id": "a", "score": 0.9, "doc_name": "A", "content": "..."},
        {"id": "b", "score": 0.5, "doc_name": "B", "content": "..."},
    ]
    out = rrf_fuse(dense, [], k=25)
    assert [r["id"] for r in out] == ["a", "b"]
    # bm25_score is 0 when no bm25 results
    assert all(r["bm25_score"] == 0.0 for r in out)


def test_rrf_fuse_bm25_only_normalizes_scores():
    bm25 = [
        {"id": "x", "score": 20, "doc_name": "X", "content": "..."},
        {"id": "y", "score": 10, "doc_name": "Y", "content": "..."},
    ]
    out = rrf_fuse([], bm25, k=25)
    assert [r["id"] for r in out] == ["x", "y"]
    # max score 20 -> x normalized to 1.0, y to 0.5
    assert out[0]["bm25_score"] == 1.0
    assert out[1]["bm25_score"] == 0.5


def test_rrf_fuse_respects_top_k_limit():
    dense = [{"id": str(i), "score": 0.1, "doc_name": f"D{i}", "content": "."} for i in range(30)]
    out = rrf_fuse(dense, [], k=25, top_k=5)
    assert len(out) == 5


def test_rrf_fuse_zero_bm25_scores_sets_norm_zero():
    # All-zero BM25 scores should not divide by zero.
    bm25 = [
        {"id": "z", "score": 0, "doc_name": "Z", "content": "."},
    ]
    out = rrf_fuse([], bm25, k=25)
    assert out[0]["bm25_score"] == 0.0


def test_normalize_scores_empty_input_returns_empty():
    assert normalize_scores([]) == []


def test_normalize_scores_single_element_sets_norm_to_one():
    # Min == max for a single element -> _norm is 1.0 (not divide-by-zero).
    single = [{"dense_score": 0.5, "bm25_score": 0.3, "rrf_score": 0.04}]
    out = normalize_scores(single)
    assert out[0]["dense_score_norm"] == 1.0
    assert out[0]["bm25_score_norm"] == 1.0
    assert out[0]["rrf_score_norm"] == 1.0


def test_normalize_scores_min_max_spread():
    rows = [
        {"dense_score": 0.2, "bm25_score": 0.1, "rrf_score": 0.01},
        {"dense_score": 0.8, "bm25_score": 0.5, "rrf_score": 0.08},
    ]
    out = normalize_scores(rows)
    assert out[0]["dense_score_norm"] == 0.0
    assert out[1]["dense_score_norm"] == 1.0


# ── bm25 edge cases ──────────────────────────────────────────────────────────

def test_bm25_search_before_build_returns_empty():
    """Calling search() without build_index() must not raise — return []."""
    retriever = BM25Retriever()
    assert retriever.search("anything") == []


def test_bm25_empty_query_returns_empty():
    retriever = BM25Retriever.from_chunks([
        {"id": "c1", "content": "RoHS directive", "doc_name": "RoHS"},
    ])
    # Whitespace-only query tokenizes to nothing -> []
    assert retriever.search("   ") == []


def test_bm25_search_no_match_returns_empty():
    retriever = BM25Retriever.from_chunks([
        {"id": "c1", "content": "RoHS directive", "doc_name": "RoHS"},
    ])
    assert retriever.search("zzzznonexistent") == []


def test_bm25_search_returns_metadata_fields():
    retriever = BM25Retriever.from_chunks([
        {
            "id": "c1",
            "content": "RoHS directive restricts lead",
            "doc_name": "RoHS 2011/65/EU",
            "article_no": "Art.4",
            "region": "EU",
        },
    ])
    out = retriever.search("RoHS lead")
    assert len(out) >= 1
    r = out[0]
    assert r["doc_name"] == "RoHS 2011/65/EU"
    assert r["article_no"] == "Art.4"
    assert r["region"] == "EU"
    assert "score" in r


def test_tokenize_handles_empty_and_none():
    assert _tokenize("") == []
    assert _tokenize(None) == []  # type: ignore[arg-type]


def test_tokenize_mixed_cjk_and_ascii():
    tokens = _tokenize("RoHS 铅含量限制")
    # Should contain both ascii (rohs) and CJK unigrams (铅, 限, etc.)
    assert "rohs" in tokens
    assert any(t for t in tokens if "一" <= t[0] <= "鿿")


# ── must_check edge cases ────────────────────────────────────────────────────

def test_get_must_check_unknown_category_returns_empty():
    assert get_must_check_regulations("nonexistent_category") == []


def test_get_must_check_is_case_insensitive():
    lower = get_must_check_regulations("electronics")
    upper = get_must_check_regulations("ELECTRONICS")
    mixed = get_must_check_regulations("Electronics")
    assert lower == upper == mixed
    assert len(lower) > 0


def test_apply_must_check_skips_already_present_docs():
    """If a must-check doc_name is already in results, don't duplicate-inject."""
    chunks = [
        {"id": "ck1", "content": "RoHS", "doc_name": "RoHS Directive 2011/65/EU", "region": "EU"},
    ]
    results = [
        {"id": "r1", "score": 0.9, "doc_name": "RoHS Directive 2011/65/EU", "content": "...", "region": "EU"},
    ]
    out = apply_must_check(results, "electronics", chunks)
    # RoHS is already present -> should NOT be injected again
    rohs_entries = [r for r in out if r.get("doc_name") == "RoHS Directive 2011/65/EU"]
    assert len(rohs_entries) == 1


def test_apply_must_check_caps_at_50_results():
    """apply_must_check returns at most 50 results."""
    chunks = [{"id": f"ck{i}", "content": "x", "doc_name": f"doc{i}", "region": "EU"} for i in range(60)]
    results = [{"id": f"r{i}", "score": 0.1, "doc_name": f"existing{i}", "content": ".", "region": "EU"} for i in range(60)]
    out = apply_must_check(results, "electronics", chunks)
    assert len(out) <= 50


def test_apply_must_check_no_category_passes_through():
    """Unknown category returns results unchanged."""
    results = [{"id": "r1", "score": 0.9, "doc_name": "X", "content": ".", "region": "EU"}]
    out = apply_must_check(results, "unknown_cat", [])
    assert out == results


def test_category_regulations_covers_expected_categories():
    # Sanity: the categories the frontend claims to support all have entries.
    for cat in ["electronics", "appliance", "toy", "battery", "cosmetic", "textile", "food_contact"]:
        assert cat in CATEGORY_REGULATIONS, f"missing must-check for {cat}"
        assert len(CATEGORY_REGULATIONS[cat]) > 0
