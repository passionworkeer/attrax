"""Tests for the vision response cache (plan §10.3)."""
from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor

from rag_service.verify.vision_cache import VisionResponseCache


class TestVisionResponseCache:
    def test_roundtrip(self, tmp_path):
        cache = VisionResponseCache(tmp_path)
        key = cache.cache_key(b"image", "MiniMax-M3", "v1")
        assert cache.get(key) is None
        cache.put(key, '{"product_type": "charger"}')
        assert cache.get(key) == '{"product_type": "charger"}'

    def test_keys_differ_by_model_and_prompt(self, tmp_path):
        base = VisionResponseCache.cache_key(b"img", "model-a", "p1")
        assert base != VisionResponseCache.cache_key(b"img", "model-b", "p1")
        assert base != VisionResponseCache.cache_key(b"img", "model-a", "p2")
        assert base == VisionResponseCache.cache_key(b"img", "model-a", "p1")

    def test_keys_differ_by_checklist(self, tmp_path):
        checks_a = [{"id": "a", "title": "A"}]
        checks_b = [{"id": "a", "title": "A"}, {"id": "b", "title": "B"}]
        assert (
            VisionResponseCache.cache_key(b"img", "m", "p", checks_a)
            != VisionResponseCache.cache_key(b"img", "m", "p", checks_b)
        )

    def test_keys_differ_by_image_bytes(self, tmp_path):
        assert (
            VisionResponseCache.cache_key(b"img1", "m", "p")
            != VisionResponseCache.cache_key(b"img2", "m", "p")
        )

    def test_eviction_bounds_entries(self, tmp_path, monkeypatch):
        monkeypatch.setattr("rag_service.verify.vision_cache.MAX_ENTRIES", 3)
        cache = VisionResponseCache(tmp_path)
        for index in range(6):
            key = cache.cache_key(f"img{index}".encode(), "m", "p")
            cache.put(key, f"resp-{index}")
        files = list((tmp_path / "cache" / "vision").glob("*.json"))
        assert len(files) <= 3
        # Oldest entries evicted; the newest survive.
        assert cache.get(cache.cache_key(b"img5", "m", "p")) == "resp-5"
        assert cache.get(cache.cache_key(b"img0", "m", "p")) is None

    def test_no_session_data_in_store(self, tmp_path):
        """Authorization isolation (§10.3): the cache file holds only the
        raw model text keyed by content hash — no session ids, no image
        bytes, no filenames."""
        import json

        cache = VisionResponseCache(tmp_path)
        key = cache.cache_key(b"secret-image", "m", "p")
        cache.put(key, "analysis text")
        stored = list((tmp_path / "cache" / "vision").glob("*.json"))[0]
        payload = json.loads(stored.read_text(encoding="utf-8"))
        assert set(payload.keys()) == {"text"}
        assert "secret-image" not in stored.name  # key is a sha256 hex


class TestSingleflight:
    """H4: concurrent miss callers share one compute; the write-through must
    not deadlock and the per-key bookkeeping must be released."""

    def test_get_or_compute_writes_through_without_deadlocking(self, tmp_path):
        cache = VisionResponseCache(tmp_path)
        key = cache.cache_key(b"img", "m", "p")
        calls: list[int] = []

        def compute() -> str:
            calls.append(1)
            return "analysis text"

        # The pre-fix implementation re-acquired the (non-reentrant) cache
        # lock inside put() while already holding it, so this call never
        # returned. The timeout turns a regression back into a fast failure
        # instead of a hung test.
        with ThreadPoolExecutor(max_workers=1) as pool:
            text, cache_hit = pool.submit(cache.get_or_compute, key, compute).result(
                timeout=10
            )

        assert text == "analysis text"
        assert cache_hit is False
        assert cache.get(key) == "analysis text"
        assert calls == [1]
        # Per-key singleflight bookkeeping is dropped once the flight ends:
        # otherwise _key_locks grows once per distinct image hash forever.
        assert cache._key_locks == {}
        assert cache._in_flight == {}

    def test_get_or_compute_shares_one_compute_across_threads(self, tmp_path):
        cache = VisionResponseCache(tmp_path)
        key = cache.cache_key(b"shared", "m", "p")
        calls: list[int] = []
        release = threading.Event()

        def compute() -> str:
            calls.append(1)
            release.wait(5)
            return "shared text"

        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(cache.get_or_compute, key, compute)
            deadline = time.time() + 5
            while not calls and time.time() < deadline:
                time.sleep(0.01)
            assert calls, "first compute never started"
            second = pool.submit(cache.get_or_compute, key, compute)
            time.sleep(0.05)  # let the second caller join the in-flight call
            release.set()
            r1 = first.result(timeout=10)
            r2 = second.result(timeout=10)

        assert len(calls) == 1
        assert r1[0] == r2[0] == "shared text"
        assert cache.get(key) == "shared text"
        assert cache._key_locks == {}

    def test_get_or_compute_serves_a_second_call_from_cache(self, tmp_path):
        cache = VisionResponseCache(tmp_path)
        key = cache.cache_key(b"cached", "m", "p")
        cache.put(key, "already there")

        def compute() -> str:  # pragma: no cover — must not run
            raise AssertionError("compute ran despite a cache hit")

        text, cache_hit = cache.get_or_compute(key, compute)
        assert (text, cache_hit) == ("already there", True)
