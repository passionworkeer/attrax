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
# round-trip and the 2s rate-limit delay entirely on cache hits.
_CACHE_MAX = 512
_QUERY_CACHE: dict[str, tuple] = {}
_QUERY_CACHE_LOCK = threading.Lock()


def _qcache_key(text: str) -> str:
    return hashlib.md5(text.encode()).hexdigest()


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

    @property
    def client(self):
        if self._client is None:
            from openai import OpenAI
            self._client = OpenAI(
                base_url="https://api-inference.modelscope.cn/v1",
                api_key=self.api_key,
            )
        return self._client

    def _rate_limit(self, min_interval: float = 2.0):
        elapsed = time.monotonic() - self._last_call
        if elapsed < min_interval:
            time.sleep(min_interval - elapsed)
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

    def embed_query(self, text: str) -> list[float]:
        """
        Embed a single query string with in-process cache.
        Cache hits skip both the 2s rate-limit delay and the HTTP round-trip.
        """
        key = _qcache_key(text)
        with _QUERY_CACHE_LOCK:
            if key in _QUERY_CACHE:
                return list(_QUERY_CACHE[key])

        self._rate_limit(2.0)
        result = self._call_api(text)

        with _QUERY_CACHE_LOCK:
            if len(_QUERY_CACHE) >= _CACHE_MAX:
                # Simple eviction: remove the first (oldest) entry
                first_key = next(iter(_QUERY_CACHE))
                del _QUERY_CACHE[first_key]
            _QUERY_CACHE[key] = tuple(result)

        return result

    def embed_batch(self, texts: list[str], batch_size: int = 1) -> list[list[float]]:
        """
        Embed a batch of texts with retry/backoff.
        Returns zero vectors for chunks that permanently fail.
        """
        if not texts:
            return []

        results = []
        failed = 0
        t0 = time.monotonic()

        for i, text in enumerate(texts):
            self._rate_limit(2.0)
            try:
                vec = self._call_api(text)
                results.append(vec)
            except Exception as e:
                logger.warning(f"Chunk {i} failed ({e}), using zero vector")
                results.append([0.0] * self.DIM)
                failed += 1

            if (i + 1) % 50 == 0 or (i + 1) == len(texts):
                elapsed = time.monotonic() - t0
                rate = (i + 1) / elapsed if elapsed > 0 else 0
                eta = (len(texts) - i - 1) / rate if rate > 0 else 0
                logger.info(
                    f"  Embedded {i+1}/{len(texts)} ({failed} failed, "
                    f"{rate:.1f}/s, ETA {eta/60:.1f}min)"
                )

        elapsed = time.monotonic() - t0
        logger.info(
            f"  Done: {len(texts)} chunks in {elapsed/60:.1f}min "
            f"({failed} failed, avg {elapsed/len(texts):.1f}s/chunk)"
        )
        return results
