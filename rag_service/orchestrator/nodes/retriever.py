#!/usr/bin/env python3
"""
retriever.py - Parallel retrieval node with Send() fan-out

Uses LangGraph Send() to fan out per-market retrieval.
"""
from typing import Optional
from langgraph.types import Send
from rag_service.orchestrator.state import GraphState

# Global retriever instance (initialized once, shared across calls)
_retriever_instance = None


def set_retriever(retriever):
    """Inject HybridRetriever from outside the graph."""
    global _retriever_instance
    _retriever_instance = retriever


def _retrieve_single_market(query: str, market: str, category: str = "") -> list[dict]:
    """Retrieve for one market using the shared HybridRetriever."""
    if _retriever_instance is None:
        return []

    try:
        results = _retriever_instance.retrieve(
            query=query,
            product_category=category,
            region=market,
            top_k=10,
        )
        # Tag each result with market
        for r in results:
            r["market"] = market
        return results
    except Exception as e:
        return []


def retriever_node(state: GraphState) -> dict:
    """Single-market retrieval (called per market via Send())."""
    sub_queries = state.get("sub_queries", [])
    category = state.get("category", "")
    if not sub_queries:
        return {"documents": []}

    # Use first sub-query for this node instance
    sq = sub_queries[0]
    results = _retrieve_single_market(sq["query"], sq["market"], category)

    return {"documents": results}


def fan_out_markets(state: GraphState) -> list[Send]:
    """Fan out to one retrieve node per market."""
    sub_queries = state.get("sub_queries", [])
    return [
        Send("retrieve", {"query": sq["query"], "market": sq["market"], "sub_queries": [sq]})
        for sq in sub_queries
    ]
