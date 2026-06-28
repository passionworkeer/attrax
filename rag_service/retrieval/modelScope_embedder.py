#!/usr/bin/env python3
"""
modelScope_embedder.py - ModelScope Qwen3-Embedding-0.6B via API

Uses ModelScope inference API with:
- Exponential backoff for rate limits (429)
- Text cleaning (skip binary/noise)
- Chunk-level error isolation (zero-fill on permanent failure)
"""
import os
import re
import time
import logging
import hashlib
import threading
from typing import Optional

logger = logging.getLogger(__name__)

DIM = 1024
MAX_TEXT_LEN = 8000
MIN_TEXT_LEN = 5  # Queries can be short; lower threshold for Chinese

# ─── LRU cache for embed_query ─────────────────────────────────────────────────
# Caches repeated query embeddings at the API level, bypassing both the network
# round-trip and any rate-limit delay entirely on cache hits.
_CACHE_MAX = 512
_QUERY_CACHE: dict[str, tuple] = {}
_QUERY_CACHE_LOCK = threading.Lock()

# Per-key locks: only concurrent requests for the SAME query key coalesce
# into a single API call. Different queries proceed in parallel. Previously a
# single global lock serialized all first-time embed_query calls, which under
# multi-market LangGraph fan-out turned independent queries into a sequential
# chain and inflated tail latency.
_PER_KEY_LOCKS: dict[str, threading.Lock] = {}
_PER_KEY_LOCKS_GUARD = threading.Lock()


def _per_key_lock(key: str) -> threading.Lock:
    """Return (creating if necessary) a lock specific to ``key``."""
    with _PER_KEY_LOCKS_GUARD:
        lock = _PER_KEY_LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            _PER_KEY_LOCKS[key] = lock
        return lock

# ─── Hourly rate-limit (sliding window) ────────────────────────────────────────
# ModelScope's free tier throttles at ~350 requests/hour/model. We keep a safety
# margin under the published cap and track call timestamps in a 1h sliding window.
# Calls are admitted immediately while the window has capacity; only when the
# window fills up do we sleep until the oldest call ages out.
#
# B4 fix: the sliding-window timestamp list is guarded by a single global lock
# (``_RATE_LIMIT_LOCK``). The lock is held only for the bookkeeping (prune +
# append), never for the API call, so the critical section stays tiny. In
# ``embed_query``, rate-limit is invoked inside the per-key lock AFTER the
# double-checked cache lookup, so only the genuine cache-miss holder reaches
# it — same-key concurrency collapses to exactly one quota unit, and cache
# hits consume zero quota.
_DEFAULT_HOURLY_LIMIT = 300      # safety margin below the ~350 free-tier cap
_DEFAULT_WINDOW_SECONDS = 3600   # 1 hour
_DEFAULT_BURST_INTERVAL = 0.0    # no forced delay between calls by default
_RATE_LIMIT_LOCK = threading.Lock()
_CALL_TIMESTAMPS: list[float] = []


def _qcache_key(text: str) -> str:
    return hashlib.md5(text.encode()).hexdigest()


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        logger.warning(f"Invalid int for {name}={raw!r}, using default {default}")
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        logger.warning(f"Invalid float for {name}={raw!r}, using default {default}")
        return default


def clean_text(text: str) -> str:
    if not text:
        return ""
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def is_likely_binary(text: str) -> bool:
    if not text:
        return True
    if sum(c.isprintable() or c.isspace() for c in text) / max(len(text), 1) < 0.7:
        return True
    if sum(c.isalpha() for c in text) / max(len(text), 1) < 0.05 and len(text) > 20:
        return True
    return False


class ModelScopeEmbedder:
    """
    Embedding via ModelScope Qwen3-Embedding-0.6B API.
    Falls back to local model if available.
    """

    DIM = DIM
    MODEL = "Qwen/Qwen3-Embedding-0.6B"

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get("MODELSCOPE_API_KEY", "")
        if not self.api_key:
            raise ValueError(
                "MODELSCOPE_API_KEY is not configured; ModelScope embedding is unavailable"
            )
        self._client = None
        self._last_call = 0.0
        self._hourly_limit = _env_int(
            "MODELSCOPE_HOURLY_LIMIT", _DEFAULT_HOURLY_LIMIT
        )
        self._window_seconds = _env_int(
            "MODELSCOPE_WINDOW_SECONDS", _DEFAULT_WINDOW_SECONDS
        )
        # Optional small burst guard (default 0 = no forced per-call delay).
        # Kept as a safety knob; the primary throttle is the sliding window.
        self._burst_interval = _env_float(
            "MODELSCOPE_BURST_INTERVAL", _DEFAULT_BURST_INTERVAL
        )

    @property
    def client(self):
        if self._client is None:
            from openai import OpenAI
            self._client = OpenAI(
                base_url="https://api-inference.modelscope.cn/v1",
                api_key=self.api_key,
            )
        return self._client

    def _rate_limit(self, min_interval: float = 0.0):
        """
        Throttle API calls to respect the hourly quota.

        Two layers of protection:
        1. Burst guard: optional small floor between successive calls
           (``_burst_interval``, default 0s — no per-call delay).
        2. Sliding-window quota: admit calls immediately while the trailing
           ``_window_seconds`` window holds fewer than ``_hourly_limit``
           timestamps; otherwise sleep until the oldest call ages out.

        The previous implementation forced a fixed 2s sleep on every call,
        which mis-modelled an hourly quota as a per-call floor and dominated
        query latency. Cache hits (``embed_query``) bypass this entirely.
        """
        now = time.monotonic()
        # Burst guard (off by default).
        burst = min_interval if min_interval > 0 else self._burst_interval
        if burst > 0:
            elapsed = now - self._last_call
            if elapsed < burst:
                time.sleep(burst - elapsed)
                now = time.monotonic()
        # Sliding-window quota. ``_RATE_LIMIT_LOCK`` is the single global
        # guard for the timestamp list (B4); held only for bookkeeping.
        with _RATE_LIMIT_LOCK:
            cutoff = now - self._window_seconds
            # Drop timestamps outside the window (immutable: rebuild list).
            fresh = [t for t in _CALL_TIMESTAMPS if t > cutoff]
            _CALL_TIMESTAMPS[:] = fresh
            if len(fresh) >= self._hourly_limit:
                # Wait until the oldest call ages out of the window.
                wait = fresh[0] + self._window_seconds - now
            else:
                wait = 0.0
                _CALL_TIMESTAMPS.append(now)
        if wait > 0:
            logger.warning(
                f"Hourly quota {self._hourly_limit} reached; "
                f"sleeping {wait:.1f}s for sliding window"
            )
            time.sleep(wait)
            # After waiting, claim a slot.
            with _RATE_LIMIT_LOCK:
                _CALL_TIMESTAMPS.append(time.monotonic())
        self._last_call = time.monotonic()

    def _call_api(self, text: str) -> list[float]:
        cleaned = clean_text(text)
        if is_likely_binary(cleaned) or len(cleaned) < MIN_TEXT_LEN:
            raise ValueError("Text too short or binary")
        if len(cleaned) > MAX_TEXT_LEN:
            cleaned = cleaned[:MAX_TEXT_LEN]

        delay = 1.0
        for attempt in range(8):
            try:
                resp = self.client.embeddings.create(
                    model=self.MODEL,
                    input=cleaned,
                    encoding_format="float",
                )
                return resp.data[0].embedding
            except Exception as e:
                err_str = str(e)
                if "429" in err_str or "rate limit" in err_str.lower():
                    logger.warning(f"Rate limited, retry {attempt+1}/8 in {delay:.1f}s")
                    time.sleep(delay)
                    delay = min(delay * 2, 60)
                    continue
                raise
        raise RuntimeError(f"Max retries exceeded for: {text[:50]}")

    def _call_api_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed multiple texts in a single API call."""
        cleaned_batch = [clean_text(t) for t in texts]
        valid = [
            (i, t[:MAX_TEXT_LEN])
            for i, t in enumerate(cleaned_batch)
            if not is_likely_binary(t) and len(t) >= MIN_TEXT_LEN
        ]
        if not valid:
            return [[0.0] * self.DIM for _ in texts]

        indices = [i for i, _ in valid]
        batch_texts = [t for _, t in valid]

        delay = 1.0
        for attempt in range(8):
            try:
                resp = self.client.embeddings.create(
                    model=self.MODEL,
                    input=batch_texts,
                    encoding_format="float",
                )
                out = [[0.0] * self.DIM for _ in texts]
                # Order-safety: the API contract guarantees resp.data is in
                # input order, but a previous implementation assumed that
                # silently and produced misaligned embeddings when an
                # upstream proxy reshaped the response. Validate via the
                # explicit ``index`` field when present; fall back to
                # positional only when the field is absent AND counts match.
                data_items = list(resp.data)
                if len(data_items) != len(batch_texts):
                    raise RuntimeError(
                        f"Batch embed returned {len(data_items)} items for "
                        f"{len(batch_texts)} inputs — count mismatch"
                    )
                has_index_field = any(
                    getattr(item, "index", None) is not None
                    for item in data_items
                )
                if has_index_field:
                    for item in data_items:
                        slot = item.index
                        if not (0 <= slot < len(indices)):
                            raise RuntimeError(
                                f"Batch embed index {slot} out of range for "
                                f"{len(indices)} valid inputs"
                            )
                        out[indices[slot]] = item.embedding
                else:
                    # Positional fallback (legacy responses without index).
                    for j, idx in enumerate(indices):
                        out[idx] = data_items[j].embedding
                return out
            except Exception as e:
                err_str = str(e)
                if "429" in err_str or "rate limit" in err_str.lower():
                    logger.warning(f"Rate limited (batch), retry {attempt+1}/8 in {delay:.1f}s")
                    time.sleep(delay)
                    delay = min(delay * 2, 60)
                    continue
                raise
        raise RuntimeError(f"Max retries exceeded for batch of {len(texts)} texts")

    def embed_query(self, text: str) -> list[float]:
        """
        Embed a single query string with in-process cache.
        Cache hits skip both the rate-limit delay and the HTTP round-trip.
        Thread-safe via per-key locking: concurrent first-time requests for
        the SAME query coalesce into a single API call (preventing thundering
        herd and cache poisoning), while different queries proceed in
        parallel using independent locks.

        B4 contract goals (per the audit finding):
        1. Same-key concurrent requests consume exactly ONE rate-limit quota
           unit, not N — the per-key lock plus the double-checked cache
           lookup means only the holder that actually misses reaches
           ``_rate_limit()``; same-key waiters hit the cache and skip it.
        2. Cache hits consume ZERO quota — the fast path returns before
           ``_rate_limit()`` is ever called.

        The ``_CALL_TIMESTAMPS`` list is mutated under the global
        ``_RATE_LIMIT_LOCK`` so concurrent different-key holders cannot lose
        appends or read a partially-updated window.
        """
        key = _qcache_key(text)
        # Fast path: cache hit under the shared cache lock, released before
        # any network work so other keys are not blocked. Cache hits never
        # reach _rate_limit() and therefore consume zero quota.
        with _QUERY_CACHE_LOCK:
            if key in _QUERY_CACHE:
                return list(_QUERY_CACHE[key])

        # Per-key serialization: only same-key callers wait on each other.
        # The double-checked cache lookup INSIDE this lock is what collapses
        # same-key concurrency to a single quota unit: when the holder
        # finishes the API call and populates the cache, every same-key
        # waiter that queued on this lock re-checks the cache, hits, and
        # returns without ever calling _rate_limit().
        key_lock = _per_key_lock(key)
        with key_lock:
            with _QUERY_CACHE_LOCK:
                if key in _QUERY_CACHE:
                    return list(_QUERY_CACHE[key])
            # Only the genuine cache-miss holder reaches here: one rate-limit
            # charge per same-key group, exactly as the audit requires.
            self._rate_limit()
            result = self._call_api(text)
            with _QUERY_CACHE_LOCK:
                if len(_QUERY_CACHE) >= _CACHE_MAX:
                    first_key = next(iter(_QUERY_CACHE))
                    del _QUERY_CACHE[first_key]
                _QUERY_CACHE[key] = tuple(result)
            return list(result)

    def embed_batch(self, texts: list[str], batch_size: int = 50) -> list[list[float]]:
        """
        Embed a batch of texts with retry/backoff.

        Sends up to ``batch_size`` texts per API call (batch inference), which
        drastically reduces the number of HTTP round-trips (from N to N/50) and
        avoids aggressive API rate limits.  The default ``batch_size=50`` was
        chosen because ModelScope's free tier throttles at ~350 requests per hour
        per model, and 7170 chunks ÷ 50 ≈ 144 calls is well under that threshold.

        Returns zero vectors for chunks that permanently fail.
        """
        if not texts:
            return []

        results = []
        failed = 0
        t0 = time.monotonic()

        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            self._rate_limit()
            try:
                vecs = self._call_api_batch(batch)
                results.extend(vecs)
            except Exception as e:
                logger.warning(f"Batch at {i} failed ({e}), using zero vectors")
                results.extend([[0.0] * self.DIM for _ in batch])
                failed += len(batch)

            if (i + batch_size) % 50 == 0 or (i + batch_size) >= len(texts):
                elapsed = time.monotonic() - t0
                rate = (i + batch_size) / elapsed if elapsed > 0 else 0
                eta = (len(texts) - i - batch_size) / rate if rate > 0 else 0
                logger.info(
                    f"  Embedded {min(i + batch_size, len(texts))}/{len(texts)} "
                    f"({failed} failed, {rate:.1f}/s, ETA {eta/60:.1f}min)"
                )

        elapsed = time.monotonic() - t0
        logger.info(
            f"  Done: {len(texts)} chunks in {elapsed/60:.1f}min "
            f"({failed} failed, avg {elapsed/len(texts):.1f}s/chunk)"
        )
        return results
