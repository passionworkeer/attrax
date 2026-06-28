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
import os
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

# Width of the candidate window fed into RRF for each branch. 50 mirrors the
# historical dense/bm25 search depth; widening it does not move the needle in
# eval and just inflates fusion cost.
_SEARCH_DEPTH = 50
# RRF smoothing constant for merging two BM25 result lists. Kept in sync with
# the main fusion default (fusion.DEFAULT_K) so a chunk found in both pools
# scores identically to a chunk fused via the standard dense+bm25 path.
_BM25_MERGE_K = 25

logger = logging.getLogger(__name__)

# Lazily-initialized shared executor for parallel dense + BM25 searches.
# Reused across all HybridRetriever.retrieve() calls (and across LangGraph
# Send() market fan-out) to avoid per-query ThreadPoolExecutor init overhead.
_dense_bm25_pool: ThreadPoolExecutor | None = None

_embedder = None
_embedder_name = "none"

# ─── Retrieval Result Cache ───────────────────────────────────────────────────
# Caches (query, region, top_k) → results for 5 minutes.
# Thread-safe. Typical hit rate: 30-60% in multi-round agent loops.
_RETRIEVAL_CACHE: OrderedDict[str, tuple[list, float]] = OrderedDict()
_CACHE_LOCK = threading.Lock()
_CACHE_TTL_SECS = 300  # 5 minutes
_CACHE_MAX_SIZE = 500


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


def _merge_bm25_results(
    strict_results: list[dict],
    loose_results: list[dict],
    top_k: int,
) -> list[dict]:
    """Merge strict-pool and loose-pool BM25 result lists via reciprocal rank.

    RRF lets a chunk found in only one pool surface (e.g. a target chunk with an
    incomplete product_category tag that only the loose pool contains), while
    chunks found in both pools get their contributions summed. Both inputs are
    first de-duplicated by source_id (keeping the best-scoring chunk per
    source) so multi-chunk regulations do not saturate the top-k window and
    crowd out a target source that exists as fewer chunks.
    """
    strict_dedup = _dedupe_by_source_id(strict_results)
    loose_dedup = _dedupe_by_source_id(loose_results)
    if not loose_dedup:
        return strict_dedup[:top_k]
    if not strict_dedup:
        return loose_dedup[:top_k]

    rrf_scores: dict[str, float] = {}
    payload: dict[str, dict] = {}
    for rank, r in enumerate(strict_dedup):
        doc_id = r.get("id") or f"strict_{rank}"
        rrf_scores[doc_id] = rrf_scores.get(doc_id, 0.0) + 1.0 / (_BM25_MERGE_K + rank)
        payload.setdefault(doc_id, r)
    for rank, r in enumerate(loose_dedup):
        doc_id = r.get("id") or f"loose_{rank}"
        rrf_scores[doc_id] = rrf_scores.get(doc_id, 0.0) + 1.0 / (_BM25_MERGE_K + rank)
        payload.setdefault(doc_id, r)

    ordered_ids = sorted(rrf_scores, key=rrf_scores.get, reverse=True)[:top_k]
    return [
        {**payload[doc_id], "bm25_merge_score": rrf_scores[doc_id]}
        for doc_id in ordered_ids
    ]


def _dedupe_by_source_id(results: list[dict]) -> list[dict]:
    """Keep the highest-scoring chunk per source_id, preserving order."""
    seen: set[str] = set()
    output: list[dict] = []
    for r in results:
        sid = r.get("source_id")
        key = sid if sid else f"__no_sid__{r.get('id','')}"
        if key in seen:
            continue
        seen.add(key)
        output.append(r)
    return output


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


def _dense_weight() -> float:
    """Read the dense-vs-BM25 fusion weight from the environment.

    ``RAG_DENSE_WEIGHT`` (default 1.0) multiplies the dense contribution
    in RRF fusion. Kept as a runtime knob so eval can rebalance without
    code changes; the default preserves the historical equal-weight
    behavior. Invalid values fall back to 1.0 with a warning.
    """
    raw = os.environ.get("RAG_DENSE_WEIGHT", "").strip()
    if not raw:
        return 1.0
    try:
        value = float(raw)
    except ValueError:
        logger.warning(f"Invalid RAG_DENSE_WEIGHT={raw!r}, using default 1.0")
        return 1.0
    if value < 0:
        logger.warning(f"Negative RAG_DENSE_WEIGHT={value}, clamping to 0.0")
        return 0.0
    return value


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


# Default regions to pre-build filtered BM25 sub-indices for at warmup.
# Reflects the project's multi-market fan-out set (EU/US are defaults; the
# rest are supported markets per CLAUDE.md). Keeps the working set bounded
# while covering the high-traffic combinations.
_WARMUP_REGIONS: list[str] = ["EU", "US", "UK", "CN", "AU", "SA", "AE", "JP"]


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

        # A (high-risk) public contract: expose the active embedder name on
        # the instance so callers (main.py) can read ``retriever.embedder_name``
        # instead of reflecting into the module-private ``_embedder_name``.
        # Initialised to the module-level default; updated when the lazy
        # ``embedder`` property first probes the embedder.
        self.embedder_name: str = _embedder_name

        # ─── P0-2 fail-loud: dimension mismatch metrics ─────────────────────
        # Track mismatch as an exposed metric so the silent-degradation failure
        # mode is visible. Dense silently degrading to BM25 was a P0 issue:
        # callers had no signal that dense retrieval was disabled.
        # E (high-risk): the counter is bumped from inside the parallel dense
        # branch of retrieve(), which LangGraph's Send() fan-out runs
        # concurrently across markets. A bare ``+= 1`` loses updates under
        # that concurrency, so the increment is guarded by a lock. The
        # instance attribute itself stays a plain int (contract with
        # main.py's ``getattr(retriever, 'dense_dim_mismatch_count', 0)``).
        self._dim_mismatch_lock = threading.Lock()
        self.dense_dim_mismatch_count: int = 0
        self.dense_dim_mismatch_last: dict | None = None

    def load_chunks(self, chunks: list[dict]):
        """Load chunks into BM25 index."""
        if self.bm25:
            self.bm25.build_index(chunks)
        self._chunks = chunks
        self._chunks_loaded = True
        # Best-effort filtered-BM25 cache warmup. Disabled by default to keep
        # unit-test startup fast; flip on via env in production. Failures are
        # swallowed so a corrupt chunk never blocks service boot.
        if os.environ.get("ATTRAX_WARMUP_FILTER_BM25", "").strip() in ("1", "true", "True"):
            try:
                self.warmup_filter_bm25()
            except Exception as e:
                logger.warning(f"Filtered BM25 warmup failed (non-fatal): {e}")

    def warmup_filter_bm25(self, regions: list[str] | None = None) -> int:
        """
        Pre-build filtered BM25 sub-indices for common (region) chunk subsets.

        Populates _FILTER_BM25_CACHE so the first /scan requests with metadata
        filters hit cache instead of paying the full tokenize+build cost.
        Idempotent and graceful: any per-region failure is logged and skipped.

        Args:
            regions: optional region list to warm. Defaults to _WARMUP_REGIONS.

        Returns:
            number of sub-indices successfully built and cached.
        """
        if not self._chunks_loaded or not self._chunks:
            return 0
        targets = regions or _WARMUP_REGIONS
        built = 0
        for region in targets:
            subset = filter_chunks(self._chunks, region=region)
            if not subset:
                continue
            try:
                _get_or_build_filter_bm25(subset)
                built += 1
            except Exception as e:
                logger.warning(
                    f"BM25 warmup skipped for region={region}: {e}"
                )
        if built:
            logger.info(f"Filtered BM25 warmup: {built} sub-indices cached")
        return built

    @property
    def embedder(self):
        """Lazy-load embedder on first use."""
        if self._embedder is None:
            self._embedder, name = _probe_embedders()
            # Mirror the resolved name onto the public attribute so callers
            # that read ``retriever.embedder_name`` (R3 contract) see the
            # post-probe value, not the pre-probe default.
            self.embedder_name = name
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
            # E (high-risk): lock-guarded increment — _dense_search runs inside
            # the parallel branch of retrieve(), so under LangGraph Send()
            # fan-out multiple markets can hit this path at once. A bare
            # ``+= 1`` would lose updates under that concurrency.
            with self._dim_mismatch_lock:
                self.dense_dim_mismatch_count += 1
                current_count = self.dense_dim_mismatch_count
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
                current_count,
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

        # Fallback pool: same filters as the strict candidate pool but with
        # product_category dropped. Some regulation chunks carry incomplete
        # product_category tags (e.g. lead-paint chunks tagged
        # [electronics,toys,painted_goods] but queried as children_products),
        # which the strict pool excludes outright. The loose pool keeps
        # region/regulatory_types/official_only so the candidate set stays
        # scoped; BM25 then surfaces chunks by term relevance. Only built when a
        # product_category filter is active, otherwise the loose pool is
        # identical to the strict pool.
        loose_chunks = (
            filter_chunks(
                self._chunks,
                region=region,
                regulatory_types=regulatory_types,
                source_ids=source_ids,
                official_only=official_only,
            )
            if product_category
            else None
        )

        # Run dense + BM25 in parallel. The executor is module-level (not
        # per-call) so LangGraph's Send() fan-out across multiple markets
        # reuses the same pool — ThreadPoolExecutor init/teardown was the
        # dominant per-query cost in profiling.
        global _dense_bm25_pool
        if _dense_bm25_pool is None:
            _dense_bm25_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="hybrid-retrieve")
        pool = _dense_bm25_pool
        dense_future = pool.submit(self._dense_search, query, _SEARCH_DEPTH)
        strict_chunks = candidate_chunks if use_metadata_candidates else None
        bm25_future = pool.submit(self._bm25_search, query, _SEARCH_DEPTH, strict_chunks)
        loose_future = (
            pool.submit(self._bm25_search, query, _SEARCH_DEPTH, loose_chunks)
            if loose_chunks
            else None
        )
        dense_results = dense_future.result()
        bm25_results = bm25_future.result()
        loose_results = loose_future.result() if loose_future else []

        # Merge strict + loose BM25 lists via RRF so a chunk that only the loose
        # pool found can still surface, while chunks in both pools get boosted.
        bm25_results = _merge_bm25_results(bm25_results, loose_results, _SEARCH_DEPTH)

        # RRF fusion
        if dense_results or bm25_results:
            fused = rrf_fuse(
                dense_results,
                bm25_results,
                k=25,
                top_k=top_k * 2,
                dense_weight=_dense_weight(),
            )
        else:
            fused = []

        # Must-Check injection
        if product_category and self._chunks:
            fused = apply_must_check(fused, product_category, candidate_chunks or self._chunks)

        if use_metadata_candidates:
            # Post-fusion filter. product_category is intentionally NOT applied
            # here: the loose-pool fallback above exists precisely to recover
            # chunks whose product_category tag is incomplete, and re-applying
            # the strict category filter would drop them again. Region,
            # regulatory_types, source_ids and official_only stay strict so the
            # result set remains scoped to the request.
            fused = [
                attach_metadata_fields(r)
                for r in fused
                if filter_chunks(
                    [r],
                    region=region,
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
# Cache ceiling for filtered BM25 sub-indices.
#
# Raised from 20 -> 80: with multi-market fan-out (EU/US/UK/CN/AU/...) crossed
# with multiple product categories, the working set of (region, category)
# combinations easily exceeds 20 entries. At 20 the cache thrashed under
# realistic multi-market /scan traffic, forcing full re-tokenization of
# thousands of chunks on miss — the dominant cause of /scan breaching its
# 280s timeout. Memory cost per entry is dominated by tokenized corpus
# (word-id arrays); 80 entries at ~14k chunks total stays well under a few
# hundred MB, acceptable for the worker process.
_FILTER_BM25_MAX = 80


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
