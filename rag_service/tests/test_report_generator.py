"""Stub test: verifies report_generator imports and instantiates correctly."""
import sys, os
import json
from unittest.mock import MagicMock, patch
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rag_service.generate.report_generator import REPORT_PACKAGE_SYSTEM_PROMPT, ReportGenerator
from rag_service.schemas.report_package import ReportPackage


def _clear_llm_env(monkeypatch):
    import rag_service.config  # noqa: F401

    for name in (
        "LLM_PROVIDER", "LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL",
        "LLM_THINKING", "LLM_TIMEOUT_SECONDS", "MINIMAX_API_KEY",
        "MINIMAX_BASE_URL", "MINIMAX_MODEL", "MIMOTALK_API_KEY",
        "MIMOTALK_BASE_URL", "MIMOTALK_MODEL",
    ):
        monkeypatch.delenv(name, raising=False)


def test_import():
    """Module imports without error."""
    assert ReportGenerator is not None


def test_instantiate_without_key(monkeypatch):
    """Can create instance without API key (env var cleared)."""
    _clear_llm_env(monkeypatch)
    gen = ReportGenerator()
    assert gen.api_key == ""
    assert gen.provider == "minimax"


def test_instantiate_with_key(monkeypatch):
    """Can create instance with explicit API key."""
    _clear_llm_env(monkeypatch)
    gen = ReportGenerator(api_key="sk-test-key-123")
    assert gen.api_key == "sk-test-key-123"
    assert gen.provider == "minimax"


def test_review_claims_survive_report_normalization(monkeypatch):
    _clear_llm_env(monkeypatch)
    gen = ReportGenerator(api_key="test")
    claims = [{
        "market": "EU",
        "checkId": "common.nameplate.readability",
        "status": "unknown",
        "reason": "Needs a clearer label",
    }]
    result = gen._normalize_report_package(
        {
            "complianceReport": "report",
            "profitReport": {"markdown": "No cost inputs"},
            "reviewClaims": claims,
        },
        "charger", "EU", "review", [],
    )
    assert result["reviewClaims"] == claims


@patch("rag_service.generate.report_generator._NO_PROXY_OPENER")
def test_report_reader_skips_thinking_block_and_returns_text_block(mock_opener, monkeypatch):
    _clear_llm_env(monkeypatch)
    mock_response = MagicMock()
    mock_response.__enter__ = MagicMock(return_value=mock_response)
    mock_response.__exit__ = MagicMock(return_value=False)
    mock_response.read.return_value = json.dumps({
        "content": [
            {"type": "thinking", "thinking": "hidden reasoning", "signature": "sig"},
            {"type": "text", "text": '{"complianceReport":"ok"}'},
        ]
    }).encode("utf-8")
    mock_opener.open.return_value = mock_response
    gen = ReportGenerator(api_key="test-key")

    result = gen._read_llm_response(MagicMock())

    assert result == '{"complianceReport":"ok"}'
    assert mock_opener.open.call_args.kwargs["timeout"] == 240


def test_generate_empty_chunks(monkeypatch):
    """With no chunks, returns structured mock report without calling API."""
    _clear_llm_env(monkeypatch)
    gen = ReportGenerator(api_key="")
    result = gen.generate(
        query="What are the REACH requirements?",
        product="Battery",
        market="EU",
        chunks=[],
    )
    # Should return mock report (not a network call)
    assert "Battery" in result or "EU" in result
    assert "⚠️" in result  # Mock report contains warning emoji


def test_generate_with_chunks_no_api_key(monkeypatch):
    """With no API key, returns mock report."""
    _clear_llm_env(monkeypatch)
    gen = ReportGenerator(api_key="")
    result = gen.generate(
        query="REACH requirements?",
        product="Battery",
        market="EU",
        chunks=[{"content": "REACH Article 22 restricts lead.", "doc_name": "REACH"}],
    )
    # Should handle gracefully (mock or API call)
    assert result is not None


def test_generate_report_package_fallback_is_validated(monkeypatch):
    """Unified package fallback includes the strong schema extension fields."""
    _clear_llm_env(monkeypatch)
    gen = ReportGenerator(api_key="")

    package = gen.generate_report_package(
        query="What certifications are needed?",
        product="Power bank",
        market="EU",
        chunks=[],
    )

    validated = ReportPackage.model_validate(package)
    assert validated.complianceReport
    assert validated.productDossier.product == "Power bank"
    assert validated.evidenceBundles.generation
    assert validated.auditMetadata.schemaVersion == "report-package/v1"


def test_generate_report_package_caps_default_output_for_interactive_latency(monkeypatch):
    _clear_llm_env(monkeypatch)
    gen = ReportGenerator(api_key="configured")
    seen = {}

    def fake_generate(system, prompt, max_tokens):
        seen["max_tokens"] = max_tokens
        seen["prompt"] = prompt
        return "{}"

    monkeypatch.setattr(gen, "_generate_llm", fake_generate)
    gen.generate_report_package(
        query="Check charger",
        product="USB charger",
        market="EU",
        chunks=[{"id": "r1", "content": "Article 1 safety", "doc_name": "LVD"}],
    )

    assert seen["max_tokens"] == 6144
    assert "12000 个字符以内" in seen["prompt"]
    assert "每条 citation 必须有 claim" in seen["prompt"]
    assert "优先保证所有 JSON 字段闭合" in seen["prompt"]


def test_generate_report_package_caps_qwen_output_to_finish_interactively(monkeypatch):
    _clear_llm_env(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "qwen")
    monkeypatch.setenv("LLM_API_KEY", "configured")
    monkeypatch.setenv("LLM_MODEL", "qwen3.8-max-0902")
    gen = ReportGenerator()
    seen = {}

    def fake_generate(system, prompt, max_tokens):
        seen["max_tokens"] = max_tokens
        seen["prompt"] = prompt
        return "{}"

    monkeypatch.setattr(gen, "_generate_llm", fake_generate)
    gen.generate_report_package(
        query="Check power bank",
        product="Power bank",
        market="EU",
        chunks=[{"id": "r1", "content": "Battery safety", "doc_name": "Battery Regulation"}],
        max_tokens=4096,
    )

    assert seen["max_tokens"] == 4096
    assert "整个 JSON 控制在 12000 个字符以内" in seen["prompt"]
    assert "complianceReport 不超过 500 个汉字" in seen["prompt"]
    assert "reviewClaims不可省略" in seen["prompt"]


def test_generate_report_package_includes_visual_observation_without_treating_it_as_law(monkeypatch):
    gen = ReportGenerator(api_key="configured")
    seen = {}

    def fake_generate(system, prompt, max_tokens):
        seen["system"] = system
        seen["prompt"] = prompt
        return '{"complianceReport":"## Report","profitReport":{"markdown":"Unavailable"},"roadmap":{"items":[]},"decisionView":{}}'

    monkeypatch.setattr(gen, "_generate_llm", fake_generate)
    gen.generate_report_package(
        query="Check charger",
        product="USB charger",
        market="EU",
        chunks=[{"id": "r1", "content": "Article 1 safety", "doc_name": "LVD"}],
        vision_context="- 图片无法验证：铭牌区域未展示\n- 可见特征：USB-C 接口",
    )

    assert "视觉观察（仅代表图片可见内容，不是法规或认证结论）" in seen["prompt"]
    assert "铭牌区域未展示" in seen["prompt"]
    assert "图片未展示或无法辨认" in seen["system"]


def test_report_package_prompt_treats_unreadable_visual_evidence_as_warn_not_rejection():
    """A blurry label is an evidence gap, never a fabricated non-compliance finding."""
    assert "WARN — 产品类别和适用法规已可判断" in REPORT_PACKAGE_SYSTEM_PROMPT
    assert "绝不能触发 REJECTED" in REPORT_PACKAGE_SYSTEM_PROMPT
    assert "severity 为 medium" in REPORT_PACKAGE_SYSTEM_PROMPT


def test_generate_report_package_repairs_malformed_json_once(monkeypatch):
    gen = ReportGenerator(api_key="configured")
    calls = []

    def fake_generate(system, prompt, max_tokens):
        calls.append((system, prompt))
        if len(calls) == 1:
            return '{"complianceReport":'
        return '{"complianceReport":"## Repaired","profitReport":{"markdown":"Unavailable"},"roadmap":{"items":[]},"decisionView":{}}'

    monkeypatch.setattr(gen, "_generate_llm", fake_generate)
    package = gen.generate_report_package(
        query="Check charger",
        product="USB charger",
        market="EU",
        chunks=[{"id": "r1", "content": "Article 1 safety", "doc_name": "LVD"}],
    )

    assert len(calls) == 2
    assert "严格的 JSON 修复器" in calls[1][0]
    assert package["complianceReport"] == "## Repaired"
