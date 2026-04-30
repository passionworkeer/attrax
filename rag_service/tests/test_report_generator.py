"""Stub test: verifies report_generator imports and instantiates correctly."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rag_service.generate.report_generator import ReportGenerator


def test_import():
    """Module imports without error."""
    assert ReportGenerator is not None


def test_instantiate_without_key():
    """Can create instance without API key (lazy client init)."""
    gen = ReportGenerator()
    assert gen.api_key == ""
    assert gen._client is None


def test_instantiate_with_key():
    """Can create instance with explicit API key."""
    gen = ReportGenerator(api_key="sk-test-key-123")
    assert gen.api_key == "sk-test-key-123"
    assert gen._client is None  # lazy


def test_generate_empty_chunks():
    """With no chunks, returns error message without calling API."""
    gen = ReportGenerator(api_key="sk-test-key-123")
    result = gen.generate(
        query="What are the REACH requirements?",
        product="Battery",
        market="EU",
        chunks=[],
    )
    assert "错误" in result or "error" in result.lower()


def test_generate_with_chunks_no_api_key():
    """With no API key, returns error message."""
    gen = ReportGenerator(api_key="")
    result = gen.generate(
        query="REACH requirements?",
        product="Battery",
        market="EU",
        chunks=[{"content": "REACH Article 22 restricts lead.", "doc_name": "REACH"}],
    )
    # Should handle missing key gracefully
    assert result is not None


def test_generate_with_metadata():
    """generate_with_metadata returns structured dict."""
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
