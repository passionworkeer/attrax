#!/usr/bin/env python3
"""
hybrid_retriever.py - Hybrid retrieval pipeline

Combines: Dense (Faiss) + BM25 -> RRF Fusion -> Must Check -> Rerank
"""
import logging
from typing import Optional

from rag_service.retrieval.local_embedder import LocalEmbedder, MODEL_PATH as LOCAL_MODEL_PATH
from rag_service.retrieval.modelScope_embedder import ModelScopeEmbedder
from rag_service.retrieval.bm25_retriever import BM25Retriever
from rag_service.retrieval.fusion import rrf_fuse
from rag_service.retrieval.must_check import apply_must_check
from rag_service.retrieval.faiss_retriever import FaissRetriever

logger = logging.getLogger(__name__)


class HybridRetriever:
    """
    Hybrid Dense + BM25 retriever with RRF fusion and reranking.

    Usage:
        retriever = HybridRetriever(embedder=embedder, bm25=bm25, faiss_retriever=faiss_ret)
        results = retriever.retrieve(
            query="充电宝铅含量限制",
            product_category="electronics",
            region="EU",
            top_k=20,
        )
    """

    def __init__(
        self,
        embedder=None,
        bm25: Optional[BM25Retriever] = None,
        faiss_retriever: Optional[FaissRetriever] = None,
        qdrant_client: Optional[object] = None,
        cohere_reranker_key: Optional[str] = None,
    ):
        self.bm25 = bm25
        self.faiss_retriever = faiss_retriever
        self.reranker_key = cohere_reranker_key or __import__("os").environ.get("COHERE_API_KEY", "")
        self._chunks: list[dict] = []
        self._chunks_loaded = False

        # Lazy embedder initialization (deferred to _get_embedder to avoid proxy issues)
        self._embedder = embedder  # None = will be lazily initialized

        # Auto-load chunks from FaissRetriever so retrieve() works without explicit load_chunks()
        if faiss_retriever is not None and hasattr(faiss_retriever, "chunks") and faiss_retriever.chunks:
            self._chunks = faiss_retriever.chunks
            self._chunks_loaded = True
            if self.bm25:
                self.bm25.build_index(faiss_retriever.chunks)
            logger.info(f"HybridRetriever: auto-loaded {len(faiss_retriever.chunks)} chunks from FaissRetriever")

    def load_chunks(self, chunks: list[dict]):
        """Load chunks into BM25 index."""
        if self.bm25:
            self.bm25.build_index(chunks)
        self._chunks = chunks
        self._chunks_loaded = True

    def _dense_search(self, query: str, top_k: int = 50) -> list[dict]:
        """Dense vector search via Faiss."""
        if self.faiss_retriever is None or self.faiss_retriever.index is None:
            return []

        try:
            embedder = self._get_embedder()
            if embedder is None:
                logger.warning("No embedder available, skipping dense search")
                return []
            query_vec = embedder.embed_query(query)
            return self.faiss_retriever.search(query_vec, top_k)
        except Exception as e:
            logger.warning(f"Dense search failed: {e}")
            return []

    def _get_embedder(self):
        """Lazily get or initialize embedder with proxy disabled."""
        if self._embedder is not None:
            return self._embedder

        import os as _os
        _os.environ.setdefault("NO_PROXY", "*")

        if LOCAL_MODEL_PATH.exists():
            self._embedder = LocalEmbedder()
            logger.info("Using LocalEmbedder (local GPU)")
        else:
            self._embedder = ModelScopeEmbedder()
            logger.info("Using ModelScopeEmbedder (API)")
        return self._embedder

    def retrieve(
        self,
        query: str,
        product_category: str = "",
        region: str = "",
        top_k: int = 20,
    ) -> list[dict]:
        """
        Full hybrid retrieval pipeline.

        Args:
            query: search query
            product_category: electronics/toy/etc. for must_check
            region: EU/US/CN for filtering
            top_k: final number of results

        Returns:
            list of chunk dicts with rrf_score and rerank_score
        """
        if not self._chunks_loaded:
            logger.warning("Chunks not loaded, returning empty")
            return []

        # Step 1: Dense search
        dense_results = self._dense_search(query, top_k=50)

        # Step 2: BM25 search
        bm25_results = []
        if self.bm25:
            bm25_results = self.bm25.search(query, top_k=50)

        # Step 3: RRF fusion
        fused = rrf_fuse(dense_results, bm25_results, k=25, top_k=top_k * 2)

        # Step 4: Must Check injection
        if product_category:
            fused = apply_must_check(fused, product_category, self._chunks)

        # Step 5: Region filter (if specified)
        if region:
            fused = [r for r in fused if r.get("region", "").lower() == region.lower()]

        # Step 6: Cohere Rerank (if key available)
        if self.reranker_key and len(fused) > top_k:
            fused = self._cohere_rerank(query, fused, top_k)

        return fused[:top_k]

    def _cohere_rerank(self, query: str, results: list[dict], top_n: int) -> list[dict]:
        """Rerank results using Cohere rerank-multilingual-v3."""
        try:
            import cohere
            client = cohere.ClientV2(api_key=self.reranker_key)

            docs = [r.get("content", "")[:1000] for r in results]
            resp = client.rerank(
                query=query,
                documents=docs,
                model="rerank-multilingual-v3.0",
                top_n=top_n,
            )

            # Map reranked results back
            reranked = []
            for item in resp.results:
                r = results[item.index].copy()
                r["rerank_score"] = item.relevance_score
                reranked.append(r)

            return reranked
        except Exception as e:
            logger.warning(f"Rerank failed: {e}, returning fused results")
            return results[:top_n]
