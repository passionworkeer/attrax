"""Tests for rag_service.eval.metrics — offline RAG evaluation metrics.

Post P1-7 leakage remediation:
- The golden set is an INDEPENDENT natural-language collection; tests assert
  the loader refuses to derive anything from chunks and that the file is
  well-formed and covers all claimed markets.
- faithfulness() now scores an answer against an INDEPENDENT key_facts
  checklist (not against retrieved_docs). Tests lock this new contract and the
  fact that retrieved_docs no longer influence the score.
"""
from __future__ import annotations

import json
import sys
import os
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rag_service.eval.metrics import (
    _tokenize,
    _extract_claims,
    _claim_supported,
    faithfulness,
    answer_relevancy,
    context_precision,
    context_recall,
    compute_all_metrics,
    generate_test_set,
    load_golden_set,
    DEFAULT_GOLDEN_SET_PATH,
    GOLDEN_SET_VERSION,
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
    assert "铅" in tokens
    assert "镉" in tokens
    assert "汞" in tokens


def test_tokenize_mixed_chinese_english():
    tokens = _tokenize("REACH限制铅含量")
    assert "reach" in tokens
    assert "限" in tokens
    assert "制" in tokens
    assert "铅" in tokens


# ── _extract_claims ──────────────────────────────────────────────────────────

def test_extract_claims_empty_returns_empty():
    assert _extract_claims("") == []


def test_extract_claims_short_sentences_dropped():
    assert _extract_claims("Hi. OK.") == []


def test_extract_claims_splits_on_chinese_period():
    text = "第一句话内容比较长。第二句话内容也很长。"
    claims = _extract_claims(text)
    assert len(claims) == 2
    assert "第一句话内容比较长" in claims[0]
    assert "第二句话内容也很长" in claims[1]


def test_extract_claims_splits_on_english_period():
    text = "RoHS restricts lead. REACH covers chemicals."
    claims = _extract_claims(text)
    assert len(claims) == 2


# ── _claim_supported (token-coverage based, post P1-7) ───────────────────────

def test_claim_supported_strong_overlap_true():
    claim = "铅的最大允许浓度有限值"
    evidence = "产品中铅的最大允许浓度不得超过0.1%的限值"
    assert _claim_supported(claim, evidence) is True


def test_claim_supported_no_overlap_false():
    claim = "欧盟对玩具涂层有重金属限值"
    evidence = "completely unrelated banana phone content 毫无关联的文字"
    assert _claim_supported(claim, evidence) is False


def test_claim_supported_pure_stopwords_false():
    # A claim made only of stopwords cannot be evaluated → False.
    claim = "的是了"
    evidence = "任意文本内容"
    assert _claim_supported(claim, evidence) is False


# ── faithfulness (NEW contract: independent key_facts checklist) ─────────────

def test_faithfulness_no_key_facts_zero():
    """Without an independent key_facts checklist, faith is 0 by design."""
    result = faithfulness("any answer", [{"content": "any doc"}], key_facts=None)
    assert result["score"] == 0.0
    assert "key_facts" in result["details"]


def test_faithfulness_empty_answer_zero():
    result = faithfulness("", [{"content": "x"}], key_facts=["一个独立的事实点"])
    assert result["score"] == 0.0


def test_faithfulness_all_facts_supported():
    answer = "欧盟对玩具涂层有重金属限值。铅镉汞等重金属在涂层中受限。"
    facts = ["欧盟对玩具涂层有重金属限值", "铅镉汞等重金属在涂层中受限"]
    result = faithfulness(answer, retrieved_docs=None, key_facts=facts)
    assert result["score"] == 1.0
    assert "2/2" in result["details"]


def test_faithfulness_partial_support():
    answer = "欧盟对玩具涂层有重金属限值。"
    facts = ["欧盟对玩具涂层有重金属限值", "铅镉汞等重金属在涂层中受限"]
    result = faithfulness(answer, retrieved_docs=None, key_facts=facts)
    assert result["score"] == 0.5
    assert "1/2" in result["details"]


def test_faithfulness_ignores_retrieved_docs():
    """P1-7 critical: retrieved_docs must NOT influence the score, even when
    they would fully cover the key_facts. The metric measures answer vs an
    independent checklist only."""
    facts = ["完全不存在于答案中的独立事实点"]
    # docs DO contain the fact, but the answer does not.
    docs = [{"content": "完全不存在于答案中的独立事实点"}]
    result_with_docs = faithfulness("完全不相关的答案内容", docs, key_facts=facts)
    result_no_docs = faithfulness("完全不相关的答案内容", None, key_facts=facts)
    assert result_with_docs == result_no_docs
    assert result_with_docs["score"] == 0.0


# ── answer_relevancy ────────────────────────────────────────────────────────

def test_answer_relevancy_empty_inputs():
    assert answer_relevancy("", "answer")["score"] == 0.0
    assert answer_relevancy("question", "")["score"] == 0.0


def test_answer_relevancy_high_overlap():
    q = "RoHS restricts lead content in electronics"
    a = "RoHS restricts lead content in electronics products"
    result = answer_relevancy(q, a)
    assert result["score"] > 0.8


def test_answer_relevancy_no_overlap():
    q = "RoHS restricts lead"
    a = "completely unrelated banana phone content"
    result = answer_relevancy(q, a)
    assert result["score"] < 0.5


def test_answer_relevancy_filters_stopwords():
    q = "the lead is restricted"
    a = "lead restricted by RoHS"
    result = answer_relevancy(q, a)
    assert result["score"] == 1.0


# ── context_precision ───────────────────────────────────────────────────────

def test_context_precision_empty_docs():
    assert context_precision("question", [])["score"] == 0.0


def test_context_precision_all_docs_relevant():
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
    assert result["score"] == 0.5


def test_context_precision_ground_truth_keywords_override():
    docs = [
        {"content": "completamente sin palabras en español"},
        {"content": "The RoHS directive restricts specific substances in electronics"},
    ]
    q = "完全不相关的问题"
    gt = ["rohs", "restricts"]
    result = context_precision(q, docs, ground_truth_keywords=gt)
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
    # Two gt claims where the second shares no meaningful tokens with the
    # retrieved doc → exactly 1/2 recalled under the token-coverage formula.
    docs = [{"content": "铅的最大允许浓度为0.1%。"}]
    gt = "铅的最大允许浓度为0.1%。纺织品的纤维成分需要按比例标注。"
    result = context_recall(gt, docs)
    assert result["score"] == 0.5


def test_context_recall_no_ground_truth_claims_returns_one():
    assert context_recall("hi.", [{"content": "anything"}])["score"] == 1.0


# ── compute_all_metrics ─────────────────────────────────────────────────────

def test_compute_all_metrics_returns_all_four_keys():
    result = compute_all_metrics(
        question="What does RoHS restrict?",
        answer="RoHS restricts lead content.",
        retrieved_docs=[{"content": "RoHS restricts lead content."}],
        ground_truth_answer="RoHS restricts lead content.",
        key_facts=["RoHS restricts lead content"],
    )
    assert set(result.keys()) == {"faithfulness", "answer_relevancy", "context_precision", "context_recall"}
    for v in result.values():
        assert "score" in v
        assert "details" in v
        assert 0.0 <= v["score"] <= 1.0


def test_compute_all_metrics_legacy_fallback_when_no_key_facts():
    """When key_facts is absent, faithfulness falls back to the docs-based
    formula and must ANNOUNCE it in details (no silent circular scoring)."""
    result = compute_all_metrics(
        question="q",
        answer="RoHS restricts lead content.",
        retrieved_docs=[{"content": "RoHS restricts lead content."}],
        ground_truth_answer="RoHS restricts lead content.",
    )
    assert "LEGACY" in result["faithfulness"]["details"]


# ── Golden-set integrity (P1-7 leakage controls) ────────────────────────────

def test_golden_set_file_exists_and_well_formed():
    """The independent golden set must exist and have the expected shape."""
    assert DEFAULT_GOLDEN_SET_PATH.exists(), f"missing golden set: {DEFAULT_GOLDEN_SET_PATH}"
    data = load_golden_set()
    assert isinstance(data["cases"], list) and data["cases"]
    assert data.get("version") == GOLDEN_SET_VERSION


def test_golden_set_covers_all_claimed_markets():
    """Audit called out UK/AU/SA/AE/JP as 0-coverage. New set must cover them."""
    data = load_golden_set()
    claimed = set(data["coverage"]["markets"])
    actual = {c["market"] for c in data["cases"]}
    # Every claimed market must have at least one real case.
    assert claimed.issubset(actual), f"claimed markets missing cases: {claimed - actual}"
    # Specifically the previously-uncovered markets must each have >= 2 cases.
    for m in ("UK", "AU", "SA", "AE", "JP"):
        n = sum(1 for c in data["cases"] if c["market"] == m)
        assert n >= 2, f"market {m} has only {n} cases (need >= 2)"


def test_golden_set_queries_have_no_regulation_numbers():
    """Leakage control: queries must NOT embed regulation numbers/IDs that
    also appear in chunk text (the old generator's failure mode)."""
    import re
    data = load_golden_set()
    hard_patterns = [r"\b\d{4}/\d+\b", r"\bEC\s*No\b", r"\b16\s*CFR\b"]
    flagged = []
    for c in data["cases"]:
        for p in hard_patterns:
            if re.search(p, c["question"]):
                flagged.append((c["id"], p))
    assert not flagged, f"queries contain regulation-number leakage: {flagged}"


def test_golden_set_expected_source_ids_exist_in_faiss_meta():
    """Every expected_source_id must be a real FAISS source_id. Skip gracefully
    if the FAISS meta file is not present (e.g. fresh checkout)."""
    faiss_meta = DEFAULT_GOLDEN_SET_PATH.parents[1] / "faiss" / "legal_chunks_meta.json"
    if not faiss_meta.exists():
        return  # not a failure — index may not be built in this environment
    raw = json.loads(faiss_meta.read_text(encoding="utf-8"))
    chunks = raw.get("chunks", raw) if isinstance(raw, dict) else raw
    valid = {c.get("source_id") for c in chunks if c.get("source_id")}
    data = load_golden_set()
    missing = []
    for c in data["cases"]:
        for sid in c["expected_source_ids"]:
            if sid not in valid:
                missing.append((c["id"], sid))
    assert not missing, f"expected_source_ids not present in FAISS meta: {missing}"


def test_generate_test_set_does_not_accept_corpus_derivation(tmp_path):
    """P1-7 contract: generate_test_set must refuse to derive cases from
    chunks. The legacy corpus_dir path is gone; passing chunk data must not
    change the output."""
    out = tmp_path / "test_set.json"
    cases = generate_test_set(output_path=str(out))
    assert out.exists()
    # Output cases match the golden set count and carry key_facts.
    data = load_golden_set()
    assert len(cases) == len(data["cases"])
    assert all("key_facts" in c for c in cases)
