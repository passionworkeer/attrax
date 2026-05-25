import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rag_service.parser.docx_parser import parse_docx, get_document_properties


def _sample_docx(tmp_path):
    """Create a deterministic DOCX fixture with paragraphs, table and metadata."""
    import docx

    path = tmp_path / "sample_compliance.docx"
    document = docx.Document()
    document.core_properties.title = "Compliance Fixture"
    document.core_properties.author = "Attrax Test Suite"
    document.add_paragraph("Portable speaker compliance overview")
    document.add_paragraph("RoHS and FCC evidence requirements")

    table = document.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "Market"
    table.cell(0, 1).text = "Requirement"
    table.cell(1, 0).text = "EU"
    table.cell(1, 1).text = "RoHS"
    document.save(path)
    return path


def test_parse_docx_integration(tmp_path):
    """Parse a generated DOCX file."""
    docx_path = _sample_docx(tmp_path)

    result = parse_docx(str(docx_path))
    assert "rawText" in result
    assert "tables" in result
    assert result["paragraphCount"] == 2


def test_paragraph_count(tmp_path):
    """Paragraph count is reported correctly."""
    docx_path = _sample_docx(tmp_path)

    result = parse_docx(str(docx_path))
    # Count should match actual paragraphs
    paras = result["rawText"].split("\n\n")
    non_empty = [p for p in paras if p.strip()]
    assert result["paragraphCount"] == len(non_empty)


def test_tables_extracted(tmp_path):
    """Tables are extracted from DOCX."""
    docx_path = _sample_docx(tmp_path)

    result = parse_docx(str(docx_path))
    assert isinstance(result["tables"], list)
    assert result["tables"] == [[["Market", "Requirement"], ["EU", "RoHS"]]]


def test_handles_invalid_file():
    """Returns error dict for non-existent file."""
    result = parse_docx("nonexistent.docx")
    assert "error" in result
    assert result["rawText"] == ""


def test_metadata_properties(tmp_path):
    """Document properties are extracted."""
    docx_path = _sample_docx(tmp_path)

    props = get_document_properties(str(docx_path))
    assert isinstance(props, dict)
    assert props["title"] == "Compliance Fixture"
    assert props["author"] == "Attrax Test Suite"
