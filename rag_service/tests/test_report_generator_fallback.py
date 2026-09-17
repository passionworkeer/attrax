"""Report-generation fallback tests (2026-09-16).

The generator is MiniMax-primary with a DeepSeek degradation path so that a
full MiniMax outage still yields a real report instead of a mock package.
These tests pin the four things that would silently break that:

1. block-by-type response reading (DeepSeek prefixes the answer with a
   ``thinking`` block, so positional reading returns "")
2. the degrade trigger and its budget floor
3. the primary attempt cap — without it, 3 x 90s + backoff exceeds the scan
   budget and the fallback is never reached
4. provider provenance, so a fallback-served report is not labelled MiniMax

``conftest.py`` clears DEEPSEEK_* for every test, so nothing here reaches a
live endpoint by accident — the fallback tests set the key explicitly.
"""
from __future__ import annotations

import json
import urllib.error
from unittest.mock import MagicMock, patch

import pytest

from rag_service.generate.report_generator import ReportGenerator

PRIMARY_TEXT = '{"complianceReport": "primary answer"}'


def _generator(with_fallback: bool = True) -> ReportGenerator:
    gen = ReportGenerator(api_key="primary-key")
    gen.api_key = "primary-key"
    gen.base_url = "https://primary.example/v1"
    gen.model = "primary-model"
    gen._primary_provider = "minimax"
    gen.fallback_api_key = "fallback-key" if with_fallback else ""
    gen.fallback_base_url = "https://fallback.example/anthropic/v1"
    gen.fallback_model = "fallback-model"
    gen.fallback_max_tokens = 16384
    return gen


def _response(payload: dict) -> MagicMock:
    response = MagicMock()
    response.__enter__ = MagicMock(return_value=response)
    response.__exit__ = MagicMock(return_value=False)
    response.read.return_value = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    return response


def _text_blocks(*texts: str) -> dict:
    return {"content": [{"type": "text", "text": t} for t in texts]}


# ─────────────────────────────────────────────
#  Response reading (block-by-type)
# ─────────────────────────────────────────────

class TestResponseReading:
    @patch("rag_service.generate.report_generator._NO_PROXY_OPENER")
    def test_reads_text_block_not_position_zero(self, mock_opener):
        """DeepSeek puts a thinking block first; block 0 is NOT the answer."""
        mock_opener.open.return_value = _response({
            "content": [
                {"type": "thinking", "thinking": "let me think", "signature": "x"},
                {"type": "text", "text": "the real answer"},
            ],
        })
        gen = _generator()

        result = gen._read_mimotalk_response(MagicMock())

        assert result == "the real answer"

    @patch("rag_service.generate.report_generator._NO_PROXY_OPENER")
    def test_concatenates_multiple_text_blocks(self, mock_opener):
        mock_opener.open.return_value = _response({
            "content": [
                {"type": "text", "text": "part one "},
                {"type": "thinking", "thinking": "hmm"},
                {"type": "text", "text": "part two"},
            ],
        })

        assert _generator()._read_mimotalk_response(MagicMock()) == "part one part two"

    @patch("rag_service.generate.report_generator._NO_PROXY_OPENER")
    def test_single_text_block_still_works(self, mock_opener):
        """MiniMax's shape — the pre-existing behaviour must not regress."""
        mock_opener.open.return_value = _response(_text_blocks("minimax answer"))

        assert _generator()._read_mimotalk_response(MagicMock()) == "minimax answer"

    @patch("rag_service.generate.report_generator._NO_PROXY_OPENER")
    def test_thinking_only_response_raises_empty(self, mock_opener):
        """A reasoning-only response proves the budget was exhausted."""
        mock_opener.open.return_value = _response({
            "content": [{"type": "thinking", "thinking": "ran out of budget"}],
        })

        with pytest.raises(ValueError, match="empty response"):
            _generator()._read_mimotalk_response(MagicMock())


# ─────────────────────────────────────────────
#  Degrade behaviour
# ─────────────────────────────────────────────

class TestGenerationFallback:
    @patch("rag_service.generate.report_generator._NO_PROXY_OPENER")
    def test_primary_success_never_touches_fallback(self, mock_opener):
        mock_opener.open.return_value = _response(_text_blocks(PRIMARY_TEXT))
        gen = _generator()

        result = gen._generate_mimotalk("sys", "user", 4096)

        assert result == PRIMARY_TEXT
        assert gen.provider == "minimax"
        assert mock_opener.open.call_count == 1

    @patch("rag_service.generate.report_generator._NO_PROXY_OPENER")
    def test_falls_back_when_primary_raises(self, mock_opener):
        mock_opener.open.side_effect = [
            urllib.error.HTTPError("u", 401, "Unauthorized", {}, MagicMock()),
            _response(_text_blocks('{"complianceReport": "fallback answer"}')),
        ]
        gen = _generator()

        result = gen._generate_mimotalk("sys", "user", 4096)

        assert result == '{"complianceReport": "fallback answer"}'
        assert gen.provider == "deepseek"

    @patch("rag_service.generate.report_generator._NO_PROXY_OPENER")
    def test_fallback_request_targets_anthropic_endpoint_with_budget_floor(
        self, mock_opener
    ):
        mock_opener.open.side_effect = [
            urllib.error.HTTPError("u", 500, "boom", {}, MagicMock()),
            _response(_text_blocks("ok")),
        ]
        gen = _generator()

        gen._generate_mimotalk("sys", "user", 4096)

        fallback_req = mock_opener.open.call_args_list[1][0][0]
        assert fallback_req.full_url == "https://fallback.example/anthropic/v1/messages"
        body = json.loads(fallback_req.data.decode("utf-8"))
        assert body["model"] == "fallback-model"
        assert body["max_tokens"] == 16384  # floor, not the primary's 4096
        assert body["system"] == "sys"

    @patch("rag_service.generate.report_generator._NO_PROXY_OPENER")
    def test_explicit_budget_above_the_floor_is_kept(self, mock_opener):
        mock_opener.open.side_effect = [
            urllib.error.HTTPError("u", 500, "boom", {}, MagicMock()),
            _response(_text_blocks("ok")),
        ]

        _generator()._generate_mimotalk("sys", "user", 32768)

        body = json.loads(mock_opener.open.call_args_list[1][0][0].data.decode("utf-8"))
        assert body["max_tokens"] == 32768

    @patch("rag_service.generate.report_generator._NO_PROXY_OPENER")
    def test_both_providers_failing_reraises_the_primary_failure(self, mock_opener):
        primary = urllib.error.HTTPError("u", 401, "Unauthorized", {}, MagicMock())
        mock_opener.open.side_effect = [
            primary,
            urllib.error.HTTPError("u", 500, "fallback boom", {}, MagicMock()),
        ]
        gen = _generator()

        with pytest.raises(urllib.error.HTTPError):
            gen._generate_mimotalk("sys", "user", 4096)

    @patch("rag_service.generate.report_generator._NO_PROXY_OPENER")
    def test_no_fallback_configured_keeps_the_old_raise_behaviour(self, mock_opener):
        mock_opener.open.side_effect = urllib.error.HTTPError(
            "u", 401, "Unauthorized", {}, MagicMock()
        )
        gen = _generator(with_fallback=False)

        with pytest.raises(urllib.error.HTTPError):
            gen._generate_mimotalk("sys", "user", 4096)
        assert mock_opener.open.call_count == 1


# ─────────────────────────────────────────────
#  Attempt budget (the fallback must be reachable)
# ─────────────────────────────────────────────

class TestAttemptBudget:
    @patch("rag_service.generate.report_generator._NO_PROXY_OPENER")
    def test_primary_is_attempted_once_when_a_fallback_exists(self, mock_opener):
        """3 x 90s + backoff (~273s) would blow the 280s scan budget.

        The primary must fail fast so the fallback actually gets reached on the
        timeout-class outage it exists for.
        """
        mock_opener.open.side_effect = [
            urllib.error.URLError("timed out"),
            _response(_text_blocks("fallback served")),
        ]
        gen = _generator()

        with patch("rag_service.generate.report_generator.time.sleep") as sleep:
            result = gen._generate_mimotalk("sys", "user", 4096)

        assert result == "fallback served"
        assert mock_opener.open.call_count == 2  # 1 primary + 1 fallback
        sleep.assert_not_called()

    @patch("rag_service.generate.report_generator._NO_PROXY_OPENER")
    def test_transient_retries_still_happen_without_a_fallback(self, mock_opener):
        """The retry budget is untouched for deployments with no fallback key."""
        mock_opener.open.side_effect = [
            urllib.error.URLError("blip"),
            _response(_text_blocks("recovered")),
        ]
        gen = _generator(with_fallback=False)

        with patch("rag_service.generate.report_generator.time.sleep"):
            result = gen._generate_mimotalk("sys", "user", 4096)

        assert result == "recovered"
        assert mock_opener.open.call_count == 2


if __name__ == "__main__":  # pragma: no cover
    pytest.main([__file__, "-v"])
