#!/usr/bin/env python3
"""
retriever.py - Parallel retrieval node with Send() fan-out

Uses LangGraph Send() to fan out per-market retrieval.
"""
import logging
import os
from pathlib import Path
from typing import Optional
from langgraph.types import Send
from rag_service.orchestrator.state import GraphState

_APP_ROOT = Path(__file__).parent.parent.parent
logger = logging.getLogger(__name__)

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

            _faiss_dir = Path(os.environ.get("FAISS_INDEX_DIR", _APP_ROOT / "data" / "faiss"))
            faiss = FaissRetriever.load(
                str(_faiss_dir / "legal_chunks.index"),
                str(_faiss_dir / "legal_chunks_meta.json"),
            )
            bm25 = BM25Retriever()
            _retriever_instance = HybridRetriever(bm25=bm25, faiss_retriever=faiss)
            # CRITICAL: load chunks into BM25 + HybridRetriever
            chunks = faiss.chunks if faiss else []
            if chunks:
                _retriever_instance.load_chunks(chunks)
        except Exception as exc:
            logger.warning("Lazy retriever initialization failed", exc_info=exc)

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
            top_k=15,
        )
        for r in results:
            r["market"] = market
        return results
    except Exception as exc:
        logger.warning("Retrieval failed for market %s", market, exc_info=exc)
        return []


def retriever_node(state: GraphState) -> dict:
    """Single-market retrieval (called per market via Send()).

    De-RAG spec §7.7 step 1: when `RETRIEVAL_ENABLED` is disabled
    (default false), the retrieval stack is bypassed entirely — the
    generator consumes KB article texts (via `USE_KB_INPUT=true`) and
    `mandatory_regulations` instead of corpus chunks. The graph shape
    stays intact so flipping the flag back re-enables retrieval with
    zero code changes.
    """
    if not _retrieval_enabled():
        return {"documents": []}

    sub_queries = state.get("sub_queries", [])
    if not sub_queries:
        return {"documents": []}

    sq = sub_queries[0]
    results = _retrieve_single_market(sq["query"], sq["market"])
    return {"documents": results}


def _retrieval_enabled() -> bool:
    """Feature flag for the retrieval stack (De-RAG spec §7.7 step 1).

    Default TRUE preserves the deployed behavior (chunks path).
    Set `RETRIEVAL_ENABLED=false` to skip retrieval — combined with
    `USE_KB_INPUT=true` this activates the full KB-anchored pipeline
    without the FAISS/BM25/embedding stack.

    Note: the spec text says the collapsed pipeline defaults to
    retrieval-off; we ship default-on to keep the deployed system
    unchanged until the E2E baseline comparison (spec §10 step 7)
    signs off on the KB path.
    """
    val = (os.environ.get("RETRIEVAL_ENABLED") or "").strip().lower()
    if not val:
        return True  # default: legacy retrieval active
    return val in {"1", "true", "yes", "on"}


def fan_out_markets(state: GraphState) -> list[Send]:
    """Fan out to one retrieve node per market.

    When retrieval is disabled (§7.7 step 1) the fan-out returns a
    single no-op Send so the graph topology is unchanged — the
    retriever node itself short-circuits to `{"documents": []}`.
    """
    if not _retrieval_enabled():
        # Still emit one Send so the 'retrieve' node executes (and its
        # trace entry lands), but it will return empty documents.
        sub_queries = state.get("sub_queries", [])
        if sub_queries:
            sq = sub_queries[0]
            return [
                Send("retrieve", {"query": sq["query"], "market": sq["market"], "sub_queries": [sq]})
            ]
        return []
    sub_queries = state.get("sub_queries", [])
    return [
        Send("retrieve", {"query": sq["query"], "market": sq["market"], "sub_queries": [sq]})
        for sq in sub_queries
    ]