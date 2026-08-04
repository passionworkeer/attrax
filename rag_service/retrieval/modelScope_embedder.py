#!/usr/bin/env python3
"""ModelScope Qwen3 embedding client with bounded caches and fail-fast quota."""

from __future__ import annotations

import hashlib
import logging
import os
import re
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Iterator, Optional

logger = logging.getLogger(__name__)

DIM = 1024
MAX_TEXT_LEN = 8000
MIN_TEXT_LEN = 5
_CACHE_MAX = 512
_DEFAULT_HOURLY_LIMIT = 300
_DEFAULT_WINDOW_SECONDS = 3600
_DEFAULT_BURST_INTERVAL = 0.0

_QUERY_CACHE: dict[str, tuple[float, ...]] = {}
_QUERY_CACHE_LOCK = threading.Lock()
_RATE_LIMIT_LOCK = threading.Lock()
_CALL_TIMESTAMPS: list[float] = []


class ModelScopeQuotaExceeded(RuntimeError):
    """Local quota guard rejected a request without occupying a worker."""

    def __init__(self, retry_after_seconds: float):
        self.retry_after_seconds = max(0.0, retry_after_seconds)
        super().__init__(
            f"ModelScope hourly quota exhausted; retry after {self.retry_after_seconds:.1f}s"
        )


@dataclass
class _KeyLockEntry:
    lock: threading.Lock
    users: int = 0


_PER_KEY_LOCKS: dict[str, _KeyLockEntry] = {}
_PER_KEY_LOCKS_GUARD = threading.Lock()


@contextmanager
def _per_key_lock(key: str) -> Iterator[None]:
    """Serialize identical misses and delete the lock after the last waiter."""
    with _PER_KEY_LOCKS_GUARD:
        entry = _PER_KEY_LOCKS.get(key)
        if entry is None:
            entry = _KeyLockEntry(threading.Lock())
            _PER_KEY_LOCKS[key] = entry
        entry.users += 1
    entry.lock.acquire()
    try:
        yield
    finally:
        entry.lock.release()
        with _PER_KEY_LOCKS_GUARD:
            entry.users -= 1
            if entry.users == 0 and _PER_KEY_LOCKS.get(key) is entry:
                _PER_KEY_LOCKS.pop(key, None)


def _qcache_key(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        logger.warning("Invalid integer %s=%r; using %d", name, raw, default)
        return default
    return value if value > 0 else default


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        logger.warning("Invalid float %s=%r; using %.2f", name, raw, default)
        return default
    return max(0.0, value)


def clean_text(text: str) -> str:
    if not text:
        return ""
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def is_likely_binary(text: str) -> bool:
    if not text:
        return True
    length = max(len(text), 1)
    if sum(char.isprintable() or char.isspace() for char in text) / length < 0.7:
        return True
    return len(text) > 20 and sum(char.isalpha() for char in text) / length < 0.05


class ModelScopeEmbedder:
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
        self._hourly_limit = _env_int("MODELSCOPE_HOURLY_LIMIT", _DEFAULT_HOURLY_LIMIT)
        self._window_seconds = _env_int(
            "MODELSCOPE_WINDOW_SECONDS", _DEFAULT_WINDOW_SECONDS
        )
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
                timeout=float(os.environ.get("MODELSCOPE_HTTP_TIMEOUT_SECONDS", "30")),
                max_retries=0,
            )
        return self._client

    def _rate_limit(self, min_interval: float = 0.0) -> None:
        """Reserve one sliding-window slot or fail fast with retry metadata."""
        now = time.monotonic()
        burst = min_interval if min_interval > 0 else self._burst_interval
        if burst > 0:
            elapsed = now - self._last_call
            if elapsed < burst:
                time.sleep(burst - elapsed)
                now = time.monotonic()

        with _RATE_LIMIT_LOCK:
            cutoff = now - self._window_seconds
            _CALL_TIMESTAMPS[:] = [
                timestamp for timestamp in _CALL_TIMESTAMPS if timestamp > cutoff
            ]
            if len(_CALL_TIMESTAMPS) >= self._hourly_limit:
                retry_after = _CALL_TIMESTAMPS[0] + self._window_seconds - now
                raise ModelScopeQuotaExceeded(retry_after)
            _CALL_TIMESTAMPS.append(now)
        self._last_call = now

    @staticmethod
    def _is_rate_limit_error(error: Exception) -> bool:
        text = str(error).lower()
        return "429" in text or "rate limit" in text or "too many requests" in text

    def _call_api(self, text: str) -> list[float]:
        cleaned = clean_text(text)
        if is_likely_binary(cleaned) or len(cleaned) < MIN_TEXT_LEN:
            raise ValueError("Text too short or binary")
        cleaned = cleaned[:MAX_TEXT_LEN]

        delay = 1.0
        for attempt in range(8):
            try:
                response = self.client.embeddings.create(
                    model=self.MODEL,
                    input=cleaned,
                    encoding_format="float",
                )
                vector = list(response.data[0].embedding)
                if len(vector) != self.DIM:
                    raise RuntimeError(
                        f"ModelScope returned dimension {len(vector)}, expected {self.DIM}"
                    )
                return vector
            except Exception as error:
                if not self._is_rate_limit_error(error):
                    raise
                if attempt == 7:
                    break
                logger.warning(
                    "ModelScope rate limited, retry %d/8 in %.1fs", attempt + 1, delay
                )
                time.sleep(delay)
                delay = min(delay * 2, 30.0)
        raise RuntimeError(f"Max retries exceeded for: {cleaned[:50]}")

    def _call_api_batch(self, texts: list[str]) -> list[list[float]]:
        cleaned = [clean_text(text) for text in texts]
        valid = [
            (index, text[:MAX_TEXT_LEN])
            for index, text in enumerate(cleaned)
            if not is_likely_binary(text) and len(text) >= MIN_TEXT_LEN
        ]
        if not valid:
            return [[0.0] * self.DIM for _ in texts]

        indexes = [index for index, _ in valid]
        inputs = [text for _, text in valid]
        delay = 1.0
        for attempt in range(8):
            try:
                response = self.client.embeddings.create(
                    model=self.MODEL,
                    input=inputs,
                    encoding_format="float",
                )
                items = list(response.data)
                if len(items) != len(inputs):
                    raise RuntimeError(
                        f"Batch embed returned {len(items)} items for {len(inputs)} inputs"
                    )
                output = [[0.0] * self.DIM for _ in texts]
                has_indexes = any(
                    getattr(item, "index", None) is not None for item in items
                )
                for position, item in enumerate(items):
                    slot = item.index if has_indexes else position
                    if not isinstance(slot, int) or not 0 <= slot < len(indexes):
                        raise RuntimeError("Batch embedding response index is invalid")
                    vector = list(item.embedding)
                    if len(vector) != self.DIM:
                        raise RuntimeError(
                            f"ModelScope returned dimension {len(vector)}, expected {self.DIM}"
                        )
                    output[indexes[slot]] = vector
                return output
            except Exception as error:
                if not self._is_rate_limit_error(error):
                    raise
                if attempt == 7:
                    break
                logger.warning(
                    "ModelScope batch rate limited, retry %d/8 in %.1fs",
                    attempt + 1,
                    delay,
                )
                time.sleep(delay)
                delay = min(delay * 2, 30.0)
        raise RuntimeError(f"Max retries exceeded for batch of {len(texts)} texts")

    def embed_query(self, text: str) -> list[float]:
        key = _qcache_key(text)
        with _QUERY_CACHE_LOCK:
            cached = _QUERY_CACHE.get(key)
            if cached is not None:
                return list(cached)

        with _per_key_lock(key):
            with _QUERY_CACHE_LOCK:
                cached = _QUERY_CACHE.get(key)
                if cached is not None:
                    return list(cached)
            self._rate_limit()
            result = self._call_api(text)
            with _QUERY_CACHE_LOCK:
                if len(_QUERY_CACHE) >= _CACHE_MAX:
                    _QUERY_CACHE.pop(next(iter(_QUERY_CACHE)))
                _QUERY_CACHE[key] = tuple(result)
            return list(result)

    def embed_batch(self, texts: list[str], batch_size: int = 50) -> list[list[float]]:
        if not texts:
            return []
        if not isinstance(batch_size, int) or batch_size <= 0:
            raise ValueError("batch_size must be a positive integer")

        results: list[list[float]] = []
        failed = 0
        started = time.monotonic()
        for offset in range(0, len(texts), batch_size):
            batch = texts[offset : offset + batch_size]
            self._rate_limit()
            try:
                results.extend(self._call_api_batch(batch))
            except ModelScopeQuotaExceeded:
                raise
            except Exception as error:
                logger.warning(
                    "Embedding batch at offset %d failed (%s); emitting zero vectors for build-time filtering",
                    offset,
                    type(error).__name__,
                )
                results.extend([[0.0] * self.DIM for _ in batch])
                failed += len(batch)

        elapsed = max(time.monotonic() - started, 1e-9)
        logger.info(
            "Embedded %d texts in %.1fs (%d zero vectors; %.1f/s)",
            len(texts),
            elapsed,
            failed,
            len(texts) / elapsed,
        )
        return results
