import json
import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.report_regulation_coverage import build_coverage_report, render_markdown_report  # noqa: E402


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def test_build_coverage_report_matches_registry_to_processed_and_index(tmp_path):
    registry_path = tmp_path / "data/regulation_sources/official_sources.json"
    supplement_dir = tmp_path / "data/regulation_supplements/batch"
    processed_dir = tmp_path / "data/corpus/processed"
    faiss_meta = tmp_path / "data/faiss_versions/batch/legal_chunks_meta.json"

    registry = [
        {
            "id": "eu-gpsr",
            "market": "EU",
            "title": "GPSR",
            "channel": "Publications Office",
            "source_type": "eu_celex",
            "source_url": "https://publications.europa.eu/resource/celex/32023R0988",
            "files": ["raw/eu/gpsr.rdf", "raw/eu/gpsr.xhtml"],
            "product_categories": ["general_consumer_products"],
            "regulatory_types": ["product_safety"],
            "why_added": "General safety",
        },
        {
            "id": "us-phthalates",
            "market": "US",
            "title": "16 CFR Part 1307",
            "channel": "eCFR",
            "source_type": "ecfr_part",
            "source_url": "https://www.ecfr.gov/current/title-16/part-1307",
            "files": ["raw/us/part-1307.xml"],
            "product_categories": ["toys", "children_products"],
            "regulatory_types": ["chemical"],
            "why_added": "Phthalates",
        },
    ]
    write_json(registry_path, registry)

    write_json(
        supplement_dir / "manifest.json",
        {
            "summary": {
                "regulation_entries": 2,
                "raw_files": 3,
                "markets": ["EU", "US"],
                "failed_downloads": 0,
            },
            "entries": registry,
            "ingestion_status": {
                "processed_into_current_corpus": True,
                "processed_files": ["data/corpus/processed/EU_Official_eu-gpsr.json"],
            },
        },
    )

    write_json(
        processed_dir / "EU_Official_eu-gpsr.json",
        {
            "id": "eu-gpsr",
            "title": "GPSR",
            "region": "EU",
            "sourceType": "xhtml",
            "totalChars": 1234,
            "metadata": {"supplement_id": "eu-gpsr", "source_url": "https://example.test/gpsr"},
            "rawText": "Article 1 product safety",
        },
    )
    write_json(
        faiss_meta,
        {
            "dim": 384,
            "chunks": [
                {"source_id": "eu-gpsr", "region": "EU", "source_file": "EU_Official_eu-gpsr.json"},
                {"source_id": "eu-gpsr", "region": "EU", "source_file": "EU_Official_eu-gpsr.json"},
            ],
        },
    )

    report = build_coverage_report(
        registry_path=registry_path,
        supplement_dirs=[supplement_dir],
        processed_dir=processed_dir,
        faiss_meta_path=faiss_meta,
        generated_at="2026-05-26T18:00:00+08:00",
    )

    assert report["summary"]["registry_entries"] == 2
    assert report["summary"]["supplement_entries"] == 2
    assert report["summary"]["processed_registry_entries"] == 1
    assert report["summary"]["missing_processed_entries"] == 1
    assert report["summary"]["faiss_chunks"] == 2
    assert report["coverage_by_market"]["EU"]["registry_entries"] == 1
    assert report["coverage_by_market"]["EU"]["processed_entries"] == 1
    assert report["coverage_by_market"]["US"]["missing_processed_entries"] == 1
    assert report["missing_processed_entry_ids"] == ["us-phthalates"]


def test_render_markdown_report_includes_core_counts():
    report = {
        "generated_at": "2026-05-26T18:00:00+08:00",
        "summary": {
            "registry_entries": 2,
            "supplement_entries": 2,
            "processed_registry_entries": 1,
            "missing_processed_entries": 1,
            "faiss_chunks": 2,
            "failed_downloads": 0,
        },
        "coverage_by_market": {
            "EU": {"registry_entries": 1, "processed_entries": 1, "missing_processed_entries": 0},
            "US": {"registry_entries": 1, "processed_entries": 0, "missing_processed_entries": 1},
        },
        "missing_processed_entry_ids": ["us-phthalates"],
    }

    markdown = render_markdown_report(report)

    assert "# Regulation Coverage Report" in markdown
    assert "- Registry entries: 2" in markdown
    assert "- FAISS chunks: 2" in markdown
    assert "| EU | 1 | 1 | 0 |" in markdown
    assert "- us-phthalates" in markdown
