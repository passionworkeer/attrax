# Regulation Source Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a minimal official-source registry, collect the next official regulation batch from it, and add the first ingestion architecture improvement for PDF-heavy supplement sources.

**Architecture:** Keep raw official sources isolated under `data/regulation_supplements`. Move source declarations into `data/regulation_sources/official_sources.json`, add a registry-driven collector that reuses the existing download and EU CELEX resolution utilities, and add tests around registry shape, adapter behavior, manifest integrity, and PDF supplement parsing.

**Tech Stack:** Python 3, pytest, requests, existing `scripts/collect_global_regulation_sources.py` collector helpers, existing FastAPI/RAG corpus conventions, pdfplumber for PDF extraction.

---

## File Structure

- Create `data/regulation_sources/official_sources.json`: declarative official-source registry for the next batch.
- Create `scripts/collect_official_sources_from_registry.py`: registry-driven collector CLI that builds an isolated supplement manifest.
- Create `rag_service/tests/test_official_source_registry.py`: static registry schema and controlled-tag tests.
- Create `rag_service/tests/test_registry_collector_adapters.py`: unit tests for adapter URL/file behavior without network calls.
- Create `rag_service/tests/test_registry_collector_manifest.py`: post-collection manifest integrity tests for the new supplement.
- Modify `scripts/ingest_regulation_supplements.py`: add `.pdf` parsing support while preserving existing HTML/XML/RDF behavior.
- Modify `rag_service/tests/test_regulation_supplement_ingest.py`: add a focused PDF parsing test with a fake `pdfplumber` module.

## Task 1: Add Registry Schema Test

**Files:**
- Create: `rag_service/tests/test_official_source_registry.py`
- Later Create: `data/regulation_sources/official_sources.json`

- [ ] **Step 1: Write the failing test**

Create `rag_service/tests/test_official_source_registry.py` with:

```python
import json
from pathlib import Path


REGISTRY_PATH = Path("data/regulation_sources/official_sources.json")

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
    assert REGISTRY_PATH.exists(), f"Missing registry: {REGISTRY_PATH}"
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
.runvenv\Scripts\python.exe -m pytest rag_service/tests/test_official_source_registry.py -q
```

Expected: `FAIL` because `data/regulation_sources/official_sources.json` does not exist yet.

- [ ] **Step 3: Commit the failing test**

```powershell
git add rag_service/tests/test_official_source_registry.py
git commit -m "test: define official source registry contract"
```

## Task 2: Add Initial Official Source Registry

**Files:**
- Create: `data/regulation_sources/official_sources.json`
- Test: `rag_service/tests/test_official_source_registry.py`

- [ ] **Step 1: Add the registry file**

Create `data/regulation_sources/official_sources.json` with:

```json
[
  {
    "id": "eu-2023-988-general-product-safety",
    "market": "EU",
    "title": "Regulation (EU) 2023/988 on general product safety",
    "channel": "Publications Office of the European Union",
    "source_type": "eu_celex",
    "source_url": "https://publications.europa.eu/resource/celex/32023R0988",
    "celex": "32023R0988",
    "files": ["raw/eu/eu-2023-988-general-product-safety.rdf", "raw/eu/eu-2023-988-general-product-safety.xhtml"],
    "product_categories": ["general_consumer_products", "children_products", "electronics", "toys"],
    "regulatory_types": ["product_safety", "market_surveillance", "documentation"],
    "why_added": "Core EU general product-safety framework for online and offline consumer products."
  },
  {
    "id": "eu-2009-48-toy-safety",
    "market": "EU",
    "title": "Directive 2009/48/EC on the safety of toys",
    "channel": "Publications Office of the European Union",
    "source_type": "eu_celex",
    "source_url": "https://publications.europa.eu/resource/celex/32009L0048",
    "celex": "32009L0048",
    "files": ["raw/eu/eu-2009-48-toy-safety.rdf", "raw/eu/eu-2009-48-toy-safety.xhtml"],
    "product_categories": ["toys", "children_products"],
    "regulatory_types": ["product_safety", "chemical", "mechanical", "testing"],
    "why_added": "Primary EU toy safety directive for mechanical, chemical, warning, and conformity obligations."
  },
  {
    "id": "eu-2011-65-rohs",
    "market": "EU",
    "title": "Directive 2011/65/EU on restriction of hazardous substances in electrical and electronic equipment",
    "channel": "Publications Office of the European Union",
    "source_type": "eu_celex",
    "source_url": "https://publications.europa.eu/resource/celex/32011L0065",
    "celex": "32011L0065",
    "files": ["raw/eu/eu-2011-65-rohs.rdf", "raw/eu/eu-2011-65-rohs.xhtml"],
    "product_categories": ["electronics", "electrical_equipment"],
    "regulatory_types": ["chemical", "conformity", "documentation"],
    "why_added": "Core EU hazardous-substance restriction for electrical and electronic products."
  },
  {
    "id": "eu-2012-19-weee",
    "market": "EU",
    "title": "Directive 2012/19/EU on waste electrical and electronic equipment",
    "channel": "Publications Office of the European Union",
    "source_type": "eu_celex",
    "source_url": "https://publications.europa.eu/resource/celex/32012L0019",
    "celex": "32012L0019",
    "files": ["raw/eu/eu-2012-19-weee.rdf", "raw/eu/eu-2012-19-weee.xhtml"],
    "product_categories": ["electronics", "waste_electrical"],
    "regulatory_types": ["waste", "sustainability", "labelling"],
    "why_added": "EU WEEE producer responsibility and waste electrical-equipment obligations."
  },
  {
    "id": "eu-2014-53-radio-equipment",
    "market": "EU",
    "title": "Directive 2014/53/EU on radio equipment",
    "channel": "Publications Office of the European Union",
    "source_type": "eu_celex",
    "source_url": "https://publications.europa.eu/resource/celex/32014L0053",
    "celex": "32014L0053",
    "files": ["raw/eu/eu-2014-53-radio-equipment.rdf", "raw/eu/eu-2014-53-radio-equipment.xhtml"],
    "product_categories": ["electronics", "radio"],
    "regulatory_types": ["radio", "emc", "conformity"],
    "why_added": "EU RED coverage for Wi-Fi, Bluetooth, connected, and radio-enabled products."
  },
  {
    "id": "eu-2014-30-emc",
    "market": "EU",
    "title": "Directive 2014/30/EU on electromagnetic compatibility",
    "channel": "Publications Office of the European Union",
    "source_type": "eu_celex",
    "source_url": "https://publications.europa.eu/resource/celex/32014L0030",
    "celex": "32014L0030",
    "files": ["raw/eu/eu-2014-30-emc.rdf", "raw/eu/eu-2014-30-emc.xhtml"],
    "product_categories": ["electronics", "electrical_equipment"],
    "regulatory_types": ["emc", "conformity", "testing"],
    "why_added": "EU EMC conformity baseline for electronic and electrical equipment."
  },
  {
    "id": "eu-2014-35-low-voltage",
    "market": "EU",
    "title": "Directive 2014/35/EU on low voltage electrical equipment",
    "channel": "Publications Office of the European Union",
    "source_type": "eu_celex",
    "source_url": "https://publications.europa.eu/resource/celex/32014L0035",
    "celex": "32014L0035",
    "files": ["raw/eu/eu-2014-35-low-voltage.rdf", "raw/eu/eu-2014-35-low-voltage.xhtml"],
    "product_categories": ["electronics", "electrical_equipment"],
    "regulatory_types": ["product_safety", "conformity", "testing"],
    "why_added": "EU electrical safety baseline for low-voltage equipment."
  },
  {
    "id": "eu-2019-1020-market-surveillance",
    "market": "EU",
    "title": "Regulation (EU) 2019/1020 on market surveillance and compliance of products",
    "channel": "Publications Office of the European Union",
    "source_type": "eu_celex",
    "source_url": "https://publications.europa.eu/resource/celex/32019R1020",
    "celex": "32019R1020",
    "files": ["raw/eu/eu-2019-1020-market-surveillance.rdf", "raw/eu/eu-2019-1020-market-surveillance.xhtml"],
    "product_categories": ["general_consumer_products", "electronics", "toys"],
    "regulatory_types": ["market_surveillance", "documentation", "conformity"],
    "why_added": "EU market surveillance and economic-operator compliance context."
  },
  {
    "id": "us-16-cfr-1307-phthalates",
    "market": "US",
    "title": "16 CFR Part 1307, Prohibition of Children's Toys and Child Care Articles Containing Specified Phthalates",
    "channel": "eCFR API (2026-05-21)",
    "source_type": "ecfr_part",
    "source_url": "https://www.ecfr.gov/current/title-16/part-1307",
    "ecfr_date": "2026-05-21",
    "ecfr_title": 16,
    "ecfr_part": "1307",
    "files": ["raw/us/US_16_CFR_Part_1307_phthalates.xml"],
    "product_categories": ["toys", "children_products", "chemicals"],
    "regulatory_types": ["chemical", "product_safety"],
    "why_added": "US CPSC phthalate restrictions for toys and child-care articles."
  },
  {
    "id": "us-16-cfr-1630-carpets-rugs",
    "market": "US",
    "title": "16 CFR Part 1630, Standard for the Surface Flammability of Carpets and Rugs",
    "channel": "eCFR API (2026-05-21)",
    "source_type": "ecfr_part",
    "source_url": "https://www.ecfr.gov/current/title-16/part-1630",
    "ecfr_date": "2026-05-21",
    "ecfr_title": 16,
    "ecfr_part": "1630",
    "files": ["raw/us/US_16_CFR_Part_1630_carpets_rugs.xml"],
    "product_categories": ["textiles", "home_goods", "furniture"],
    "regulatory_types": ["flammability", "testing"],
    "why_added": "US flammability standard for carpets and rugs."
  },
  {
    "id": "us-16-cfr-1631-small-carpets-rugs",
    "market": "US",
    "title": "16 CFR Part 1631, Standard for the Surface Flammability of Small Carpets and Rugs",
    "channel": "eCFR API (2026-05-21)",
    "source_type": "ecfr_part",
    "source_url": "https://www.ecfr.gov/current/title-16/part-1631",
    "ecfr_date": "2026-05-21",
    "ecfr_title": 16,
    "ecfr_part": "1631",
    "files": ["raw/us/US_16_CFR_Part_1631_small_carpets_rugs.xml"],
    "product_categories": ["textiles", "home_goods", "furniture"],
    "regulatory_types": ["flammability", "testing"],
    "why_added": "US flammability standard for small carpets and rugs."
  },
  {
    "id": "us-16-cfr-1633-mattresses-open-flame",
    "market": "US",
    "title": "16 CFR Part 1633, Standard for the Flammability (Open Flame) of Mattress Sets",
    "channel": "eCFR API (2026-05-21)",
    "source_type": "ecfr_part",
    "source_url": "https://www.ecfr.gov/current/title-16/part-1633",
    "ecfr_date": "2026-05-21",
    "ecfr_title": 16,
    "ecfr_part": "1633",
    "files": ["raw/us/US_16_CFR_Part_1633_mattresses_open_flame.xml"],
    "product_categories": ["furniture", "home_goods", "textiles"],
    "regulatory_types": ["flammability", "testing"],
    "why_added": "US open-flame flammability standard for mattress sets."
  },
  {
    "id": "us-16-cfr-1700-poison-prevention-packaging",
    "market": "US",
    "title": "16 CFR Part 1700, Poison Prevention Packaging",
    "channel": "eCFR API (2026-05-21)",
    "source_type": "ecfr_part",
    "source_url": "https://www.ecfr.gov/current/title-16/part-1700",
    "ecfr_date": "2026-05-21",
    "ecfr_title": 16,
    "ecfr_part": "1700",
    "files": ["raw/us/US_16_CFR_Part_1700_poison_prevention_packaging.xml"],
    "product_categories": ["packaging", "children_products", "chemicals"],
    "regulatory_types": ["packaging", "product_safety", "testing"],
    "why_added": "US child-resistant packaging requirements for hazardous household substances."
  },
  {
    "id": "ca-consumer-chemicals-containers-regulations-2001",
    "market": "CA",
    "title": "Consumer Chemicals and Containers Regulations, 2001",
    "channel": "Justice Laws Website, Government of Canada",
    "source_type": "canada_justice_xml",
    "source_url": "https://laws-lois.justice.gc.ca/eng/XML/SOR-2001-269.xml",
    "files": ["raw/ca/CA_consumer_chemicals_containers_regulations_2001.xml"],
    "product_categories": ["chemicals", "packaging", "general_consumer_products"],
    "regulatory_types": ["chemical", "labelling", "packaging", "product_safety"],
    "why_added": "Canada consumer chemical hazard classification, container, and labelling obligations."
  },
  {
    "id": "ca-surface-coating-materials-regulations",
    "market": "CA",
    "title": "Surface Coating Materials Regulations",
    "channel": "Justice Laws Website, Government of Canada",
    "source_type": "canada_justice_xml",
    "source_url": "https://laws-lois.justice.gc.ca/eng/XML/SOR-2016-193.xml",
    "files": ["raw/ca/CA_surface_coating_materials_regulations.xml"],
    "product_categories": ["children_products", "toys", "chemicals"],
    "regulatory_types": ["chemical", "product_safety"],
    "why_added": "Canada coating-material heavy-metal and applied coating safety coverage."
  },
  {
    "id": "ca-phthalates-regulations",
    "market": "CA",
    "title": "Phthalates Regulations",
    "channel": "Justice Laws Website, Government of Canada",
    "source_type": "canada_justice_xml",
    "source_url": "https://laws-lois.justice.gc.ca/eng/XML/SOR-2016-188.xml",
    "files": ["raw/ca/CA_phthalates_regulations.xml"],
    "product_categories": ["toys", "children_products", "chemicals"],
    "regulatory_types": ["chemical", "product_safety"],
    "why_added": "Canada phthalate restrictions for toys and child-care articles."
  },
  {
    "id": "ca-childrens-sleepwear-regulations",
    "market": "CA",
    "title": "Children's Sleepwear Regulations",
    "channel": "Justice Laws Website, Government of Canada",
    "source_type": "canada_justice_xml",
    "source_url": "https://laws-lois.justice.gc.ca/eng/XML/SOR-2016-169.xml",
    "files": ["raw/ca/CA_childrens_sleepwear_regulations.xml"],
    "product_categories": ["children_products", "apparel", "textiles"],
    "regulatory_types": ["flammability", "labelling", "testing"],
    "why_added": "Canada children's sleepwear flammability and labelling coverage."
  },
  {
    "id": "ca-consumer-products-containing-lead-regulations",
    "market": "CA",
    "title": "Consumer Products Containing Lead Regulations",
    "channel": "Justice Laws Website, Government of Canada",
    "source_type": "canada_justice_xml",
    "source_url": "https://laws-lois.justice.gc.ca/eng/XML/SOR-2018-83.xml",
    "files": ["raw/ca/CA_consumer_products_containing_lead_regulations.xml"],
    "product_categories": ["children_products", "toys", "general_consumer_products", "chemicals"],
    "regulatory_types": ["chemical", "product_safety"],
    "why_added": "Canada lead restrictions for affected consumer products."
  },
  {
    "id": "ca-corded-window-coverings-regulations",
    "market": "CA",
    "title": "Corded Window Coverings Regulations",
    "channel": "Justice Laws Website, Government of Canada",
    "source_type": "canada_justice_xml",
    "source_url": "https://laws-lois.justice.gc.ca/eng/XML/SOR-2019-97.xml",
    "files": ["raw/ca/CA_corded_window_coverings_regulations.xml"],
    "product_categories": ["children_products", "home_goods"],
    "regulatory_types": ["product_safety", "mechanical", "labelling"],
    "why_added": "Canada strangulation-risk and product-information requirements for corded window coverings."
  },
  {
    "id": "uk-weee-regulations-guidance",
    "market": "UK",
    "title": "Regulations: waste electrical and electronic equipment",
    "channel": "GOV.UK",
    "source_type": "gov_html",
    "source_url": "https://www.gov.uk/guidance/regulations-waste-electrical-and-electronic-equipment",
    "files": ["raw/uk/UK_weee_regulations_guidance.html"],
    "product_categories": ["electronics", "waste_electrical"],
    "regulatory_types": ["waste", "sustainability", "documentation"],
    "why_added": "UK WEEE obligations for producers, distributors, and sellers of electrical goods."
  },
  {
    "id": "uk-packaging-epr-who-is-affected",
    "market": "UK",
    "title": "Extended producer responsibility for packaging: who is affected and what to do",
    "channel": "GOV.UK",
    "source_type": "gov_html",
    "source_url": "https://www.gov.uk/guidance/extended-producer-responsibility-for-packaging-who-is-affected-and-what-to-do",
    "files": ["raw/uk/UK_packaging_epr_who_is_affected.html"],
    "product_categories": ["packaging", "general_consumer_products"],
    "regulatory_types": ["packaging", "sustainability", "waste"],
    "why_added": "UK packaging EPR scope and action obligations for importers and sellers."
  },
  {
    "id": "uk-reach-compliance-guidance",
    "market": "UK",
    "title": "How to comply with REACH chemical regulations",
    "channel": "GOV.UK",
    "source_type": "gov_html",
    "source_url": "https://www.gov.uk/guidance/how-to-comply-with-reach-chemical-regulations",
    "files": ["raw/uk/UK_reach_compliance_guidance.html"],
    "product_categories": ["chemicals", "general_consumer_products", "electronics", "toys"],
    "regulatory_types": ["chemical", "documentation"],
    "why_added": "UK REACH compliance guidance for chemical duties after EU exit."
  },
  {
    "id": "uk-hse-svhc-overview",
    "market": "UK",
    "title": "Substances of very high concern overview",
    "channel": "Health and Safety Executive",
    "source_type": "gov_html",
    "source_url": "https://www.hse.gov.uk/REACH/svhc-overview.htm",
    "files": ["raw/uk/UK_hse_svhc_overview.html"],
    "product_categories": ["chemicals", "general_consumer_products"],
    "regulatory_types": ["chemical", "documentation"],
    "why_added": "UK SVHC context for chemical communication and article obligations."
  },
  {
    "id": "nz-product-safety-standards-2005",
    "market": "NZ",
    "title": "Product Safety Standards (Children's Toys) Regulations 2005",
    "channel": "New Zealand Legislation",
    "source_type": "direct_url",
    "source_url": "https://www.legislation.govt.nz/regulation/public/2005/0236/latest/whole.html",
    "files": ["raw/nz/NZ_product_safety_standards_childrens_toys_2005.html"],
    "product_categories": ["toys", "children_products"],
    "regulatory_types": ["product_safety", "mechanical", "testing"],
    "why_added": "New Zealand toy product-safety standard coverage."
  },
  {
    "id": "nz-product-safety-standards-household-cots-2016",
    "market": "NZ",
    "title": "Product Safety Standards (Household Cots) Regulations 2016",
    "channel": "New Zealand Legislation",
    "source_type": "direct_url",
    "source_url": "https://www.legislation.govt.nz/regulation/public/2016/0058/latest/whole.html",
    "files": ["raw/nz/NZ_product_safety_standards_household_cots_2016.html"],
    "product_categories": ["children_products", "home_goods"],
    "regulatory_types": ["product_safety", "mechanical", "testing"],
    "why_added": "New Zealand household cot safety coverage for baby and nursery products."
  }
]
```

- [ ] **Step 2: Run registry schema test to verify it passes**

Run:

```powershell
.runvenv\Scripts\python.exe -m pytest rag_service/tests/test_official_source_registry.py -q
```

Expected: `3 passed`.

- [ ] **Step 3: Commit registry and schema test**

```powershell
git add data/regulation_sources/official_sources.json rag_service/tests/test_official_source_registry.py
git commit -m "Add official source registry"
```

## Task 3: Add Collector Adapter Tests

**Files:**
- Create: `rag_service/tests/test_registry_collector_adapters.py`
- Later Create: `scripts/collect_official_sources_from_registry.py`

- [ ] **Step 1: Write failing adapter tests**

Create `rag_service/tests/test_registry_collector_adapters.py` with:

```python
import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.collect_official_sources_from_registry import (  # noqa: E402
    build_download_url,
    build_manifest_entry,
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
    assert entry["files"] == ["raw/uk/UK_weee_regulations_guidance.html"]
```

- [ ] **Step 2: Run adapter tests to verify they fail**

Run:

```powershell
.runvenv\Scripts\python.exe -m pytest rag_service/tests/test_registry_collector_adapters.py -q
```

Expected: `ERROR` or `FAIL` because `scripts.collect_official_sources_from_registry` does not exist.

- [ ] **Step 3: Commit failing adapter tests**

```powershell
git add rag_service/tests/test_registry_collector_adapters.py
git commit -m "test: define registry collector adapters"
```

## Task 4: Implement Registry-Driven Collector

**Files:**
- Create: `scripts/collect_official_sources_from_registry.py`
- Test: `rag_service/tests/test_registry_collector_adapters.py`

- [ ] **Step 1: Add the collector script**

Create `scripts/collect_official_sources_from_registry.py` with:

```python
#!/usr/bin/env python3
"""Collect official regulation sources from a declarative registry."""
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
from typing import Any

from collect_global_regulation_sources import (
    Collector,
    as_posix,
    build_readme,
    make_entry,
    sha256_file,
)


DEFAULT_REGISTRY = Path("data/regulation_sources/official_sources.json")
DEFAULT_SUPPLEMENT_DIR = Path("data/regulation_supplements/2026-05-26_registry_official_sources")
DEFAULT_MIN_BYTES = 128


def load_registry(path: Path = DEFAULT_REGISTRY) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("registry root must be a list")
    return data


def build_download_url(entry: dict[str, Any]) -> str:
    source_type = entry["source_type"]
    if source_type == "ecfr_part":
        date = entry.get("ecfr_date", "2026-05-21")
        return (
            f"https://www.ecfr.gov/api/versioner/v1/full/{date}/"
            f"title-{int(entry['ecfr_title'])}.xml?part={entry['ecfr_part']}"
        )
    if source_type in {"canada_justice_xml", "direct_url", "gov_html"}:
        return entry["source_url"]
    raise ValueError(f"source type {source_type} does not use direct download URLs")


def eu_registry_files(entry: dict[str, Any]) -> tuple[str, str]:
    files = entry.get("files", [])
    if len(files) != 2:
        raise ValueError(f"EU CELEX entry {entry.get('id')} must define RDF and XHTML files")
    rdf_rel, xhtml_rel = files
    if not rdf_rel.endswith(".rdf") or not xhtml_rel.endswith(".xhtml"):
        raise ValueError(f"EU CELEX entry {entry.get('id')} files must be .rdf and .xhtml")
    return rdf_rel, xhtml_rel


def build_manifest_entry(entry: dict[str, Any], files: list[str]) -> dict[str, Any]:
    return make_entry(
        entry["id"],
        entry["market"],
        entry["title"],
        entry["channel"],
        entry["source_url"],
        list(files),
        entry["why_added"],
        list(entry["product_categories"]),
        list(entry["regulatory_types"]),
    )


def collect_entry(collector: Collector, entry: dict[str, Any]) -> dict[str, Any]:
    source_type = entry["source_type"]
    if source_type == "eu_celex":
        rdf_rel, xhtml_rel = eu_registry_files(entry)
        manifest_entry = build_manifest_entry(entry, [rdf_rel])
        collector.ensure_eu_text(manifest_entry, entry["celex"], rdf_rel, xhtml_rel)
        return manifest_entry

    file_rel = entry["files"][0]
    download_url = build_download_url(entry)
    min_bytes = int(entry.get("min_bytes", DEFAULT_MIN_BYTES))
    collector.download(download_url, file_rel, force=True, min_bytes=min_bytes)
    manifest_entry = build_manifest_entry(entry, [file_rel])
    if download_url != entry["source_url"]:
        manifest_entry["content_url"] = download_url
    return manifest_entry


def build_registry_manifest(
    registry: list[dict[str, Any]],
    collector: Collector,
) -> dict[str, Any]:
    entries = [collect_entry(collector, entry) for entry in registry]
    raw_file_set: set[str] = set()

    for manifest_entry in entries:
        stats = []
        for rel_path in manifest_entry["files"]:
            raw_file_set.add(rel_path)
            path = collector.supplement_dir / rel_path
            if not path.exists() or path.stat().st_size == 0:
                collector.failures.append(
                    {
                        "entry_id": manifest_entry["id"],
                        "file": rel_path,
                        "error": "missing or empty file referenced by manifest",
                    }
                )
                continue
            stats.append(
                {
                    "file": rel_path,
                    "bytes": path.stat().st_size,
                    "sha256": sha256_file(path),
                }
            )
        manifest_entry["file_stats"] = stats

    markets = sorted({entry["market"] for entry in entries})
    channels = sorted({entry["channel"] for entry in entries})
    product_categories = sorted(
        {category for entry in entries for category in entry.get("product_categories", [])}
    )
    regulatory_types = sorted(
        {reg_type for entry in entries for reg_type in entry.get("regulatory_types", [])}
    )
    created_at = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(timespec="seconds")

    return {
        "version": "1.0",
        "created_at": created_at,
        "isolation": {
            "status": "isolated",
            "not_mixed_with": ["data/corpus", "data/corpus/processed", "data/faiss"],
            "raw_root": as_posix(collector.raw_dir),
        },
        "summary": {
            "regulation_entries": len(entries),
            "raw_files": len(raw_file_set),
            "markets": markets,
            "product_categories": product_categories,
            "regulatory_types": regulatory_types,
            "channels": channels,
            "failed_downloads": len(collector.failures),
        },
        "entries": entries,
        "notes": [
            "This supplement was generated from data/regulation_sources/official_sources.json.",
            "Raw files remain isolated until reviewed and explicitly ingested.",
            "US eCFR entries use official API XML with a pinned date.",
            "EU entries include Publications Office RDF metadata and resolved English Cellar XHTML text when available.",
        ],
    }


def write_outputs(collector: Collector, manifest: dict[str, Any]) -> None:
    collector.supplement_dir.mkdir(parents=True, exist_ok=True)
    (collector.supplement_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (collector.supplement_dir / "README.md").write_text(build_readme(manifest), encoding="utf-8")

    failure_path = collector.supplement_dir / "download_failures.json"
    if collector.failures:
        failure_path.write_text(
            json.dumps(collector.failures, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    elif failure_path.exists():
        failure_path.unlink()


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect official regulation sources from registry.")
    parser.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY)
    parser.add_argument("--supplement-dir", type=Path, default=DEFAULT_SUPPLEMENT_DIR)
    args = parser.parse_args()

    registry = load_registry(args.registry)
    collector = Collector(args.supplement_dir)
    manifest = build_registry_manifest(registry, collector)
    write_outputs(collector, manifest)
    print(
        json.dumps(
            {
                "created_at": manifest["created_at"],
                "entries": manifest["summary"]["regulation_entries"],
                "raw_files": manifest["summary"]["raw_files"],
                "markets": manifest["summary"]["markets"],
                "failed_downloads": manifest["summary"]["failed_downloads"],
                "failures": collector.failures,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 1 if collector.failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run adapter tests to verify they pass**

Run:

```powershell
.runvenv\Scripts\python.exe -m pytest rag_service/tests/test_registry_collector_adapters.py -q
```

Expected: `4 passed`.

- [ ] **Step 3: Run registry test again**

Run:

```powershell
.runvenv\Scripts\python.exe -m pytest rag_service/tests/test_official_source_registry.py -q
```

Expected: `3 passed`.

- [ ] **Step 4: Commit collector**

```powershell
git add scripts/collect_official_sources_from_registry.py rag_service/tests/test_registry_collector_adapters.py
git commit -m "Add registry-driven official source collector"
```

## Task 5: Add Post-Collection Manifest Test

**Files:**
- Create: `rag_service/tests/test_registry_collector_manifest.py`
- Later Create by command: `data/regulation_supplements/2026-05-26_registry_official_sources/manifest.json`

- [ ] **Step 1: Write failing manifest test**

Create `rag_service/tests/test_registry_collector_manifest.py` with:

```python
import json
from pathlib import Path


SUPPLEMENT_DIR = Path("data/regulation_supplements/2026-05-26_registry_official_sources")
MANIFEST_PATH = SUPPLEMENT_DIR / "manifest.json"


def load_manifest() -> dict:
    assert MANIFEST_PATH.exists(), f"Missing manifest: {MANIFEST_PATH}"
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def test_registry_supplement_manifest_is_isolated_and_complete():
    manifest = load_manifest()

    assert manifest["isolation"]["status"] == "isolated"
    assert "data/corpus/processed" in manifest["isolation"]["not_mixed_with"]
    assert manifest["summary"]["regulation_entries"] >= 20
    assert manifest["summary"]["raw_files"] >= manifest["summary"]["regulation_entries"]
    assert manifest["summary"]["failed_downloads"] == 0
    assert {"EU", "US", "CA", "UK", "NZ"}.issubset(set(manifest["summary"]["markets"]))


def test_registry_supplement_references_existing_files_with_hashes():
    manifest = load_manifest()
    referenced_files = set()

    for entry in manifest["entries"]:
        assert entry["id"]
        assert entry["source_url"].startswith("https://")
        assert entry["files"]
        assert entry["file_stats"]
        assert len(entry["file_stats"]) == len(entry["files"])

        for stat in entry["file_stats"]:
            rel_path = stat["file"]
            referenced_files.add(rel_path)
            raw_path = SUPPLEMENT_DIR / rel_path
            assert raw_path.exists(), raw_path
            assert raw_path.stat().st_size == stat["bytes"]
            assert stat["bytes"] > 128
            assert len(stat["sha256"]) == 64

    assert len(referenced_files) == manifest["summary"]["raw_files"]


def test_registry_supplement_has_readme_and_no_failure_report():
    load_manifest()
    assert (SUPPLEMENT_DIR / "README.md").exists()
    assert not (SUPPLEMENT_DIR / "download_failures.json").exists()
```

- [ ] **Step 2: Run manifest test to verify it fails**

Run:

```powershell
.runvenv\Scripts\python.exe -m pytest rag_service/tests/test_registry_collector_manifest.py -q
```

Expected: `FAIL` because the new supplement manifest has not been collected yet.

- [ ] **Step 3: Commit failing manifest test**

```powershell
git add rag_service/tests/test_registry_collector_manifest.py
git commit -m "test: define registry supplement manifest contract"
```

## Task 6: Collect Registry Official Sources

**Files:**
- Create by command: `data/regulation_supplements/2026-05-26_registry_official_sources/`
- Test: `rag_service/tests/test_registry_collector_manifest.py`

- [ ] **Step 1: Run the registry collector**

Run:

```powershell
.runvenv\Scripts\python.exe scripts\collect_official_sources_from_registry.py --registry data\regulation_sources\official_sources.json --supplement-dir data\regulation_supplements\2026-05-26_registry_official_sources
```

Expected output shape:

```json
{
  "entries": 25,
  "raw_files": 33,
  "markets": ["CA", "EU", "NZ", "UK", "US"],
  "failed_downloads": 0,
  "failures": []
}
```

- [ ] **Step 2: Run manifest test to verify it passes**

Run:

```powershell
.runvenv\Scripts\python.exe -m pytest rag_service/tests/test_registry_collector_manifest.py -q
```

Expected: `3 passed`.

- [ ] **Step 3: Commit collected raw supplement**

```powershell
git add data/regulation_supplements/2026-05-26_registry_official_sources rag_service/tests/test_registry_collector_manifest.py
git commit -m "Add registry-collected official source supplement"
```

## Task 7: Add PDF Supplement Parsing Support

**Files:**
- Modify: `scripts/ingest_regulation_supplements.py`
- Modify: `rag_service/tests/test_regulation_supplement_ingest.py`

- [ ] **Step 1: Add failing PDF parser test**

Append this test to `rag_service/tests/test_regulation_supplement_ingest.py`:

```python
def test_parse_source_file_supports_pdf_with_pdfplumber(monkeypatch, tmp_path):
    import sys
    import types

    from scripts.ingest_regulation_supplements import parse_source_file

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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
.runvenv\Scripts\python.exe -m pytest rag_service/tests/test_regulation_supplement_ingest.py::test_parse_source_file_supports_pdf_with_pdfplumber -q
```

Expected: `FAIL` with `Unsupported supplement source format`.

- [ ] **Step 3: Implement PDF parsing**

Modify `scripts/ingest_regulation_supplements.py`:

```python
TEXT_FILE_PRIORITY = {
    ".xhtml": 0,
    ".html": 1,
    ".htm": 1,
    ".xml": 2,
    ".rdf": 3,
    ".pdf": 4,
}
```

Add this branch inside `parse_source_file` before the final `raise ValueError`:

```python
    if suffix == ".pdf":
        raw_text, page_count = _parse_pdf_text(source_path)
        return {
            "sourceType": "pdf",
            "pageCount": page_count,
            "totalChars": len(raw_text),
            "hasTables": False,
            "tableCount": 0,
            "tables": [],
            "rawText": raw_text,
        }
```

Add this helper near `_parse_xml_text`:

```python
def _parse_pdf_text(source_path: Path) -> tuple[str, int]:
    try:
        import pdfplumber
    except ImportError as exc:
        raise RuntimeError("pdfplumber is required to parse PDF supplement sources") from exc

    text_parts: list[str] = []
    page_count = 0
    with pdfplumber.open(source_path) as pdf:
        page_count = len(pdf.pages)
        for page in pdf.pages:
            page_text = page.extract_text() or ""
            if page_text.strip():
                text_parts.append(page_text.strip())
    return "\n".join(text_parts), page_count
```

- [ ] **Step 4: Run PDF parser test to verify it passes**

Run:

```powershell
.runvenv\Scripts\python.exe -m pytest rag_service/tests/test_regulation_supplement_ingest.py::test_parse_source_file_supports_pdf_with_pdfplumber -q
```

Expected: `1 passed`.

- [ ] **Step 5: Run existing ingestion tests**

Run:

```powershell
.runvenv\Scripts\python.exe -m pytest rag_service/tests/test_regulation_supplement_ingest.py -q
```

Expected: all tests in `test_regulation_supplement_ingest.py` pass.

- [ ] **Step 6: Commit PDF parsing support**

```powershell
git add scripts/ingest_regulation_supplements.py rag_service/tests/test_regulation_supplement_ingest.py
git commit -m "Add PDF parsing for regulation supplements"
```

## Task 8: Final Focused Verification

**Files:**
- Verify all files changed in Tasks 1-7.

- [ ] **Step 1: Run the focused pytest suite**

Run:

```powershell
.runvenv\Scripts\python.exe -m pytest rag_service/tests/test_official_source_registry.py rag_service/tests/test_registry_collector_adapters.py rag_service/tests/test_registry_collector_manifest.py rag_service/tests/test_regulation_supplement_ingest.py rag_service/tests/test_global_regulation_supplement_manifest.py -q
```

Expected: all selected tests pass.

- [ ] **Step 2: Inspect repository status**

Run:

```powershell
git status --short
```

Expected: only intentional files from this plan and earlier unrelated working-tree changes are present. Do not revert the earlier unrelated changes.

- [ ] **Step 3: Summarize coverage gained**

Report:

```text
Registry source count: 25
New supplement: data/regulation_supplements/2026-05-26_registry_official_sources
Markets added in this batch: CA, EU, NZ, UK, US
Raw files expected: 33
Failed downloads: 0
Architecture improvement: supplement PDF parsing added to ingest script
Verification: focused pytest command and result
```

## Self-Review

- Spec coverage: Tasks 1-2 implement the registry, Tasks 3-6 implement registry-driven collection and isolated manifest output, Task 7 implements the PDF ingestion architecture improvement, and Task 8 verifies the focused suite.
- Red-flag scan: The plan contains concrete file paths, commands, code snippets, and expected outputs.
- Type consistency: Adapter names are `eu_celex`, `ecfr_part`, `canada_justice_xml`, `direct_url`, and `gov_html`; the registry, tests, and collector use the same names.
