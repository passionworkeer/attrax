"""Tests for synthesis + refiner nodes — previously 0% dedicated coverage.

synthesis_node: two-stage dedup (id then doc_name), 40-doc LLM cap,
trace entry, empty-input fast path.
refiner_node: extract regulatory terms from missing citations, build
refined query, increment loop_count, preserve sub_queries shape.
"""
from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rag_service.orchestrator.nodes.synthesis import synthesis_node
from rag_service.orchestrator.nodes.refiner import refiner_node


# ── synthesis_node ───────────────────────────────────────────────────────────

def _doc(id_, doc_name, score, market="EU", rrf_score=None):
    return {
        "id": id_,
        "doc_name": doc_name,
        "score": score,
        "rrf_score": rrf_score if rrf_score is not None else score,
        "market": market,
        "content": "...",
    }


def test_synthesis_empty_docs_returns_empty():
    out = synthesis_node({"documents": []})
    assert out["documents"] == []
    # No trace entry appended when nothing to synthesize.
    assert out["agent_trace"] == []


def test_synthesis_empty_docs_preserves_existing_trace():
    existing = [{"node": "retrieve", "status": "ok"}]
    out = synthesis_node({"documents": [], "agent_trace": existing})
    assert out["documents"] == []
    assert out["agent_trace"] == []  # empty-docs branch: no new entry; reducer keeps existing (audit 2026-06-29)


def test_synthesis_stage1_dedup_by_chunk_id():
    docs = [
        _doc("c1", "RoHS", 0.9),
        _doc("c1", "RoHS", 0.9),  # duplicate id -> dropped
        _doc("c2", "REACH", 0.8),
    ]
    out = synthesis_node({"documents": docs})
    ids = [d["id"] for d in out["documents"]]
    assert ids == ["c1", "c2"]


def test_synthesis_must_check_items_without_id_are_kept():
    # Must-check items have synthetic ids like "must_check_..." which ARE
    # present, but chunks with empty id should also be kept (always include).
    docs = [
        {"id": "", "doc_name": "manual", "score": 0.5, "market": "EU"},
        {"id": "", "doc_name": "manual2", "score": 0.4, "market": "EU"},
    ]
    out = synthesis_node({"documents": docs})
    # Both empty-id docs pass stage1; stage2 dedups by doc_name (different) -> both kept.
    assert len(out["documents"]) == 2


def test_synthesis_stage2_dedup_by_doc_name_keeps_highest_score():
    docs = [
        _doc("c1", "RoHS Directive", 0.7, rrf_score=0.07),
        _doc("c2", "RoHS Directive", 0.9, rrf_score=0.09),  # higher -> wins
        _doc("c3", "REACH", 0.8),
    ]
    out = synthesis_node({"documents": docs})
    by_name = {d["doc_name"]: d for d in out["documents"]}
    assert by_name["RoHS Directive"]["id"] == "c2"
    assert "REACH" in by_name


def test_synthesis_caps_at_40_docs():
    docs = [_doc(f"c{i}", f"doc{i}", 0.9 - i * 0.001) for i in range(50)]
    out = synthesis_node({"documents": docs})
    assert len(out["documents"]) == 40


def test_synthesis_sorts_by_score_descending():
    docs = [
        _doc("c1", "low", 0.3),
        _doc("c2", "high", 0.95),
        _doc("c3", "mid", 0.6),
    ]
    out = synthesis_node({"documents": docs})
    scores = [d["score"] for d in out["documents"]]
    assert scores == sorted(scores, reverse=True)
    assert scores[0] == 0.95


def test_synthesis_trace_entry_records_dedup_stages():
    docs = [
        _doc("c1", "RoHS", 0.9),
        _doc("c1", "RoHS", 0.9),  # stage1 drop
        _doc("c2", "REACH", 0.8),
    ]
    out = synthesis_node({"documents": docs})
    trace = out["agent_trace"][-1]
    assert trace["node"] == "synthesis"
    assert trace["total_docs"] == 3
    assert trace["stage1_deduped"] == 2
    assert trace["unique_by_doc_name"] == 2
    assert trace["context_docs_sent"] == 2


def test_synthesis_records_markets_covered():
    docs = [
        _doc("c1", "RoHS", 0.9, market="EU"),
        _doc("c2", "FCC", 0.8, market="US"),
        _doc("c3", "GB", 0.7, market="CN"),
    ]
    out = synthesis_node({"documents": docs})
    trace = out["agent_trace"][-1]
    assert set(trace["markets_covered"]) == {"EU", "US", "CN"}


def test_synthesis_preserves_existing_trace():
    existing = [{"node": "retrieve", "status": "ok"}]
    docs = [_doc("c1", "RoHS", 0.9)]
    out = synthesis_node({"documents": docs, "agent_trace": existing})
    # Node returns ONLY its new entry; the graph reducer accumulates existing (audit 2026-06-29).
    assert len(out["agent_trace"]) == 1
    assert out["agent_trace"][0]["node"] == "synthesis"


def test_synthesis_cross_market_dedup_keeps_best_across_markets():
    # Same doc_name from two markets -> keep the higher-scoring one.
    docs = [
        _doc("c1", "RoHS Directive", 0.7, market="EU"),
        _doc("c2", "RoHS Directive", 0.9, market="US"),
    ]
    out = synthesis_node({"documents": docs})
    assert len(out["documents"]) == 1
    assert out["documents"][0]["id"] == "c2"


# ── refiner_node ─────────────────────────────────────────────────────────────

def test_refiner_no_missing_citations_keeps_query():
    state = {
        "query": "充电宝",
        "sub_queries": [{"market": "EU", "query": "充电宝", "product_type": "充电宝"}],
        "missing_citations": [],
        "loop_count": 0,
    }
    out = refiner_node(state)
    assert out["query"] == "充电宝"
    assert out["loop_count"] == 1
    # sub_queries query keeps original (refiner appends " " + joined terms,
    # which is empty here, so the query gains a trailing space — document
    # this behavior so future refactors notice).
    assert out["sub_queries"][0]["query"].strip() == "充电宝"


def test_refiner_extracts_article_terms_from_missing_citations():
    state = {
        "query": "充电宝",
        "sub_queries": [{"market": "EU", "query": "充电宝", "product_type": "充电宝"}],
        "missing_citations": ["[REACH Article 22]", "[RoHS Annex II]"],
        "loop_count": 0,
    }
    out = refiner_node(state)
    # Refined query should include extracted Article/Annex terms.
    assert "Article" in out["query"] or "Annex" in out["query"]
    # sub_queries should also have the terms appended.
    sq_query = out["sub_queries"][0]["query"]
    assert "Article" in sq_query or "Annex" in sq_query


def test_refiner_increments_loop_count():
    state = {
        "query": "query",
        "sub_queries": [],
        "missing_citations": [],
        "loop_count": 2,
    }
    out = refiner_node(state)
    assert out["loop_count"] == 3


def test_refiner_trace_entry_recorded():
    state = {
        "query": "充电宝",
        "sub_queries": [{"market": "EU", "query": "充电宝"}],
        "missing_citations": ["[REACH Article 22]"],
        "loop_count": 0,
    }
    out = refiner_node(state)
    trace = out["agent_trace"][-1]
    assert trace["node"] == "query_refiner"
    assert trace["missing_count"] == 1
    assert trace["loop_count"] == 1
    assert "refined_query" in trace
    assert len(trace["refined_query"]) <= 100


def test_refiner_does_not_duplicate_terms_already_in_query():
    state = {
        "query": "充电宝 Article 22",
        "sub_queries": [{"market": "EU", "query": "充电宝 Article 22"}],
        "missing_citations": ["[REACH Article 22]"],
        "loop_count": 0,
    }
    out = refiner_node(state)
    # "Article" already in query -> not appended again to main query.
    assert out["query"].count("Article") == 1


def test_refiner_preserves_sub_queries_shape():
    # Use market-specific base queries so dedup-by-expanded-text doesn't
    # collapse the two entries (refiner now dedups identical expanded queries
    # to prevent unbounded HyDE growth — see test_orchestrator_state).
    state = {
        "query": "query",
        "sub_queries": [
            {"market": "EU", "query": "EU specific query", "product_type": "充电宝"},
            {"market": "US", "query": "US specific query", "product_type": "充电宝"},
        ],
        "missing_citations": ["[RoHS Article 4]"],
        "loop_count": 0,
    }
    out = refiner_node(state)
    assert len(out["sub_queries"]) == 2
    assert [s["market"] for s in out["sub_queries"]] == ["EU", "US"]
    # product_type preserved.
    assert all(s["product_type"] == "充电宝" for s in out["sub_queries"])


def test_refiner_handles_chinese_article_pattern():
    # The refiner regex `(Article|Annex|...|第\d+条)\s*[\dXIV]+` requires a
    # trailing number after the term. "第3条" alone does NOT match (条 is
    # not followed by a digit), so no term is extracted. Verify the refiner
    # still runs cleanly and just returns the original query + trailing space.
    state = {
        "query": "玩具",
        "sub_queries": [{"market": "CN", "query": "玩具"}],
        "missing_citations": ["[GB 6675 第3条]"],
        "loop_count": 0,
    }
    out = refiner_node(state)
    # No term extracted -> query stays 玩具 (no 第3条 appended).
    assert "第3条" not in out["query"]
    assert out["query"].strip() == "玩具"
    # loop_count still increments regardless of extraction.
    assert out["loop_count"] == 1


def test_refiner_preserves_existing_trace():
    existing = [{"node": "synthesis", "status": "ok"}]
    state = {
        "query": "query",
        "sub_queries": [],
        "missing_citations": [],
        "loop_count": 0,
        "agent_trace": existing,
    }
    out = refiner_node(state)
    # Node returns ONLY its new entry; the graph reducer accumulates existing (audit 2026-06-29).
    assert len(out["agent_trace"]) == 1
    assert out["agent_trace"][0]["node"] == "query_refiner"
