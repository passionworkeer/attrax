"""Tests for rag_service.eval.metrics — RAGAS-style offline metrics.

The metrics module computes RAG quality scores without LLM dependency
(substring / N-gram matching). Locking the scoring formulas here means
future refactors of tokenization or claim extraction will surface as
test failures instead of silently changing RAG quality reports.
"""
from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rag_service.eval.metrics import (
    _tokenize,
    _extract_claims,
    faithfulness,
    answer_relevancy,
    context_precision,
    context_recall,
    compute_all_metrics,
)


# ── _tokenize ────────────────────────────────────────────────────────────────

def test_tokenize_empty_returns_empty():
    assert _tokenize("") == []


def test_tokenize_english_words():
    tokens = _tokenize("RoHS restricts lead content")
    assert "rohs" in tokens
    assert "restricts" in tokens
    assert "lead" in tokens
    assert "content" in tokens


def test_tokenize_chinese_chars_become_individual_unigrams():
    tokens = _tokenize("铅镉汞")
    # Each CJK char becomes a separate token.
    assert "铅" in tokens
    assert "镉" in tokens
    assert "汞" in tokens


def test_tokenize_mixed_chinese_english():
    tokens = _tokenize("REACH限制铅含量")
    assert "reach" in tokens
    assert "限" in tokens
    assert "制" in tokens
    assert "铅" in tokens
    assert "含" in tokens
    assert "量" in tokens


# ── _extract_claims ──────────────────────────────────────────────────────────

def test_extract_claims_empty_returns_empty():
    assert _extract_claims("") == []


def test_extract_claims_short_sentences_dropped():
    # Sentences shorter than 8 chars are dropped.
    result = _extract_claims("Hi. OK.")
    assert result == []


def test_extract_claims_splits_on_chinese_period():
    # Both sentences must be >= 8 chars (filter threshold) to be kept.
    text = "第一句话内容比较长。第二句话内容也很长。"
    claims = _extract_claims(text)
    assert len(claims) == 2
    assert "第一句话内容比较长" in claims[0]
    assert "第二句话内容也很长" in claims[1]


def test_extract_claims_splits_on_english_period():
    text = "RoHS restricts lead. REACH covers chemicals."
    claims = _extract_claims(text)
    assert len(claims) == 2


# ── faithfulness ─────────────────────────────────────────────────────────────

def test_faithfulness_empty_inputs_zero():
    assert faithfulness("", []) == {"score": 0.0, "details": "no answer or docs"}


def test_faithfulness_no_answer_zero():
    assert faithfulness("", [{"content": "anything"}]) == {"score": 0.0, "details": "no answer or docs"}


def test_faithfulness_no_docs_zero():
    assert faithfulness("Lead is restricted by RoHS.", []) == {"score": 0.0, "details": "no answer or docs"}


def test_faithfulness_all_claims_supported():
    docs = [{"content": "铅的最大允许浓度为0.1%。镉的最大允许浓度为0.01%。"}]
    answer = "铅的最大允许浓度为0.1%。镉的最大允许浓度为0.01%。"
    result = faithfulness(answer, docs)
    assert result["score"] == 1.0
    assert "2/2" in result["details"]


def test_faithfulness_partial_support():
    docs = [{"content": "铅的最大允许浓度为0.1%。"}]
    answer = "铅的最大允许浓度为0.1%。镉的最大允许浓度为0.01%。"
    result = faithfulness(answer, docs)
    assert result["score"] == 0.5
    assert "1/2" in result["details"]


def test_faithfulness_no_claims_returns_one():
    """If answer has no claimable sentences, faith = 1.0 (vacuous)."""
    docs = [{"content": "anything"}]
    assert faithfulness("hi.", docs)["score"] == 1.0


# ── answer_relevancy ────────────────────────────────────────────────────────

def test_answer_relevancy_empty_inputs():
    assert answer_relevancy("", "answer")["score"] == 0.0
    assert answer_relevancy("question", "")["score"] == 0.0


def test_answer_relevancy_high_overlap():
    q = "RoHS restricts lead content in electronics"
    a = "RoHS restricts lead content in electronics products"
    result = answer_relevancy(q, a)
    # Most query tokens appear in answer.
    assert result["score"] > 0.8


def test_answer_relevancy_no_overlap():
    q = "RoHS restricts lead"
    a = "completely unrelated banana phone content"
    result = answer_relevancy(q, a)
    # Some overlap may still occur from stopword removal; assert below 0.5.
    assert result["score"] < 0.5


def test_answer_relevancy_filters_stopwords():
    # Stopwords ("the", "is") should be removed; the rest should overlap.
    q = "the lead is restricted"
    a = "lead restricted by RoHS"
    result = answer_relevancy(q, a)
    # After stopword removal: q_tokens = {lead, restricted}, a_tokens = {lead, restricted, rohs}
    assert result["score"] == 1.0


# ── context_precision ───────────────────────────────────────────────────────

def test_context_precision_empty_docs():
    assert context_precision("question", [])["score"] == 0.0


def test_context_precision_all_docs_relevant():
    # Use a question whose tokens appear strongly in both docs so the
    # overlap >= threshold (len(q_tokens)//4) check passes for every doc.
    q = "RoHS restricts lead content in electronics products"
    docs = [
        {"content": "RoHS restricts lead content in all electronics products"},
        {"content": "REACH also restricts lead content in electronics"},
    ]
    result = context_precision(q, docs)
    assert result["score"] == 1.0
    assert "2/2 docs relevant" in result["details"]


def test_context_precision_some_docs_irrelevant():
    docs = [
        {"content": "RoHS restricts lead content"},
        {"content": "completely unrelated banana phone content"},
    ]
    q = "What does RoHS restrict?"
    result = context_precision(q, docs)
    # 1 of 2 docs relevant.
    assert result["score"] == 0.5


def test_context_precision_ground_truth_keywords_override():
    """If GT keywords match a doc, it's relevant even if question doesn't."""
    docs = [
        {"content": "completamente sin palabras en español"},  # no q overlap
        {"content": "The RoHS directive restricts specific substances in electronics"},
    ]
    q = "完全不相关的问题"  # No token overlap with anything
    gt = ["rohs", "restricts"]
    result = context_precision(q, docs, ground_truth_keywords=gt)
    # At least 1 doc matches GT keywords.
    assert result["score"] >= 0.5


# ── context_recall ───────────────────────────────────────────────────────────

def test_context_recall_empty_inputs():
    assert context_recall("", [{"content": "x"}])["score"] == 0.0
    assert context_recall("gt", [])["score"] == 0.0


def test_context_recall_all_covered():
    docs = [{"content": "铅的最大允许浓度为0.1%。镉的最大允许浓度为0.01%。"}]
    gt = "铅的最大允许浓度为0.1%。镉的最大允许浓度为0.01%。"
    result = context_recall(gt, docs)
    assert result["score"] == 1.0


def test_context_recall_partial_coverage():
    docs = [{"content": "铅的最大允许浓度为0.1%。"}]
    gt = "铅的最大允许浓度为0.1%。镉的最大允许浓度为0.01%。"
    result = context_recall(gt, docs)
    assert result["score"] == 0.5


def test_context_recall_no_ground_truth_claims_returns_one():
    """GT with no extractable claims -> 1.0 (vacuous)."""
    assert context_recall("hi.", [{"content": "anything"}])["score"] == 1.0


# ── compute_all_metrics ─────────────────────────────────────────────────────

def test_compute_all_metrics_returns_all_four_keys():
    result = compute_all_metrics(
        question="What does RoHS restrict?",
        answer="RoHS restricts lead content.",
        retrieved_docs=[{"content": "RoHS restricts lead content."}],
        ground_truth_answer="RoHS restricts lead content.",
    )
    assert set(result.keys()) == {"faithfulness", "answer_relevancy", "context_precision", "context_recall"}
    for v in result.values():
        assert "score" in v
        assert "details" in v
        assert 0.0 <= v["score"] <= 1.0