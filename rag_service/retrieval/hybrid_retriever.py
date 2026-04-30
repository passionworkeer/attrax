#!/usr/bin/env python3
"""
hybrid_retriever.py - Hybrid retrieval pipeline

三级 embedding 降级（优先本地，零 API 依赖）：
  1. OllamaEmbedder        (nomic-embed-text, 768-dim, 本地 CPU)
  2. LocalEmbedder         (Qwen3-Embedding-0.6B, 1024-dim, 本地 GPU/CPU)
  3. ModelScopeEmbedder    (Qwen3-Embedding-0.6B, 1024-dim, API 调用)

检索流程：
  Dense(Faiss) + BM25 → RRF 融合 → Must-Check 注入

去除了 Cohere rerank（依赖外部 API），改为直接取 top_k 结果。
如果 Faiss 索引维度与当前 embedder 不匹配，Faiss 分支静默跳过（退化为纯 BM25）。
"""
import logging
from typing import Optional

from rag_service.retrieval.bm25_retriever import BM25Retriever
from rag_service.retrieval.faiss_retriever import FaissRetriever
from rag_service.retrieval.fusion import rrf_fuse
from rag_service.retrieval.must_check import apply_must_check

logger = logging.getLogger(__name__)

# 尝试加载各 embedder，失败则静默降级
_embedder = None
_embedder_name = "none"


def _probe_embedders():
    """
    三级探测，按优先级尝试：
    1. OllamaEmbedder (本地，无 API)
    2. LocalEmbedder (本地 Qwen，GPU/CPU)
    3. ModelScopeEmbedder (API，需 key)

    Returns (embedder_instance, name_str)
    """
    global _embedder, _embedder_name
    if _embedder is not None:
        return _embedder, _embedder_name

    # ── 1. Ollama nomic-embed-text (本地，无需 GPU) ──────────────────
    try:
        from rag_service.retrieval.ollama_embedder import OllamaEmbedder
        _embedder = OllamaEmbedder()
        _embedder_name = "ollama"
        logger.info("Embedding: using OllamaEmbedder (nomic-embed-text, 768-dim)")
        return _embedder, _embedder_name
    except Exception as e:
        logger.info(f"Embedding: OllamaEmbedder unavailable ({e}), trying LocalEmbedder")

    # ── 2. 本地 Qwen3-Embedding-0.6B ──────────────────────────────────
    try:
        from rag_service.retrieval.local_embedder import LocalEmbedder, MODEL_PATH as LOCAL_MODEL_PATH
        if LOCAL_MODEL_PATH.exists():
            _embedder = LocalEmbedder()
            _embedder_name = "local_qwen"
            logger.info("Embedding: using LocalEmbedder (Qwen3-Embedding-0.6B, local)")
            return _embedder, _embedder_name
        else:
            logger.info(f"Embedding: LocalEmbedder model not found at {LOCAL_MODEL_PATH}")
    except Exception as e:
        logger.warning(f"Embedding: LocalEmbedder failed ({e})")

    # ── 3. ModelScope API (需网络 + key) ───────────────────────────────
    try:
        from rag_service.retrieval.modelScope_embedder import ModelScopeEmbedder
        _embedder = ModelScopeEmbedder()
        _embedder_name = "modelscope_api"
        logger.info("Embedding: using ModelScopeEmbedder (API)")
        return _embedder, _embedder_name
    except Exception as e:
        logger.error(f"Embedding: all embedders failed: {e}")
        _embedder_name = "none"
        return None, "none"


class HybridRetriever:
    """
    Hybrid Dense(Faiss) + BM25 retriever with RRF fusion.

    Embedding 优先级：Ollama → 本地 Qwen → ModelScope API
    去除了 Cohere rerank（外部 API 依赖），改为直接 top_k 截断。

    Usage:
        retriever = HybridRetriever(bm25=bm25, faiss_retriever=faiss_ret)
        results = retriever.retrieve(query="充电宝铅含量限制", product_category="electronics")
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
        self._embedder = None  # lazy

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
        """Return the embedding dimension of the active embedder."""
        ed = self.embedder
        if ed is None:
            return 0
        return getattr(ed, "DIM", 0)

    def _dense_search(self, query: str, top_k: int = 50) -> list[dict]:
        """Dense vector search via Faiss. Skips if dim mismatch."""
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

        # Dimension check: skip Faiss if dimensions don't match
        ed_dim = self.embedder_dim
        fs_dim = self.faiss_retriever.dim
        if ed_dim > 0 and fs_dim > 0 and ed_dim != fs_dim:
            logger.warning(
                f"Dimension mismatch: embedder={ed_dim}, Faiss={fs_dim}. "
                f"Skipping vector search (fallback to BM25). "
                f"Hint: rebuild Faiss index with matching embedder."
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
            region: EU/US/CN for filtering
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
