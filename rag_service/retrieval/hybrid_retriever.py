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

性能优化：
  - LRU cache on embed_query (all embedder types)
  - Corpus tokenization cached at build_index (BM25)
  - Retrieval result cache with 5-min TTL (HybridRetriever)
  - Parallel BM25 + dense search via ThreadPoolExecutor
"""
import hashlib
import logging
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from rag_service.retrieval.bm25_retriever import BM25Retriever
from rag_service.retrieval.faiss_retriever import FaissRetriever
from rag_service.retrieval.fusion import rrf_fuse
from rag_service.retrieval.must_check import apply_must_check

logger = logging.getLogger(__name__)

_embedder = None
_embedder_name = "none"

# ─── Retrieval Result Cache ───────────────────────────────────────────────────
# Caches (query, region, top_k) → results for 5 minutes.
# Thread-safe. Typical hit rate: 30-60% in multi-round agent loops.
_RETRIEVAL_CACHE: OrderedDict[str, tuple[list, float]] = OrderedDict()
_CACHE_LOCK = threading.Lock()
_CACHE_TTL_SECS = 300  # 5 minutes
_CACHE_MAX_SIZE = 500


def _cache_key(query: str, region: str, product_category: str, top_k: int) -> str:
    """Stable cache key from query parameters."""
    raw = f"{query}|{region}|{product_category}|{top_k}"
    return hashlib.md5(raw.encode()).hexdigest()


def _cache_get(key: str) -> Optional[list]:
    """Return cached result if not expired, else None."""
    with _CACHE_LOCK:
        entry = _RETRIEVAL_CACHE.get(key)
        if entry is None:
            return None
        results, timestamp = entry
        if time.monotonic() - timestamp > _CACHE_TTL_SECS:
            del _RETRIEVAL_CACHE[key]
            return None
        _RETRIEVAL_CACHE.move_to_end(key)
        return results


def _cache_set(key: str, results: list) -> None:
    """Store result in cache."""
    with _CACHE_LOCK:
        _RETRIEVAL_CACHE[key] = (results, time.monotonic())
        _RETRIEVAL_CACHE.move_to_end(key)
        while len(_RETRIEVAL_CACHE) > _CACHE_MAX_SIZE:
            _RETRIEVAL_CACHE.popitem(last=False)


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
        Full hybrid retrieval pipeline (parallelized).

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

        # Fast path: check retrieval result cache (5-min TTL)
        cache_k = _cache_key(query, region or "", product_category, top_k)
        cached = _cache_get(cache_k)
        if cached is not None:
            logger.debug(f"Retrieval cache HIT for query: {query[:40]}")
            return cached[:top_k]

        # Run dense + BM25 in parallel
        with ThreadPoolExecutor(max_workers=2) as pool:
            dense_future = pool.submit(self._dense_search, query, 50)
            bm25_future = pool.submit(self._bm25_search, query, 50)
            dense_results = dense_future.result()
            bm25_results = bm25_future.result()

        # RRF fusion
        if dense_results or bm25_results:
            fused = rrf_fuse(dense_results, bm25_results, k=25, top_k=top_k * 2)
        else:
            fused = []

        # Must-Check injection
        if product_category and self._chunks:
            fused = apply_must_check(fused, product_category, self._chunks)

        # Region filter
        if region:
            fused = [r for r in fused if r.get("region", "").lower() == region.lower()]

        result = fused[:top_k]
        _cache_set(cache_k, result)
        return result

    def _bm25_search(self, query: str, top_k: int) -> list[dict]:
        """BM25 search helper (called in thread pool)."""
        if self.bm25:
            return self.bm25.search(query, top_k=top_k)
        return []
