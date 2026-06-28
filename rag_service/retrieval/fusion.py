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

    Immutability: caller-owned dicts in ``dense_results`` and
    ``bm25_results`` are never mutated. The previous implementation wrote
    ``score_norm`` in place on each BM25 result dict, which leaked fusion
    state back into the caller (and into the BM25 cache). All derived
    state now lives in local maps and is reconstructed into fresh result
    dicts via ``attach_metadata_fields``.

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
    # Normalize BM25 scores to 0-1 range WITHOUT mutating input dicts.
    bm25_score_norm: dict[str, float] = {}
    if bm25_results and any(r.get("score", 0) for r in bm25_results):
        max_score = max(r["score"] for r in bm25_results)
        for r in bm25_results:
            doc_id = r.get("id")
            if doc_id is None or max_score <= 0:
                norm = 0.0
            else:
                norm = r["score"] / max_score
            # If the same id appears twice in the list, keep the larger norm.
            prev = bm25_score_norm.get(doc_id, 0.0)
            if norm > prev:
                bm25_score_norm[doc_id] = norm
    # else: bm25_score_norm stays empty; missing keys yield 0.0 below.

    # Build score / payload maps. The contribution formula uses each
    # result's position (i) within its own branch list as the rank, which
    # is the standard RRF formulation. (Both branches normally feed
    # equally-sized candidate windows from the retriever; we do not pad
    # ranks to a common depth because doing so would change scores for
    # single-branch hits, breaking the existing ranking tests.)
    rrf_scores: dict[str, float] = {}
    dense_map: dict[str, float] = {}
    payload_map: dict[str, dict] = {}

    for i, r in enumerate(dense_results):
        doc_id = r.get("id", f"dense_{i}")
        rrf_scores[doc_id] = rrf_scores.get(doc_id, 0) + dense_weight * 1.0 / (k + i)
        dense_map[doc_id] = r.get("score", 0)
        payload_map[doc_id] = r

    for i, r in enumerate(bm25_results):
        doc_id = r.get("id", f"bm25_{i}")
        rrf_scores[doc_id] = rrf_scores.get(doc_id, 0) + bm25_weight * 1.0 / (k + i)
        payload_map.setdefault(doc_id, r)
        dense_map.setdefault(doc_id, 0.0)

    sorted_ids = sorted(rrf_scores, key=rrf_scores.get, reverse=True)[:top_k]

    results = []
    for doc_id in sorted_ids:
        payload = payload_map.get(doc_id, {})
        bm_norm = bm25_score_norm.get(doc_id, 0.0)
        results.append(attach_metadata_fields({
            "id": doc_id,
            "rrf_score": rrf_scores[doc_id],
            "dense_score": dense_map.get(doc_id, 0.0),
            "bm25_score": bm_norm,
            # User-visible score: avg of dense (0-1) + normalized BM25 (0-1)
            # This is the score displayed in the frontend; rrf_score is
            # rank-based (max ~0.08) and not user-friendly.
            "score": (dense_map.get(doc_id, 0.0) + bm_norm) / 2,
            "content": payload.get("content", ""),
            "doc_name": payload.get("doc_name", ""),
            "article_no": payload.get("article_no", ""),
            "region": payload.get("region", ""),
            "source_id": payload.get("source_id", ""),
            "source_file": payload.get("source_file", ""),
            "source_url": payload.get("source_url", ""),
            "content_url": payload.get("content_url", ""),
            "official_channel": payload.get("official_channel", ""),
            "product_categories": payload.get("product_categories", []),
            "regulatory_types": payload.get("regulatory_types", []),
            "raw_files": payload.get("raw_files", []),
            "metadata": payload.get("metadata", {}),
        }))

    return results


def normalize_scores(results: list[dict]) -> list[dict]:
    """Min-max normalize score fields to 0-1 (immutable: returns new dicts)."""
    if not results:
        return results

    output = [dict(r) for r in results]
    for key in ["dense_score", "bm25_score", "rrf_score"]:
        vals = [r.get(key, 0) for r in output]
        mn, mx = min(vals), max(vals)
        for r in output:
            if mx > mn:
                r[f"{key}_norm"] = (r.get(key, 0) - mn) / (mx - mn)
            else:
                r[f"{key}_norm"] = 1.0

    return output
