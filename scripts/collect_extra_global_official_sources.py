#!/usr/bin/env python3
"""Collect an extra global batch of official legal/regulatory source files."""
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


DEFAULT_SUPPLEMENT_DIR = Path("data/regulation_supplements/2026-05-27_extra_global_official_sources")
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
        for attempt in range(2):
            try:
                response = self.session.get(url, timeout=45, allow_redirects=True, verify=False)
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
                    "75",
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

        if fallback_curl:
            try:
                ps_url = url.replace("'", "''")
                ps_path = str(path).replace("'", "''")
                ps_ua = "Mozilla/5.0"
                command = [
                    "powershell.exe",
                    "-NoProfile",
                    "-Command",
                    (
                        "$ProgressPreference='SilentlyContinue'; "
                        f"Invoke-WebRequest -Uri '{ps_url}' -OutFile '{ps_path}' "
                        "-UseBasicParsing -MaximumRedirection 5 -TimeoutSec 75 "
                        f"-Headers @{{'User-Agent'='{ps_ua}'; 'Accept-Language'='es-AR,es;q=0.9,en;q=0.8'; 'Referer'='https://servicios.infoleg.gob.ar/'}}"
                    ),
                ]
                result = subprocess.run(command, text=True, capture_output=True, check=False)
                if result.returncode == 0 and path.exists() and path.stat().st_size >= min_bytes:
                    return {
                        "url": url,
                        "file": rel_path,
                        "status": "downloaded-powershell",
                        "bytes": path.stat().st_size,
                        "content_type": "",
                    }
                last_error = (result.stderr or result.stdout or f"powershell exit {result.returncode}")[-500:]
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
                "The batch expands weaker geographic coverage, especially ASEAN, Middle East, South Africa, Latin America, Turkey, Hong Kong, and Taiwan.",
                "Original PDF files are preserved where official sites expose them; otherwise official legal database or regulator HTML is retained.",
                "Several jurisdictions publish mandatory standards through paid standards stores; this batch keeps official law, technical regulation, certification, and regulator pages that are public.",
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
    add_malaysia_entries(entries)
    add_philippines_entries(entries)
    add_indonesia_entries(entries)
    add_vietnam_entries(entries)
    add_thailand_entries(entries)
    add_saudi_entries(entries)
    add_uae_entries(entries)
    add_south_africa_entries(entries)
    add_turkey_entries(entries)
    add_latin_america_entries(entries)
    add_hong_kong_entries(entries)
    add_taiwan_entries(entries)
    drop_unreachable_entries(entries)
    return entries


def drop_unreachable_entries(entries: list[dict[str, Any]]) -> None:
    """Keep only sources that were locally reachable during the collection pass."""
    disabled = {
        "my-kpdn-consumer-protection-act-599",
        "ph-ntc-cpe-type-approval-procedures",
        "ph-ntc-short-range-radio-type-approval",
        "vn-vbpl-product-goods-quality-law-en",
        "vn-vbpl-product-goods-quality-law-vi",
        "vn-vbpl-consumer-rights-law-2010",
        "th-tisi-product-certification-brief",
        "th-tisi-laws-regulation-portal",
        "th-nbtc-telecom-standards-portal",
        "ae-tdra-type-approval-page",
        "ae-tdra-type-approval-policy",
        "ae-tdra-type-approval-regulation",
        "za-nrcs-compulsory-specifications",
        "za-nrcs-chemical-mechanical-materials-vc-list",
        "hk-customs-toys-childrens-products-safety",
        "hk-emsd-electrical-products-safety-regulation",
        "hk-customs-consumer-protection-faq",
        "tw-bsmi-commodity-inspection",
        "tw-ncc-telecom-terminal-equipment-compliance-approval",
        "tw-ncc-tte-compliance-approval-pdf",
        "tw-bsmi-power-conversion-system-inspection",
        "tw-bsmi-stationary-lithium-battery-inspection",
    }
    entries[:] = [entry for entry in entries if entry["id"] not in disabled]


def add_malaysia_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "my-kpdn-consumer-protection-act-599",
            "Consumer Protection Act 1999, Act 599",
            "Ministry of Domestic Trade and Cost of Living, Malaysia",
            "https://www.kpdn.gov.my/images/2024/awam/akta/ttpm/Act%20599.pdf",
            [("https://www.kpdn.gov.my/images/2024/awam/akta/ttpm/Act%20599.pdf", "raw/my/MY_consumer_protection_act_1999_act_599.pdf", 1000)],
            "Malaysia consumer-protection statute covering product safety, misleading conduct, and consumer remedies.",
            ["general_consumer_products", "children_products", "electronics"],
            ["product_safety", "labelling", "market_surveillance"],
        ),
        (
            "my-st-electrical-equipment-approval-guidelines",
            "Guidelines for the Approval of Electrical Equipment, 2024 edition",
            "Energy Commission / Suruhanjaya Tenaga, Malaysia",
            "https://www.st.gov.my/resources/guidelines-approval-electrical-equipment",
            [
                ("https://www.st.gov.my/resources/guidelines-approval-electrical-equipment", "raw/my/MY_st_electrical_equipment_approval_guidelines.html", 1000),
                ("https://www.st.gov.my/sites/default/files/2026-02/Guidelines-for-the-Approval-of-Electrical-Equipment-%282024-Edition%29.pdf", "raw/my/MY_st_guidelines_approval_electrical_equipment_2024.pdf", 1000),
            ],
            "Malaysia COA/ST-SIRIM approval, regulated electrical equipment, safety, energy efficiency, and labeling guidance.",
            ["electronics", "electrical_equipment", "home_appliances"],
            ["product_safety", "conformity", "labelling", "technical_standard"],
        ),
        (
            "my-st-energy-using-products",
            "Energy-Using Product approval and energy efficiency page",
            "Energy Commission / Suruhanjaya Tenaga, Malaysia",
            "https://www.st.gov.my/energy-using-product-0",
            [("https://www.st.gov.my/energy-using-product-0", "raw/my/MY_st_energy_using_products.html", 1000)],
            "Malaysia energy-using product COE and MEPS context for appliances and electrical products.",
            ["electronics", "electrical_equipment", "home_appliances"],
            ["sustainability", "labelling", "technical_standard"],
        ),
    ]
    add_download_specs(entries, "MY", specs)


def add_philippines_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "ph-bps-product-certification",
            "BPS product certification schemes",
            "Bureau of Philippine Standards, Department of Trade and Industry",
            "https://bps.dti.gov.ph/product-certification",
            [("https://bps.dti.gov.ph/product-certification", "raw/ph/PH_bps_product_certification.html", 1000)],
            "Philippines PS/ICC mandatory product certification framework for regulated consumer, electrical, mechanical, and chemical products.",
            ["general_consumer_products", "electronics", "electrical_equipment", "industrial_products"],
            ["conformity", "testing", "market_surveillance"],
        ),
        (
            "ph-bps-list-products-under-mandatory-certification",
            "List of products under mandatory certification",
            "Bureau of Philippine Standards, Department of Trade and Industry",
            "https://bps.dti.gov.ph/product-certification/list-of-products-under-mandatory-certification",
            [
                ("https://bps.dti.gov.ph/product-certification/list-of-products-under-mandatory-certification", "raw/ph/PH_bps_mandatory_certification_list.html", 1000),
                ("https://bps.dti.gov.ph/images/ListOfProductsAndSystemsUnderMandatoryCertification.pdf", "raw/ph/PH_bps_products_systems_mandatory_certification.pdf", 1000),
            ],
            "Philippines mandatory certification product scope, including household appliances, electrical products, batteries, helmets, lighters, and LPG cylinders.",
            ["electronics", "electrical_equipment", "home_appliances", "batteries", "industrial_products"],
            ["scope_classification", "conformity", "product_safety"],
        ),
        (
            "ph-judiciary-consumer-act-ra7394",
            "Republic Act No. 7394, Consumer Act of the Philippines",
            "Supreme Court E-Library and Bureau of Philippine Standards, Republic of the Philippines",
            "https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/3302",
            [
                ("https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/3302", "raw/ph/PH_consumer_act_ra7394_supreme_court_elibrary.html", 1000),
                ("https://bps.dti.gov.ph/component/edocman/225-republic-act-no-7394-consumer-act-of-the-philippines/download?Itemid=", "raw/ph/PH_consumer_act_ra7394_dti_bps.pdf", 1000),
            ],
            "Philippines consumer product safety, standards, labeling, advertising, and remedies baseline.",
            ["general_consumer_products", "children_products", "packaging"],
            ["product_safety", "labelling", "market_surveillance"],
        ),
        (
            "ph-ntc-cpe-type-approval-procedures",
            "Customer premises equipment interface parameters and type approval procedures",
            "National Telecommunications Commission, Philippines",
            "https://ntc5.ntc.gov.ph/wp-content/uploads/2019/10/MC-10-11-90-CUSTOMER-PREMISES-EQUIPMENT-INTERFACE-PARAMETERS-AND-TYPE-APPROVAL-PROCEDURES.pdf",
            [("https://ntc5.ntc.gov.ph/wp-content/uploads/2019/10/MC-10-11-90-CUSTOMER-PREMISES-EQUIPMENT-INTERFACE-PARAMETERS-AND-TYPE-APPROVAL-PROCEDURES.pdf", "raw/ph/PH_ntc_cpe_type_approval_procedures.pdf", 1000)],
            "Philippines telecom/customer-premises equipment type approval procedure source.",
            ["electronics", "radio", "telecommunications"],
            ["radio", "conformity", "technical_standard"],
        ),
        (
            "ph-ntc-short-range-radio-type-approval",
            "Short-range radio service type approval and importation guidelines",
            "National Telecommunications Commission, Philippines",
            "https://ntc5.ntc.gov.ph/wp-content/uploads/2019/10/MC-07-06-98-Amendments-To-Memorandum-Circulars-02-01-97-And-01-01-98-And-Providing-Additional-Licensing-Guidelines-And-Procedures-For-Short-Range-Radio-Service-SRRS.pdf",
            [("https://ntc5.ntc.gov.ph/wp-content/uploads/2019/10/MC-07-06-98-Amendments-To-Memorandum-Circulars-02-01-97-And-01-01-98-And-Providing-Additional-Licensing-Guidelines-And-Procedures-For-Short-Range-Radio-Service-SRRS.pdf", "raw/ph/PH_ntc_short_range_radio_type_approval.pdf", 1000)],
            "Philippines short-range radio equipment type approval, type acceptance, labeling, and import procedure context.",
            ["electronics", "radio", "telecommunications"],
            ["radio", "conformity", "labelling"],
        ),
        (
            "ph-ntc-type-approval-application-form-1-17",
            "Application for type approval, acceptance, and grant of equipment conformity certificate",
            "National Telecommunications Commission, Philippines",
            "https://region7.ntc.gov.ph/information/application-forms/",
            [
                ("https://region7.ntc.gov.ph/information/application-forms/", "raw/ph/PH_ntc_downloadable_application_forms.html", 1000),
                ("https://region7.ntc.gov.ph/wp-content/uploads/2024/01/Form_No._NTC_1-17_APPLICATION_FOR_TYPE_APPROVAL_ACCEPTANCE_GRANT_OF_EQUIPMENT_CONFORMITY_CERTIFICATE.pdf", "raw/ph/PH_ntc_type_approval_equipment_conformity_certificate_form_1_17.pdf", 1000),
            ],
            "Philippines official NTC application artifact for equipment type approval and conformity certificate review.",
            ["electronics", "radio", "telecommunications"],
            ["radio", "conformity", "documentation"],
        ),
    ]
    add_download_specs(entries, "PH", specs)


def add_indonesia_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "id-bpk-consumer-protection-law-8-1999",
            "Law No. 8 of 1999 on Consumer Protection",
            "JDIH BPK, Republic of Indonesia",
            "https://peraturan.bpk.go.id/Home/Download/33784/UU%20Nomor%208%20Tahun%201999.pdf",
            [("https://peraturan.bpk.go.id/Home/Download/33784/UU%20Nomor%208%20Tahun%201999.pdf", "raw/id/ID_consumer_protection_law_8_1999.pdf", 1000)],
            "Indonesia consumer protection law covering product quality, safety, information, and business obligations.",
            ["general_consumer_products", "children_products", "packaging"],
            ["product_safety", "labelling", "market_surveillance"],
        ),
        (
            "id-bpk-consumer-protection-supervision-pp-58-2001",
            "Government Regulation No. 58 of 2001 on consumer protection supervision",
            "JDIH BPK, Republic of Indonesia",
            "https://peraturan.bpk.go.id/Download/42336/PP%20NO%2058%20TH%202001.pdf",
            [("https://peraturan.bpk.go.id/Download/42336/PP%20NO%2058%20TH%202001.pdf", "raw/id/ID_consumer_protection_supervision_pp_58_2001.pdf", 1000)],
            "Indonesia implementing regulation for guidance and supervision of consumer protection.",
            ["general_consumer_products"],
            ["market_surveillance", "documentation"],
        ),
        (
            "id-bpk-standardization-conformity-law-20-2014",
            "Law No. 20 of 2014 on Standardization and Conformity Assessment",
            "JDIH BPK, Republic of Indonesia",
            "https://peraturan.bpk.go.id/Home/Download/38663/UU%20Nomor%2020%20Tahun%202014.pdf",
            [("https://peraturan.bpk.go.id/Home/Download/38663/UU%20Nomor%2020%20Tahun%202014.pdf", "raw/id/ID_standardization_conformity_law_20_2014.pdf", 1000)],
            "Indonesia standardization and conformity assessment baseline for compulsory SNI and product certification.",
            ["general_consumer_products", "electronics", "industrial_products"],
            ["conformity", "technical_standard", "testing"],
        ),
    ]
    add_download_specs(entries, "ID", specs)


def add_vietnam_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "vn-vbpl-product-goods-quality-law-en",
            "Law on Product and Goods Quality, English text",
            "National Database on Legal Documents, Vietnam",
            "https://vbpl.vn/TW/Pages/vbpqen-toanvan.aspx?ItemID=3036&Keyword=",
            [("https://vbpl.vn/TW/Pages/vbpqen-toanvan.aspx?ItemID=3036&Keyword=", "raw/vn/VN_product_goods_quality_law_english.html", 1000)],
            "Vietnam product and goods quality law covering unsafe goods, conformity announcement, labeling, and consumer rights.",
            ["general_consumer_products", "industrial_products", "packaging"],
            ["product_safety", "conformity", "labelling"],
        ),
        (
            "vn-vbpl-product-goods-quality-law-vi",
            "Law on Product and Goods Quality, Vietnamese official text",
            "National Database on Legal Documents, Vietnam",
            "https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=12896",
            [("https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=12896", "raw/vn/VN_product_goods_quality_law_vietnamese.html", 1000)],
            "Vietnam original Vietnamese law text for product and goods quality.",
            ["general_consumer_products", "industrial_products", "packaging"],
            ["product_safety", "conformity", "labelling"],
        ),
        (
            "vn-vbpl-consumer-rights-law-2010",
            "Law No. 59/2010/QH12 on Protection of Consumers' Rights",
            "National Database on Legal Documents, Vietnam",
            "https://vbpl.vn/bocongthuong/Pages/vbpqen-toanvan.aspx?ItemID=10500",
            [("https://vbpl.vn/bocongthuong/Pages/vbpqen-toanvan.aspx?ItemID=10500", "raw/vn/VN_consumer_rights_law_2010_english.html", 1000)],
            "Vietnam consumer rights law covering trader liability, consumer information, unsafe goods warnings, and dispute resolution.",
            ["general_consumer_products", "electronics", "home_goods"],
            ["product_safety", "market_surveillance", "documentation"],
        ),
        (
            "vn-mic-electrical-safety-telecom-it-terminal-equipment",
            "Circular 24/2022/TT-BTTTT on electrical safety for telecom and IT terminal equipment",
            "Ministry of Information and Communications, Vietnam",
            "https://cspl.mic.gov.vn/Pages/TinTuc/138525/Thong-tu-so-24-2022-TT-BTTTT-Ban-hanh--quy-chuan-ky-thuat-quoc-gia-ve-an-toan-dien-doi-voi-thiet-bi-dau-cuoi-vien-thong-va-cong-nghe-thong-tin-.html",
            [("https://cspl.mic.gov.vn/Pages/TinTuc/138525/Thong-tu-so-24-2022-TT-BTTTT-Ban-hanh--quy-chuan-ky-thuat-quoc-gia-ve-an-toan-dien-doi-voi-thiet-bi-dau-cuoi-vien-thong-va-cong-nghe-thong-tin-.html", "raw/vn/VN_mic_electrical_safety_telecom_it_terminal_equipment.html", 1000)],
            "Vietnam telecom and IT terminal equipment electrical-safety technical regulation context.",
            ["electronics", "telecommunications", "electrical_equipment"],
            ["technical_standard", "product_safety", "conformity"],
        ),
    ]
    add_download_specs(entries, "VN", specs)


def add_thailand_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "th-tisi-industrial-product-standards-act",
            "Industrial Product Standards Act, B.E. 2511 (1968)",
            "Thai Industrial Standards Institute",
            "https://www.tisi.go.th/data/law/pdf_files/law1/2511_1968.pdf",
            [("https://www.tisi.go.th/data/law/pdf_files/law1/2511_1968.pdf", "raw/th/TH_tisi_industrial_product_standards_act_1968.pdf", 1000)],
            "Thailand industrial product standards statutory baseline for standards, licensing, and mandatory control.",
            ["general_consumer_products", "industrial_products", "electronics"],
            ["technical_standard", "conformity", "market_surveillance"],
        ),
        (
            "th-tisi-product-certification-brief",
            "TISI standardization and product certification overview",
            "Thai Industrial Standards Institute",
            "https://www2.tisi.go.th/tisiinbrief",
            [("https://www2.tisi.go.th/tisiinbrief", "raw/th/TH_tisi_standardization_product_certification_brief.html", 1000)],
            "Thailand voluntary and mandatory TISI product certification framework overview.",
            ["general_consumer_products", "electronics", "electrical_equipment"],
            ["conformity", "testing", "scope_classification"],
        ),
        (
            "th-tisi-laws-regulation-portal",
            "TISI laws and regulation portal",
            "Thai Industrial Standards Institute",
            "https://www2.tisi.go.th/law/en",
            [("https://www2.tisi.go.th/law/en", "raw/th/TH_tisi_laws_regulation_portal.html", 1000)],
            "Thailand official TISI law and regulation index for standards and certification instruments.",
            ["general_consumer_products", "industrial_products"],
            ["technical_standard", "conformity", "documentation"],
        ),
        (
            "th-nbtc-telecom-standards-portal",
            "Telecommunication standards portal",
            "Office of the National Broadcasting and Telecommunications Commission, Thailand",
            "https://standard1.nbtc.go.th/Standards.aspx?lang=en-US",
            [("https://standard1.nbtc.go.th/Standards.aspx?lang=en-US", "raw/th/TH_nbtc_telecom_standards_portal.html", 1000)],
            "Thailand telecom equipment standards and conformity assessment entry point.",
            ["electronics", "radio", "telecommunications"],
            ["radio", "technical_standard", "conformity"],
        ),
    ]
    add_download_specs(entries, "TH", specs)


def add_saudi_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "sa-saso-technical-regulations-portal",
            "SASO technical regulations portal",
            "Saudi Standards, Metrology and Quality Organization",
            "https://www.saso.gov.sa/en/laws-and-regulations/technical_regulations/pages/default.aspx",
            [("https://www.saso.gov.sa/en/laws-and-regulations/technical_regulations/pages/default.aspx", "raw/sa/SA_saso_technical_regulations_portal.html", 1000)],
            "Saudi Arabia official technical regulation index for textiles, electrical, mechanical, chemical, and other products.",
            ["general_consumer_products", "electronics", "textiles", "industrial_products"],
            ["scope_classification", "conformity", "technical_standard"],
        ),
        (
            "sa-saso-low-voltage-electrical-equipment",
            "Gulf Technical Regulation for Low Voltage Electrical Equipment and Appliances",
            "Saudi Standards, Metrology and Quality Organization",
            "https://www.saso.gov.sa/en/Laws-And-Regulations/Documents/Gulf-Technical-Regulation-for-Low-Voltage-Electrical-Equipment-and-Appliances-BD-142004-01.pdf",
            [("https://www.saso.gov.sa/en/Laws-And-Regulations/Documents/Gulf-Technical-Regulation-for-Low-Voltage-Electrical-Equipment-and-Appliances-BD-142004-01.pdf", "raw/sa/SA_saso_gulf_low_voltage_electrical_equipment.pdf", 1000)],
            "Saudi/GCC low-voltage electrical equipment safety, EMC, and conformity requirements.",
            ["electronics", "electrical_equipment", "home_appliances"],
            ["product_safety", "conformity", "emc"],
        ),
        (
            "sa-saso-rohs-electrical-electronic-equipment",
            "Technical Regulation for Restriction of Hazardous Substances in Electrical and Electronic Equipment",
            "Saudi Standards, Metrology and Quality Organization",
            "https://saso.gov.sa/en/Laws-And-Regulations/Technical_regulations/Documents/TR-Restriction-of-hazardous-Substance-in-Electrical-and-Electronic-Equipment-V2.pdf",
            [("https://saso.gov.sa/en/Laws-And-Regulations/Technical_regulations/Documents/TR-Restriction-of-hazardous-Substance-in-Electrical-and-Electronic-Equipment-V2.pdf", "raw/sa/SA_saso_rohs_electrical_electronic_equipment_v2.pdf", 1000)],
            "Saudi RoHS-like hazardous substance restrictions and technical-file obligations for EEE.",
            ["electronics", "electrical_equipment", "chemicals"],
            ["chemical", "conformity", "documentation"],
        ),
        (
            "sa-saso-textile-products-technical-regulation",
            "Technical Regulation for Textile Products",
            "Saudi Standards, Metrology and Quality Organization",
            "https://www.saso.gov.sa/en/Laws-And-Regulations/Technical_regulations/Documents/TR-for-Textile-Products.pdf",
            [("https://www.saso.gov.sa/en/Laws-And-Regulations/Technical_regulations/Documents/TR-for-Textile-Products.pdf", "raw/sa/SA_saso_textile_products_technical_regulation.pdf", 1000)],
            "Saudi textile product essential requirements, labeling, and conformity assessment.",
            ["textiles", "apparel", "furniture"],
            ["labelling", "conformity", "chemical"],
        ),
        (
            "sa-saso-ppe-clothing-technical-regulation",
            "Technical Regulation for Personal Protective Equipment and Clothing",
            "Saudi Standards, Metrology and Quality Organization",
            "https://www.saso.gov.sa/en/Laws-And-Regulations/Technical_regulations/Documents/TR%20-%20Personal%20Protective%20Equipment%20and%20Clothing.pdf",
            [("https://www.saso.gov.sa/en/Laws-And-Regulations/Technical_regulations/Documents/TR%20-%20Personal%20Protective%20Equipment%20and%20Clothing.pdf", "raw/sa/SA_saso_ppe_clothing_technical_regulation.pdf", 1000)],
            "Saudi PPE and protective clothing essential health and safety requirements and conformity assessment.",
            ["ppe", "apparel", "industrial_products"],
            ["product_safety", "conformity", "testing"],
        ),
        (
            "sa-saso-gcc-children-toys-technical-regulation",
            "GCC Technical Regulation on Children Toys",
            "Saudi Standards, Metrology and Quality Organization",
            "https://www.saso.gov.sa/en/Laws-And-Regulations/Technical_regulations/Documents/GSO-Technical-Regulation-On-Toys.pdf",
            [("https://www.saso.gov.sa/en/Laws-And-Regulations/Technical_regulations/Documents/GSO-Technical-Regulation-On-Toys.pdf", "raw/sa/SA_saso_gcc_children_toys_technical_regulation.pdf", 1000)],
            "Saudi/GCC toys safety, conformity, and G-mark technical regulation.",
            ["toys", "children_products"],
            ["product_safety", "conformity", "labelling"],
        ),
    ]
    add_download_specs(entries, "SA", specs)


def add_uae_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "ae-tdra-type-approval-page",
            "Telecommunications equipment type approval page",
            "Telecommunications and Digital Government Regulatory Authority, UAE",
            "https://tdra.gov.ae/en/about/tdra-sectors/telecommunication/the-technology-development-affairs/type-approval",
            [("https://tdra.gov.ae/en/about/tdra-sectors/telecommunication/the-technology-development-affairs/type-approval", "raw/ae/AE_tdra_type_approval_page.html", 1000)],
            "UAE RTTE type approval, dealer registration, custom clearance, and conformity marking overview.",
            ["electronics", "radio", "telecommunications"],
            ["radio", "conformity", "labelling"],
        ),
        (
            "ae-tdra-type-approval-policy",
            "Telecommunications Equipment Type Approval Regime Policy",
            "Telecommunications and Digital Government Regulatory Authority, UAE",
            "https://tdra.gov.ae/-/media/About/regulations-and-ruling/EN/Policy---Telecommunications-Equipment-Type-Approval-RegimeV2-0-pdf.ashx",
            [("https://tdra.gov.ae/-/media/About/regulations-and-ruling/EN/Policy---Telecommunications-Equipment-Type-Approval-RegimeV2-0-pdf.ashx", "raw/ae/AE_tdra_type_approval_policy_v2.pdf", 1000)],
            "UAE telecom equipment type approval policy and market access framework.",
            ["electronics", "radio", "telecommunications"],
            ["radio", "conformity", "documentation"],
        ),
        (
            "ae-tdra-type-approval-regulation",
            "Telecommunications Equipment Type Approval Regime Regulation",
            "Telecommunications and Digital Government Regulatory Authority, UAE",
            "https://tdra.gov.ae/-/media/About/regulations-and-ruling/EN/Regulation---Telecommunications-Equipment-Type-Approval-Regime-V2-0-pdf.ashx",
            [("https://tdra.gov.ae/-/media/About/regulations-and-ruling/EN/Regulation---Telecommunications-Equipment-Type-Approval-Regime-V2-0-pdf.ashx", "raw/ae/AE_tdra_type_approval_regulation_v2.pdf", 1000)],
            "UAE type approval technical standards, documentation, labeling, and market obligations.",
            ["electronics", "radio", "telecommunications"],
            ["radio", "conformity", "technical_standard"],
        ),
        (
            "ae-moiat-ecas-conformity-certificates",
            "Issue conformity certificates for regulated products",
            "Ministry of Industry and Advanced Technology, UAE",
            "https://moiat.gov.ae/en/services/issue-conformity-certificates-for-regulated-products?search=ecas",
            [("https://moiat.gov.ae/en/services/issue-conformity-certificates-for-regulated-products?search=ecas", "raw/ae/AE_moiat_ecas_conformity_certificates.html", 1000)],
            "UAE ECAS regulated-product conformity certificate service and health/safety product control context.",
            ["general_consumer_products", "electronics", "cosmetics"],
            ["conformity", "scope_classification", "market_surveillance"],
        ),
        (
            "ae-moiat-laws-and-regulations",
            "MOIAT laws and regulations portal",
            "Ministry of Industry and Advanced Technology, UAE",
            "https://moiat.gov.ae/en/about-us/laws-and-legislation/",
            [("https://moiat.gov.ae/en/about-us/laws-and-legislation/", "raw/ae/AE_moiat_laws_and_regulations.html", 1000)],
            "UAE official laws and regulations entry point for quality infrastructure, product conformity, and regulated sectors.",
            ["general_consumer_products", "industrial_products", "electronics"],
            ["conformity", "technical_standard", "scope_classification"],
        ),
        (
            "ae-moiat-manaa-product-safety",
            "Manaa product safety and recall platform",
            "Ministry of Industry and Advanced Technology, UAE",
            "https://moiat.gov.ae/en/programs/manaa",
            [("https://moiat.gov.ae/en/programs/manaa", "raw/ae/AE_moiat_manaa_product_safety.html", 1000)],
            "UAE product safety alert, recall, and consumer reporting platform context.",
            ["general_consumer_products", "electronics", "children_products"],
            ["product_safety", "market_surveillance", "recall"],
        ),
    ]
    add_download_specs(entries, "AE", specs)


def add_south_africa_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "za-icasa-type-approval-requirements",
            "Type approval requirements for South Africa",
            "Independent Communications Authority of South Africa",
            "https://www.icasa.org.za/pages/type-approval",
            [("https://www.icasa.org.za/pages/type-approval", "raw/za/ZA_icasa_type_approval_requirements.html", 1000)],
            "South Africa radio and telecommunications equipment type approval requirements and application process.",
            ["electronics", "radio", "telecommunications"],
            ["radio", "conformity", "technical_standard"],
        ),
        (
            "za-icasa-type-approval-regulations-2013",
            "Type Approval Regulations 2013",
            "Independent Communications Authority of South Africa",
            "https://www.icasa.org.za/legislation-and-regulations/type-approval-regulations-2013",
            [("https://www.icasa.org.za/legislation-and-regulations/type-approval-regulations-2013", "raw/za/ZA_icasa_type_approval_regulations_2013.html", 1000)],
            "South Africa ICASA type approval regulation source page.",
            ["electronics", "radio", "telecommunications"],
            ["radio", "conformity", "documentation"],
        ),
        (
            "za-icasa-labelling-regulations-2013",
            "Labelling Regulations 2013",
            "Independent Communications Authority of South Africa",
            "https://www.icasa.org.za/legislation-and-regulations/labelling-regulations",
            [("https://www.icasa.org.za/legislation-and-regulations/labelling-regulations", "raw/za/ZA_icasa_labelling_regulations_2013.html", 1000)],
            "South Africa labeling requirements for type-approved telecommunications equipment.",
            ["electronics", "radio", "telecommunications"],
            ["labelling", "radio", "conformity"],
        ),
        (
            "za-nrcs-compulsory-specifications",
            "NRCS compulsory specifications portal",
            "National Regulator for Compulsory Specifications, South Africa",
            "https://www.nrcs.org.za/compulsory-specifications/compulsory-specifications",
            [("https://www.nrcs.org.za/compulsory-specifications/compulsory-specifications", "raw/za/ZA_nrcs_compulsory_specifications.html", 1000)],
            "South Africa compulsory specification index for regulated products.",
            ["general_consumer_products", "industrial_products", "electrical_equipment"],
            ["technical_standard", "scope_classification", "market_surveillance"],
        ),
        (
            "za-nrcs-chemical-mechanical-materials-vc-list",
            "NRCS chemical, mechanical, and materials regulated products list",
            "National Regulator for Compulsory Specifications, South Africa",
            "https://www.nrcs.org.za/business-units/cmm",
            [("https://www.nrcs.org.za/business-units/cmm", "raw/za/ZA_nrcs_cmm_regulated_products.html", 1000)],
            "South Africa compulsory specifications for PPE, lighters, respirators, carrier bags, and related products.",
            ["ppe", "plastics", "general_consumer_products", "industrial_products"],
            ["product_safety", "technical_standard", "scope_classification"],
        ),
        (
            "za-icasa-radio-frequency-spectrum-regulations-2015",
            "Radio Frequency Spectrum Regulations 2015",
            "Independent Communications Authority of South Africa",
            "https://www.icasa.org.za/legislation-and-regulations/radio-frequency-spectrum-regulations-2015",
            [("https://www.icasa.org.za/legislation-and-regulations/radio-frequency-spectrum-regulations-2015", "raw/za/ZA_icasa_radio_frequency_spectrum_regulations_2015.html", 1000)],
            "South Africa spectrum regulation context for radio equipment and regulated wireless devices.",
            ["electronics", "radio", "telecommunications"],
            ["radio", "technical_standard", "market_surveillance"],
        ),
    ]
    add_download_specs(entries, "ZA", specs)


def add_turkey_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "tr-product-safety-technical-regulations-law-7223",
            "Product Safety and Technical Regulations Law No. 7223",
            "Ministry of Trade, Turkiye",
            "https://urunkurallari.ticaret.gov.tr/en/legislation/product-safety-and-technical-regulations-law-no-7223",
            [("https://urunkurallari.ticaret.gov.tr/en/legislation/product-safety-and-technical-regulations-law-no-7223", "raw/tr/TR_product_safety_technical_regulations_law_7223.html", 1000)],
            "Turkiye product safety, technical regulation, traceability, recall, and producer/importer responsibility baseline.",
            ["general_consumer_products", "electronics", "toys"],
            ["product_safety", "market_surveillance", "conformity"],
        ),
        (
            "tr-law-7223-implementing-regulations",
            "Implementing regulations of Law No. 7223",
            "Ministry of Trade, Turkiye",
            "https://urunkurallari.ticaret.gov.tr/en/legislation/product-safety-and-technical-regulations-law-no-7223/implementing-regulations",
            [("https://urunkurallari.ticaret.gov.tr/en/legislation/product-safety-and-technical-regulations-law-no-7223/implementing-regulations", "raw/tr/TR_law_7223_implementing_regulations.html", 1000)],
            "Turkiye implementing regulations for general product safety and market surveillance under Law No. 7223.",
            ["general_consumer_products", "children_products", "electronics"],
            ["product_safety", "market_surveillance", "documentation"],
        ),
        (
            "tr-ministry-product-safety-consumer-info",
            "Product safety information and Ministry-supervised product groups",
            "Ministry of Trade, Turkiye",
            "https://ticaret.gov.tr/tuketici/piyasa-gozetimi/urun-guvenligi",
            [("https://ticaret.gov.tr/tuketici/piyasa-gozetimi/urun-guvenligi", "raw/tr/TR_ministry_product_safety_consumer_info.html", 1000)],
            "Turkiye product safety surveillance scope for textiles, toys, childcare products, furniture, bicycles, chemicals, and consumer products.",
            ["general_consumer_products", "toys", "children_products", "textiles", "furniture"],
            ["market_surveillance", "product_safety", "scope_classification"],
        ),
        (
            "tr-official-gazette-market-surveillance-regulation-2021",
            "Official Gazette regulation implementing Law No. 7223",
            "Official Gazette of Turkiye",
            "https://www.resmigazete.gov.tr/eskiler/2021/05/20210527-2.pdf",
            [("https://www.resmigazete.gov.tr/eskiler/2021/05/20210527-2.pdf", "raw/tr/TR_official_gazette_law_7223_implementing_regulation_2021.pdf", 1000)],
            "Turkiye official gazette PDF for product safety / market surveillance implementing regulation under Law No. 7223.",
            ["general_consumer_products", "industrial_products"],
            ["market_surveillance", "product_safety", "conformity"],
        ),
    ]
    add_download_specs(entries, "TR", specs)


def add_latin_america_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "ar-infoleg-consumer-defense-law-24240",
            "Law No. 24,240 on Consumer Defense",
            "InfoLeg, Ministry of Justice, Argentina",
            "https://servicios.infoleg.gob.ar/infolegInternet/verNorma.do?id=638",
            [
                ("https://servicios.infoleg.gob.ar/infolegInternet/verNorma.do?id=638", "raw/ar/AR_infoleg_consumer_defense_law_24240_metadata.html", 1000),
                ("https://servicios.infoleg.gob.ar/infolegInternet/anexos/0-4999/638/texact.htm", "raw/ar/AR_infoleg_consumer_defense_law_24240_text.html", 1000),
            ],
            "Argentina consumer defense law official legal database text.",
            ["general_consumer_products", "electronics", "packaging"],
            ["product_safety", "labelling", "market_surveillance"],
        ),
        (
            "cl-leychile-consumer-rights-law-19496",
            "Law No. 19,496 on consumer rights protection",
            "Ley Chile, Biblioteca del Congreso Nacional de Chile",
            "https://www.leychile.cl/Navegar?idNorma=61438",
            [
                ("https://www.leychile.cl/Navegar?idNorma=61438", "raw/cl/CL_leychile_consumer_rights_law_19496.html", 1000),
                ("https://nuevo.leychile.cl/servicios/Consulta/Exportar?exportar_con_notas_al_pie=True&exportar_con_notas_bcn=True&exportar_con_notas_originales=True&exportar_formato=pdf&hddResultadoExportar=61438.1997-03-07.0.0%23&nombrearchivo=Ley-19496_07-MAR-1997&radioExportar=Normas", "raw/cl/CL_leychile_consumer_rights_law_19496.pdf", 1000),
            ],
            "Chile consumer rights and product/service information law from official Ley Chile source.",
            ["general_consumer_products", "electronics", "packaging"],
            ["labelling", "market_surveillance", "documentation"],
        ),
    ]
    add_download_specs(entries, "AR_CL", specs)


def add_hong_kong_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "hk-customs-toys-childrens-products-safety",
            "Toys and children's products safety",
            "Hong Kong Customs and Excise Department",
            "https://www.customs.gov.hk/en/service-enforcement-information/consumer-protection/toys-safety/index.html",
            [
                ("https://www.customs.gov.hk/en/service-enforcement-information/consumer-protection/toys-safety/index.html", "raw/hk/HK_customs_toys_childrens_products_safety.html", 1000),
                ("https://www.customs.gov.hk/hcms/filemanager/en/content_189/tcpso_english_version.pdf", "raw/hk/HK_toys_childrens_products_safety_ordinance_guide.pdf", 1000),
            ],
            "Hong Kong toys and children's products safety law, phthalates, markings, and bilingual warning requirements.",
            ["toys", "children_products"],
            ["product_safety", "labelling", "chemical"],
        ),
        (
            "hk-emsd-electrical-products-safety-regulation",
            "Outline of Electrical Products (Safety) Regulation",
            "Electrical and Mechanical Services Department, Hong Kong",
            "https://www.emsd.gov.hk/en/electricity_safety/publications/guidance_notes_guidelines/outline_of_electrical_products_safety_regulation/index.html",
            [
                ("https://www.emsd.gov.hk/en/electricity_safety/publications/guidance_notes_guidelines/outline_of_electrical_products_safety_regulation/index.html", "raw/hk/HK_emsd_electrical_products_safety_regulation_outline.html", 1000),
                ("https://www.emsd.gov.hk/filemanager/en/content_444/GN-ElectricalProductsSafetyRegulation2019.pdf", "raw/hk/HK_emsd_electrical_products_safety_regulation_guidance_2019.pdf", 1000),
            ],
            "Hong Kong household electrical product safety requirements and certificate of safety compliance guidance.",
            ["electronics", "electrical_equipment", "home_appliances"],
            ["product_safety", "conformity", "technical_standard"],
        ),
        (
            "hk-customs-consumer-protection-faq",
            "Consumer protection FAQ on consumer goods safety and toys",
            "Hong Kong Customs and Excise Department",
            "https://www.customs.gov.hk/en/service-enforcement-information/consumer-protection/faqs/index.html?print=1",
            [("https://www.customs.gov.hk/en/service-enforcement-information/consumer-protection/faqs/index.html?print=1", "raw/hk/HK_customs_consumer_protection_faq.html", 1000)],
            "Hong Kong consumer goods general safety requirement and bilingual warning context.",
            ["general_consumer_products", "toys", "children_products"],
            ["product_safety", "labelling", "market_surveillance"],
        ),
    ]
    add_download_specs(entries, "HK", specs)


def add_taiwan_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "tw-bsmi-commodity-inspection",
            "Commodity inspection laws and regulations portal",
            "Bureau of Standards, Metrology and Inspection, Taiwan",
            "https://www.bsmi.gov.tw/wSite/ct?ctNode=3563&mp=2&xItem=20603",
            [("https://www.bsmi.gov.tw/wSite/ct?ctNode=3563&mp=2&xItem=20603", "raw/tw/TW_bsmi_commodity_inspection_laws_regulations.html", 1000)],
            "Taiwan commodity inspection act and product certification regulation index.",
            ["general_consumer_products", "electronics", "industrial_products"],
            ["conformity", "technical_standard", "market_surveillance"],
        ),
        (
            "tw-ncc-telecom-terminal-equipment-compliance-approval",
            "Regulations Governing Compliance Approval for Telecommunications Terminal Equipment",
            "National Communications Commission, Taiwan",
            "https://ncclaw.ncc.gov.tw/Eng/PrintFLAWDAT0201.aspx?beginpos=2&id=FL094201&keyword=",
            [("https://ncclaw.ncc.gov.tw/Eng/PrintFLAWDAT0201.aspx?beginpos=2&id=FL094201&keyword=", "raw/tw/TW_ncc_telecom_terminal_equipment_compliance_approval.html", 1000)],
            "Taiwan telecom terminal equipment type approval and declaration of conformity regulation.",
            ["electronics", "radio", "telecommunications"],
            ["radio", "conformity", "technical_standard"],
        ),
        (
            "tw-ncc-tte-compliance-approval-pdf",
            "Compliance Approval Regulations of Telecommunications Terminal Equipment",
            "National Communications Commission, Taiwan",
            "https://www.ncc.gov.tw/english/show_file.aspx?file_sn=315&ft=P&table_name=news",
            [("https://www.ncc.gov.tw/english/show_file.aspx?file_sn=315&ft=P&table_name=news", "raw/tw/TW_ncc_tte_compliance_approval_regulations.pdf", 1000)],
            "Taiwan NCC PDF source for telecommunications terminal equipment compliance approval.",
            ["electronics", "radio", "telecommunications"],
            ["radio", "conformity", "documentation"],
        ),
        (
            "tw-bsmi-power-conversion-system-inspection",
            "Legal inspection requirements for power conversion systems",
            "Bureau of Standards, Metrology and Inspection, Taiwan",
            "https://www.bsmi.gov.tw/wSite/record/file_actData.jsp?filename=f1735022550384.pdf&fileuuid=118939",
            [("https://www.bsmi.gov.tw/wSite/record/file_actData.jsp?filename=f1735022550384.pdf&fileuuid=118939", "raw/tw/TW_bsmi_power_conversion_system_inspection_requirements.pdf", 1000)],
            "Taiwan legal inspection requirements for electrical/electronic power conversion systems, including RoHS-style labeling.",
            ["electronics", "electrical_equipment", "batteries"],
            ["conformity", "labelling", "chemical"],
        ),
        (
            "tw-bsmi-stationary-lithium-battery-inspection",
            "Legal inspection requirements for stationary lithium battery systems",
            "Bureau of Standards, Metrology and Inspection, Taiwan",
            "https://www.bsmi.gov.tw/wSite/public/Data/f1767317970865.pdf",
            [("https://www.bsmi.gov.tw/wSite/public/Data/f1767317970865.pdf", "raw/tw/TW_bsmi_stationary_lithium_battery_inspection_requirements.pdf", 1000)],
            "Taiwan legal inspection and restricted-substance labeling requirements for stationary lithium battery systems.",
            ["batteries", "electronics", "electrical_equipment"],
            ["conformity", "labelling", "chemical"],
        ),
    ]
    add_download_specs(entries, "TW", specs)


def add_download_specs(
    entries: list[dict[str, Any]],
    default_market: str,
    specs: list[tuple[str, str, str, str, list[tuple[str, str, int]], str, list[str], list[str]]],
) -> None:
    for entry_id, title, channel, source_url, downloads, why, categories, reg_types in specs:
        market = default_market
        if default_market == "AR_CL":
            market = "AR" if entry_id.startswith("ar-") else "CL"
        entry = make_entry(
            entry_id,
            market,
            title,
            channel,
            source_url,
            [file_rel for _, file_rel, _ in downloads],
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
    return f"""# Extra Global Official Source Supplement

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

- Original PDF files are retained where public official sources expose them.
- Official regulator HTML is retained where PDF/Word originals are not public or the jurisdiction publishes via legal database pages.
- This batch targets broad geographic gap filling rather than ingestion; review and embedding should happen as a separate step.
"""


def main() -> int:
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
