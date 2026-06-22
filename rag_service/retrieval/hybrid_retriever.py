#!/usr/bin/env python3
"""
hybrid_retriever.py - Hybrid retrieval pipeline

检索流程：
  Dense(Faiss) + BM25 → RRF 融合 → Must-Check 注入

Embedding:
  ModelScopeEmbedder (cloud API, requires MODELSCOPE_API_KEY)

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
from rag_service.retrieval.metadata_filter import attach_metadata_fields, filter_chunks
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


def _cache_key_v2(
    query: str,
    region: str,
    product_category: str,
    regulatory_types: list[str],
    source_ids: list[str],
    official_only: bool,
    top_k: int,
) -> str:
    """Stable cache key including metadata filters."""
    raw = jsonish_key(
        query,
        region,
        product_category,
        sorted(regulatory_types),
        sorted(source_ids),
        official_only,
        top_k,
    )
    return hashlib.md5(raw.encode()).hexdigest()


def jsonish_key(*parts) -> str:
    return "|".join(str(part) for part in parts)


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
    Embedder probing.

    Production intentionally uses only the ModelScope embedding API. Local
    Ollama/Qwen embedders remain in the repository for tests and historical
    experiments, but are not part of the deployment path.

    Returns (embedder_instance, name_str)
    """
    global _embedder, _embedder_name
    if _embedder is not None:
        return _embedder, _embedder_name

    try:
        from rag_service.retrieval.modelScope_embedder import ModelScopeEmbedder
        _embedder = ModelScopeEmbedder()
        _embedder_name = "modelscope_api"
        logger.info("Embedding: ModelScopeEmbedder (Qwen3-Embedding-0.6B API)")
        return _embedder, _embedder_name
    except Exception as e:
        logger.error(f"Embedding: ModelScope API unavailable: {e}")
        _embedder_name = "none"
        return None, "none"


class HybridRetriever:
    """
    Hybrid Dense(Faiss) + BM25 retriever with RRF fusion.

    Embedding provider: ModelScope API only
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

        # ─── P0-2 fail-loud: dimension mismatch metrics ─────────────────────
        # Track mismatch as an exposed metric so the silent-degradation failure
        # mode is visible. Dense silently degrading to BM25 was a P0 issue:
        # callers had no signal that dense retrieval was disabled.
        self.dense_dim_mismatch_count: int = 0
        self.dense_dim_mismatch_last: dict | None = None

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
            # P0-2 fix: previously this only logged a warning and returned [],
            # causing dense retrieval to silently degrade to BM25-only. Surface
            # the failure loudly (ERROR level) and bump an exposed counter so
            # operators / health endpoints can detect the mismatch.
            self.dense_dim_mismatch_count += 1
            self.dense_dim_mismatch_last = {
                "embedder_dim": ed_dim,
                "faiss_dim": fs_dim,
            }
            logger.error(
                "FAISS dense retrieval DISABLED: dimension mismatch "
                "(embedder=%d, faiss=%d). This was previously a silent "
                "fallback to BM25-only. Rebuild the FAISS index to match the "
                "production embedder dim, or switch embedder. Mismatch #%d.",
                ed_dim,
                fs_dim,
                self.dense_dim_mismatch_count,
            )
            return []

        try:
            return self.faiss_retriever.search(query_vec, top_k)
        except Exception as e:
            logger.error(f"Dense search failed: {e}")
            return []

    def retrieve(
        self,
        query: str,
        product_category: str = "",
        region: str = "",
        regulatory_types: list[str] | None = None,
        source_ids: list[str] | None = None,
        official_only: bool = False,
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

        regulatory_types = regulatory_types or []
        source_ids = source_ids or []

        # Fast path: check retrieval result cache (5-min TTL)
        cache_k = _cache_key_v2(
            query,
            region or "",
            product_category,
            regulatory_types,
            source_ids,
            official_only,
            top_k,
        )
        cached = _cache_get(cache_k)
        if cached is not None:
            logger.debug(f"Retrieval cache HIT for query: {query[:40]}")
            return cached[:top_k]

        candidate_chunks = filter_chunks(
            self._chunks,
            region=region,
            product_category=product_category,
            regulatory_types=regulatory_types,
            source_ids=source_ids,
            official_only=official_only,
        )
        use_metadata_candidates = bool(region or product_category or regulatory_types or source_ids or official_only)
        if use_metadata_candidates and not candidate_chunks:
            _cache_set(cache_k, [])
            return []

        # Run dense + BM25 in parallel
        with ThreadPoolExecutor(max_workers=2) as pool:
            dense_future = pool.submit(self._dense_search, query, 50)
            bm25_future = pool.submit(self._bm25_search, query, 50, candidate_chunks if use_metadata_candidates else None)
            dense_results = dense_future.result()
            bm25_results = bm25_future.result()

        # RRF fusion
        if dense_results or bm25_results:
            fused = rrf_fuse(dense_results, bm25_results, k=25, top_k=top_k * 2)
        else:
            fused = []

        # Must-Check injection
        if product_category and self._chunks:
            fused = apply_must_check(fused, product_category, candidate_chunks or self._chunks)

        if use_metadata_candidates:
            fused = [
                attach_metadata_fields(r)
                for r in fused
                if filter_chunks(
                    [r],
                    region=region,
                    product_category=product_category,
                    regulatory_types=regulatory_types,
                    source_ids=source_ids,
                    official_only=official_only,
                )
            ]

        result = fused[:top_k]
        _cache_set(cache_k, result)
        return result

    def _bm25_search(self, query: str, top_k: int, chunks: list[dict] | None = None) -> list[dict]:
        """BM25 search helper (called in thread pool)."""
        if chunks is not None:
            bm25 = _get_or_build_filter_bm25(chunks)
            return bm25.search(query, top_k=top_k)
        if self.bm25:
            return self.bm25.search(query, top_k=top_k)
        return []


# ─── Filtered BM25 Sub-Index LRU Cache ────────────────────────────────────────
# Reuses BM25 sub-indices across queries with the same chunk filter signature.
# Without this, every retrieve() call with metadata filters rebuilt BM25Okapi
# from scratch (tokenizing thousands of chunks), which dominated scan latency
# and caused /scan to exceed its 280s timeout.
_FILTER_BM25_CACHE: OrderedDict[str, tuple[BM25Retriever, float]] = OrderedDict()
_FILTER_BM25_LOCK = threading.Lock()
_FILTER_BM25_MAX = 20


def _filter_signature(chunks: list[dict]) -> str:
    """Stable signature for a filtered chunk subset."""
    return hashlib.md5(
        "|".join(sorted(c["id"] for c in chunks)).encode()
    ).hexdigest()


def _get_or_build_filter_bm25(chunks: list[dict]) -> BM25Retriever:
    """Return cached BM25Retriever for the chunk subset, building if missing."""
    sig = _filter_signature(chunks)
    with _FILTER_BM25_LOCK:
        entry = _FILTER_BM25_CACHE.get(sig)
        if entry is not None:
            bm25, _ = entry
            _FILTER_BM25_CACHE.move_to_end(sig)
            return bm25
    bm25 = BM25Retriever()
    bm25.build_index(chunks)
    with _FILTER_BM25_LOCK:
        _FILTER_BM25_CACHE[sig] = (bm25, time.monotonic())
        _FILTER_BM25_CACHE.move_to_end(sig)
        while len(_FILTER_BM25_CACHE) > _FILTER_BM25_MAX:
            _FILTER_BM25_CACHE.popitem(last=False)
    return bm25
