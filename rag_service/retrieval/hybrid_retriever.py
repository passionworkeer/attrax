#!/usr/bin/env python3
"""
hybrid_retriever.py - Hybrid retrieval pipeline

检索流程：
  Dense(Faiss) + BM25 → RRF 融合 → Must-Check 注入

Embedding 降级链：
  1. OllamaEmbedder     (本地，需 ollama pull nomic-embed-text)
  2. LocalEmbedder     (Qwen3-Embedding-0.6B，本地缓存)
  3. ModelScopeEmbedder (云端 API，需 API key)

用户提供云端 embedding key 后，删除前两级，直接用 ModelScopeEmbedder 即可。

Rerank: 不实现
"""
import logging
from typing import Optional

from rag_service.retrieval.bm25_retriever import BM25Retriever
from rag_service.retrieval.faiss_retriever import FaissRetriever
from rag_service.retrieval.fusion import rrf_fuse
from rag_service.retrieval.must_check import apply_must_check

logger = logging.getLogger(__name__)

_embedder = None
_embedder_name = "none"


def _probe_embedders():
    """
    Embedder 探测，按优先级尝试：
    1. OllamaEmbedder      (本地，无需网络)
    2. LocalEmbedder       (Qwen3-Embedding-0.6B，本地缓存)
    3. ModelScopeEmbedder  (云端 API，需 key)

    Returns (embedder_instance, name_str)
    """
    global _embedder, _embedder_name
    if _embedder is not None:
        return _embedder, _embedder_name

    # ── 1. Ollama nomic-embed-text ──────────────────────────────
    try:
        from rag_service.retrieval.ollama_embedder import OllamaEmbedder
        _embedder = OllamaEmbedder()
        _embedder_name = "ollama"
        logger.info("Embedding: OllamaEmbedder (nomic-embed-text, 768-dim)")
        return _embedder, _embedder_name
    except Exception as e:
        logger.info(f"Embedding: OllamaEmbedder unavailable ({e})")

    # ── 2. 本地 Qwen3-Embedding-0.6B ──────────────────────────
    try:
        from rag_service.retrieval.local_embedder import LocalEmbedder, MODEL_PATH as LOCAL_MODEL_PATH
        if LOCAL_MODEL_PATH.exists():
            _embedder = LocalEmbedder()
            _embedder_name = "local_qwen"
            logger.info("Embedding: LocalEmbedder (Qwen3-Embedding-0.6B, local cache)")
            return _embedder, _embedder_name
        else:
            logger.info(f"Embedding: LocalEmbedder model not found at {LOCAL_MODEL_PATH}")
    except Exception as e:
        logger.warning(f"Embedding: LocalEmbedder failed ({e})")

    # ── 3. ModelScope API ──────────────────────────────────────
    try:
        from rag_service.retrieval.modelScope_embedder import ModelScopeEmbedder
        _embedder = ModelScopeEmbedder()
        _embedder_name = "modelscope_api"
        logger.info("Embedding: ModelScopeEmbedder (Qwen3-Embedding-0.6B API)")
        return _embedder, _embedder_name
    except Exception as e:
        logger.error(f"Embedding: all embedders failed: {e}")
        _embedder_name = "none"
        return None, "none"


class HybridRetriever:
    """
    Hybrid Dense(Faiss) + BM25 retriever with RRF fusion.

    Embedding 优先级：Ollama → 本地 Qwen → ModelScope API
    Faiss 维度不匹配时自动跳过向量分支，退化为纯 BM25。
    Rerank: 不实现

    Usage:
        hr = HybridRetriever(bm25=bm25, faiss_retriever=faiss)
        hr.load_chunks(chunks)
        results = hr.retrieve(query="充电宝合规", region="EU", top_k=10)
    """

    def __init__(
        self,
        bm25: Optional[BM25Retriever] = None,
        faiss_retriever: Optional[FaissRetriever] = None,
    ):
        self.bm25 = bm25
        self.faiss_retriever = faiss_retriever
        self._chunks: list[dict] = []
        self._chunks_loaded = False
        self._embedder = None

    def load_chunks(self, chunks: list[dict]):
        """Load chunks into BM25 index."""
        if self.bm25:
            self.bm25.build_index(chunks)
        self._chunks = chunks
        self._chunks_loaded = True

    @property
    def embedder(self):
        """Lazy-load embedder on first use."""
        if self._embedder is None:
            self._embedder, name = _probe_embedders()
            logger.info(f"HybridRetriever embedder: {name}")
        return self._embedder

    @property
    def embedder_dim(self) -> int:
        ed = self.embedder
        return getattr(ed, "DIM", 0) if ed else 0

    def _dense_search(self, query: str, top_k: int = 50) -> list[dict]:
        """Dense vector search via Faiss. Skips if embedder unavailable or dim mismatch."""
        if self.faiss_retriever is None or self.faiss_retriever.index is None:
            return []

        ed = self.embedder
        if ed is None:
            logger.warning("No embedder available, skipping dense search")
            return []

        try:
            query_vec = ed.embed_query(query)
        except Exception as e:
            logger.warning(f"Embedding query failed: {e}")
            return []

        ed_dim = self.embedder_dim
        fs_dim = self.faiss_retriever.dim
        if ed_dim > 0 and fs_dim > 0 and ed_dim != fs_dim:
            logger.warning(
                f"Dimension mismatch: embedder={ed_dim}, Faiss={fs_dim}. "
                "Skipping vector search (fallback to BM25)."
            )
            return []

        try:
            return self.faiss_retriever.search(query_vec, top_k)
        except Exception as e:
            logger.warning(f"Dense search failed: {e}")
            return []

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
            region: EU/US/CN for filtering (case-insensitive)
            top_k: final number of results

        Returns:
            list of chunk dicts with rrf_score
        """
        if not self._chunks_loaded:
            logger.warning("Chunks not loaded, returning empty")
            return []

        # Step 1: Dense search (Faiss)
        dense_results = self._dense_search(query, top_k=50)

        # Step 2: BM25 search
        bm25_results = []
        if self.bm25:
            bm25_results = self.bm25.search(query, top_k=50)

        # Step 3: RRF fusion
        if dense_results or bm25_results:
            fused = rrf_fuse(dense_results, bm25_results, k=25, top_k=top_k * 2)
        else:
            fused = []

        # Step 4: Must-Check injection
        if product_category and self._chunks:
            fused = apply_must_check(fused, product_category, self._chunks)

        # Step 5: Region filter (case-insensitive)
        if region:
            fused = [r for r in fused if r.get("region", "").lower() == region.lower()]

        return fused[:top_k]
