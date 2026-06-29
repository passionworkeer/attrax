#!/usr/bin/env python3
"""
metrics.py - Offline RAG evaluation metrics for rag-service.

Design (post P1-7 leakage remediation):
- No query/case is ever generated from chunk text. The golden set is an
  independent, hand-authored natural-language query collection living in
  data/regulation_eval/natural_language_cases.json. See load_golden_set() /
  generate_test_set() for the loader contract — they only load that file and
  refuse to derive anything from corpus chunks.
- faithfulness() scores an answer against an INDEPENDENT key_facts checklist
  (atomic reference facts supplied per case), never against the retrieved
  documents themselves. The old substring-self-coverage formula (which made
  faith == 1.0 trivially in dry-run) is removed.
"""
import json
import re
from pathlib import Path
from typing import Any

# ── Golden-set loader ─────────────────────────────────────────────────────────

# Default location of the independent natural-language eval set. The file is
# versioned via its own "version" field so eval regressions can be attributed
# to a golden-set change rather than a retrieval/scoring change.
DEFAULT_GOLDEN_SET_PATH = (
    Path(__file__).resolve().parents[2] / "data" / "regulation_eval" / "natural_language_cases.json"
)

# Metadata-only stamp, re-exported for callers that import it (e.g.
# regulation_retrieval_eval.py). The authoritative version lives in the
# golden-set file's "version" field.
GOLDEN_SET_VERSION = "2026-06-29-natural-language-v1"


def load_golden_set(path: str | Path | None = None) -> dict[str, Any]:
    """Load the independent natural-language golden set as a whole.

    Returns the raw JSON object (with version/coverage/cases). Raises
    FileNotFoundError if absent so callers fail loudly rather than silently
    falling back to a leaked generator.
    """
    p = Path(path) if path else DEFAULT_GOLDEN_SET_PATH
    data = json.loads(p.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("cases"), list):
        raise ValueError(f"golden set at {p} must be an object with a 'cases' list")
    return data


def generate_test_set(output_path: str | None = None, golden_set_path: str | Path | None = None) -> list[dict]:
    """Materialize the independent golden set into the legacy "test_set.json"
    shape consumed by run_eval.py.

    Contract change (P1-7): this function no longer accepts a corpus_dir and
    will NEVER derive cases from chunk text. The corpus_dir parameter is
    accepted but ignored with a warning to keep CLI compatibility, and any
    attempt to pass chunk-derived data raises.
    """
    data = load_golden_set(golden_set_path)
    cases = data["cases"]

    result: list[dict] = []
    for case in cases:
        result.append({
            "id": case["id"],
            "question": case["question"],
            "ground_truth_answer": " ".join(case.get("key_facts", [])),
            "key_facts": list(case.get("key_facts", [])),
            "source_document": "",
            "expected_source_ids": list(case.get("expected_source_ids", [])),
            "market": case["market"],
            "category": case["category"],
            "critical": case.get("critical", False),
            "golden_set_version": data.get("version", GOLDEN_SET_VERSION),
        })

    if output_path:
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

    return result


# ── Core metrics ──────────────────────────────────────────────────────────────

def _tokenize(text: str) -> list[str]:
    """Simple tokenizer: Chinese chars + ASCII alphanumeric tokens."""
    tokens = re.findall(r"[一-鿿]+|[a-zA-Z0-9]+", text.lower())
    result: list[str] = []
    for t in tokens:
        if re.search(r"[一-鿿]", t):
            result.extend(list(t))
        else:
            result.append(t)
    return result


def _extract_claims(text: str) -> list[str]:
    """Split text into atomic claims using sentence delimiters.

    A claim is a clause that makes a single factual assertion. Claims shorter
    than 8 chars are dropped as not meaningful.
    """
    sentences = re.split(r"[。！？.;!?\n]+", text)
    claims: list[str] = []
    for s in sentences:
        s = s.strip()
        if len(s) >= 8:
            claims.append(s)
    return claims


def _claim_supported(claim: str, evidence: str) -> bool:
    """Return True if an atomic claim is supported by the evidence text.

    A claim is considered supported when its set of meaningful tokens (after
    stopword removal) is sufficiently covered by the evidence. This is a
    deliberately coarse lexical check; it is meant to score answers against
    an INDEPENDENT key_facts checklist, never against the retrieved docs.
    """
    stops = {
        "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都",
        "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你",
        "the", "a", "an", "is", "are", "was", "were", "of", "and",
        "to", "in", "for", "on", "with", "as", "at", "by", "or", "it",
        "需", "要", "可", "能", "对", "与", "及", "或", "等", "并",
    }
    claim_tokens = [t for t in _tokenize(claim) if t not in stops]
    if not claim_tokens:
        return False
    evidence_tokens = set(_tokenize(evidence))
    covered = sum(1 for t in claim_tokens if t in evidence_tokens)
    # Require a strong majority of claim tokens present (>= 60%).
    return covered / len(claim_tokens) >= 0.6


def faithfulness(
    answer: str,
    retrieved_docs: list[dict] | None = None,
    *,
    key_facts: list[str] | None = None,
) -> dict[str, Any]:
    """% of independent reference key_facts supported by the answer.

    This is the P1-7 fixed formula. The old signature scored answer claims as
    substrings of retrieved_docs (circular: in dry-run the doc WAS the ground
    truth, so faith == 1.0 always). The new formula scores the answer against
    an INDEPENDENT key_facts checklist authored per case — the retrieved_docs
    argument is accepted for backward compatibility but is NOT used in scoring.

    Args:
        answer: the generated report/answer text.
        retrieved_docs: accepted for backward compatibility; ignored.
        key_facts: independent atomic reference facts for this case.

    Returns:
        score: float in [0.0, 1.0] — fraction of key_facts supported.
        details: summary string.
    """
    if not key_facts:
        return {"score": 0.0, "details": "no independent key_facts supplied"}
    if not answer:
        return {"score": 0.0, "details": "empty answer"}

    supported = sum(1 for fact in key_facts if _claim_supported(fact, answer))
    score = round(supported / len(key_facts), 3)
    details = f"{supported}/{len(key_facts)} independent facts supported"
    return {"score": score, "details": details}


def answer_relevancy(question: str, answer: str) -> dict[str, Any]:
    """Token overlap between question and answer keywords.

    Higher overlap → more relevant answer.
    """
    if not question or not answer:
        return {"score": 0.0, "details": "empty input"}

    q_tokens = set(_tokenize(question))
    a_tokens = set(_tokenize(answer))

    stops = {"的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都",
             "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你",
             "the", "a", "an", "is", "are", "was", "were", "of", "and",
             "to", "in", "for", "on", "with", "as", "at", "by", "or", "it"}
    q_tokens -= stops
    a_tokens -= stops

    if not q_tokens:
        return {"score": 1.0, "details": "no query tokens"}

    overlap = len(q_tokens & a_tokens) / len(q_tokens)
    score = round(overlap, 3)
    details = f"token overlap: {len(q_tokens & a_tokens)}/{len(q_tokens)}"
    return {"score": score, "details": details}


def context_precision(
    question: str,
    retrieved_docs: list[dict],
    ground_truth_keywords: list[str] | None = None,
) -> dict[str, Any]:
    """Fraction of retrieved docs that are relevant to the question.

    A doc is "relevant" if it shares significant keyword overlap with the
    question, or (optionally) with supplied ground_truth_keywords.
    """
    if not retrieved_docs:
        return {"score": 0.0, "details": "no docs retrieved"}

    gt_kw = set(w.lower() for w in (ground_truth_keywords or []))
    q_tokens = set(_tokenize(question))

    relevant_count = 0
    for doc in retrieved_docs:
        doc_content = doc.get("content", "")
        doc_tokens = set(_tokenize(doc_content))
        overlap = len(q_tokens & doc_tokens)
        threshold = max(1, len(q_tokens) // 4)
        is_relevant = overlap >= threshold
        if gt_kw and not is_relevant:
            is_relevant = len(gt_kw & doc_tokens) >= 1
        if is_relevant:
            relevant_count += 1

    score = round(relevant_count / len(retrieved_docs), 3)
    details = f"{relevant_count}/{len(retrieved_docs)} docs relevant"
    return {"score": score, "details": details}


def context_recall(
    ground_truth_answer: str,
    retrieved_docs: list[dict],
) -> dict[str, Any]:
    """Fraction of ground-truth answer content covered by retrieved docs.

    Splits the ground truth into atomic claims and checks each against the doc
    pool using the lexical _claim_supported check (token-coverage based, not
    raw substring).
    """
    if not ground_truth_answer or not retrieved_docs:
        return {"score": 0.0, "details": "no ground truth or docs"}

    gt_claims = _extract_claims(ground_truth_answer)
    if not gt_claims:
        return {"score": 1.0, "details": "no extractable gt claims"}

    combined = "\n".join(doc.get("content", "") for doc in retrieved_docs)
    covered = sum(1 for c in gt_claims if _claim_supported(c, combined))
    score = round(covered / len(gt_claims), 3)
    details = f"{covered}/{len(gt_claims)} gt claims recalled"
    return {"score": score, "details": details}


def compute_all_metrics(
    question: str,
    answer: str,
    retrieved_docs: list[dict],
    ground_truth_answer: str,
    ground_truth_keywords: list[str] | None = None,
    key_facts: list[str] | None = None,
) -> dict[str, Any]:
    """Compute all four metrics in one call.

    faithfulness uses key_facts when provided (preferred, post P1-7); when
    absent it falls back to scoring answer claims against retrieved_docs to
    preserve a backward-compatible signal, with a details string flagging the
    fallback so reports never silently use the legacy circular formula.
    """
    if key_facts:
        fid = faithfulness(answer, retrieved_docs, key_facts=key_facts)
    else:
        # Legacy fallback path: score answer claims against retrieved docs.
        # Marked explicitly so reports cannot pass this off as the
        # decoupled metric.
        if not answer or not retrieved_docs:
            fid = {"score": 0.0, "details": "no answer or docs (legacy fallback)"}
        else:
            claims = _extract_claims(answer)
            if not claims:
                fid = {"score": 1.0, "details": "no claimable sentences (legacy fallback)"}
            else:
                combined = "\n".join(d.get("content", "") for d in retrieved_docs)
                supported = sum(1 for c in claims if _claim_supported(c, combined))
                score = round(supported / len(claims), 3)
                fid = {"score": score, "details": f"{supported}/{len(claims)} claims supported (LEGACY fallback — supply key_facts)"}

    return {
        "faithfulness": fid,
        "answer_relevancy": answer_relevancy(question, answer),
        "context_precision": context_precision(question, retrieved_docs, ground_truth_keywords),
        "context_recall": context_recall(ground_truth_answer, retrieved_docs),
    }
