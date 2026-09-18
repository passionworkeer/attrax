"""Vision provider fallback tests (2026-09-16).

The vision layer is MiniMax-primary with a DeepSeek (OpenAI-compatible)
degradation path. These tests pin the three things that would silently break
a scan if they regressed:

1. the Anthropic→OpenAI message translation (image blocks must become data URLs)
2. the degrade trigger (primary empty → fallback called exactly once)
3. cache layering (a fallback answer must not be served as a primary answer)

``conftest.py`` clears DEEPSEEK_* for every test, so nothing here can reach the
live endpoint by accident — the fallback tests set the key explicitly.
"""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from rag_service.config import resolve_deepseek_config
from rag_service.pipeline.nodes import vision as vision_module
from rag_service.pipeline.nodes.vision import (
    VISION_PROMPT_VERSION,
    VisionAnalyzer,
    _to_openai_messages,
)

_JPEG_BYTES = b"\xff\xd8\xff\xe0" + b"\x00" * 12

FREEFORM_OUTPUT = """{
  "product_type": "USB 充电器",
  "identity_confidence": "high",
  "core_features": ["USB-C 接口"],
  "visible_certification_marks": ["CE"],
  "unreadable_or_missing_evidence": [],
  "questions_needed": []
}"""

CHECKLIST_OUTPUT = """{
  "product_type": "USB 充电器",
  "identity_confidence": "medium",
  "core_features": [],
  "visible_certification_marks": [],
  "questions_needed": [],
  "observations": [
    {
      "check_id": "c1",
      "visibility": "present_readable",
      "observed_text": "USB-C",
      "description": "铭牌可见",
      "bbox": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2}
    }
  ]
}"""


def _analyzer(**kwargs) -> VisionAnalyzer:
    kwargs.setdefault("api_key", "primary-key")
    kwargs.setdefault("fallback_api_key", "fallback-key")
    analyzer = VisionAnalyzer(**kwargs)
    # Legacy tests in this module assume MiniMax as primary (the original
    # behavior before VISION_PRIMARY env was added). Force that here so
    # existing assertions about primary = _call_mimotalk still hold.
    # Tests for the new "deepseek primary" default live in
    # test_vision_primary_swap.py.
    analyzer._vision_primary = "minimax"
    return analyzer


def _stub_openai_response(mock_opener, text: str = "ok") -> MagicMock:
    """Point the patched opener at a canned OpenAI-shaped chat response."""
    response = MagicMock()
    response.__enter__ = MagicMock(return_value=response)
    response.__exit__ = MagicMock(return_value=False)
    response.read.return_value = json.dumps(
        {"choices": [{"message": {"content": text}}]}, ensure_ascii=False
    ).encode("utf-8")
    mock_opener.open.return_value = response
    return response


# ─────────────────────────────────────────────
#  Config resolution
# ─────────────────────────────────────────────

class TestResolveDeepSeekConfig:
    def test_reads_process_env(self, monkeypatch):
        monkeypatch.setenv("DEEPSEEK_API_KEY", "fb-key")
        monkeypatch.setenv("DEEPSEEK_BASE_URL", "https://fb.example/v1")
        monkeypatch.setenv("DEEPSEEK_MODEL", "fb-model")
        monkeypatch.setenv("DEEPSEEK_MAX_TOKENS", "2048")

        assert resolve_deepseek_config() == (
            "fb-key",
            "https://fb.example/v1",
            "fb-model",
            2048,
            "https://api.deepseek.com/anthropic/v1",
        )

    def test_blank_base_url_and_model_fall_back_to_defaults(self, monkeypatch):
        monkeypatch.setenv("DEEPSEEK_BASE_URL", "")
        monkeypatch.setenv("DEEPSEEK_MODEL", "  ")

        _, base_url, model, _, _ = resolve_deepseek_config()

        assert base_url == "https://api.deepseek.com"
        assert model == "deepseek-flash"

    def test_explicit_empty_key_disables_fallback(self):
        assert resolve_deepseek_config("")[0] == ""

    def test_trailing_slash_is_trimmed(self, monkeypatch):
        monkeypatch.setenv("DEEPSEEK_BASE_URL", "https://fb.example/v1/")

        assert resolve_deepseek_config()[1] == "https://fb.example/v1"

    def test_default_budget_leaves_room_for_reasoning(self):
        """deepseek-flash bills reasoning_content against the completion budget.

        Measured reasoning spend on one nameplate photo ranged 1.2k–4.9k tokens,
        so the default must sit well above the primary provider's 3072.
        """
        _, _, _, max_tokens, _ = resolve_deepseek_config()

        assert max_tokens == 16384
        assert max_tokens > 3072

    def test_anthropic_base_url_keeps_its_version_segment(self):
        """The generator appends '/messages', so the base must carry '/v1'."""
        _, _, _, _, anthropic_base = resolve_deepseek_config()

        assert anthropic_base == "https://api.deepseek.com/anthropic/v1"
        assert anthropic_base.endswith("/v1")

    def test_non_positive_budget_falls_back_to_default(self, monkeypatch):
        monkeypatch.setenv("DEEPSEEK_MAX_TOKENS", "0")

        assert resolve_deepseek_config()[3] == 16384


# ─────────────────────────────────────────────
#  Message translation
# ─────────────────────────────────────────────

class TestToOpenAiMessages:
    def test_image_block_becomes_data_url(self):
        messages = [{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": "QUJD",
                    },
                },
                {"type": "text", "text": "这张图片里有什么？"},
            ],
        }]

        converted = _to_openai_messages(messages)

        blocks = converted[0]["content"]
        assert blocks[0] == {
            "type": "image_url",
            "image_url": {"url": "data:image/png;base64,QUJD"},
        }
        assert blocks[1] == {"type": "text", "text": "这张图片里有什么？"}

    def test_missing_media_type_defaults_to_jpeg(self):
        messages = [{
            "role": "user",
            "content": [{"type": "image", "source": {"data": "QUJD"}}],
        }]

        url = _to_openai_messages(messages)[0]["content"][0]["image_url"]["url"]

        assert url == "data:image/jpeg;base64,QUJD"

    def test_string_content_message_passes_through(self):
        messages = [{"role": "user", "content": "plain text"}]

        assert _to_openai_messages(messages) == messages

    def test_input_messages_are_not_mutated(self):
        messages = [{
            "role": "user",
            "content": [{"type": "image", "source": {"data": "QUJD"}}],
        }]

        _to_openai_messages(messages)

        assert messages[0]["content"][0]["type"] == "image"


# ─────────────────────────────────────────────
#  _call_deepseek transport
# ─────────────────────────────────────────────

class TestCallDeepSeek:
    @patch("rag_service.pipeline.nodes.vision._NO_PROXY_OPENER")
    def test_parses_openai_choice_shape(self, mock_opener):
        mock_response = MagicMock()
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)
        mock_response.read.return_value = (
            b'{"choices":[{"message":{"content":"observed text"}}]}'
        )
        mock_opener.open.return_value = mock_response

        result = _analyzer()._call_deepseek([{"role": "user", "content": []}])

        assert result == "observed text"

    @patch("rag_service.pipeline.nodes.vision._NO_PROXY_OPENER")
    def test_posts_to_chat_completions_with_data_url(self, mock_opener):
        mock_response = MagicMock()
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)
        mock_response.read.return_value = b'{"choices":[{"message":{"content":"x"}}]}'
        mock_opener.open.return_value = mock_response

        analyzer = _analyzer()
        analyzer._call_deepseek([{
            "role": "user",
            "content": [
                {"type": "image", "source": {"media_type": "image/png", "data": "QUJD"}},
                {"type": "text", "text": "look"},
            ],
        }])

        request = mock_opener.open.call_args[0][0]
        assert request.full_url == "https://api.deepseek.com/chat/completions"
        body = json.loads(request.data.decode("utf-8"))
        assert body["model"] == analyzer.fallback_model
        assert body["messages"][0]["content"][0]["image_url"]["url"] == (
            "data:image/png;base64,QUJD"
        )

    def test_no_fallback_key_returns_empty_without_network(self):
        analyzer = _analyzer(fallback_api_key="")

        assert analyzer._call_deepseek([{"role": "user", "content": []}]) == ""

    @patch("rag_service.pipeline.nodes.vision._NO_PROXY_OPENER")
    def test_uses_the_fallback_budget_by_default(self, mock_opener, monkeypatch):
        monkeypatch.setenv("DEEPSEEK_MAX_TOKENS", "9000")
        _stub_openai_response(mock_opener)

        analyzer = _analyzer()
        analyzer._call_deepseek([{"role": "user", "content": []}])

        body = json.loads(mock_opener.open.call_args[0][0].data.decode("utf-8"))
        assert body["max_tokens"] == 9000

    @patch("rag_service.pipeline.nodes.vision._NO_PROXY_OPENER")
    def test_explicit_budget_overrides_the_default(self, mock_opener):
        _stub_openai_response(mock_opener)

        _analyzer()._call_deepseek([{"role": "user", "content": []}], max_tokens=512)

        body = json.loads(mock_opener.open.call_args[0][0].data.decode("utf-8"))
        assert body["max_tokens"] == 512

    @patch("rag_service.pipeline.nodes.vision._NO_PROXY_OPENER")
    def test_primary_budget_is_not_forwarded_to_the_fallback(self, mock_opener):
        """The checklist primary asks for 3072; the fallback needs its own budget."""
        _stub_openai_response(mock_opener)

        analyzer = _analyzer()
        checks = [{"id": "c1", "title": "铭牌可读性"}]
        with patch.object(VisionAnalyzer, "_call_mimotalk", return_value=""):
            analyzer.analyze_single_image_with_checks(_JPEG_BYTES, "image/jpeg", checks)

        body = json.loads(mock_opener.open.call_args[0][0].data.decode("utf-8"))
        assert body["max_tokens"] == analyzer.fallback_max_tokens == 16384

    @patch("rag_service.pipeline.nodes.vision._NO_PROXY_OPENER")
    def test_reasoning_exhausted_budget_is_reported_not_silent(self, mock_opener, caplog):
        """HTTP 200 + empty content + reasoning means a budget problem."""
        mock_response = MagicMock()
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)
        mock_response.read.return_value = (
            b'{"choices":[{"message":{"content":"","reasoning_content":"thinking..."}}]}'
        )
        mock_opener.open.return_value = mock_response

        with caplog.at_level("ERROR"):
            result = _analyzer()._call_deepseek([{"role": "user", "content": []}])

        assert result == ""
        assert "DEEPSEEK_MAX_TOKENS" in caplog.text


# ─────────────────────────────────────────────
#  Degrade behavior
# ─────────────────────────────────────────────

class TestFallbackDegradation:
    def test_primary_success_never_calls_fallback(self):
        analyzer = _analyzer()
        with patch.object(
            VisionAnalyzer, "_call_mimotalk", return_value=FREEFORM_OUTPUT
        ), patch.object(VisionAnalyzer, "_call_deepseek") as fallback:
            result = analyzer.analyze_single_image(_JPEG_BYTES, "image/jpeg")

        fallback.assert_not_called()
        assert result["product_type"] == "USB 充电器"

    def test_falls_back_when_primary_returns_nothing(self):
        analyzer = _analyzer()
        with patch.object(
            VisionAnalyzer, "_call_mimotalk", return_value=""
        ), patch.object(
            VisionAnalyzer, "_call_deepseek", return_value=FREEFORM_OUTPUT
        ) as fallback:
            result = analyzer.analyze_single_image(_JPEG_BYTES, "image/jpeg")

        fallback.assert_called_once()
        assert result["product_type"] == "USB 充电器"
        assert [c["mark"] for c in result["certifications"]] == ["CE"]
        assert "error" not in result

    def test_checklist_path_also_degrades(self):
        analyzer = _analyzer()
        checks = [{"id": "c1", "title": "铭牌可读性"}]
        with patch.object(
            VisionAnalyzer, "_call_mimotalk", return_value=""
        ), patch.object(
            VisionAnalyzer, "_call_deepseek", return_value=CHECKLIST_OUTPUT
        ) as fallback:
            result = analyzer.analyze_single_image_with_checks(
                _JPEG_BYTES, "image/jpeg", checks
            )

        fallback.assert_called_once()
        assert result["observations"][0]["check_id"] == "c1"

    def test_both_providers_failing_reports_vision_call_failed(self):
        analyzer = _analyzer()
        with patch.object(
            VisionAnalyzer, "_call_mimotalk", return_value=""
        ), patch.object(VisionAnalyzer, "_call_deepseek", return_value=""):
            result = analyzer.analyze_single_image(_JPEG_BYTES, "image/jpeg")

        assert result["error"] == "vision_call_failed"

    def test_unconfigured_fallback_reports_vision_call_failed(self):
        analyzer = _analyzer(fallback_api_key="")
        with patch.object(
            VisionAnalyzer, "_call_mimotalk", return_value=""
        ), patch.object(VisionAnalyzer, "_call_deepseek") as fallback:
            result = analyzer.analyze_single_image(_JPEG_BYTES, "image/jpeg")

        fallback.assert_not_called()
        assert result["error"] == "vision_call_failed"

    def test_fallback_only_deployment_still_analyzes(self):
        """A deployment with no primary key must not go image-blind."""
        analyzer = VisionAnalyzer(api_key="", fallback_api_key="fallback-key")
        assert analyzer.available is True

        with patch.object(
            VisionAnalyzer, "_call_deepseek", return_value=FREEFORM_OUTPUT
        ) as fallback:
            result = analyzer.analyze_single_image(_JPEG_BYTES, "image/jpeg")

        fallback.assert_called_once()
        assert result["product_type"] == "USB 充电器"

    def test_no_credentials_means_unavailable(self):
        analyzer = VisionAnalyzer(api_key="", fallback_api_key="")

        assert analyzer.available is False
        assert analyzer.analyze_single_image(_JPEG_BYTES, "image/jpeg")["error"] == "no_api_key"
        assert analyzer.analyze_images(
            [{"buffer": _JPEG_BYTES, "mime_type": "image/jpeg"}]
        )["images_analyzed"] == 0


# ─────────────────────────────────────────────
#  Cache layering
# ─────────────────────────────────────────────

class TestFallbackCacheLayering:
    def test_fallback_text_is_cached_under_its_own_provider_key(self):
        analyzer = _analyzer()
        with patch.object(
            VisionAnalyzer, "_call_mimotalk", return_value=""
        ), patch.object(
            VisionAnalyzer, "_call_deepseek", return_value=FREEFORM_OUTPUT
        ):
            analyzer.analyze_single_image(_JPEG_BYTES, "image/jpeg")

        cache = vision_module._get_vision_cache()
        primary_key = cache.cache_key(
            _JPEG_BYTES, analyzer.model, VISION_PROMPT_VERSION, None
        )
        fallback_key = cache.cache_key(
            _JPEG_BYTES, analyzer.fallback_model, VISION_PROMPT_VERSION, None
        )

        assert cache.get(primary_key) is None
        assert cache.get(fallback_key) == FREEFORM_OUTPUT

    def test_cached_fallback_answer_avoids_a_second_fallback_call(self):
        """The primary is retried (it may have recovered); the fallback is not.

        Primary-first is deliberate: the fallback is a degradation, so its
        cached answer must never pre-empt a recovered primary provider.
        """
        analyzer = _analyzer()
        with patch.object(VisionAnalyzer, "_call_mimotalk", return_value=""), patch.object(
            VisionAnalyzer, "_call_deepseek", return_value=FREEFORM_OUTPUT
        ) as fallback:
            analyzer.analyze_single_image(_JPEG_BYTES, "image/jpeg")
            with patch.object(
                VisionAnalyzer, "_call_mimotalk", return_value=""
            ) as primary:
                second = analyzer.analyze_single_image(_JPEG_BYTES, "image/jpeg")

        assert primary.call_count == 1
        assert fallback.call_count == 1
        assert second["product_type"] == "USB 充电器"

    def test_primary_cache_hit_skips_both_providers(self):
        analyzer = _analyzer()
        with patch.object(
            VisionAnalyzer, "_call_mimotalk", return_value=FREEFORM_OUTPUT
        ):
            analyzer.analyze_single_image(_JPEG_BYTES, "image/jpeg")

        with patch.object(
            VisionAnalyzer, "_call_mimotalk", return_value=""
        ) as primary, patch.object(
            VisionAnalyzer, "_call_deepseek", return_value=""
        ) as fallback:
            result = analyzer.analyze_single_image(_JPEG_BYTES, "image/jpeg")

        primary.assert_not_called()
        fallback.assert_not_called()
        assert result["product_type"] == "USB 充电器"


if __name__ == "__main__":  # pragma: no cover
    pytest.main([__file__, "-v"])
