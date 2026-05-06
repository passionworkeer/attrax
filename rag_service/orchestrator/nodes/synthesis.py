#!/usr/bin/env python3
"""
synthesis.py - Result synthesis node

Merges and deduplicates chunks from multiple markets.
Applies must_check regulation injection.
"""
from rag_service.orchestrator.state import GraphState


def synthesis_node(state: GraphState) -> dict:
    """Synthesize retrieved chunks across markets.

    Two-stage deduplication:
    1. Per-market dedup by chunk id (existing behavior)
    2. Cross-market dedup by doc_name → keep highest-scoring chunk per document

    Caps the pool sent to LLM context at 40 so generation quality is not harmed,
    while still being tight enough to avoid overwhelming downstream processing.
    """
    docs = state.get("documents", [])
    category = state.get("category", "")

    if not docs:
        return {"documents": []}

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
        score = doc.get("rerank_score", doc.get("score", 0))
        if not doc_name:
            # nameless items (e.g. must-check) — keep all
            doc_name = f"_anon_{id(doc)}"
        existing = doc_name_best.get(doc_name)
        if existing is None or score > existing.get("rerank_score", existing.get("score", 0)):
            doc_name_best[doc_name] = doc

    unique_docs = list(doc_name_best.values())

    # Sort by score descending
    unique_docs.sort(key=lambda d: d.get("rerank_score", d.get("score", 0)), reverse=True)

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

    return {
        "documents": context_docs,
        "agent_trace": state.get("agent_trace", []) + [trace_entry],
    }
