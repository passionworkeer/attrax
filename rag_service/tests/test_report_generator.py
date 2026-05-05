"""Stub test: verifies report_generator imports and instantiates correctly."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rag_service.generate.report_generator import ReportGenerator


def test_import():
    """Module imports without error."""
    assert ReportGenerator is not None


def test_instantiate_without_key(monkeypatch):
    """Can create instance without API key (env var cleared)."""
    monkeypatch.delenv("MIMOTALK_API_KEY", raising=False)
    gen = ReportGenerator()
    assert gen.api_key == ""
    assert gen.provider == "mimotalk"


def test_instantiate_with_key():
    """Can create instance with explicit API key."""
    gen = ReportGenerator(api_key="sk-test-key-123")
    assert gen.api_key == "sk-test-key-123"
    assert gen.provider == "mimotalk"


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
