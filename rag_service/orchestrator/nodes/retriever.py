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
_is_injected = False


def set_retriever(retriever):
    """Inject HybridRetriever from outside the graph."""
    global _retriever_instance, _is_injected
    _retriever_instance = retriever
    _is_injected = True


def _get_retriever():
    """Get retriever with lazy initialization. Ensures chunks are loaded."""
    global _retriever_instance, _is_injected
    if _retriever_instance is not None:
        return _retriever_instance

    if not _is_injected:
        try:
            from rag_service.retrieval.hybrid_retriever import HybridRetriever
            from rag_service.retrieval.faiss_retriever import FaissRetriever
            from rag_service.retrieval.bm25_retriever import BM25Retriever

            faiss = FaissRetriever.load(
                "C:/temp/faiss_index/legal_chunks.index",
                "C:/temp/faiss_index/legal_chunks_meta.json",
            )
            bm25 = BM25Retriever()
            _retriever_instance = HybridRetriever(bm25=bm25, faiss_retriever=faiss)
            # CRITICAL: load chunks into BM25 + HybridRetriever
            chunks = faiss.chunks if faiss else []
            if chunks:
                _retriever_instance.load_chunks(chunks)
        except Exception:
            pass

    return _retriever_instance


def _retrieve_single_market(query: str, market: str) -> list[dict]:
    """Retrieve for one market using the shared HybridRetriever."""
    retriever = _get_retriever()
    if retriever is None:
        return []

    try:
        results = retriever.retrieve(
            query=query,
            product_category="",
            region=market,
            top_k=10,
        )
        for r in results:
            r["market"] = market
        return results
    except Exception:
        return []


def retriever_node(state: GraphState) -> dict:
    """Single-market retrieval (called per market via Send())."""
    sub_queries = state.get("sub_queries", [])
    if not sub_queries:
        return {"documents": []}

    sq = sub_queries[0]
    results = _retrieve_single_market(sq["query"], sq["market"])
    return {"documents": results}


def fan_out_markets(state: GraphState) -> list[Send]:
    """Fan out to one retrieve node per market."""
    sub_queries = state.get("sub_queries", [])
    return [
        Send("retrieve", {"query": sq["query"], "market": sq["market"], "sub_queries": [sq]})
        for sq in sub_queries
    ]