#!/usr/bin/env python3
"""Collect a gap-fill batch of official legal/regulatory source files."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import subprocess
import time
from pathlib import Path
from typing import Any

import requests
import urllib3


DEFAULT_SUPPLEMENT_DIR = Path("data/regulation_supplements/2026-05-27_coverage_gap_official_sources")
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
)


class Collector:
    def __init__(self, supplement_dir: Path) -> None:
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        self.supplement_dir = supplement_dir
        self.raw_dir = supplement_dir / "raw"
        self.failures: list[dict[str, Any]] = []
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": USER_AGENT,
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.9",
            }
        )

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
                response = self.session.get(url, timeout=90, allow_redirects=True, verify=False)
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
                    "-k",
                    "--ssl-no-revoke",
                    "--fail",
                    "--max-time",
                    "120",
                    "-A",
                    USER_AGENT,
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

    def build_manifest(self) -> dict[str, Any]:
        entries = build_entries()
        raw_file_set: set[str] = set()

        for manifest_entry in entries:
            downloads = manifest_entry.pop("_downloads", [])
            for download in downloads:
                self.download(
                    download["url"],
                    download["file"],
                    min_bytes=download.get("min_bytes", 128),
                )

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
                "failed_downloads": len(self.failures),
            },
            "entries": entries,
            "notes": [
                "This supplement is a raw official-source collection only; it has not been ingested into data/corpus/processed or data/faiss.",
                "The batch targets weaker market/category coverage: Japan, Korea, Singapore, India, Mexico, Brazil, GCC, and New Zealand.",
                "Original formats are preserved where public official sources provide them: PDF, DOCX, XML, and official HTML.",
                "Some jurisdictions publish standards behind paid standards portals; this batch keeps official government pages where the full standard PDF is not public.",
            ],
        }

    def write_outputs(self, manifest: dict[str, Any]) -> None:
        self.supplement_dir.mkdir(parents=True, exist_ok=True)
        (self.supplement_dir / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        (self.supplement_dir / "README.md").write_text(build_readme(manifest), encoding="utf-8")
        (self.supplement_dir / "ingestion_report.json").write_text(
            json.dumps(
                {
                    "status": "raw_only_not_ingested",
                    "created_at": manifest["created_at"],
                    "failed_downloads": manifest["summary"]["failed_downloads"],
                    "failures": self.failures,
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )


def build_entries() -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    add_japan_entries(entries)
    add_korea_entries(entries)
    add_singapore_entries(entries)
    add_india_entries(entries)
    add_mexico_entries(entries)
    add_brazil_entries(entries)
    add_new_zealand_entries(entries)
    add_gcc_entries(entries)
    return entries


def add_japan_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "jp-jlt-consumer-product-safety-act-2804",
            "Consumer Product Safety Act",
            "2804",
            "s48Aa000310403en7.0_h23A122",
            "Japan general consumer-product safety, specified products, reporting, recall, and enforcement framework.",
            ["general_consumer_products", "home_goods"],
            ["product_safety", "market_surveillance"],
        ),
        (
            "jp-jlt-household-goods-quality-labeling-act-3935",
            "Household Goods Quality Labeling Act",
            "3935",
            "s37Aa001040401en14.0_h23A122",
            "Japan household goods quality and composition labeling baseline.",
            ["general_consumer_products", "textiles", "home_goods"],
            ["labelling", "documentation"],
        ),
        (
            "jp-jlt-household-products-harmful-substances-act-3881",
            "Act on Control of Household Products Containing Harmful Substances",
            "3881",
            "s48Aa001120301en14.0_h21A49",
            "Japan household-product chemical restrictions for textiles, home goods, and consumer articles.",
            ["chemicals", "textiles", "children_products", "home_goods"],
            ["chemical", "product_safety"],
        ),
        (
            "jp-jlt-electrical-appliances-materials-safety-act-2745",
            "Electrical Appliances and Materials Safety Act",
            "2745",
            "s36Aa002340306en7.0_h23A122",
            "Japan PSE electrical-appliance safety and conformity framework.",
            ["electronics", "electrical_equipment", "home_appliances"],
            ["product_safety", "conformity", "testing"],
        ),
        (
            "jp-jlt-electrical-appliances-materials-enforcement-regulation-3006",
            "Regulation for Enforcement of the Electrical Appliances and Materials Safety Act",
            "3006",
            "h37Coj00840103en11.0_h28O43",
            "Japan PSE enforcement detail for electrical products and materials.",
            ["electronics", "electrical_equipment", "home_appliances"],
            ["product_safety", "technical_standard", "conformity"],
        ),
        (
            "jp-jlt-food-sanitation-act-5024",
            "Food Sanitation Act",
            "5024",
            "s22Aa002330305en16.0_r5A36",
            "Japan food-contact utensils, containers, packaging, and kitchenware sanitary baseline.",
            ["food_contact", "kitchenware", "packaging"],
            ["food_contact", "chemical", "product_safety"],
        ),
        (
            "jp-jlt-pharmaceutical-medical-devices-act-3213",
            "Act on Securing Quality, Efficacy and Safety of Products Including Pharmaceuticals and Medical Devices",
            "3213",
            "s35Aa001450204en8.0_h27A50",
            "Japan cosmetics, quasi-drugs, and product-quality baseline under the PMD Act.",
            ["cosmetics", "general_consumer_products"],
            ["product_safety", "labelling", "chemical"],
        ),
    ]
    for entry_id, title, law_id, file_stem, why, categories, reg_types in specs:
        base = f"https://www.japaneselawtranslation.go.jp/en/laws"
        slug = entry_id.removeprefix("jp-jlt-")
        html_rel = f"raw/jp/{slug}.html"
        pdf_rel = f"raw/jp/{slug}.pdf"
        docx_rel = f"raw/jp/{slug}.docx"
        xml_rel = f"raw/jp/{slug}.xml"
        entry = make_entry(
            entry_id,
            "JP",
            title,
            "Japanese Law Translation, Ministry of Justice",
            f"{base}/view/{law_id}/en",
            [html_rel, pdf_rel, docx_rel, xml_rel],
            why,
            categories,
            reg_types,
            source_type="japan_law_translation",
        )
        entry["jlt_law_id"] = law_id
        entry["_downloads"] = [
            {"url": f"{base}/view/{law_id}/en", "file": html_rel, "min_bytes": 1000},
            {"url": f"{base}/download/{law_id}/09/{file_stem}.pdf", "file": pdf_rel, "min_bytes": 1000},
            {"url": f"{base}/download/{law_id}/10/{file_stem}.docx", "file": docx_rel, "min_bytes": 1000},
            {"url": f"{base}/download/{law_id}/06/{file_stem}.xml", "file": xml_rel, "min_bytes": 1000},
        ]
        entries.append(entry)


def add_korea_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "kr-klri-framework-act-safety-products-52809",
            "Framework Act on the Safety of Products",
            "52809",
            "Korea cross-product product-safety policy, recall, and safety-management framework.",
            ["general_consumer_products", "children_products"],
            ["product_safety", "market_surveillance"],
        ),
        (
            "kr-klri-special-act-safety-childrens-products-60495",
            "Special Act on the Safety of Children's Products",
            "60495",
            "Korea child-product certification, safety confirmation, and supplier conformity framework.",
            ["children_products", "toys"],
            ["product_safety", "conformity", "testing"],
        ),
        (
            "kr-klri-electrical-appliances-consumer-products-safety-control-act-61394",
            "Electrical Appliances and Consumer Products Safety Control Act",
            "61394",
            "Korea KC electrical-appliance and consumer-product safety-control coverage.",
            ["electronics", "electrical_equipment", "home_appliances", "general_consumer_products"],
            ["product_safety", "conformity", "testing"],
        ),
        (
            "kr-klri-food-sanitation-act-46429",
            "Food Sanitation Act",
            "46429",
            "Korea food-contact utensils, containers, packaging, and sanitary safety baseline.",
            ["food_contact", "kitchenware", "packaging"],
            ["food_contact", "chemical", "labelling"],
        ),
        (
            "kr-klri-cosmetics-act-68854",
            "Cosmetics Act",
            "68854",
            "Korea cosmetics safety, labeling, importer/manufacturer, and advertising controls.",
            ["cosmetics"],
            ["product_safety", "labelling", "chemical"],
        ),
        (
            "kr-klri-k-reach-48870",
            "Act on Registration and Evaluation of Chemical Substances",
            "48870",
            "Korea K-REACH chemical registration and evaluation coverage for imported substances and articles.",
            ["chemicals", "raw_materials", "general_consumer_products"],
            ["chemical", "documentation"],
        ),
        (
            "kr-klri-chemical-substances-control-act-55950",
            "Chemical Substances Control Act",
            "55950",
            "Korea hazardous-chemical handling, labelling, and control context.",
            ["chemicals", "industrial_products"],
            ["chemical", "labelling", "market_surveillance"],
        ),
        (
            "kr-klri-radio-waves-act-61445",
            "Radio Waves Act",
            "61445",
            "Korea radio equipment, spectrum, certification, and wireless-device context.",
            ["electronics", "radio", "telecommunications"],
            ["radio", "conformity", "emc"],
        ),
    ]
    for entry_id, title, hseq, why, categories, reg_types in specs:
        file_rel = f"raw/kr/{entry_id.removeprefix('kr-klri-')}.html"
        entry = make_entry(
            entry_id,
            "KR",
            title,
            "Korean Law Translation Center / KLRI",
            f"https://elaw.klri.re.kr/eng_service/lawView.do?hseq={hseq}&lang=ENG",
            [file_rel],
            why,
            categories,
            reg_types,
            source_type="klri_html",
        )
        entry["klri_hseq"] = hseq
        entry["_downloads"] = [
            {
                "url": f"https://elaw.klri.re.kr/eng_service/lawViewContent.do?hseq={hseq}&lang=ENG",
                "file": file_rel,
                "min_bytes": 5000,
            }
        ]
        entries.append(entry)


def add_singapore_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "sg-cpso-cpsr-info-booklet",
            "Consumer Protection (Safety Requirements) Regulations information booklet",
            "Consumer Product Safety Office Singapore",
            "https://www.consumerproductsafety.gov.sg/suppliers/cpsr/overview-of-cpsr/",
            [
                ("https://www.consumerproductsafety.gov.sg/suppliers/cpsr/overview-of-cpsr/", "raw/sg/SG_cpso_cpsr_overview.html", 1000),
                ("https://www.consumerproductsafety.gov.sg/files/cps-info-booklet.pdf", "raw/sg/SG_cpso_cpsr_info_booklet.pdf", 1000),
            ],
            "Singapore controlled-goods CPSR safety mark and supplier obligation source pack.",
            ["controlled_goods", "electronics", "home_appliances"],
            ["product_safety", "conformity", "scope_classification"],
        ),
        (
            "sg-cpso-cgsr-info-book",
            "Consumer Goods Safety Requirements Regulations information book",
            "Consumer Product Safety Office Singapore",
            "https://www.consumerproductsafety.gov.sg/suppliers/cgsr/overview-of-cgsr/",
            [
                ("https://www.consumerproductsafety.gov.sg/suppliers/cgsr/overview-of-cgsr/", "raw/sg/SG_cpso_cgsr_overview.html", 1000),
                ("https://www.consumerproductsafety.gov.sg/files/cgsr-info-book.pdf", "raw/sg/SG_cpso_cgsr_info_book.pdf", 1000),
            ],
            "Singapore general consumer goods safety requirements beyond controlled goods.",
            ["general_consumer_products", "children_products", "home_goods"],
            ["product_safety", "market_surveillance"],
        ),
        (
            "sg-nea-mels-meps-household-sector",
            "Mandatory Energy Labelling Scheme and Minimum Energy Performance Standards",
            "National Environment Agency Singapore",
            "https://www.nea.gov.sg/our-services/climate-change-energy-efficiency/energy-efficiency/household-sector/about-mandatory-energy-labelling-and-minimum-energy-performance-standards",
            [
                (
                    "https://www.nea.gov.sg/our-services/climate-change-energy-efficiency/energy-efficiency/household-sector/about-mandatory-energy-labelling-and-minimum-energy-performance-standards",
                    "raw/sg/SG_nea_mels_meps_household_sector.html",
                    1000,
                ),
                (
                    "https://www.nea.gov.sg/docs/default-source/cmd-documents/energy-efficiency/household-sector/circular-key-amendments-to-the-mels-and-meps-requirements-under-the-energy-conservation-act.pdf",
                    "raw/sg/SG_nea_mels_meps_key_amendments_circular.pdf",
                    1000,
                ),
            ],
            "Singapore appliance energy label and MEPS requirements for household regulated goods.",
            ["home_appliances", "electronics", "electrical_equipment"],
            ["labelling", "sustainability", "technical_standard"],
        ),
        (
            "sg-nea-mandatory-packaging-reporting",
            "Mandatory Packaging Reporting",
            "National Environment Agency Singapore",
            "https://www.nea.gov.sg/our-services/waste-management/mandatory-packaging-reporting",
            [
                ("https://www.nea.gov.sg/our-services/waste-management/mandatory-packaging-reporting", "raw/sg/SG_nea_mandatory_packaging_reporting.html", 1000),
                ("https://www.nea.gov.sg/docs/default-source/mandatory-packaging-reporting/nea-mandatory-packaging-reporting-guidebook.pdf", "raw/sg/SG_nea_mandatory_packaging_reporting_guidebook.pdf", 1000),
            ],
            "Singapore packaging data reporting and 3R plan obligations.",
            ["packaging"],
            ["packaging", "sustainability", "documentation"],
        ),
        (
            "sg-nea-e-waste-epr-system",
            "Extended Producer Responsibility system for e-waste management",
            "National Environment Agency Singapore",
            "https://www.nea.gov.sg/our-services/waste-management/3r-programmes-and-resources/e-waste-management/extended-producer-responsibility-(epr)-system-for-e-waste-management-system",
            [
                (
                    "https://www.nea.gov.sg/our-services/waste-management/3r-programmes-and-resources/e-waste-management/extended-producer-responsibility-(epr)-system-for-e-waste-management-system",
                    "raw/sg/SG_nea_e_waste_epr_system.html",
                    1000,
                ),
                (
                    "https://www.nea.gov.sg/docs/default-source/default-document-library/producer-guidelines-(24-feb-2026).pdf",
                    "raw/sg/SG_nea_e_waste_producer_guidelines_2026.pdf",
                    1000,
                ),
            ],
            "Singapore regulated consumer e-waste and producer responsibility implementation guidance.",
            ["electronics", "waste_electrical"],
            ["sustainability", "waste", "documentation"],
        ),
    ]
    for entry_id, title, channel, source_url, downloads, why, categories, reg_types in specs:
        files = [file_rel for _, file_rel, _ in downloads]
        entry = make_entry(
            entry_id,
            "SG",
            title,
            channel,
            source_url,
            files,
            why,
            categories,
            reg_types,
            source_type="official_html_pdf",
        )
        entry["_downloads"] = [
            {"url": url, "file": file_rel, "min_bytes": min_bytes}
            for url, file_rel, min_bytes in downloads
        ]
        entries.append(entry)


def add_india_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "in-cpcb-plastic-waste-management-rules",
            "Plastic Waste Management Rules, 2016 and amendments",
            "Central Pollution Control Board, Government of India",
            "https://cpcb.nic.in/plastic-waste-rules/",
            [
                ("https://cpcb.nic.in/plastic-waste-rules/", "raw/in/IN_cpcb_plastic_waste_rules.html", 1000),
                ("https://cpcb.nic.in/uploads/plasticwaste/PWM_Gazette.pdf", "raw/in/IN_plastic_waste_management_rules_2016.pdf", 1000),
                ("https://cpcb.nic.in/uploads/plasticwaste/2-amendment-pwmrules-2022.pdf", "raw/in/IN_plastic_waste_management_rules_2022_amendment.pdf", 1000),
            ],
            "India plastic packaging and EPR framework for packaging-heavy product categories.",
            ["packaging", "plastics", "general_consumer_products"],
            ["packaging", "sustainability", "waste"],
        ),
        (
            "in-cpcb-e-waste-rules-portal",
            "E-Waste (Management) Rules portal and 2022 rules",
            "Central Pollution Control Board, Government of India",
            "https://www.cpcb.nic.in/e-waste/",
            [
                ("https://www.cpcb.nic.in/e-waste/", "raw/in/IN_cpcb_e_waste_rules_portal.html", 1000),
                ("https://cpcb.nic.in/uploads/Projects/E-Waste/e-waste_rules_2022.pdf", "raw/in/IN_cpcb_e_waste_management_rules_2022.pdf", 1000),
            ],
            "India electronics EPR and waste-management implementation portal with official rules PDF.",
            ["electronics", "waste_electrical"],
            ["sustainability", "waste", "documentation"],
        ),
        (
            "in-cdsco-cosmetics-rules-2020",
            "Cosmetics Rules, 2020",
            "Central Drugs Standard Control Organisation, Government of India",
            "https://cdsco.gov.in/opencms/opencms/en/Acts-and-rules/Cosmetics-Rules/",
            [
                ("https://cdsco.gov.in/opencms/opencms/en/Acts-and-rules/Cosmetics-Rules/", "raw/in/IN_cdsco_cosmetics_rules_2020_page.html", 1000),
                ("https://cdsco.gov.in/opencms/resources/UploadCDSCOWeb/2022/cos_rules/Cosmetics%20Rules%202020.pdf", "raw/in/IN_cdsco_cosmetics_rules_2020.pdf", 1000),
                ("https://cdsco.gov.in/opencms/resources/UploadCDSCOWeb/2022/cos_rules/CR_G.S.R.%20763(E)%20dt_15.12.2020_COSMETICS%20RULES%202020.pdf", "raw/in/IN_cdsco_cosmetics_rules_2020_gsr_763.pdf", 1000),
            ],
            "India cosmetics import, registration, labelling, and safety rules.",
            ["cosmetics"],
            ["product_safety", "labelling", "chemical"],
        ),
    ]
    for entry_id, title, channel, source_url, downloads, why, categories, reg_types in specs:
        files = [file_rel for _, file_rel, _ in downloads]
        entry = make_entry(
            entry_id,
            "IN",
            title,
            channel,
            source_url,
            files,
            why,
            categories,
            reg_types,
            source_type="official_html_pdf",
        )
        entry["_downloads"] = [
            {"url": url, "file": file_rel, "min_bytes": min_bytes}
            for url, file_rel, min_bytes in downloads
        ]
        entries.append(entry)


def add_mexico_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "mx-platiica-nom-050-scfi-2004-general-labelling",
            "NOM-050-SCFI-2004, commercial information and general product labelling",
            "https://platiica.economia.gob.mx/normalizacion/nom-050-scfi-2004/",
            "050scfi.pdf",
            "Mexico general consumer product commercial information and labelling baseline.",
            ["general_consumer_products", "packaging"],
            ["labelling", "documentation"],
        ),
        (
            "mx-platiica-nom-024-scfi-2013-electrical-electronic-labelling",
            "NOM-024-SCFI-2013, commercial information for electrical, electronic and home appliances",
            "https://platiica.economia.gob.mx/normalizacion/nom-024-scfi-2013/",
            "024scfi2013.pdf",
            "Mexico electrical, electronic, and home-appliance commercial information requirements.",
            ["electronics", "electrical_equipment", "home_appliances"],
            ["labelling", "documentation"],
        ),
        (
            "mx-platiica-nom-003-scfi-2014-electrical-product-safety",
            "NOM-003-SCFI-2014, electrical product safety specifications",
            "https://platiica.economia.gob.mx/normalizacion/nom-003-scfi-2014/",
            "003scfi2015.pdf",
            "Mexico electrical product safety and conformity standard baseline.",
            ["electronics", "electrical_equipment", "home_appliances"],
            ["product_safety", "technical_standard", "conformity"],
        ),
        (
            "mx-platiica-nom-141-ssa1-scfi-2012-cosmetics-labelling",
            "NOM-141-SSA1/SCFI-2012, cosmetic products prepackaged labelling",
            "https://platiica.economia.gob.mx/normalizacion/nom-141-ssa1-scfi-2012/",
            "141ssascfi2012.pdf",
            "Mexico cosmetic product labelling and health information standard.",
            ["cosmetics", "packaging"],
            ["labelling", "chemical", "product_safety"],
        ),
    ]
    for entry_id, title, page_url, pdf_name, why, categories, reg_types in specs:
        slug = entry_id.removeprefix("mx-platiica-")
        html_rel = f"raw/mx/{slug}.html"
        pdf_rel = f"raw/mx/{slug}.pdf"
        entry = make_entry(
            entry_id,
            "MX",
            title,
            "PLATIICA, Secretaria de Economia, Government of Mexico",
            page_url,
            [html_rel, pdf_rel],
            why,
            categories,
            reg_types,
            source_type="platiica_html_pdf",
        )
        entry["_downloads"] = [
            {"url": page_url, "file": html_rel, "min_bytes": 1000},
            {
                "url": f"https://platiica.economia.gob.mx/wp-content/uploads/sites/2/PDF_Normas_Publicas/{pdf_name}",
                "file": pdf_rel,
                "min_bytes": 1000,
            },
        ]
        entries.append(entry)

    nom_051 = make_entry(
        "mx-platiica-nom-051-scfi-ssa1-2010-food-labelling",
        "MX",
        "NOM-051-SCFI/SSA1-2010, food and non-alcoholic beverage labelling",
        "PLATIICA, Secretaria de Economia, Government of Mexico",
        "https://platiica.economia.gob.mx/normalizacion/nom-051-scfi-ssa1-2010/",
        [
            "raw/mx/nom-051-scfi-ssa1-2010-food-labelling.html",
            "raw/mx/nom-051-scfi-ssa1-2010-2025-review.pdf",
        ],
        "Mexico food and non-alcoholic beverage packaging and warning-label context.",
        ["packaging", "food_contact", "general_consumer_products"],
        ["labelling", "packaging", "documentation"],
        source_type="platiica_html_pdf",
    )
    nom_051["_downloads"] = [
        {
            "url": "https://platiica.economia.gob.mx/normalizacion/nom-051-scfi-ssa1-2010/",
            "file": "raw/mx/nom-051-scfi-ssa1-2010-food-labelling.html",
            "min_bytes": 1000,
        },
        {
            "url": "https://platiica.economia.gob.mx/wp-content/uploads/sites/2/InformedeRevision/NOM-051-SCFI-SSA1-2010_2025_ultima_revisi%C3%B3n.pdf",
            "file": "raw/mx/nom-051-scfi-ssa1-2010-2025-review.pdf",
            "min_bytes": 1000,
        },
    ]
    entries.append(nom_051)


def add_brazil_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "br-planalto-consumer-defense-code",
            "Consumer Defense Code, Law No. 8,078/1990",
            "Presidency of the Republic of Brazil / Planalto",
            "http://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm",
            "raw/br/BR_planalto_consumer_defense_code_law_8078.html",
            "Brazil consumer protection, product information, defects, and liability baseline.",
            ["general_consumer_products", "electronics", "children_products"],
            ["product_safety", "labelling", "market_surveillance"],
        ),
        (
            "br-inmetro-conformity-assessment",
            "Inmetro conformity assessment portal",
            "National Institute of Metrology, Quality and Technology (Inmetro)",
            "https://www.gov.br/inmetro/pt-br/assuntos/avaliacao-da-conformidade",
            "raw/br/BR_inmetro_conformity_assessment.html",
            "Brazil conformity assessment and regulated-product certification portal.",
            ["general_consumer_products", "industrial_products", "electronics"],
            ["conformity", "testing", "scope_classification"],
        ),
        (
            "br-anvisa-cosmetics-portal",
            "Anvisa cosmetics portal",
            "Brazilian Health Regulatory Agency (Anvisa)",
            "https://www.gov.br/anvisa/pt-br/assuntos/cosmeticos",
            "raw/br/BR_anvisa_cosmetics_portal.html",
            "Brazil cosmetics regulatory, safety, import, and labeling context.",
            ["cosmetics"],
            ["product_safety", "labelling", "chemical"],
        ),
        (
            "br-anatel-certification-products-portal",
            "Anatel product certification portal",
            "National Telecommunications Agency of Brazil (Anatel)",
            "https://www.gov.br/anatel/pt-br/regulado/certificacao-de-produtos",
            "raw/br/BR_anatel_product_certification_portal.html",
            "Brazil telecom product certification, homologation, and technical requirement portal.",
            ["electronics", "radio", "telecommunications"],
            ["radio", "conformity", "emc"],
        ),
    ]
    for entry_id, title, channel, url, file_rel, why, categories, reg_types in specs:
        entry = make_entry(
            entry_id,
            "BR",
            title,
            channel,
            url,
            [file_rel],
            why,
            categories,
            reg_types,
            source_type="official_html",
        )
        entry["_downloads"] = [{"url": url, "file": file_rel, "min_bytes": 1000}]
        entries.append(entry)


def add_new_zealand_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "nz-product-safety-baby-walker-standard",
            "Baby walker mandatory product safety standard",
            "baby-walker-standard",
            "New Zealand baby-walker mechanical and child product safety standard page.",
            ["children_products", "home_goods"],
            ["product_safety", "mechanical"],
        ),
        (
            "nz-product-safety-childrens-nightwear-standard",
            "Children's nightwear mandatory product safety standard",
            "childrens-nightwear-standard",
            "New Zealand children's nightwear flammability and labelling standard page.",
            ["children_products", "apparel", "textiles"],
            ["product_safety", "flammability", "labelling"],
        ),
        (
            "nz-product-safety-bicycle-standard",
            "Bicycle mandatory product safety standard",
            "bicycle-standard",
            "New Zealand bicycle product safety standard page.",
            ["general_consumer_products"],
            ["product_safety", "mechanical"],
        ),
        (
            "nz-product-safety-multipurpose-ladders-standard",
            "Multipurpose ladders mandatory product safety standard",
            "multipurpose-ladders",
            "New Zealand multipurpose ladder product safety standard page.",
            ["home_goods", "industrial_products"],
            ["product_safety", "mechanical"],
        ),
        (
            "nz-product-safety-sunscreen-standard",
            "Sunscreen mandatory product safety standard",
            "sunscreen-standard",
            "New Zealand sunscreen product safety standard page.",
            ["cosmetics", "general_consumer_products"],
            ["product_safety", "labelling", "chemical"],
        ),
    ]
    base = "https://www.productsafety.govt.nz/for-businesses/making-sure-products-are-safe/mandatory-product-safety-standards"
    for entry_id, title, slug, why, categories, reg_types in specs:
        url = f"{base}/{slug}"
        file_rel = f"raw/nz/NZ_{slug.replace('-', '_')}.html"
        entry = make_entry(
            entry_id,
            "NZ",
            title,
            "Product Safety New Zealand",
            url,
            [file_rel],
            why,
            categories,
            reg_types,
            source_type="official_html",
        )
        entry["_downloads"] = [{"url": url, "file": file_rel, "min_bytes": 1000}]
        entries.append(entry)


def add_gcc_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "gcc-gso-conformity-main-portal",
            "GSO conformity portal",
            "https://www.gso.org.sa/en/conformity/",
            "raw/gcc/GCC_GSO_conformity_portal.html",
            "GSO conformity services and committee entry point for GCC product compliance.",
            ["general_consumer_products", "electronics", "industrial_products"],
            ["conformity", "market_surveillance"],
        ),
        (
            "gcc-gso-conformity-assessment-scheme",
            "GCC Conformity Assessment Scheme",
            "https://www.gso.org.sa/en/conformity/gcc-conformity-assessment-scheme/",
            "raw/gcc/GCC_GSO_conformity_assessment_scheme.html",
            "GCC conformity assessment scheme context for regulated products.",
            ["general_consumer_products", "electronics", "toys"],
            ["conformity", "testing", "scope_classification"],
        ),
        (
            "gcc-gso-gcc-conformity-mark",
            "GCC Conformity Mark",
            "https://www.gso.org.sa/en/conformity/gcc-conformity-mark/",
            "raw/gcc/GCC_GSO_conformity_mark.html",
            "G-Mark / GCC conformity mark context for covered products.",
            ["electronics", "toys", "controlled_goods"],
            ["conformity", "labelling"],
        ),
    ]
    for entry_id, title, url, file_rel, why, categories, reg_types in specs:
        entry = make_entry(
            entry_id,
            "GCC",
            title,
            "Gulf Cooperation Council Standardization Organization",
            url,
            [file_rel],
            why,
            categories,
            reg_types,
            source_type="official_html",
        )
        entry["_downloads"] = [{"url": url, "file": file_rel, "min_bytes": 1000}]
        entries.append(entry)


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
    *,
    source_type: str = "official_source",
) -> dict[str, Any]:
    return {
        "id": entry_id,
        "market": market,
        "title": title,
        "channel": channel,
        "source_type": source_type,
        "source_url": source_url,
        "files": files,
        "why_added": why_added,
        "product_categories": product_categories,
        "regulatory_types": regulatory_types,
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def as_posix(path: Path) -> str:
    return path.as_posix()


def build_readme(manifest: dict[str, Any]) -> str:
    summary = manifest["summary"]
    market_lines = "\n".join(f"- {market}" for market in summary["markets"])
    category_lines = "\n".join(f"- {category}" for category in summary["product_categories"])
    channel_lines = "\n".join(f"- {channel}" for channel in summary["channels"])
    return f"""# Coverage Gap Official Source Supplement

Created: {manifest["created_at"]}

This directory is an isolated raw-source supplement for official legal and regulatory
materials. It has not been ingested into `data/corpus/processed` or `data/faiss`.

## Summary

- Entries: {summary["regulation_entries"]}
- Raw files: {summary["raw_files"]}
- Failed downloads: {summary["failed_downloads"]}

## Markets

{market_lines}

## Product Categories

{category_lines}

## Official Channels

{channel_lines}

## Notes

- Original PDF, DOCX, XML, and official HTML files are preserved where available.
- Korea KLRI translations state their own legal-effect limitations; they are kept as official translation-portal source text for RAG review.
- Some product standards are copyrighted or sold through official standards stores, so public official pages are retained where full standards are not freely downloadable.
"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--supplement-dir",
        type=Path,
        default=DEFAULT_SUPPLEMENT_DIR,
        help="Directory for the isolated raw supplement.",
    )
    args = parser.parse_args()

    collector = Collector(args.supplement_dir)
    manifest = collector.build_manifest()
    collector.write_outputs(manifest)
    print(json.dumps(manifest["summary"], ensure_ascii=False, indent=2))
    if collector.failures:
        print("Failures:")
        print(json.dumps(collector.failures, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
