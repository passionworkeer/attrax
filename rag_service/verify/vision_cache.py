"""Content-hash observation cache (plan 2026-09-13 §10.3 缓存分层).

Caches the RAW vision-model text response for a single image, keyed by:

    sha256(image bytes) + model + prompt_version (+ checklist hash when
    the checklist prompt is used)

The cached value is the model's raw text, never a parsed structure —
parsing embeds session ids (observation ids carry scan identity), so it
must re-run per session. On a hit the pipeline skips the LLM roundtrip
and re-parses; identical image + identical model + identical prompt
yields the identical raw text, so the parse is deterministic.

Storage: one JSON file per key under ``<runtime_data_dir>/cache/vision``.
Bound: max ``MAX_ENTRIES`` files, evicted oldest-mtime-first. Cross-
session reuse stores only the analysis text keyed by content hash — no
image bytes, no session linkage — so a cache hit cannot expose a user's
photo or metadata to another session.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
from collections import defaultdict
from concurrent.futures import Future
from pathlib import Path
from typing import Any, Callable

logger = logging.getLogger(__name__)

MAX_ENTRIES = 500
_SUBDIR = "cache/vision"


class VisionResponseCache:
    def __init__(self, base_dir: Path | str | None = None):
        if base_dir is None:
            from rag_service.config import settings

            base_dir = settings.runtime_data_dir
        self.dir = Path(base_dir) / "cache" / "vision"
        try:
            self.dir.mkdir(parents=True, exist_ok=True)
        except OSError:
            self.dir = None  # cache disabled on unwritable storage
        # H13: serialize get/put/evict so concurrent writers cannot over-evict
        # (race: caller A's eviction glob runs while caller B's put succeeds,
        # then A's unlink removes B's newly written entry).
        self._lock = threading.Lock()
        # H4: per-key singleflight. Concurrent callers for the same cache_key
        # share one in-flight LLM call; later callers await the original
        # Future. Entries are dropped again when the flight completes, so the
        # dict only holds keys that are computing right now.
        self._key_locks: dict[str, threading.Lock] = defaultdict(threading.Lock)
        self._key_locks_lock = threading.Lock()
        self._in_flight: dict[str, Future[str]] = {}

    # ── keys ────────────────────────────────────────────────────────────

    @staticmethod
    def cache_key(
        image_bytes: bytes,
        model: str,
        prompt_version: str,
        checklist: list[dict[str, Any]] | None = None,
    ) -> str:
        digest = hashlib.sha256()
        digest.update(image_bytes)
        digest.update(f"\x00model={model}".encode("utf-8"))
        digest.update(f"\x00prompt={prompt_version}".encode("utf-8"))
        if checklist:
            # Checklist identity: ids + titles, order-stable.
            payload = json.dumps(
                [{"id": c.get("id"), "title": c.get("title")} for c in checklist],
                ensure_ascii=False,
                sort_keys=True,
            )
            digest.update(f"\x00checks={payload}".encode("utf-8"))
        return digest.hexdigest()

    # ── io ──────────────────────────────────────────────────────────────

    def _path(self, key: str) -> Path | None:
        return (self.dir / f"{key}.json") if self.dir else None

    def get(self, key: str) -> str | None:
        # H13: hold the lock across the read + utime so an eviction glob on
        # another thread cannot race with the LRU mtime bump.
        with self._lock:
            path = self._path(key)
            if path is None or not path.exists():
                return None
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                text = payload.get("text")
                if isinstance(text, str):
                    # Bump mtime for LRU eviction.
                    os.utime(path, None)
                    return text
            except (OSError, ValueError):
                return None
        return None

    def put(self, key: str, text: str) -> None:
        # H13: hold the lock across write + evict so two concurrent puts
        # cannot both see "len <= MAX_ENTRIES" and skip eviction when they
        # actually push the count over the limit.
        with self._lock:
            path = self._path(key)
            if path is None or not text:
                return
            try:
                tmp = path.with_suffix(".tmp")
                tmp.write_text(
                    json.dumps({"text": text}, ensure_ascii=False), encoding="utf-8"
                )
                tmp.replace(path)  # atomic on POSIX
            except OSError as exc:
                logger.debug("vision cache write failed: %s", exc)
                return
            self._evict_if_needed()

    def _evict_if_needed(self) -> None:
        # H13: caller already holds self._lock.
        if self.dir is None:
            return
        try:
            entries = [p for p in self.dir.glob("*.json") if p.is_file()]
            if len(entries) <= MAX_ENTRIES:
                return
            entries.sort(key=lambda p: p.stat().st_mtime)
            for stale in entries[: len(entries) - MAX_ENTRIES]:
                stale.unlink(missing_ok=True)
        except OSError:
            return

    # ── H4: singleflight ────────────────────────────────────────────────────

    def get_or_compute(
        self,
        key: str,
        compute: Callable[[], str],
    ) -> tuple[str, bool]:
        """Cache lookup; on miss, ``compute`` runs under a per-key singleflight.

        Concurrent callers for the same ``key`` share one in-flight LLM call:
        the first caller invokes ``compute``, every later caller awaits its
        result. Returns ``(text, cache_hit)`` mirroring ``_vision_text``.

        ``compute`` is called outside the cache lock so an LLM roundtrip
        does not block other cache lookups. The per-key lock only serializes
        the in-flight registration; once the Future resolves, all waiters
        get the same result without re-running the model.

        ``self._lock`` is deliberately NOT held while persisting the result:
        it is a non-reentrant ``threading.Lock`` and ``put`` acquires it
        itself, so wrapping the two deadlocked every write that came through
        this path (found by the 2026-09-18 H4 review).

        Every exit drops the per-key lock from ``_key_locks`` so the dict
        stays bounded by the number of *concurrently computing* keys rather
        than growing once per distinct image hash.
        """
        cached = self.get(key)
        if cached:
            return cached, True
        per_key = self._lock_for(key)
        with per_key:
            # Re-check after acquiring the per-key lock — a previous holder
            # may have just finished its put.
            cached = self.get(key)
            if cached:
                return cached, True
            existing = self._in_flight.get(key)
            if existing is not None and not existing.done():
                text = existing.result()
                return text, bool(text)
            future: Future[str] = Future()
            self._in_flight[key] = future
        try:
            text = compute()
            # put() takes self._lock itself — it must run OUTSIDE any lock
            # held here (nesting the two is the deadlock this fixes).
            if text:
                self.put(key, text)
            future.set_result(text or "")
            return text or "", False
        except Exception as exc:
            future.set_exception(exc)
            raise
        finally:
            with self._key_locks_lock:
                # Only this flight's own bookkeeping is dropped: a later
                # caller may already have registered a fresh future for the
                # key (it saw ours done), and that flight owns its own entry.
                if self._in_flight.get(key) is future:
                    self._in_flight.pop(key, None)
                    self._key_locks.pop(key, None)

    def _lock_for(self, cache_key: str) -> threading.Lock:
        # defaultdict's default factory is not thread-safe; guard the lookup
        # so two concurrent miss paths cannot each spawn a new lock object.
        with self._key_locks_lock:
            return self._key_locks[cache_key]
