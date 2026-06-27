#!/usr/bin/env python3
"""
fusion.py - Reciprocal Rank Fusion (RRF) for combining Dense + BM25 results

RRF score = sum(1 / (k + rank)) where k=25 is the standard fusion parameter.
"""
from typing import TypedDict
import logging

from rag_service.retrieval.metadata_filter import attach_metadata_fields

logger = logging.getLogger(__name__)

DEFAULT_K = 25


class FusionResult(TypedDict):
    id: str
    rrf_score: float
    dense_score: float
    bm25_score: float
    content: str
    doc_name: str
    article_no: str
    region: str


def rrf_fuse(
    dense_results: list[dict],
    bm25_results: list[dict],
    k: int = DEFAULT_K,
    top_k: int = 50,
    dense_weight: float = 1.0,
    bm25_weight: float = 1.0,
) -> list[FusionResult]:
    """
    Fuse Dense + BM25 results using Reciprocal Rank Fusion.

    Weighted contribution per result:
        rrf_score += weight_i * 1.0 / (k + rank_i)

    Defaults (dense_weight=1.0, bm25_weight=1.0) preserve the historical
    equal-weight behavior exactly — no change to rankings or score scale
    when callers omit the weights. Tuning is left to downstream eval.

    Args:
        dense_results: list of dicts with 'id' and 'score' (0-1)
        bm25_results: list of dicts with 'id' and 'score' (raw BM25)
        k: RRF smoothing parameter (default 25)
        top_k: number of results to return
        dense_weight: multiplier on the dense contribution (default 1.0)
        bm25_weight: multiplier on the bm25 contribution (default 1.0)

    Returns:
        list[FusionResult] sorted by rrf_score descending
    """
    # Normalize BM25 scores to 0-1 range
    if bm25_results and any(r.get("score", 0) for r in bm25_results):
        max_score = max(r["score"] for r in bm25_results)
        for r in bm25_results:
            r["score_norm"] = r["score"] / max_score if max_score > 0 else 0
    else:
        for r in bm25_results:
            r["score_norm"] = 0.0

    # Build score maps
    rrf_scores: dict[str, float] = {}
    dense_map: dict[str, float] = {}
    bm25_map: dict[str, dict] = {}

    for i, r in enumerate(dense_results):
        doc_id = r.get("id", f"dense_{i}")
        rrf_scores[doc_id] = rrf_scores.get(doc_id, 0) + dense_weight * 1.0 / (k + i)
        dense_map[doc_id] = r.get("score", 0)
        bm25_map[doc_id] = r

    for i, r in enumerate(bm25_results):
        doc_id = r.get("id", f"bm25_{i}")
        rrf_scores[doc_id] = rrf_scores.get(doc_id, 0) + bm25_weight * 1.0 / (k + i)
        bm25_map[doc_id] = r
        dense_map.setdefault(doc_id, 0.0)

    # Sort by RRF score
    sorted_ids = sorted(rrf_scores, key=rrf_scores.get, reverse=True)[:top_k]

    results = []
    for doc_id in sorted_ids:
        bm = bm25_map.get(doc_id, {})
        base = bm or {}
        results.append(attach_metadata_fields({
            "id": doc_id,
            "rrf_score": rrf_scores[doc_id],
            "dense_score": dense_map.get(doc_id, 0.0),
            "bm25_score": bm.get("score_norm", 0.0),
            # User-visible score: avg of dense (0-1) + normalized BM25 (0-1)
            # This is the score displayed in the frontend; rrf_score is rank-based (max 0.08)
            "score": (dense_map.get(doc_id, 0.0) + bm.get("score_norm", 0.0)) / 2,
            "content": base.get("content", ""),
            "doc_name": base.get("doc_name", ""),
            "article_no": base.get("article_no", ""),
            "region": base.get("region", ""),
            "source_id": base.get("source_id", ""),
            "source_file": base.get("source_file", ""),
            "source_url": base.get("source_url", ""),
            "content_url": base.get("content_url", ""),
            "official_channel": base.get("official_channel", ""),
            "product_categories": base.get("product_categories", []),
            "regulatory_types": base.get("regulatory_types", []),
            "raw_files": base.get("raw_files", []),
            "metadata": base.get("metadata", {}),
        }))

    return results


def normalize_scores(results: list[dict]) -> list[dict]:
    """Min-max normalize all score fields to 0-1."""
    if not results:
        return results

    for key in ["dense_score", "bm25_score", "rrf_score"]:
        vals = [r.get(key, 0) for r in results]
        mn, mx = min(vals), max(vals)
        if mx > mn:
            for r in results:
                r[f"{key}_norm"] = (r.get(key, 0) - mn) / (mx - mn)
        else:
            for r in results:
                r[f"{key}_norm"] = 1.0

    return results
