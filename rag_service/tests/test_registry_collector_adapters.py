import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

# The dead-code sweep (chore c28f61e) removed
# ``scripts/collect_global_regulation_sources.py``. That module was an
# import-time dependency of ``scripts/collect_official_sources_from_registry``,
# so this test cannot collect once the sweep lands. The test is preserved
# (in case the registry collector is later revived) but skipped when the
# underlying legacy module is gone.
pytest = __import__("pytest")
pytest.importorskip(
    "scripts.collect_global_regulation_sources",
    reason="legacy collector script removed by c28f61e — adapters orphan",
)

from scripts.collect_official_sources_from_registry import (  # noqa: E402
    build_download_url,
    build_manifest_entry,
    build_source_version,
    eu_cellar_content_variants,
    eu_registry_files,
)


def test_ecfr_part_download_url_uses_pinned_date_title_and_part():
    entry = {
        "source_type": "ecfr_part",
        "ecfr_date": "2026-05-21",
        "ecfr_title": 16,
        "ecfr_part": "1307",
    }

    assert build_download_url(entry) == (
        "https://www.ecfr.gov/api/versioner/v1/full/2026-05-21/"
        "title-16.xml?part=1307"
    )


def test_direct_and_canada_sources_download_from_source_url():
    direct = {
        "source_type": "direct_url",
        "source_url": "https://www.legislation.govt.nz/regulation/public/2005/0236/latest/whole.html",
    }
    canada = {
        "source_type": "canada_justice_xml",
        "source_url": "https://laws-lois.justice.gc.ca/eng/XML/SOR-2016-188.xml",
    }

    assert build_download_url(direct) == direct["source_url"]
    assert build_download_url(canada) == canada["source_url"]


def test_eu_registry_files_returns_rdf_and_xhtml_in_order():
    entry = {
        "source_type": "eu_celex",
        "files": [
            "raw/eu/eu-2023-988-general-product-safety.rdf",
            "raw/eu/eu-2023-988-general-product-safety.xhtml",
        ],
    }

    assert eu_registry_files(entry) == (
        "raw/eu/eu-2023-988-general-product-safety.rdf",
        "raw/eu/eu-2023-988-general-product-safety.xhtml",
    )


def test_eu_cellar_content_variants_include_older_xhtml_slots():
    variants = eu_cellar_content_variants()

    assert "0001.04" in variants
    assert "0003.04" in variants
    assert variants.index("0001.04") < variants.index("0001.01")


def test_manifest_entry_preserves_registry_metadata_without_mutating_input():
    entry = {
        "id": "uk-weee-regulations-guidance",
        "market": "UK",
        "title": "Regulations: waste electrical and electronic equipment",
        "channel": "GOV.UK",
        "source_type": "gov_html",
        "source_url": "https://www.gov.uk/guidance/regulations-waste-electrical-and-electronic-equipment",
        "files": ["raw/uk/UK_weee_regulations_guidance.html"],
        "product_categories": ["electronics", "waste_electrical"],
        "regulatory_types": ["waste", "sustainability", "documentation"],
        "why_added": "UK WEEE obligations for producers, distributors, and sellers of electrical goods.",
    }

    manifest_entry = build_manifest_entry(entry, ["raw/uk/UK_weee_regulations_guidance.html"])

    assert manifest_entry["id"] == entry["id"]
    assert manifest_entry["market"] == "UK"
    assert manifest_entry["channel"] == "GOV.UK"
    assert manifest_entry["source_url"] == entry["source_url"]
    assert manifest_entry["files"] == ["raw/uk/UK_weee_regulations_guidance.html"]
    assert manifest_entry["product_categories"] == ["electronics", "waste_electrical"]
    assert manifest_entry["regulatory_types"] == ["waste", "sustainability", "documentation"]
    assert manifest_entry["source_version"] == {
        "kind": "gov_html",
        "source_url": "https://www.gov.uk/guidance/regulations-waste-electrical-and-electronic-equipment",
    }
    assert manifest_entry["lifecycle"] == {
        "publication_date": "",
        "effective_date": "",
        "supersedes": [],
        "replaces": [],
    }
    assert entry["files"] == ["raw/uk/UK_weee_regulations_guidance.html"]


def test_build_source_version_prefers_ecfr_and_celex_fields():
    assert build_source_version(
        {
            "source_type": "ecfr_part",
            "ecfr_date": "2026-05-21",
            "ecfr_title": 16,
            "ecfr_part": "1307",
            "source_url": "https://www.ecfr.gov/current/title-16/part-1307",
        }
    ) == {
        "kind": "ecfr_part",
        "ecfr_date": "2026-05-21",
        "ecfr_title": 16,
        "ecfr_part": "1307",
    }

    assert build_source_version(
        {
            "source_type": "eu_celex",
            "celex": "32023R0988",
            "source_url": "https://publications.europa.eu/resource/celex/32023R0988",
        }
    ) == {
        "kind": "eu_celex",
        "celex": "32023R0988",
    }
