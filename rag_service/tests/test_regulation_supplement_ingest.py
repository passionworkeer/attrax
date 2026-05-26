import json
import sys
import warnings
from pathlib import Path

from bs4 import XMLParsedAsHTMLWarning

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.ingest_regulation_supplements import choose_primary_file, ingest_supplement, parse_source_file


def test_choose_primary_file_prefers_xhtml_over_rdf():
    entry = {
        "files": [
            "raw/eu/EU_2024-2847_cyber_resilience_act.rdf",
            "raw/eu/EU_2024-2847_cyber_resilience_act.xhtml",
        ]
    }

    assert choose_primary_file(entry) == Path("raw/eu/EU_2024-2847_cyber_resilience_act.xhtml")


def test_ingest_supplement_writes_processed_json_and_report(tmp_path):
    supplement_dir = tmp_path / "supplement"
    processed_dir = tmp_path / "processed"
    (supplement_dir / "raw/eu").mkdir(parents=True)
    (supplement_dir / "raw/us").mkdir(parents=True)

    (supplement_dir / "raw/eu/test.rdf").write_text("<rdf />", encoding="utf-8")
    (supplement_dir / "raw/eu/test.xhtml").write_text(
        """
        <html>
          <body>
            <main>
              <h1>Regulation (EU) 2024/2847</h1>
              <p>Article 1 Subject matter</p>
              <p>This Regulation lays down cybersecurity requirements.</p>
            </main>
          </body>
        </html>
        """,
        encoding="utf-8",
    )
    (supplement_dir / "raw/us/test.xml").write_text(
        """
        <DIV8>
          <HEAD>PART 1263 - SAFETY STANDARD FOR BUTTON CELL OR COIN BATTERIES</HEAD>
          <P>Section 1263.3 requires warning labels for consumer products.</P>
        </DIV8>
        """,
        encoding="utf-8",
    )
    manifest = {
        "created_at": "2026-05-25T19:14:21+08:00",
        "entries": [
            {
                "id": "eu-test-cra",
                "market": "EU",
                "title": "Regulation (EU) 2024/2847, Cyber Resilience Act",
                "channel": "Publications Office of the European Union",
                "source_url": "https://publications.europa.eu/resource/celex/32024R2847",
                "content_url": "https://publications.europa.eu/resource/cellar/test/DOC_1",
                "files": ["raw/eu/test.rdf", "raw/eu/test.xhtml"],
                "why_added": "Connected products",
            },
            {
                "id": "us-test-1263",
                "market": "US",
                "title": "16 CFR Part 1263, Safety Standard for Button Cell or Coin Batteries",
                "channel": "eCFR API",
                "source_url": "https://www.ecfr.gov/api/versioner/v1/full/2026-05-14/title-16.xml?part=1263",
                "files": ["raw/us/test.xml"],
                "why_added": "Button batteries",
            },
        ],
    }
    (supplement_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False),
        encoding="utf-8",
    )

    report = ingest_supplement(supplement_dir=supplement_dir, processed_dir=processed_dir)

    assert report["entries_processed"] == 2
    assert report["entries_failed"] == 0
    assert (supplement_dir / "ingestion_report.json").exists()

    processed_files = sorted(processed_dir.glob("*.json"))
    assert [path.name for path in processed_files] == [
        "EU_Official_eu-test-cra.json",
        "US_Official_us-test-1263.json",
    ]

    eu_doc = json.loads(processed_files[0].read_text(encoding="utf-8"))
    assert eu_doc["id"] == "eu-test-cra"
    assert eu_doc["region"] == "EU"
    assert eu_doc["sourceType"] == "xhtml"
    assert "Article 1 Subject matter" in eu_doc["rawText"]
    assert eu_doc["metadata"]["source_url"] == "https://publications.europa.eu/resource/celex/32024R2847"

    us_doc = json.loads(processed_files[1].read_text(encoding="utf-8"))
    assert us_doc["sourceType"] == "xml"
    assert "warning labels" in us_doc["rawText"]
    assert us_doc["metadata"]["official_channel"] == "eCFR API"


def test_parse_xhtml_source_does_not_emit_xml_html_warning(tmp_path):
    source = tmp_path / "source.xhtml"
    source.write_text(
        (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML//EN" "xhtml-strict.dtd">'
            '<html xmlns="http://www.w3.org/1999/xhtml">'
            "<body><main><p>Article 1 cybersecurity requirements.</p></main></body></html>"
        ),
        encoding="utf-8",
    )

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        parsed = parse_source_file(source)

    assert parsed["sourceType"] == "xhtml"
    assert "cybersecurity requirements" in parsed["rawText"]
    assert not [warning for warning in caught if issubclass(warning.category, XMLParsedAsHTMLWarning)]


def test_parse_real_official_xhtml_source_does_not_emit_xml_html_warning():
    source = Path(
        "data/regulation_supplements/2026-05-25_official_sources/raw/eu/"
        "EU_2024-2847_cyber_resilience_act.xhtml"
    )
    if not source.exists():
        import pytest

        pytest.skip("Official supplement fixture is not present")

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        parsed = parse_source_file(source)

    assert parsed["sourceType"] == "xhtml"
    assert "cyber resilience" in parsed["rawText"].lower()
    assert not [warning for warning in caught if issubclass(warning.category, XMLParsedAsHTMLWarning)]


def test_parse_source_file_supports_pdf_with_pdfplumber(monkeypatch, tmp_path):
    import types

    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"%PDF-1.4\n% test pdf bytes\n")

    class FakePage:
        def __init__(self, text):
            self._text = text

        def extract_text(self):
            return self._text

    class FakePdf:
        pages = [FakePage("First page text"), FakePage("Second page text")]

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    fake_pdfplumber = types.SimpleNamespace(open=lambda _: FakePdf())
    monkeypatch.setitem(sys.modules, "pdfplumber", fake_pdfplumber)

    parsed = parse_source_file(pdf_path)

    assert parsed["sourceType"] == "pdf"
    assert parsed["pageCount"] == 2
    assert parsed["totalChars"] == len("First page text\nSecond page text")
    assert parsed["rawText"] == "First page text\nSecond page text"
    assert parsed["hasTables"] is False
    assert parsed["tables"] == []
