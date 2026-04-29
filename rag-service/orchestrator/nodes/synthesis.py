#!/usr/bin/env python3
"""
synthesis.py - Result synthesis node

Merges and deduplicates chunks from multiple markets.
Applies must_check regulation injection.
"""
from orchestrator.state import GraphState


def synthesis_node(state: GraphState) -> dict:
    """Synthesize retrieved chunks across markets."""
    docs = state.get("documents", [])
    category = state.get("category", "")

    if not docs:
        return {"documents": []}

    # Deduplicate by id
    seen = set()
    unique_docs = []
    for doc in docs:
        doc_id = doc.get("id", "")
        if doc_id and doc_id not in seen:
            seen.add(doc_id)
            unique_docs.append(doc)
        elif not doc_id:
            # Must-check items have synthetic IDs
            unique_docs.append(doc)

    # Sort by score
    unique_docs.sort(key=lambda d: d.get("rerank_score", d.get("score", 0)), reverse=True)

    # Track synthesis stats
    markets_seen = set(d.get("market", "") for d in unique_docs)

    trace_entry = {
        "node": "synthesis",
        "total_docs": len(docs),
        "unique_docs": len(unique_docs),
        "markets_covered": list(markets_seen),
    }

    return {
        "documents": unique_docs,
        "agent_trace": state.get("agent_trace", []) + [trace_entry],
    }
