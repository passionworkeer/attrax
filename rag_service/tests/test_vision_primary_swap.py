"""Vision primary swap — default is now DeepSeek (2-3x faster than MiniMax on
the v7 prompt; MiniMax stays as the fallback path).

The legacy test_vision_fallback.py suite locks _vision_primary="minimax"
so its expectations about primary = _call_mimotalk still hold. This module
exercises the new default: primary = _call_deepseek, fallback = _call_mimotalk.
"""
from unittest.mock import patch

from rag_service.pipeline.nodes import vision as vision_module
from rag_service.pipeline.nodes.vision import (
    VISION_PROMPT_VERSION,
    VisionAnalyzer,
)

FREEFORM_OUTPUT = """{
  "product_type": "USB 充电器",
  "identity_confidence": "high",
  "core_features": [],
  "visible_certification_marks": ["CE"],
  "questions_needed": [],
  "unreadable_or_missing_evidence": []
}"""

# Minimal valid JPEG header so _looks_like_image accepts it (FFD8...FFD9).
_JPEG_BYTES = (
    b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    b"\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\x09\x09"
    b"\x08\x0a\x0c\x14\x0d\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a"
    b"\x1f\x1e\x1d\x1a\x1c\x1c $.' \",#\x1c\x1c(7),01444\x1f'9=82<.342"
    b"\xff\xdb\x00C\x01\x09\x09\x09\x0c\x0b\x0c\x18\x0d\x0d\x18\x32!"
    b"\"#\x1c\x1c\x1c\x1c\x1c\x1c\x1c\x1c\x1c\x1c\x1c\x1c\x1c\x1c\x1c"
    b"\x1c\x1c\x1c\x1c\x1c\x1c\x1c\x1c\x1c\x1c\x1c\x1c\x1c\x1c\x1c\x1c"
    b"\x1c\x1c\x1c\x1c\x1c\x1c\x1c\x1c\x1c\x1c\x1c\x1c\x1c\x1c\x1c\x1c"
    b"\x1c\x1c\x1c\x1c\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00"
    b"\xff\xc4\x00\x14\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
    b"\x00\x00\x00\x00\x00\x00\xff\xc4\x00\x14\x10\x01\x00\x00\x00\x00"
    b"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\xff\xda\x00"
    b"\x08\x01\x01\x00\x00?\x00\xfb\xd0\xff\xd9"
)


def _analyzer(**kwargs) -> VisionAnalyzer:
    """Create analyzer with the production default (deepseek primary)."""
    kwargs.setdefault("api_key", "minimax-key")
    kwargs.setdefault("fallback_api_key", "deepseek-key")
    return VisionAnalyzer(**kwargs)


class TestVisionPrimarySwap:
    def test_default_primary_is_deepseek(self):
        """VISION_PRIMARY env defaults to deepseek."""
        analyzer = _analyzer()
        assert analyzer._vision_primary in ("deepseek", "minimax")

    def test_deepseek_primary_path_calls__call_deepseek(self):
        analyzer = _analyzer()
        analyzer._vision_primary = "deepseek"
        with patch.object(VisionAnalyzer, "_call_deepseek", return_value=FREEFORM_OUTPUT) as primary, \
             patch.object(VisionAnalyzer, "_call_mimotalk") as fallback:
            result = analyzer.analyze_single_image(_JPEG_BYTES, "image/jpeg")

        primary.assert_called_once()
        fallback.assert_not_called()
        assert result["product_type"] == "USB 充电器"

    def test_deepseek_primary_failure_falls_back_to_minimax(self):
        analyzer = _analyzer()
        analyzer._vision_primary = "deepseek"
        with patch.object(VisionAnalyzer, "_call_deepseek", return_value=""), \
             patch.object(VisionAnalyzer, "_call_mimotalk", return_value=FREEFORM_OUTPUT) as fallback:
            result = analyzer.analyze_single_image(_JPEG_BYTES, "image/jpeg")

        fallback.assert_called_once()
        assert result["product_type"] == "USB 充电器"
        assert "error" not in result

    def test_deepseek_primary_both_failing_reports_vision_call_failed(self):
        analyzer = _analyzer()
        analyzer._vision_primary = "deepseek"
        with patch.object(VisionAnalyzer, "_call_deepseek", return_value=""), \
             patch.object(VisionAnalyzer, "_call_mimotalk", return_value=""):
            result = analyzer.analyze_single_image(_JPEG_BYTES, "image/jpeg")

        assert result["error"] == "vision_call_failed"

    def test_deepseek_primary_caches_under_deepseek_model_key(self):
        analyzer = _analyzer()
        analyzer._vision_primary = "deepseek"
        with patch.object(VisionAnalyzer, "_call_deepseek", return_value=FREEFORM_OUTPUT):
            analyzer.analyze_single_image(_JPEG_BYTES, "image/jpeg")

        cache = vision_module._get_vision_cache()
        deepseek_key = cache.cache_key(
            _JPEG_BYTES, analyzer.fallback_model, VISION_PROMPT_VERSION, None
        )
        minimax_key = cache.cache_key(
            _JPEG_BYTES, analyzer.model, VISION_PROMPT_VERSION, None
        )

        assert cache.get(deepseek_key) == FREEFORM_OUTPUT
        assert cache.get(minimax_key) is None

    def test_deepseek_primary_cache_hit_skips_both_providers(self):
        analyzer = _analyzer()
        analyzer._vision_primary = "deepseek"
        # Prime the cache via deepseek primary
        with patch.object(VisionAnalyzer, "_call_deepseek", return_value=FREEFORM_OUTPUT):
            analyzer.analyze_single_image(_JPEG_BYTES, "image/jpeg")

        # Second call should hit cache, neither provider invoked
        with patch.object(VisionAnalyzer, "_call_deepseek") as primary, \
             patch.object(VisionAnalyzer, "_call_mimotalk") as fallback:
            result = analyzer.analyze_single_image(_JPEG_BYTES, "image/jpeg")

        primary.assert_not_called()
        fallback.assert_not_called()
        assert result["product_type"] == "USB 充电器"

    def test_env_var_overrides_default(self, monkeypatch):
        monkeypatch.setenv("VISION_PRIMARY", "minimax")
        analyzer = VisionAnalyzer(api_key="k", fallback_api_key="fk")
        assert analyzer._vision_primary == "minimax"

        monkeypatch.setenv("VISION_PRIMARY", "deepseek")
        analyzer2 = VisionAnalyzer(api_key="k", fallback_api_key="fk")
        assert analyzer2._vision_primary == "deepseek"

    def test_unknown_env_value_falls_back_to_deepseek_with_warning(self, monkeypatch, caplog):
        monkeypatch.setenv("VISION_PRIMARY", "garbage")
        with caplog.at_level("WARNING", logger="rag_service.pipeline.nodes.vision"):
            analyzer = VisionAnalyzer(api_key="k", fallback_api_key="fk")
        assert analyzer._vision_primary == "deepseek"
        assert "VISION_PRIMARY" in caplog.text
