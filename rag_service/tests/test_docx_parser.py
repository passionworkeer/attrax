import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rag_service.parser.docx_parser import parse_docx, get_document_properties


def test_parse_docx_integration():
    """Parse a real DOCX file from corpus."""
    import glob
    docx_files = glob.glob("data/corpus/**/*.docx", recursive=True)
    if not docx_files:
        import pytest
        pytest.skip("No DOCX files found in corpus")

    result = parse_docx(docx_files[0])
    assert "rawText" in result
    assert "tables" in result
    assert result["paragraphCount"] >= 0


def test_paragraph_count():
    """Paragraph count is reported correctly."""
    import glob
    docx_files = glob.glob("data/corpus/**/*.docx", recursive=True)
    if not docx_files:
        import pytest
        pytest.skip("No DOCX files")

    result = parse_docx(docx_files[0])
    # Count should match actual paragraphs
    paras = result["rawText"].split("\n\n")
    non_empty = [p for p in paras if p.strip()]
    assert result["paragraphCount"] == len(non_empty)


def test_tables_extracted():
    """Tables are extracted from DOCX."""
    import glob
    docx_files = glob.glob("data/corpus/**/*.docx", recursive=True)
    if not docx_files:
        import pytest
        pytest.skip("No DOCX files")

    result = parse_docx(docx_files[0])
    assert isinstance(result["tables"], list)


def test_handles_invalid_file():
    """Returns error dict for non-existent file."""
    result = parse_docx("nonexistent.docx")
    assert "error" in result
    assert result["rawText"] == ""


def test_metadata_properties():
    """Document properties are extracted."""
    import glob
    docx_files = glob.glob("data/corpus/**/*.docx", recursive=True)
    if not docx_files:
        import pytest
        pytest.skip("No DOCX files")

    props = get_document_properties(docx_files[0])
    assert isinstance(props, dict)