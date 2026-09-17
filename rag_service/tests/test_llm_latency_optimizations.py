"""Latency optimizations: vision image downscale + thinking-mode control."""

import io

import pytest

from rag_service.pipeline.nodes.vision import VisionAnalyzer, _maybe_downscale
from rag_service.pipeline.nodes import vision as vision_module


def _jpeg_bytes(width: int, height: int, color=(120, 40, 200)) -> bytes:
    from PIL import Image

    img = Image.new("RGB", (width, height), color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


class TestMaybeDownscale:
    def test_small_image_passes_through_byte_identical(self):
        original = _jpeg_bytes(800, 600)
        assert _maybe_downscale(original) == original

    def test_oversized_image_is_resized_to_max_side(self):
        big = _jpeg_bytes(4000, 3000)
        out = _maybe_downscale(big)
        assert out != big
        assert len(out) < len(big)
        from PIL import Image

        with Image.open(io.BytesIO(out)) as img:
            assert max(img.size) == 1568

    def test_alpha_image_is_flattened_to_jpeg(self):
        from PIL import Image

        img = Image.new("RGBA", (3200, 100), (10, 200, 30, 128))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        out = _maybe_downscale(buf.getvalue())
        with Image.open(io.BytesIO(out)) as result:
            assert result.mode == "RGB"
            assert max(result.size) == 1568

    def test_corrupt_bytes_returned_unchanged(self):
        junk = b"this is not an image at all"
        assert _maybe_downscale(junk) == junk

    def test_empty_bytes_returned_unchanged(self):
        assert _maybe_downscale(b"") == b""


class TestDeepSeekVisionFallbackDisablesThinking:
    def test_request_body_carries_thinking_disabled(self, monkeypatch):
        """The OpenAI-compat fallback body must carry thinking disabled —
        deepseek-flash thinks at effort=high by default, which is wasted
        latency on a mechanical extraction task."""
        captured = {}

        def fake_post(self, url, api_key, body, headers=None):
            captured["body"] = json.loads(body)
            return {
                "choices": [
                    {"message": {"content": "ok"}}
                ]
            }

        import json

        monkeypatch.setattr(vision_module, "json", json, raising=False)
        monkeypatch.setattr(VisionAnalyzer, "_post_json", fake_post)
        analyzer = VisionAnalyzer(None)
        analyzer.fallback_api_key = "k"
        analyzer.fallback_base_url = "https://fb.example"
        analyzer.fallback_model = "deepseek-flash"
        analyzer.fallback_max_tokens = 4096

        text = analyzer._call_deepseek(
            [{"role": "user", "content": [{"type": "text", "text": "hi"}]}]
        )
        assert text == "ok"
        assert captured["body"]["thinking"] == {"type": "disabled"}


class TestMinimaxThinkingModeEnv:
    def _body_sent(self, monkeypatch, env_value):
        import json

        captured = {}

        def fake_post(self, url, api_key, body, headers=None):
            captured["body"] = json.loads(body)
            return {"content": [{"type": "text", "text": "answer"}]}

        monkeypatch.setattr(VisionAnalyzer, "_post_json", fake_post)
        if env_value is None:
            monkeypatch.delenv("MINIMAX_THINKING_MODE", raising=False)
        else:
            monkeypatch.setenv("MINIMAX_THINKING_MODE", env_value)
        analyzer = VisionAnalyzer("k")
        analyzer.model = "MiniMax-M3"
        analyzer.base_url = "https://mm.example/anthropic/v1"
        analyzer._call_mimotalk([{"role": "user", "content": "hi"}])
        return captured["body"]

    def test_default_omits_thinking_param(self, monkeypatch):
        assert "thinking" not in self._body_sent(monkeypatch, None)

    def test_disabled_env_sets_thinking_disabled(self, monkeypatch):
        body = self._body_sent(monkeypatch, "disabled")
        assert body["thinking"] == {"type": "disabled"}

    def test_adaptive_env_omits_thinking_param(self, monkeypatch):
        assert "thinking" not in self._body_sent(monkeypatch, "adaptive")


class TestGenerateFallbackDisablesThinking:
    def test_fallback_body_sets_reasoning_effort_none(self, monkeypatch):
        """Measured A/B on the real report-package prompt: effort=high 41.2s
        vs effort=none 24.9s with equivalent output length."""
        import json

        from rag_service.generate.report_generator import ReportGenerator

        captured = {}

        def fake_read(self, req):
            captured["body"] = json.loads(req.data.decode("utf-8"))
            return '{"complianceReport": "x"}'

        monkeypatch.setattr(ReportGenerator, "_read_mimotalk_response", fake_read)
        gen = ReportGenerator(api_key=None)
        gen.fallback_api_key = "k"
        gen.fallback_base_url = "https://fb.example/anthropic/v1"
        gen.fallback_model = "deepseek-flash"
        gen.fallback_max_tokens = 16384

        gen._generate_fallback("sys", "user", 4096)
        assert captured["body"]["reasoning"] == {"effort": "none"}
        assert captured["body"]["max_tokens"] == 16384


@pytest.mark.parametrize("bad", [b"", b"\x00" * 32])
def test_downscale_never_raises_on_garbage(bad):
    assert _maybe_downscale(bad) == bad
