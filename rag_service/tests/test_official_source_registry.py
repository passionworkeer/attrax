import json
from pathlib import Path
import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
REGISTRY_PATH = REPO_ROOT / "data" / "regulation_sources" / "official_sources.json"

REQUIRED_FIELDS = {
    "id",
    "market",
    "title",
    "channel",
    "source_type",
    "source_url",
    "files",
    "product_categories",
    "regulatory_types",
    "why_added",
}

SUPPORTED_SOURCE_TYPES = {
    "eu_celex",
    "ecfr_part",
    "canada_justice_xml",
    "direct_url",
    "gov_html",
}

CONTROLLED_PRODUCT_CATEGORIES = {
    "apparel",
    "batteries",
    "chemicals",
    "children_products",
    "cosmetics",
    "electronics",
    "electrical_equipment",
    "food_contact",
    "furniture",
    "general_consumer_products",
    "home_goods",
    "packaging",
    "radio",
    "textiles",
    "toys",
    "waste_electrical",
}

CONTROLLED_REGULATORY_TYPES = {
    "chemical",
    "conformity",
    "documentation",
    "emc",
    "flammability",
    "labelling",
    "market_surveillance",
    "mechanical",
    "packaging",
    "product_safety",
    "radio",
    "sustainability",
    "testing",
    "waste",
}


def load_registry() -> list[dict]:
    if not REGISTRY_PATH.exists():
        pytest.skip(f"Registry not present in this deployment: {REGISTRY_PATH}")
    data = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    assert isinstance(data, list), "registry root must be a list"
    return data


def test_registry_entries_have_required_shape_and_unique_ids():
    entries = load_registry()
    assert len(entries) >= 20

    seen_ids = set()
    for entry in entries:
        missing = REQUIRED_FIELDS - set(entry)
        assert not missing, f"{entry.get('id', '<missing id>')} missing {sorted(missing)}"
        assert entry["id"] not in seen_ids
        seen_ids.add(entry["id"])
        assert entry["source_type"] in SUPPORTED_SOURCE_TYPES
        assert entry["market"] == entry["market"].upper()
        assert entry["title"].strip()
        assert entry["channel"].strip()
        assert entry["source_url"].startswith("https://")
        assert entry["why_added"].strip()
        assert entry["files"]
        for raw_file in entry["files"]:
            assert raw_file.startswith("raw/"), raw_file
            assert "\\" not in raw_file, raw_file
            assert ".." not in Path(raw_file).parts, raw_file


def test_registry_uses_controlled_categories_and_regulatory_types():
    for entry in load_registry():
        unknown_categories = set(entry["product_categories"]) - CONTROLLED_PRODUCT_CATEGORIES
        unknown_types = set(entry["regulatory_types"]) - CONTROLLED_REGULATORY_TYPES
        assert not unknown_categories, f"{entry['id']} unknown categories {sorted(unknown_categories)}"
        assert not unknown_types, f"{entry['id']} unknown regulatory types {sorted(unknown_types)}"


def test_registry_adapter_specific_fields_are_present():
    for entry in load_registry():
        source_type = entry["source_type"]
        if source_type == "eu_celex":
            assert entry.get("celex", "").startswith("3")
            assert len(entry["files"]) == 2
            assert entry["files"][0].endswith(".rdf")
            assert entry["files"][1].endswith(".xhtml")
        elif source_type == "ecfr_part":
            assert isinstance(entry.get("ecfr_title"), int)
            assert str(entry.get("ecfr_part", "")).strip()
            assert len(entry["files"]) == 1
            assert entry["files"][0].endswith(".xml")
        elif source_type == "canada_justice_xml":
            assert entry["source_url"].startswith("https://laws-lois.justice.gc.ca/eng/XML/")
            assert len(entry["files"]) == 1
            assert entry["files"][0].endswith(".xml")
        elif source_type in {"direct_url", "gov_html"}:
            assert len(entry["files"]) == 1
