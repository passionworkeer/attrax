"""Stub test: verifies report_generator imports and instantiates correctly."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rag_service.generate.report_generator import REPORT_PACKAGE_SYSTEM_PROMPT, ReportGenerator
from rag_service.schemas.report_package import ReportPackage


def test_import():
    """Module imports without error."""
    assert ReportGenerator is not None


def test_instantiate_without_key(monkeypatch):
    """Can create instance without API key (env var cleared)."""
    monkeypatch.delenv("MINIMAX_API_KEY", raising=False)
    monkeypatch.delenv("MIMOTALK_API_KEY", raising=False)
    gen = ReportGenerator()
    assert gen.api_key == ""
    assert gen.provider == "minimax"


def test_instantiate_with_key():
    """Can create instance with explicit API key."""
    gen = ReportGenerator(api_key="sk-test-key-123")
    assert gen.api_key == "sk-test-key-123"
    assert gen.provider == "minimax"


def test_generate_empty_chunks(monkeypatch):
    """With no chunks, returns structured mock report without calling API."""
    monkeypatch.delenv("MIMOTALK_API_KEY", raising=False)
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
    monkeypatch.delenv("MIMOTALK_API_KEY", raising=False)
    gen = ReportGenerator(api_key="")
    result = gen.generate(
        query="REACH requirements?",
        product="Battery",
        market="EU",
        chunks=[{"content": "REACH Article 22 restricts lead.", "doc_name": "REACH"}],
    )
    # Should handle gracefully (mock or API call)
    assert result is not None


def test_generate_with_metadata(monkeypatch):
    """generate_with_metadata returns structured dict."""
    monkeypatch.delenv("MIMOTALK_API_KEY", raising=False)
    gen = ReportGenerator(api_key="")
    chunks = [
        {"content": "REACH restricts lead.", "doc_name": "REACH", "product": "Battery", "market": "EU"},
        {"content": "GDPR protects data.", "doc_name": "GDPR", "product": "Battery", "market": "EU"},
    ]
    result = gen.generate_with_metadata("What regulations apply?", chunks)
    assert "report" in result
    assert "chunks_used" in result
    assert "doc_names" in result
    assert result["chunks_used"] == 2
    assert "REACH" in result["doc_names"]
    assert "GDPR" in result["doc_names"]


def test_generate_report_package_fallback_is_validated(monkeypatch):
    """Unified package fallback includes the strong schema extension fields."""
    monkeypatch.delenv("MIMOTALK_API_KEY", raising=False)
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
    gen = ReportGenerator(api_key="configured")
    seen = {}

    def fake_generate(system, prompt, max_tokens):
        seen["max_tokens"] = max_tokens
        seen["prompt"] = prompt
        return "{}"

    monkeypatch.setattr(gen, "_generate_mimotalk", fake_generate)
    gen.generate_report_package(
        query="Check charger",
        product="USB charger",
        market="EU",
        chunks=[{"id": "r1", "content": "Article 1 safety", "doc_name": "LVD"}],
    )

    assert seen["max_tokens"] == 4096
    assert "7000 个字符以内" in seen["prompt"]
    assert "每条 citation 必须有 claim" in seen["prompt"]
    assert "优先保证所有 JSON 字段闭合" in seen["prompt"]


def test_generate_report_package_includes_visual_observation_without_treating_it_as_law(monkeypatch):
    gen = ReportGenerator(api_key="configured")
    seen = {}

    def fake_generate(system, prompt, max_tokens):
        seen["system"] = system
        seen["prompt"] = prompt
        return '{"complianceReport":"## Report","profitReport":{"markdown":"Unavailable"},"roadmap":{"items":[]},"decisionView":{}}'

    monkeypatch.setattr(gen, "_generate_mimotalk", fake_generate)
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

    monkeypatch.setattr(gen, "_generate_mimotalk", fake_generate)
    package = gen.generate_report_package(
        query="Check charger",
        product="USB charger",
        market="EU",
        chunks=[{"id": "r1", "content": "Article 1 safety", "doc_name": "LVD"}],
    )

    assert len(calls) == 2
    assert "严格的 JSON 修复器" in calls[1][0]
    assert package["complianceReport"] == "## Repaired"
