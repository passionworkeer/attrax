"""Tests for the vision response cache (plan §10.3)."""
from __future__ import annotations

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
