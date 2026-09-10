#!/usr/bin/env python3
"""
synthesis.py - Result synthesis node

Merges and deduplicates chunks from multiple markets.
(must_check injection lives in hybrid_retriever.apply_must_check; the
generator-side anchor list is built in generator_node — 2026-09-10 A+B.)
"""
from rag_service.orchestrator.state import GraphState


def synthesis_node(state: GraphState) -> dict:
    """Synthesize retrieved chunks across markets.

    Two-stage deduplication:
    1. Per-market dedup by chunk id (original behaviour)
    2. Cross-market dedup by doc_name → keep highest-scoring chunk per document

    Caps the pool sent to LLM context at 40 so generation quality is not harmed,
    while still being tight enough to avoid overwhelming downstream processing.

    Score is set upstream in fusion.py: score = (dense_score + bm25_score) / 2.
    RRF score is rank-based (max ~0.08) — not user-friendly; dense+bm25 avg gives
    an intuitive 0-1 scale where both retrievers must perform well for a high score.
    """
    docs = state.get("documents", [])

    if not docs:
        return {"documents": [], "agent_trace": []}

    # ── Stage 1: per-market dedup by chunk id (original behaviour) ────────────
    seen_ids = set()
    stage1 = []
    for doc in docs:
        doc_id = doc.get("id", "")
        if doc_id and doc_id not in seen_ids:
            seen_ids.add(doc_id)
            stage1.append(doc)
        elif not doc_id:
            # Must-check items have synthetic IDs — always include
            stage1.append(doc)

    # ── Stage 2: dedup by doc_name, keep best-scoring chunk per doc ───────────
    doc_name_best: dict[str, dict] = {}
    for doc in stage1:
        doc_name = doc.get("doc_name", "")
        sort_key = doc.get("rrf_score", doc.get("score", 0))
        if not doc_name:
            doc_name = f"_anon_{id(doc)}"
        existing = doc_name_best.get(doc_name)
        existing_key = existing.get("rrf_score", existing.get("score", 0)) if existing else -1
        if sort_key >= existing_key:
            doc_name_best[doc_name] = doc

    unique_docs = list(doc_name_best.values())
    # Sort by display score (dense+bm25 avg) descending
    unique_docs.sort(key=lambda d: d.get("score", 0), reverse=True)

    # ── Stage 3: soft cap for LLM context (40 — generous but not bloated) ──────
    LLM_CONTEXT_CAP = 40
    context_docs = unique_docs[:LLM_CONTEXT_CAP]

    markets_seen = set(d.get("market", "") for d in context_docs)

    trace_entry = {
        "node": "synthesis",
        "total_docs": len(docs),
        "stage1_deduped": len(stage1),
        "unique_by_doc_name": len(unique_docs),
        "context_docs_sent": len(context_docs),
        "markets_covered": list(markets_seen),
    }

    # Score is already set by fusion.py: (dense_score + bm25_score) / 2
    # No re-calculation needed here — preserves the value from upstream
    return {
        "documents": context_docs,
        "agent_trace": [trace_entry],
    }