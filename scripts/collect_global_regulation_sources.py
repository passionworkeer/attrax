#!/usr/bin/env python3
"""Collect isolated raw official regulation sources for review before ingestion."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import requests


DEFAULT_SUPPLEMENT_DIR = Path("data/regulation_supplements/2026-05-26_global_official_sources")
USER_AGENT = "Mozilla/5.0 (compatible; AttraxOfficialSourceCollector/1.0)"
ECFR_DATE = "2026-05-21"


class Collector:
    def __init__(self, supplement_dir: Path) -> None:
        self.supplement_dir = supplement_dir
        self.raw_dir = supplement_dir / "raw"
        self.failures: list[dict[str, Any]] = []
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT, "Accept": "*/*"})

    def download(
        self,
        url: str,
        rel_path: str,
        *,
        force: bool = False,
        min_bytes: int = 128,
        fallback_curl: bool = True,
        record_failure: bool = True,
    ) -> dict[str, Any]:
        path = self.supplement_dir / rel_path
        if path.exists() and path.stat().st_size >= min_bytes and not force:
            return {
                "url": url,
                "file": rel_path,
                "status": "existing",
                "bytes": path.stat().st_size,
                "content_type": "",
            }

        path.parent.mkdir(parents=True, exist_ok=True)
        last_error = ""
        for attempt in range(3):
            try:
                response = self.session.get(url, timeout=60, allow_redirects=True)
                if response.status_code >= 400:
                    raise RuntimeError(f"HTTP {response.status_code}")
                if len(response.content) < min_bytes:
                    raise RuntimeError(f"too small: {len(response.content)} bytes")
                path.write_bytes(response.content)
                return {
                    "url": url,
                    "final_url": response.url,
                    "file": rel_path,
                    "status": "downloaded",
                    "bytes": len(response.content),
                    "content_type": response.headers.get("content-type", ""),
                }
            except Exception as exc:  # noqa: BLE001 - retained in collection report
                last_error = str(exc)
                time.sleep(1 + attempt)

        if fallback_curl:
            try:
                command = [
                    "curl.exe",
                    "-L",
                    "--fail",
                    "--max-time",
                    "90",
                    "-o",
                    str(path),
                    url,
                ]
                result = subprocess.run(command, text=True, capture_output=True, check=False)
                if result.returncode == 0 and path.exists() and path.stat().st_size >= min_bytes:
                    return {
                        "url": url,
                        "file": rel_path,
                        "status": "downloaded-curl",
                        "bytes": path.stat().st_size,
                        "content_type": "",
                    }
                last_error = (result.stderr or result.stdout or f"curl exit {result.returncode}")[-500:]
            except Exception as exc:  # noqa: BLE001 - retained in collection report
                last_error = str(exc)

        if record_failure:
            self.failures.append({"url": url, "file": rel_path, "error": last_error})
        return {"url": url, "file": rel_path, "status": "failed", "error": last_error}

    def ensure_eu_text(self, entry: dict[str, Any], celex: str, rdf_rel: str, xhtml_rel: str) -> None:
        rdf_path = self.supplement_dir / rdf_rel
        if not rdf_path.exists() or rdf_path.stat().st_size < 128:
            self.download(f"https://publications.europa.eu/resource/celex/{celex}", rdf_rel, min_bytes=500)

        rdf_text = rdf_path.read_text(encoding="utf-8", errors="ignore")
        cellar_uuid = None
        descriptions = re.finditer(
            r'<rdf:Description rdf:about="http://publications\.europa\.eu/resource/cellar/([^"]+)">(.*?)</rdf:Description>',
            rdf_text,
            flags=re.S,
        )
        for match in descriptions:
            body = match.group(2)
            same_as = f'owl:sameAs rdf:resource="http://publications.europa.eu/resource/celex/{celex}"'
            if same_as in body:
                cellar_uuid = match.group(1)
                break

        if not cellar_uuid:
            self.failures.append(
                {
                    "url": entry["source_url"],
                    "file": xhtml_rel,
                    "error": f"could not resolve Cellar UUID for {celex}",
                }
            )
            return

        for variant in ("0006.03", "0006.02", "0001.03", "0001.02", "0002.03", "0002.02", "0003.03", "0003.02"):
            content_url = f"https://publications.europa.eu/resource/cellar/{cellar_uuid}.{variant}/DOC_1"
            result = self.download(
                content_url,
                xhtml_rel,
                force=not (self.supplement_dir / xhtml_rel).exists(),
                min_bytes=1000,
                fallback_curl=False,
                record_failure=False,
            )
            if result["status"] in {"downloaded", "existing"}:
                entry["content_url"] = content_url
                if xhtml_rel not in entry["files"]:
                    entry["files"].append(xhtml_rel)
                return

        self.failures.append(
            {
                "url": entry["source_url"],
                "file": xhtml_rel,
                "error": f"could not download XHTML for {celex} cellar {cellar_uuid}",
            }
        )

    def build_manifest(self) -> dict[str, Any]:
        entries = build_entries(self)
        raw_file_set: set[str] = set()

        for manifest_entry in entries:
            stats = []
            for rel_path in manifest_entry["files"]:
                raw_file_set.add(rel_path)
                path = self.supplement_dir / rel_path
                if not path.exists() or path.stat().st_size == 0:
                    self.failures.append(
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
                "raw_root": as_posix(self.raw_dir),
            },
            "summary": {
                "regulation_entries": len(entries),
                "raw_files": len(raw_file_set),
                "markets": markets,
                "product_categories": product_categories,
                "regulatory_types": regulatory_types,
                "channels": channels,
                "ecfr_date": ECFR_DATE,
                "failed_downloads": len(self.failures),
            },
            "entries": entries,
            "notes": [
                "This supplement is a raw official-source collection only; it has not been ingested into data/corpus/processed or data/faiss.",
                "US eCFR files use official API XML because browser eCFR pages may trigger an access-check page.",
                "EU entries include Publications Office RDF metadata and resolved English Cellar XHTML text files when available.",
                "Some government domains reject automated browser/TLS clients; only successfully retrieved non-empty official files are referenced.",
            ],
        }

    def write_outputs(self, manifest: dict[str, Any]) -> None:
        self.supplement_dir.mkdir(parents=True, exist_ok=True)
        (self.supplement_dir / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        readme = build_readme(manifest)
        (self.supplement_dir / "README.md").write_text(readme, encoding="utf-8")

        failure_path = self.supplement_dir / "download_failures.json"
        if self.failures:
            failure_path.write_text(
                json.dumps(self.failures, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        elif failure_path.exists():
            failure_path.unlink()


def build_entries(collector: Collector) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []

    eu_specs = [
        (
            "eu-2023-1230-machinery",
            "Regulation (EU) 2023/1230 on machinery",
            "32023R1230",
            "raw/eu/eu-2023-1230-machinery.rdf",
            "raw/eu/eu-2023-1230-machinery.xhtml",
            "Machinery and partly completed machinery; core EU machinery safety baseline.",
            ["machinery", "industrial_products"],
            ["product_safety", "conformity"],
        ),
        (
            "eu-2025-40-packaging-waste",
            "Regulation (EU) 2025/40 on packaging and packaging waste",
            "32025R0040",
            "raw/eu/eu-2025-40-packaging-waste.rdf",
            "raw/eu/eu-2025-40-packaging-waste.xhtml",
            "Packaging, recyclability, reuse, labelling, and sustainability obligations.",
            ["packaging"],
            ["sustainability", "labelling"],
        ),
        (
            "eu-2023-1115-deforestation",
            "Regulation (EU) 2023/1115 on deforestation-free products",
            "32023R1115",
            "raw/eu/eu-2023-1115-deforestation.rdf",
            "raw/eu/eu-2023-1115-deforestation.xhtml",
            "Supply-chain due diligence for commodities used in consumer goods and packaging.",
            ["raw_materials", "packaging"],
            ["sustainability", "due_diligence"],
        ),
        (
            "eu-2011-1007-textile-labelling",
            "Regulation (EU) No 1007/2011 on textile fibre names and labelling",
            "32011R1007",
            "raw/eu/eu-2011-1007-textile-labelling.rdf",
            "raw/eu/eu-2011-1007-textile-labelling.xhtml",
            "Textile and apparel fibre composition, labelling, and marking checks.",
            ["textiles", "apparel"],
            ["labelling"],
        ),
        (
            "eu-2009-1223-cosmetics",
            "Regulation (EC) No 1223/2009 on cosmetic products",
            "32009R1223",
            "raw/eu/eu-2009-1223-cosmetics.rdf",
            "raw/eu/eu-2009-1223-cosmetics.xhtml",
            "Cosmetics safety assessment, responsible person, ingredient and notification rules.",
            ["cosmetics"],
            ["product_safety", "chemical"],
        ),
        (
            "eu-2004-1935-food-contact-materials",
            "Regulation (EC) No 1935/2004 on materials and articles intended to contact food",
            "32004R1935",
            "raw/eu/eu-2004-1935-food-contact-materials.rdf",
            "raw/eu/eu-2004-1935-food-contact-materials.xhtml",
            "General EU food-contact material safety and declaration obligations.",
            ["food_contact", "kitchenware"],
            ["product_safety", "chemical"],
        ),
        (
            "eu-2011-10-plastic-food-contact",
            "Commission Regulation (EU) No 10/2011 on plastic materials and articles intended to contact food",
            "32011R0010",
            "raw/eu/eu-2011-10-plastic-food-contact.rdf",
            "raw/eu/eu-2011-10-plastic-food-contact.xhtml",
            "Plastic food-contact migration and material-specific compliance coverage.",
            ["food_contact", "plastics", "kitchenware"],
            ["chemical", "testing"],
        ),
        (
            "eu-2023-1542-batteries",
            "Regulation (EU) 2023/1542 concerning batteries and waste batteries",
            "32023R1542",
            "raw/eu/eu-2023-1542-batteries.rdf",
            "raw/eu/eu-2023-1542-batteries.xhtml",
            "Battery safety, sustainability, labelling, due diligence, and waste obligations.",
            ["batteries", "electronics"],
            ["product_safety", "sustainability", "labelling"],
        ),
    ]
    for entry_id, title, celex, rdf_rel, xhtml_rel, why, categories, reg_types in eu_specs:
        manifest_entry = make_entry(
            entry_id,
            "EU",
            title,
            "Publications Office of the European Union",
            f"https://publications.europa.eu/resource/celex/{celex}",
            [rdf_rel],
            why,
            categories,
            reg_types,
        )
        collector.ensure_eu_text(manifest_entry, celex, rdf_rel, xhtml_rel)
        entries.append(manifest_entry)

    add_us_entries(collector, entries)
    add_existing_collected_entries(entries)
    add_korea_entries(collector, entries)
    add_india_entries(collector, entries)
    add_brazil_entries(collector, entries)
    add_mexico_entries(collector, entries)
    add_gcc_entries(collector, entries)

    return entries


def add_us_entries(collector: Collector, entries: list[dict[str, Any]]) -> None:
    us_parts = [
        (
            "us-47-cfr-15-radio-frequency-devices",
            "47 CFR Part 15, Radio Frequency Devices",
            47,
            "15",
            "raw/us/US_47_CFR_Part_15_radio_frequency_devices.xml",
            "Radio-frequency, Wi-Fi, Bluetooth, unintentional radiator, and electronics EMC checks.",
            ["electronics", "radio"],
            ["radio", "emc"],
        ),
        (
            "us-16-cfr-1107-testing-certification",
            "16 CFR Part 1107, Testing and Labeling Pertaining to Product Certification",
            16,
            "1107",
            "raw/us/US_16_CFR_Part_1107_testing_certification.xml",
            "Children-product testing, certification, and conformity evidence.",
            ["children_products", "general_consumer_products"],
            ["testing", "conformity"],
        ),
        (
            "us-16-cfr-1110-certificates-compliance",
            "16 CFR Part 1110, Certificates of Compliance",
            16,
            "1110",
            "raw/us/US_16_CFR_Part_1110_certificates_compliance.xml",
            "Certificate data requirements for consumer products subject to CPSC rules.",
            ["general_consumer_products"],
            ["conformity", "documentation"],
        ),
        (
            "us-16-cfr-1500-hazardous-substances",
            "16 CFR Part 1500, Hazardous Substances and Articles",
            16,
            "1500",
            "raw/us/US_16_CFR_Part_1500_hazardous_substances.xml",
            "Hazardous-substance, labelling, and children-product hazard coverage.",
            ["children_products", "chemicals"],
            ["chemical", "labelling", "product_safety"],
        ),
        (
            "us-16-cfr-1501-small-parts",
            "16 CFR Part 1501, Small Parts",
            16,
            "1501",
            "raw/us/US_16_CFR_Part_1501_small_parts.xml",
            "Small-parts mechanical choking hazard checks for toys and child-use articles.",
            ["toys", "children_products"],
            ["product_safety", "mechanical"],
        ),
        (
            "us-16-cfr-1610-textile-flammability",
            "16 CFR Part 1610, Standard for the Flammability of Clothing Textiles",
            16,
            "1610",
            "raw/us/US_16_CFR_Part_1610_textile_flammability.xml",
            "Apparel and textile flammability classification and test-method coverage.",
            ["textiles", "apparel"],
            ["flammability", "testing"],
        ),
        (
            "us-16-cfr-1615-childrens-sleepwear-0-6x",
            "16 CFR Part 1615, Standard for the Flammability of Children's Sleepwear: Sizes 0 Through 6X",
            16,
            "1615",
            "raw/us/US_16_CFR_Part_1615_childrens_sleepwear_0_6x.xml",
            "Children's sleepwear flammability requirements for smaller sizes.",
            ["textiles", "children_products", "apparel"],
            ["flammability", "testing"],
        ),
        (
            "us-16-cfr-1616-childrens-sleepwear-7-14",
            "16 CFR Part 1616, Standard for the Flammability of Children's Sleepwear: Sizes 7 Through 14",
            16,
            "1616",
            "raw/us/US_16_CFR_Part_1616_childrens_sleepwear_7_14.xml",
            "Children's sleepwear flammability requirements for larger sizes.",
            ["textiles", "children_products", "apparel"],
            ["flammability", "testing"],
        ),
        (
            "us-16-cfr-1632-mattresses",
            "16 CFR Part 1632, Standard for the Flammability of Mattresses and Mattress Pads",
            16,
            "1632",
            "raw/us/US_16_CFR_Part_1632_mattresses.xml",
            "Household soft goods and mattress flammability baseline.",
            ["furniture", "home_goods", "textiles"],
            ["flammability", "testing"],
        ),
        (
            "us-21-cfr-177-food-contact-polymers",
            "21 CFR Part 177, Indirect Food Additives: Polymers",
            21,
            "177",
            "raw/us/US_21_CFR_Part_177_food_contact_polymers.xml",
            "Food-contact plastics and polymers for kitchenware, packaging, and utensils.",
            ["food_contact", "plastics", "packaging", "kitchenware"],
            ["chemical", "food_contact"],
        ),
    ]

    for entry_id, title, title_no, part, file_rel, why, categories, reg_types in us_parts:
        url = f"https://www.ecfr.gov/api/versioner/v1/full/{ECFR_DATE}/title-{title_no}.xml?part={part}"
        collector.download(url, file_rel, force=True, min_bytes=1000)
        entries.append(
            make_entry(
                entry_id,
                "US",
                title,
                f"eCFR API ({ECFR_DATE})",
                url,
                [file_rel],
                why,
                categories,
                reg_types,
            )
        )


def add_existing_collected_entries(entries: list[dict[str, Any]]) -> None:
    entries.extend(
        [
            make_entry(
                "uk-product-safety-advice-businesses",
                "UK",
                "Product safety advice for businesses",
                "GOV.UK / OPSS",
                "https://www.gov.uk/guidance/product-safety-advice-for-businesses",
                ["raw/uk/UK_product_safety_advice_for_businesses.html"],
                "General UK consumer-product safety obligations, recalls, reporting, enforcement, and labelling context.",
                ["general_consumer_products"],
                ["product_safety", "market_surveillance"],
            ),
            make_entry(
                "uk-toys-safety-regulations-2011-gb",
                "UK",
                "Toys (Safety) Regulations 2011: Great Britain",
                "GOV.UK / OPSS",
                "https://www.gov.uk/government/publications/toys-safety-regulations-2011/toys-safety-regulations-2011-great-britain",
                ["raw/uk/UK_toys_safety_regulations_2011_gb.html"],
                "UK/GB toy safety duties, conformity assessment, labelling, and importer obligations.",
                ["toys", "children_products"],
                ["product_safety", "conformity", "labelling"],
            ),
            make_entry(
                "uk-electrical-equipment-safety-regulations-2016-gb",
                "UK",
                "Electrical Equipment (Safety) Regulations 2016: Great Britain",
                "GOV.UK / OPSS",
                "https://www.gov.uk/government/publications/electrical-equipment-safety-regulations-2016/electrical-equipment-safety-regulations-2016-great-britain",
                ["raw/uk/UK_electrical_equipment_safety_regulations_2016_gb.html"],
                "Electrical product safety, CE/UKCA, documentation, and supply-chain duties.",
                ["electronics", "electrical_equipment"],
                ["product_safety", "conformity"],
            ),
            make_entry(
                "uk-emc-regulations-2016-gb",
                "UK",
                "Electromagnetic Compatibility Regulations 2016: Great Britain",
                "GOV.UK / OPSS",
                "https://www.gov.uk/government/publications/electromagnetic-compatibility-regulations-2016/electromagnetic-compatibility-regulations-2016-great-britain",
                ["raw/uk/UK_emc_regulations_2016_gb.html"],
                "EMC duties for electrical/electronic apparatus and fixed installations.",
                ["electronics"],
                ["emc", "conformity"],
            ),
            make_entry(
                "uk-radio-equipment-regulations-2017-gb",
                "UK",
                "Radio Equipment Regulations 2017: Great Britain",
                "GOV.UK / OPSS",
                "https://www.gov.uk/government/publications/radio-equipment-regulations-2017/radio-equipment-regulations-2017-great-britain",
                ["raw/uk/UK_radio_equipment_regulations_2017_gb.html"],
                "Radio and wireless-product conformity, spectrum, and importer obligations.",
                ["electronics", "radio"],
                ["radio", "conformity"],
            ),
            make_entry(
                "uk-cosmetic-products-enforcement-regulations-2013-gb",
                "UK",
                "Regulation 2009/1223 and the Cosmetic Products Enforcement Regulations 2013: Great Britain",
                "GOV.UK / OPSS",
                "https://www.gov.uk/government/publications/cosmetic-products-enforcement-regulations-2013/regulation-20091223-and-the-cosmetic-products-enforcement-regulations-2013-great-britain",
                ["raw/uk/UK_cosmetic_products_enforcement_regulations_2013_gb.html"],
                "UK/GB cosmetics responsible-person, safety report, PIF, notification, and labelling coverage.",
                ["cosmetics"],
                ["product_safety", "chemical", "labelling"],
            ),
        ]
    )

    canada_specs = [
        (
            "ca-consumer-product-safety-act",
            "Canada Consumer Product Safety Act",
            "https://laws-lois.justice.gc.ca/eng/XML/C-1.68.xml",
            "raw/ca/CA_consumer_product_safety_act.xml",
            "Core Canada consumer-product prohibition, incident, document-retention, and enforcement framework.",
            ["general_consumer_products"],
            ["product_safety", "market_surveillance"],
        ),
        (
            "ca-toys-regulations-sor-2011-17",
            "Toys Regulations (SOR/2011-17)",
            "https://laws-lois.justice.gc.ca/eng/XML/SOR-2011-17.xml",
            "raw/ca/CA_toys_regulations_SOR-2011-17.xml",
            "Canada toy mechanical, chemical, electrical, and hazard requirements.",
            ["toys", "children_products"],
            ["product_safety", "chemical", "mechanical"],
        ),
        (
            "ca-cosmetics-regulations-crc-c-869",
            "Cosmetic Regulations (C.R.C., c. 869)",
            "https://laws-lois.justice.gc.ca/eng/XML/C.R.C.,_c._869.xml",
            "raw/ca/CA_cosmetics_regulations_CRC_c_869.xml",
            "Canada cosmetics safety, labelling, notification, and ingredient controls.",
            ["cosmetics"],
            ["product_safety", "chemical", "labelling"],
        ),
        (
            "ca-textile-labelling-advertising-regulations-crc-c-1551",
            "Textile Labelling and Advertising Regulations (C.R.C., c. 1551)",
            "https://laws-lois.justice.gc.ca/eng/XML/C.R.C.,_c._1551.xml",
            "raw/ca/CA_textile_labelling_advertising_regulations_CRC_c_1551.xml",
            "Canada textile fibre-content and labelling coverage.",
            ["textiles", "apparel"],
            ["labelling"],
        ),
        (
            "ca-consumer-packaging-labelling-regulations-crc-c-417",
            "Consumer Packaging and Labelling Regulations (C.R.C., c. 417)",
            "https://laws-lois.justice.gc.ca/eng/XML/C.R.C.,_c._417.xml",
            "raw/ca/CA_consumer_packaging_labelling_regulations_CRC_c_417.xml",
            "Canada packaging, label declaration, identity, quantity, and dealer information coverage.",
            ["packaging", "general_consumer_products"],
            ["labelling", "packaging"],
        ),
    ]
    for entry_id, title, url, file_rel, why, categories, reg_types in canada_specs:
        entries.append(make_entry(entry_id, "CA", title, "Justice Laws Website, Government of Canada", url, [file_rel], why, categories, reg_types))

    entries.extend(
        [
            make_entry(
                "au-button-coin-batteries-safety-standard-2020",
                "AU",
                "Consumer Goods (Products Containing Button/Coin Batteries) Safety Standard 2020",
                "Federal Register of Legislation",
                "https://www.legislation.gov.au/F2020L01658/asmade/2020-12-21/text/original/pdf",
                ["raw/au/AU_button_coin_batteries_safety_standard_2020.pdf"],
                "Button/coin-battery secure compartment, warning, and safety coverage for consumer products.",
                ["batteries", "electronics", "children_products"],
                ["product_safety", "labelling"],
            ),
            make_entry(
                "au-toys-children-36-months-safety-standard-2023",
                "AU",
                "Consumer Goods (Toys for Children up to and including 36 Months of Age) Safety Standard 2023",
                "Federal Register of Legislation",
                "https://www.legislation.gov.au/F2023L01185/asmade/2023-09-04/text/original/pdf",
                ["raw/au/AU_toys_children_36_months_safety_standard_2023.pdf"],
                "Australia toy small-parts and young-child safety coverage.",
                ["toys", "children_products"],
                ["product_safety", "mechanical"],
            ),
            make_entry(
                "au-childrens-nightwear-safety-standard-2017",
                "AU",
                "Consumer Goods (Children's Nightwear and Limited Daywear and Paper Patterns for Children's Nightwear) Safety Standard 2017",
                "Federal Register of Legislation",
                "https://www.legislation.gov.au/F2017L00452/2019-02-13/2019-02-13/text/original/pdf",
                ["raw/au/AU_childrens_nightwear_safety_standard_2017.pdf"],
                "Australia children's apparel flammability and labelling coverage.",
                ["textiles", "children_products", "apparel"],
                ["flammability", "labelling"],
            ),
            make_entry(
                "au-cosmetics-ingredients-information-standard-2020",
                "AU",
                "Consumer Goods (Cosmetics) Information Standard 2020",
                "Federal Register of Legislation",
                "https://www.legislation.gov.au/F2020L01469/asmade/2020-11-24/text/original/pdf",
                ["raw/au/AU_cosmetics_ingredients_information_standard_2020.pdf"],
                "Australia cosmetics ingredient labelling and consumer information coverage.",
                ["cosmetics"],
                ["labelling", "product_safety"],
            ),
            make_entry(
                "jp-electrical-appliance-material-safety-act",
                "JP",
                "Electrical Appliance and Material Safety Act",
                "Japanese Law Translation",
                "https://www.japaneselawtranslation.go.jp/en/laws/view/47/en",
                ["raw/jp/JP_electrical_appliances_materials_safety_act.pdf"],
                "Japan PSE electrical appliance safety law coverage.",
                ["electronics", "electrical_equipment"],
                ["product_safety", "conformity"],
            ),
            make_entry(
                "jp-consumer-product-safety-act",
                "JP",
                "Consumer Product Safety Act",
                "Japanese Law Translation",
                "https://www.japaneselawtranslation.go.jp/en/laws/view/82/en",
                ["raw/jp/JP_consumer_product_safety_act.pdf"],
                "Japan general consumer-product safety, specified products, reporting, and enforcement framework.",
                ["general_consumer_products"],
                ["product_safety", "market_surveillance"],
            ),
            make_entry(
                "jp-food-sanitation-act",
                "JP",
                "Food Sanitation Act",
                "Japanese Law Translation",
                "https://www.japaneselawtranslation.go.jp/en/laws/view/5024/en",
                ["raw/jp/JP_food_sanitation_act.pdf"],
                "Japan food, utensils, containers, and packaging sanitary baseline.",
                ["food_contact", "kitchenware", "packaging"],
                ["food_contact", "chemical"],
            ),
            make_entry(
                "jp-technical-standards-electrical-appliances-materials",
                "JP",
                "Ministerial Order to Provide Technical Standards for Electrical Appliances and Materials",
                "Japanese Law Translation",
                "https://www.japaneselawtranslation.go.jp/en/laws/view/2961/en",
                ["raw/jp/JP_technical_standards_electrical_appliances.html"],
                "Detailed technical standards for Japan electrical appliance/material safety checks.",
                ["electronics", "electrical_equipment"],
                ["product_safety", "technical_standard"],
            ),
            make_entry(
                "sg-cpsr-overview",
                "SG",
                "Consumer Protection (Safety Requirements) Regulations overview",
                "Consumer Product Safety Office Singapore",
                "https://www.consumerproductsafety.gov.sg/suppliers/cpsr/overview-of-cpsr/",
                ["raw/sg/SG_cpsr_overview.html"],
                "Singapore controlled-goods safety mark and supplier obligations overview.",
                ["controlled_goods", "electronics"],
                ["product_safety", "conformity"],
            ),
            make_entry(
                "sg-cpsr-controlled-goods-list",
                "SG",
                "List of controlled goods under CPSR",
                "Consumer Product Safety Office Singapore",
                "https://www.consumerproductsafety.gov.sg/suppliers/cpsr/list-of-controlled-goods/",
                ["raw/sg/SG_cpsr_controlled_goods_list.html"],
                "Singapore controlled-goods category list for scope classification.",
                ["controlled_goods", "electronics", "home_appliances"],
                ["scope_classification", "conformity"],
            ),
            make_entry(
                "sg-consumer-protection-safety-requirements-regulations-2002",
                "SG",
                "Consumer Protection (Safety Requirements) Regulations 2002",
                "Singapore Statutes Online",
                "https://sso.agc.gov.sg/SL-Supp/S23-2002/Published?DocDate=20020110&ProvIds=Sc1-",
                ["raw/sg/SG_consumer_protection_safety_requirements_regulations_2002.html"],
                "Original Singapore subsidiary legislation for safety requirements controlled goods.",
                ["controlled_goods", "electronics"],
                ["product_safety", "conformity"],
            ),
            make_entry(
                "sg-consumer-product-safety-regulations-ccs",
                "SG",
                "Consumer Product Safety Regulations",
                "Competition and Consumer Commission of Singapore",
                "https://www.ccs.gov.sg/consumer-protection/legislation-and-guidelines/consumer-product-safety-regulations/",
                ["raw/sg/SG_consumer_product_safety_regulations_ccs.html"],
                "Singapore consumer product safety regulatory overview for broader product coverage.",
                ["general_consumer_products"],
                ["product_safety"],
            ),
        ]
    )


def add_korea_entries(collector: Collector, entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "kr-electrical-appliances-consumer-products-safety-control-act",
            "Electrical Appliances and Consumer Products Safety Control Act",
            "https://elaw.klri.re.kr/eng_service/lawTwoView.do?hseq=45624",
            "raw/kr/KR_electrical_appliances_consumer_products_safety_control_act.html",
            "Korea KC electrical appliance and consumer product safety-control coverage.",
            ["electronics", "electrical_equipment", "general_consumer_products"],
            ["product_safety", "conformity"],
        ),
        (
            "kr-radio-waves-act",
            "Radio Waves Act",
            "https://elaw.klri.re.kr/eng_service/lawTwoView.do?hseq=61445",
            "raw/kr/KR_radio_waves_act.html",
            "Korea radio equipment, spectrum, certification, and wireless-device context.",
            ["electronics", "radio"],
            ["radio", "conformity"],
        ),
        (
            "kr-cosmetics-act",
            "Cosmetics Act",
            "https://elaw.klri.re.kr/eng_service/lawTwoView.do?hseq=68854",
            "raw/kr/KR_cosmetics_act.html",
            "Korea cosmetics safety, labelling, importer/manufacturer, and advertising controls.",
            ["cosmetics"],
            ["product_safety", "labelling", "chemical"],
        ),
        (
            "kr-food-sanitation-act",
            "Food Sanitation Act",
            "https://elaw.klri.re.kr/eng_service/lawTwoView.do?hseq=46429",
            "raw/kr/KR_food_sanitation_act.html",
            "Korea food-contact utensils, containers, packaging, and sanitary product baseline.",
            ["food_contact", "kitchenware", "packaging"],
            ["food_contact", "chemical"],
        ),
    ]
    for entry_id, title, url, file_rel, why, categories, reg_types in specs:
        collector.download(url, file_rel, min_bytes=5000)
        entries.append(
            make_entry(
                entry_id,
                "KR",
                title,
                "Korean Law Translation Center / KLRI",
                url,
                [file_rel],
                why,
                categories,
                reg_types,
            )
        )


def add_india_entries(collector: Collector, entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "in-toys-quality-control-order-2020",
            "Toys (Quality Control) Order, 2020",
            "https://www.bis.gov.in/wp-content/uploads/2020/03/Toy_QC_order.pdf",
            "raw/in/IN_toys_quality_control_order_2020.pdf",
            "India BIS toy conformity and quality-control order coverage.",
            ["toys", "children_products"],
            ["product_safety", "conformity"],
        ),
        (
            "in-battery-waste-management-rules-2022",
            "Battery Waste Management Rules, 2022",
            "https://cpcb.nic.in/uploads/hwmd/Battery-WasteManagementRules-2022.pdf",
            "raw/in/IN_battery_waste_management_rules_2022.pdf",
            "India battery producer responsibility, labelling, collection, and recycling framework.",
            ["batteries"],
            ["sustainability", "waste", "labelling"],
        ),
        (
            "in-e-waste-management-rules-2022",
            "E-Waste (Management) Rules, 2022",
            "https://moef.gov.in/uploads/2022/11/E-Waste-Management-Rules-2022.pdf",
            "raw/in/IN_e_waste_management_rules_2022.pdf",
            "India electronics/e-waste extended producer responsibility and channelization rules.",
            ["electronics"],
            ["sustainability", "waste"],
        ),
    ]
    for entry_id, title, url, file_rel, why, categories, reg_types in specs:
        collector.download(url, file_rel, min_bytes=1000)
        entries.append(make_entry(entry_id, "IN", title, "Government of India official source", url, [file_rel], why, categories, reg_types))


def add_brazil_entries(collector: Collector, entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "br-anatel-resolution-715-2019-telecom-products",
            "Anatel Resolution No. 715/2019, conformity assessment and approval of telecommunications products",
            "https://informacoes.anatel.gov.br/legislacao/resolucoes/2019/1350-resolucao-715",
            "raw/br/BR_anatel_resolution_715_2019_telecom_products.html",
            "Brazil telecom/radio product approval framework for connected devices.",
            ["electronics", "radio", "telecommunications"],
            ["radio", "conformity"],
        ),
        (
            "br-anatel-resolution-780-2023-telecom-products",
            "Anatel Resolution No. 780/2023",
            "https://informacoes.anatel.gov.br/legislacao/resolucoes/2023/1852-resolucao-780",
            "raw/br/BR_anatel_resolution_780_2023.html",
            "Brazil Anatel update coverage for telecom-product regulatory checks.",
            ["electronics", "radio", "telecommunications"],
            ["radio", "conformity"],
        ),
    ]
    for entry_id, title, url, file_rel, why, categories, reg_types in specs:
        collector.download(url, file_rel, min_bytes=5000)
        entries.append(make_entry(entry_id, "BR", title, "Anatel Legislation Portal", url, [file_rel], why, categories, reg_types))


def add_mexico_entries(collector: Collector, entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "mx-nom-001-scfi-2018-electronic-apparatus",
            "NOM-001-SCFI-2018, Electronic apparatus - safety requirements and test methods",
            "https://platiica.economia.gob.mx/normalizacion/nom-001-scfi-2018/",
            "raw/mx/MX_NOM_001_SCFI_2018_electronic_apparatus.html",
            "Mexico electronic apparatus safety NOM coverage.",
            ["electronics"],
            ["product_safety", "testing"],
        ),
        (
            "mx-nom-024-scfi-2013-commercial-information-electrical-electronic-appliances",
            "NOM-024-SCFI-2013, commercial information for electrical, electronic and household appliances",
            "https://platiica.economia.gob.mx/normalizacion/nom-024-scfi-2013/",
            "raw/mx/MX_NOM_024_SCFI_2013_commercial_information_electrical_electronic_appliances.html",
            "Mexico commercial-information/labelling requirements for electrical and electronic products.",
            ["electronics", "home_appliances"],
            ["labelling"],
        ),
        (
            "mx-nom-252-ssa1-2011-toys",
            "NOM-252-SSA1-2011, toys and school articles: health and safety",
            "https://platiica.economia.gob.mx/normalizacion/nom-252-ssa1-2011/",
            "raw/mx/MX_NOM_252_SSA1_2011_toys_health_safety.html",
            "Mexico toy and school-article health and safety NOM coverage.",
            ["toys", "children_products"],
            ["product_safety", "chemical"],
        ),
    ]
    for entry_id, title, url, file_rel, why, categories, reg_types in specs:
        collector.download(url, file_rel, min_bytes=5000)
        entries.append(
            make_entry(
                entry_id,
                "MX",
                title,
                "Secretaria de Economia, Gobierno de Mexico",
                url,
                [file_rel],
                why,
                categories,
                reg_types,
            )
        )


def add_gcc_entries(collector: Collector, entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "gcc-gso-low-voltage-electrical-equipment-technical-regulation",
            "Gulf Technical Regulation for Low Voltage Electrical Equipment and Appliances",
            "https://www.gso.org.sa/wp-content/uploads/2017/11/Gulf-Technical-Regulation-for-Low-Voltage-Electrical-Equipment-and-Appliances-BD-142004-01.pdf",
            "raw/gcc/GCC_GSO_low_voltage_electrical_equipment_technical_regulation.pdf",
            "GCC/GSO low-voltage electrical equipment technical-regulation and G-mark coverage.",
            ["electronics", "electrical_equipment"],
            ["product_safety", "conformity"],
        ),
        (
            "gcc-gso-gmark-toys-guidance",
            "G-Mark HS Toys Guidance, English",
            "https://static.gso.org.sa/gso-public-docs/conformity/g-mark/G-Mark_HS_Toys_Guidance_V1_English.pdf",
            "raw/gcc/GCC_GSO_GMark_HS_toys_guidance_english.pdf",
            "GCC/GSO toy G-mark category and conformity guidance coverage.",
            ["toys", "children_products"],
            ["product_safety", "conformity"],
        ),
    ]
    for entry_id, title, url, file_rel, why, categories, reg_types in specs:
        collector.download(url, file_rel, min_bytes=1000)
        entries.append(make_entry(entry_id, "GCC", title, "GCC Standardization Organization (GSO)", url, [file_rel], why, categories, reg_types))


def make_entry(
    entry_id: str,
    market: str,
    title: str,
    channel: str,
    source_url: str,
    files: list[str],
    why_added: str,
    product_categories: list[str],
    regulatory_types: list[str],
) -> dict[str, Any]:
    return {
        "id": entry_id,
        "market": market,
        "title": title,
        "channel": channel,
        "source_url": source_url,
        "files": files,
        "why_added": why_added,
        "product_categories": product_categories,
        "regulatory_types": regulatory_types,
    }


def build_readme(manifest: dict[str, Any]) -> str:
    summary = manifest["summary"]
    return f"""# Global Regulation Supplement 2026-05-26

This directory contains isolated raw official or government-source regulation documents collected for review before ingestion.

## Scope

- Collected at: {manifest["created_at"]}
- Entries collected: {summary["regulation_entries"]}
- Raw files referenced: {summary["raw_files"]}
- Failed downloads: {summary["failed_downloads"]}
- Markets: {", ".join(summary["markets"])}
- Source manifest: manifest.json

## Coverage Themes

- Electronics, electrical equipment, radio/EMC, connected products
- Batteries, e-waste, packaging, sustainability and waste obligations
- Toys, children products, small parts, flammability and apparel/textiles
- Cosmetics, chemicals, food-contact materials, kitchenware and packaging
- General product safety, conformity assessment, labelling, documentation and market surveillance

## Notes

- Files remain isolated from `data/corpus/processed/` and `data/faiss/` until reviewed.
- This batch complements `2026-05-25_official_sources`, which already contains CN CCC, EU cyber/ecodesign/product-liability/common-charger, UK PSTI/UKCA, and US toy/button-battery/magnet/lead-paint entries.
- US eCFR browser pages may require access checks, so raw US files use the official eCFR API XML endpoint.
- EU files use Publications Office RDF metadata plus resolved Cellar XHTML document files where available.
- PDF-heavy entries will need the project PDF parser path before ingestion.
"""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def as_posix(path: Path) -> str:
    return path.as_posix()


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect global official regulation source files.")
    parser.add_argument("--supplement-dir", type=Path, default=DEFAULT_SUPPLEMENT_DIR)
    args = parser.parse_args()

    collector = Collector(args.supplement_dir)
    manifest = collector.build_manifest()
    collector.write_outputs(manifest)
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
