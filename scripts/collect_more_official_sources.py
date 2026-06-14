#!/usr/bin/env python3
"""Collect an additional isolated batch of official legal/regulatory source files."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rag_service.regulation_collectors.base import BaseCollector
from rag_service.regulation_collectors.eu_rdf import ensure_eu_text


DEFAULT_SUPPLEMENT_DIR = Path("data/regulation_supplements/2026-05-27_more_official_sources")
USER_AGENT = "Mozilla/5.0 (compatible; AttraxOfficialSourceCollector/1.1)"
ECFR_DATE = "2026-05-21"


class Collector(BaseCollector):
    def __init__(self, supplement_dir: Path) -> None:
        super().__init__(supplement_dir, USER_AGENT)
        self.raw_dir = supplement_dir / "raw"

    def ensure_eu_text(self, entry: dict[str, Any], celex: str, rdf_rel: str, xhtml_rel: str) -> None:
        ensure_eu_text(self, entry, celex, rdf_rel, xhtml_rel)

    def build_manifest(self) -> dict[str, Any]:
        entries = build_entries(self)
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
                    self.record_failure(
                        url="",
                        file=rel_path,
                        error="missing or empty file referenced by manifest",
                        entry_id=manifest_entry["id"],
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
                "The batch intentionally favors official original file formats: PDF, DOCX/Word, XML, XHTML, RDF, and government HTML.",
                "US statutory compilations use GovInfo PDF and USLM XML; US regulations use official eCFR API XML.",
                "UK entries include legislation.gov.uk PDF and XML original legislation files.",
                "EU entries include Publications Office RDF metadata and resolved Cellar XHTML document files where available.",
                "Some entries overlap topically with earlier guidance pages, but this batch adds original legislation or machine-readable legal text for review.",
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


def build_entries(collector: Collector) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    add_eu_entries(collector, entries)
    add_eu_full_scenario_entries(collector, entries)
    add_us_govinfo_entries(entries)
    add_us_ecfr_entries(entries)
    add_us_additional_ecfr_scenario_entries(entries)
    add_uk_entries(entries)
    add_uk_full_scenario_entries(entries)
    add_australia_entries(entries)
    add_canada_entries(entries)
    add_china_entries(entries)
    add_china_full_scenario_entries(entries)
    return entries


def add_eu_entries(collector: Collector, entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "eu-2016-425-ppe",
            "Regulation (EU) 2016/425 on personal protective equipment",
            "32016R0425",
            "raw/eu/eu-2016-425-ppe.rdf",
            "raw/eu/eu-2016-425-ppe.xhtml",
            "Original EU PPE conformity and essential health and safety requirements.",
            ["ppe", "apparel", "industrial_products"],
            ["product_safety", "conformity", "testing"],
        ),
        (
            "eu-2016-426-gas-appliances",
            "Regulation (EU) 2016/426 on appliances burning gaseous fuels",
            "32016R0426",
            "raw/eu/eu-2016-426-gas-appliances.rdf",
            "raw/eu/eu-2016-426-gas-appliances.xhtml",
            "EU gas appliance safety, conformity assessment, and economic-operator obligations.",
            ["home_appliances", "kitchenware", "industrial_products"],
            ["product_safety", "conformity"],
        ),
        (
            "eu-2014-68-pressure-equipment",
            "Directive 2014/68/EU on pressure equipment",
            "32014L0068",
            "raw/eu/eu-2014-68-pressure-equipment.rdf",
            "raw/eu/eu-2014-68-pressure-equipment.xhtml",
            "EU pressure equipment safety and conformity framework.",
            ["industrial_products", "machinery"],
            ["product_safety", "conformity", "testing"],
        ),
        (
            "eu-2014-34-atex",
            "Directive 2014/34/EU on equipment and protective systems for explosive atmospheres",
            "32014L0034",
            "raw/eu/eu-2014-34-atex.rdf",
            "raw/eu/eu-2014-34-atex.xhtml",
            "ATEX equipment, protective systems, and conformity requirements.",
            ["industrial_products", "electronics"],
            ["product_safety", "conformity"],
        ),
        (
            "eu-2014-32-measuring-instruments",
            "Directive 2014/32/EU on measuring instruments",
            "32014L0032",
            "raw/eu/eu-2014-32-measuring-instruments.rdf",
            "raw/eu/eu-2014-32-measuring-instruments.xhtml",
            "EU measuring instrument conformity and placing-on-market requirements.",
            ["electronics", "industrial_products"],
            ["conformity", "technical_standard"],
        ),
        (
            "eu-2014-31-non-automatic-weighing-instruments",
            "Directive 2014/31/EU on non-automatic weighing instruments",
            "32014L0031",
            "raw/eu/eu-2014-31-non-automatic-weighing-instruments.rdf",
            "raw/eu/eu-2014-31-non-automatic-weighing-instruments.xhtml",
            "EU weighing instrument conformity and metrology requirements.",
            ["electronics", "industrial_products"],
            ["conformity", "technical_standard"],
        ),
        (
            "eu-2013-29-pyrotechnic-articles",
            "Directive 2013/29/EU on pyrotechnic articles",
            "32013L0029",
            "raw/eu/eu-2013-29-pyrotechnic-articles.rdf",
            "raw/eu/eu-2013-29-pyrotechnic-articles.xhtml",
            "EU pyrotechnic product safety and conformity requirements.",
            ["general_consumer_products", "industrial_products"],
            ["product_safety", "conformity"],
        ),
        (
            "eu-2000-14-outdoor-noise",
            "Directive 2000/14/EC on noise emission by equipment for use outdoors",
            "32000L0014",
            "raw/eu/eu-2000-14-outdoor-noise.rdf",
            "raw/eu/eu-2000-14-outdoor-noise.xhtml",
            "EU outdoor equipment noise emission, labelling, and conformity coverage.",
            ["machinery", "industrial_products"],
            ["technical_standard", "labelling", "conformity"],
        ),
    ]
    for entry_id, title, celex, rdf_rel, xhtml_rel, why, categories, reg_types in specs:
        entry = make_entry(
            entry_id,
            "EU",
            title,
            "Publications Office of the European Union",
            f"https://publications.europa.eu/resource/celex/{celex}",
            [rdf_rel],
            why,
            categories,
            reg_types,
            source_type="eu_celex",
        )
        entry["celex"] = celex
        collector.ensure_eu_text(entry, celex, rdf_rel, xhtml_rel)
        entries.append(entry)


def add_eu_full_scenario_entries(collector: Collector, entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "eu-2006-1907-reach",
            "Regulation (EC) No 1907/2006 concerning REACH",
            "32006R1907",
            "raw/eu/eu-2006-1907-reach.rdf",
            "raw/eu/eu-2006-1907-reach.xhtml",
            "Core EU chemicals registration, SVHC communication, restriction, and authorisation framework.",
            ["chemicals", "electronics", "toys", "cosmetics", "textiles", "general_consumer_products"],
            ["chemical", "documentation", "market_surveillance"],
        ),
        (
            "eu-2008-1272-clp",
            "Regulation (EC) No 1272/2008 on classification, labelling and packaging of substances and mixtures",
            "32008R1272",
            "raw/eu/eu-2008-1272-clp.rdf",
            "raw/eu/eu-2008-1272-clp.xhtml",
            "EU CLP classification, hazard labelling, and packaging obligations for substances and mixtures.",
            ["chemicals", "packaging", "cosmetics", "general_consumer_products"],
            ["chemical", "labelling", "packaging"],
        ),
        (
            "eu-2019-1021-persistent-organic-pollutants",
            "Regulation (EU) 2019/1021 on persistent organic pollutants",
            "32019R1021",
            "raw/eu/eu-2019-1021-persistent-organic-pollutants.rdf",
            "raw/eu/eu-2019-1021-persistent-organic-pollutants.xhtml",
            "EU POPs restrictions relevant to chemicals, textiles, electronics, and recycled materials.",
            ["chemicals", "textiles", "electronics", "raw_materials"],
            ["chemical", "sustainability"],
        ),
        (
            "eu-2017-1369-energy-labelling",
            "Regulation (EU) 2017/1369 setting a framework for energy labelling",
            "32017R1369",
            "raw/eu/eu-2017-1369-energy-labelling.rdf",
            "raw/eu/eu-2017-1369-energy-labelling.xhtml",
            "EU energy labelling framework for appliances and energy-related products.",
            ["home_appliances", "electronics", "electrical_equipment"],
            ["labelling", "sustainability", "documentation"],
        ),
        (
            "eu-2009-125-ecodesign-energy-related-products",
            "Directive 2009/125/EC establishing a framework for ecodesign requirements for energy-related products",
            "32009L0125",
            "raw/eu/eu-2009-125-ecodesign-energy-related-products.rdf",
            "raw/eu/eu-2009-125-ecodesign-energy-related-products.xhtml",
            "EU legacy ecodesign framework for energy-related products and implementing measures.",
            ["home_appliances", "electronics", "electrical_equipment"],
            ["sustainability", "technical_standard", "conformity"],
        ),
        (
            "eu-2011-83-consumer-rights",
            "Directive 2011/83/EU on consumer rights",
            "32011L0083",
            "raw/eu/eu-2011-83-consumer-rights.rdf",
            "raw/eu/eu-2011-83-consumer-rights.xhtml",
            "EU consumer information, distance selling, cancellation, and post-sale obligations.",
            ["general_consumer_products", "electronics", "toys"],
            ["documentation", "labelling"],
        ),
        (
            "eu-2005-29-unfair-commercial-practices",
            "Directive 2005/29/EC concerning unfair business-to-consumer commercial practices",
            "32005L0029",
            "raw/eu/eu-2005-29-unfair-commercial-practices.rdf",
            "raw/eu/eu-2005-29-unfair-commercial-practices.xhtml",
            "EU consumer-facing claims, advertising, green claims, and marketplace conduct baseline.",
            ["general_consumer_products", "electronics", "cosmetics"],
            ["documentation", "labelling", "market_surveillance"],
        ),
        (
            "eu-2022-2065-digital-services-act",
            "Regulation (EU) 2022/2065 on a Single Market For Digital Services",
            "32022R2065",
            "raw/eu/eu-2022-2065-digital-services-act.rdf",
            "raw/eu/eu-2022-2065-digital-services-act.xhtml",
            "EU online platform due-diligence, traceability, and illegal product listing context.",
            ["general_consumer_products", "electronics", "toys"],
            ["documentation", "market_surveillance"],
        ),
        (
            "eu-2022-1925-digital-markets-act",
            "Regulation (EU) 2022/1925 on contestable and fair markets in the digital sector",
            "32022R1925",
            "raw/eu/eu-2022-1925-digital-markets-act.rdf",
            "raw/eu/eu-2022-1925-digital-markets-act.xhtml",
            "EU gatekeeper platform obligations that can affect marketplace product distribution.",
            ["general_consumer_products", "electronics"],
            ["documentation", "market_surveillance"],
        ),
    ]
    for entry_id, title, celex, rdf_rel, xhtml_rel, why, categories, reg_types in specs:
        entry = make_entry(
            entry_id,
            "EU",
            title,
            "Publications Office of the European Union",
            f"https://publications.europa.eu/resource/celex/{celex}",
            [rdf_rel],
            why,
            categories,
            reg_types,
            source_type="eu_celex",
        )
        entry["celex"] = celex
        collector.ensure_eu_text(entry, celex, rdf_rel, xhtml_rel)
        entries.append(entry)


def add_us_govinfo_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "us-consumer-product-safety-act",
            "Consumer Product Safety Act",
            "COMPS-384",
            "consumer_product_safety_act",
            "Core US consumer product safety statutory framework.",
            ["general_consumer_products", "children_products"],
            ["product_safety", "market_surveillance"],
        ),
        (
            "us-consumer-product-safety-improvement-act-2008",
            "Consumer Product Safety Improvement Act of 2008",
            "COMPS-9748",
            "consumer_product_safety_improvement_act_2008",
            "US CPSIA statutory updates for children's products, testing, certificates, and lead/phthalates.",
            ["children_products", "toys"],
            ["product_safety", "testing", "conformity"],
        ),
        (
            "us-flammable-fabrics-act",
            "Flammable Fabrics Act",
            "COMPS-390",
            "flammable_fabrics_act",
            "US statutory basis for textile and apparel flammability regulations.",
            ["textiles", "apparel", "home_goods"],
            ["flammability", "product_safety"],
        ),
        (
            "us-federal-hazardous-substances-act",
            "Federal Hazardous Substances Act",
            "COMPS-387",
            "federal_hazardous_substances_act",
            "US statutory hazardous-substance, labelling, and banned hazardous articles context.",
            ["chemicals", "children_products", "general_consumer_products"],
            ["chemical", "labelling", "product_safety"],
        ),
        (
            "us-poison-prevention-packaging-act-1970",
            "Poison Prevention Packaging Act of 1970",
            "COMPS-392",
            "poison_prevention_packaging_act_1970",
            "US child-resistant packaging statutory framework.",
            ["packaging", "chemicals", "children_products"],
            ["packaging", "product_safety"],
        ),
        (
            "us-fair-packaging-labeling-act",
            "Fair Packaging and Labeling Act",
            "COMPS-385",
            "fair_packaging_labeling_act",
            "US packaging quantity and consumer commodity labelling statutory framework.",
            ["packaging", "general_consumer_products"],
            ["labelling", "packaging"],
        ),
        (
            "us-wool-products-labeling-act-1939",
            "Wool Products Labeling Act of 1939",
            "COMPS-10283",
            "wool_products_labeling_act_1939",
            "US wool textile labelling statutory context.",
            ["textiles", "apparel"],
            ["labelling"],
        ),
        (
            "us-magnuson-moss-warranty-ftc-improvement-act",
            "Magnuson-Moss Warranty-Federal Trade Commission Improvement Act",
            "COMPS-3072",
            "magnuson_moss_warranty_ftc_improvement_act",
            "US consumer product warranty disclosure and FTC enforcement context.",
            ["general_consumer_products", "electronics"],
            ["documentation", "labelling"],
        ),
    ]
    for entry_id, title, package_id, slug, why, categories, reg_types in specs:
        pdf_rel = f"raw/us/US_{package_id}_{slug}.pdf"
        xml_rel = f"raw/us/US_{package_id}_{slug}.xml"
        entry = make_entry(
            entry_id,
            "US",
            title,
            "GovInfo / U.S. Government Publishing Office",
            f"https://www.govinfo.gov/app/details/{package_id}",
            [pdf_rel, xml_rel],
            why,
            categories,
            reg_types,
            source_type="govinfo_compilation",
        )
        entry["govinfo_package"] = package_id
        entry["_downloads"] = [
            {"url": f"https://www.govinfo.gov/content/pkg/{package_id}/pdf/{package_id}.pdf", "file": pdf_rel, "min_bytes": 1000},
            {"url": f"https://www.govinfo.gov/content/pkg/{package_id}/uslm/{package_id}.xml", "file": xml_rel, "min_bytes": 1000},
        ]
        entries.append(entry)


def add_us_ecfr_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "us-16-cfr-303-textile-fiber-products-identification",
            "16 CFR Part 303, Rules and Regulations Under the Textile Fiber Products Identification Act",
            16,
            "303",
            "raw/us/US_16_CFR_Part_303_textile_fiber_products_identification.xml",
            "US textile fiber names, composition, and labelling requirements.",
            ["textiles", "apparel"],
            ["labelling"],
        ),
        (
            "us-16-cfr-423-care-labeling",
            "16 CFR Part 423, Care Labeling of Textile Wearing Apparel and Certain Piece Goods",
            16,
            "423",
            "raw/us/US_16_CFR_Part_423_care_labeling.xml",
            "US apparel and textile care labelling rules.",
            ["textiles", "apparel"],
            ["labelling"],
        ),
        (
            "us-16-cfr-500-fair-packaging-labeling",
            "16 CFR Part 500, Regulations Under Section 4 of the Fair Packaging and Labeling Act",
            16,
            "500",
            "raw/us/US_16_CFR_Part_500_fair_packaging_labeling.xml",
            "US consumer commodity packaging and quantity declaration regulations.",
            ["packaging", "general_consumer_products"],
            ["labelling", "packaging"],
        ),
        (
            "us-16-cfr-305-energy-water-labeling",
            "16 CFR Part 305, Energy and Water Use Labeling for Consumer Products",
            16,
            "305",
            "raw/us/US_16_CFR_Part_305_energy_water_labeling.xml",
            "US EnergyGuide and water/energy use labelling requirements.",
            ["electronics", "home_appliances"],
            ["labelling", "sustainability"],
        ),
        (
            "us-16-cfr-1219-full-size-baby-cribs",
            "16 CFR Part 1219, Safety Standard for Full-Size Baby Cribs",
            16,
            "1219",
            "raw/us/US_16_CFR_Part_1219_full_size_baby_cribs.xml",
            "US durable infant product safety standard for full-size cribs.",
            ["children_products", "furniture"],
            ["product_safety", "mechanical"],
        ),
        (
            "us-16-cfr-1220-non-full-size-baby-cribs",
            "16 CFR Part 1220, Safety Standard for Non-Full-Size Baby Cribs",
            16,
            "1220",
            "raw/us/US_16_CFR_Part_1220_non_full_size_baby_cribs.xml",
            "US durable infant product safety standard for non-full-size cribs.",
            ["children_products", "furniture"],
            ["product_safety", "mechanical"],
        ),
        (
            "us-16-cfr-1221-play-yards",
            "16 CFR Part 1221, Safety Standard for Play Yards",
            16,
            "1221",
            "raw/us/US_16_CFR_Part_1221_play_yards.xml",
            "US durable infant product safety standard for play yards.",
            ["children_products", "furniture"],
            ["product_safety", "mechanical"],
        ),
        (
            "us-47-cfr-2-equipment-authorization",
            "47 CFR Part 2, Frequency Allocations and Radio Treaty Matters; General Rules and Regulations",
            47,
            "2",
            "raw/us/US_47_CFR_Part_2_equipment_authorization.xml",
            "FCC equipment authorization, radiofrequency device, and certification context.",
            ["electronics", "radio", "telecommunications"],
            ["radio", "conformity", "emc"],
        ),
    ]
    for entry_id, title, cfr_title, part, file_rel, why, categories, reg_types in specs:
        entry = make_entry(
            entry_id,
            "US",
            title,
            f"eCFR API ({ECFR_DATE})",
            f"https://www.ecfr.gov/current/title-{cfr_title}/part-{part}",
            [file_rel],
            why,
            categories,
            reg_types,
            source_type="ecfr_part",
        )
        entry["ecfr_date"] = ECFR_DATE
        entry["ecfr_title"] = cfr_title
        entry["ecfr_part"] = part
        entry["_downloads"] = [
            {
                "url": f"https://www.ecfr.gov/api/versioner/v1/full/{ECFR_DATE}/title-{cfr_title}.xml?part={part}",
                "file": file_rel,
                "min_bytes": 1000,
            }
        ]
        entries.append(entry)


def add_us_additional_ecfr_scenario_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "us-16-cfr-300-wool-products-labeling",
            "16 CFR Part 300, Rules and Regulations Under the Wool Products Labeling Act of 1939",
            16,
            "300",
            "raw/us/US_16_CFR_Part_300_wool_products_labeling.xml",
            "US wool apparel and textile labelling regulations.",
            ["textiles", "apparel"],
            ["labelling"],
        ),
        (
            "us-16-cfr-301-fur-products-labeling",
            "16 CFR Part 301, Rules and Regulations Under the Fur Products Labeling Act",
            16,
            "301",
            "raw/us/US_16_CFR_Part_301_fur_products_labeling.xml",
            "US fur product labelling and disclosure regulations.",
            ["textiles", "apparel"],
            ["labelling"],
        ),
        (
            "us-16-cfr-260-green-guides",
            "16 CFR Part 260, Guides for the Use of Environmental Marketing Claims",
            16,
            "260",
            "raw/us/US_16_CFR_Part_260_green_guides.xml",
            "US FTC environmental marketing claim guidance for recyclability, degradability, and sustainability claims.",
            ["packaging", "general_consumer_products"],
            ["labelling", "sustainability"],
        ),
        (
            "us-16-cfr-323-made-in-usa-labeling",
            "16 CFR Part 323, Made in USA Labeling Rule",
            16,
            "323",
            "raw/us/US_16_CFR_Part_323_made_in_usa_labeling.xml",
            "US origin and Made in USA labelling requirements.",
            ["general_consumer_products", "electronics", "apparel"],
            ["labelling"],
        ),
        (
            "us-16-cfr-1505-electrically-operated-toys",
            "16 CFR Part 1505, Requirements for Electrically Operated Toys or Other Electrically Operated Articles Intended for Use by Children",
            16,
            "1505",
            "raw/us/US_16_CFR_Part_1505_electrically_operated_toys.xml",
            "US electrical safety requirements for children's toys and child-use articles.",
            ["toys", "children_products", "electronics"],
            ["product_safety", "testing"],
        ),
        (
            "us-16-cfr-1507-fireworks-devices",
            "16 CFR Part 1507, Fireworks Devices",
            16,
            "1507",
            "raw/us/US_16_CFR_Part_1507_fireworks_devices.xml",
            "US consumer fireworks device safety rules.",
            ["general_consumer_products"],
            ["product_safety", "chemical"],
        ),
        (
            "us-16-cfr-1215-infant-bath-seats",
            "16 CFR Part 1215, Safety Standard for Infant Bath Seats",
            16,
            "1215",
            "raw/us/US_16_CFR_Part_1215_infant_bath_seats.xml",
            "US durable infant product safety standard for infant bath seats.",
            ["children_products", "home_goods"],
            ["product_safety", "mechanical"],
        ),
        (
            "us-16-cfr-1216-infant-walkers",
            "16 CFR Part 1216, Safety Standard for Infant Walkers",
            16,
            "1216",
            "raw/us/US_16_CFR_Part_1216_infant_walkers.xml",
            "US durable infant product safety standard for infant walkers.",
            ["children_products"],
            ["product_safety", "mechanical"],
        ),
        (
            "us-16-cfr-1217-toddler-beds",
            "16 CFR Part 1217, Safety Standard for Toddler Beds",
            16,
            "1217",
            "raw/us/US_16_CFR_Part_1217_toddler_beds.xml",
            "US durable infant product safety standard for toddler beds.",
            ["children_products", "furniture"],
            ["product_safety", "mechanical"],
        ),
        (
            "us-16-cfr-1218-bassinets-cradles",
            "16 CFR Part 1218, Safety Standard for Bassinets and Cradles",
            16,
            "1218",
            "raw/us/US_16_CFR_Part_1218_bassinets_cradles.xml",
            "US durable infant product safety standard for bassinets and cradles.",
            ["children_products", "furniture"],
            ["product_safety", "mechanical"],
        ),
        (
            "us-16-cfr-1222-bedside-sleepers",
            "16 CFR Part 1222, Safety Standard for Bedside Sleepers",
            16,
            "1222",
            "raw/us/US_16_CFR_Part_1222_bedside_sleepers.xml",
            "US durable infant product safety standard for bedside sleepers.",
            ["children_products", "furniture"],
            ["product_safety", "mechanical"],
        ),
        (
            "us-16-cfr-1223-infant-swings",
            "16 CFR Part 1223, Safety Standard for Infant Swings",
            16,
            "1223",
            "raw/us/US_16_CFR_Part_1223_infant_swings.xml",
            "US durable infant product safety standard for infant swings.",
            ["children_products"],
            ["product_safety", "mechanical"],
        ),
        (
            "us-16-cfr-1224-portable-bed-rails",
            "16 CFR Part 1224, Safety Standard for Portable Bed Rails",
            16,
            "1224",
            "raw/us/US_16_CFR_Part_1224_portable_bed_rails.xml",
            "US durable child product safety standard for portable bed rails.",
            ["children_products", "furniture"],
            ["product_safety", "mechanical"],
        ),
        (
            "us-16-cfr-1227-carriages-strollers",
            "16 CFR Part 1227, Safety Standard for Carriages and Strollers",
            16,
            "1227",
            "raw/us/US_16_CFR_Part_1227_carriages_strollers.xml",
            "US durable infant product safety standard for carriages and strollers.",
            ["children_products"],
            ["product_safety", "mechanical"],
        ),
        (
            "us-16-cfr-1229-infant-bouncer-seats",
            "16 CFR Part 1229, Safety Standard for Infant Bouncer Seats",
            16,
            "1229",
            "raw/us/US_16_CFR_Part_1229_infant_bouncer_seats.xml",
            "US durable infant product safety standard for infant bouncer seats.",
            ["children_products"],
            ["product_safety", "mechanical"],
        ),
        (
            "us-16-cfr-1231-high-chairs",
            "16 CFR Part 1231, Safety Standard for High Chairs",
            16,
            "1231",
            "raw/us/US_16_CFR_Part_1231_high_chairs.xml",
            "US durable infant product safety standard for high chairs.",
            ["children_products", "furniture"],
            ["product_safety", "mechanical"],
        ),
        (
            "us-16-cfr-1234-infant-sleep-products",
            "16 CFR Part 1234, Safety Standard for Infant Sleep Products",
            16,
            "1234",
            "raw/us/US_16_CFR_Part_1234_infant_sleep_products.xml",
            "US infant sleep product safety standard covering products not already regulated by more specific rules.",
            ["children_products", "furniture"],
            ["product_safety", "mechanical"],
        ),
        (
            "us-40-cfr-770-formaldehyde-composite-wood",
            "40 CFR Part 770, Formaldehyde Standards for Composite Wood Products",
            40,
            "770",
            "raw/us/US_40_CFR_Part_770_formaldehyde_composite_wood.xml",
            "US EPA formaldehyde emission standards for composite wood products used in furniture and home goods.",
            ["furniture", "home_goods", "raw_materials"],
            ["chemical", "product_safety", "testing"],
        ),
    ]
    for entry_id, title, cfr_title, part, file_rel, why, categories, reg_types in specs:
        entry = make_entry(
            entry_id,
            "US",
            title,
            f"eCFR API ({ECFR_DATE})",
            f"https://www.ecfr.gov/current/title-{cfr_title}/part-{part}",
            [file_rel],
            why,
            categories,
            reg_types,
            source_type="ecfr_part",
        )
        entry["ecfr_date"] = ECFR_DATE
        entry["ecfr_title"] = cfr_title
        entry["ecfr_part"] = part
        entry["_downloads"] = [
            {
                "url": f"https://www.ecfr.gov/api/versioner/v1/full/{ECFR_DATE}/title-{cfr_title}.xml?part={part}",
                "file": file_rel,
                "min_bytes": 1000,
            }
        ]
        entries.append(entry)


def add_uk_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "uk-general-product-safety-regulations-2005",
            "The General Product Safety Regulations 2005",
            "2005",
            "1803",
            "general_product_safety_regulations_2005",
            "UK original general product safety regulations.",
            ["general_consumer_products", "children_products"],
            ["product_safety", "market_surveillance"],
        ),
        (
            "uk-toys-safety-regulations-2011-original",
            "The Toys (Safety) Regulations 2011",
            "2011",
            "1881",
            "toys_safety_regulations_2011",
            "UK original toy safety regulations.",
            ["toys", "children_products"],
            ["product_safety", "chemical", "mechanical", "conformity"],
        ),
        (
            "uk-electrical-equipment-safety-regulations-2016-original",
            "The Electrical Equipment (Safety) Regulations 2016",
            "2016",
            "1101",
            "electrical_equipment_safety_regulations_2016",
            "UK original electrical equipment safety regulations.",
            ["electronics", "electrical_equipment"],
            ["product_safety", "conformity"],
        ),
        (
            "uk-emc-regulations-2016-original",
            "The Electromagnetic Compatibility Regulations 2016",
            "2016",
            "1091",
            "electromagnetic_compatibility_regulations_2016",
            "UK original EMC regulations.",
            ["electronics", "electrical_equipment"],
            ["emc", "conformity"],
        ),
        (
            "uk-radio-equipment-regulations-2017-original",
            "The Radio Equipment Regulations 2017",
            "2017",
            "1206",
            "radio_equipment_regulations_2017",
            "UK original radio equipment regulations.",
            ["electronics", "radio"],
            ["radio", "emc", "conformity"],
        ),
        (
            "uk-rohs-regulations-2012-original",
            "The Restriction of the Use of Certain Hazardous Substances in Electrical and Electronic Equipment Regulations 2012",
            "2012",
            "3032",
            "rohs_regulations_2012",
            "UK original RoHS regulations.",
            ["electronics", "electrical_equipment", "chemicals"],
            ["chemical", "conformity"],
        ),
        (
            "uk-packaging-essential-requirements-regulations-2015",
            "The Packaging (Essential Requirements) Regulations 2015",
            "2015",
            "1640",
            "packaging_essential_requirements_regulations_2015",
            "UK packaging essential requirements and enforcement context.",
            ["packaging"],
            ["packaging", "sustainability"],
        ),
        (
            "uk-psti-security-requirements-regulations-2023-original",
            "The Product Security and Telecommunications Infrastructure (Security Requirements for Relevant Connectable Products) Regulations 2023",
            "2023",
            "1007",
            "psti_security_requirements_regulations_2023",
            "UK original security requirements for consumer connectable products.",
            ["electronics", "telecommunications", "general_consumer_products"],
            ["product_safety", "documentation"],
        ),
        (
            "uk-cosmetic-products-enforcement-regulations-2013-original",
            "The Cosmetic Products Enforcement Regulations 2013",
            "2013",
            "1478",
            "cosmetic_products_enforcement_regulations_2013",
            "UK original cosmetic products enforcement regulations.",
            ["cosmetics"],
            ["product_safety", "chemical", "market_surveillance"],
        ),
        (
            "uk-simple-pressure-vessels-safety-regulations-2016",
            "The Simple Pressure Vessels (Safety) Regulations 2016",
            "2016",
            "1092",
            "simple_pressure_vessels_safety_regulations_2016",
            "UK original simple pressure vessel safety regulations.",
            ["industrial_products"],
            ["product_safety", "conformity"],
        ),
        (
            "uk-pressure-equipment-safety-regulations-2016",
            "The Pressure Equipment (Safety) Regulations 2016",
            "2016",
            "1105",
            "pressure_equipment_safety_regulations_2016",
            "UK original pressure equipment safety regulations.",
            ["industrial_products", "machinery"],
            ["product_safety", "conformity"],
        ),
    ]
    for entry_id, title, year, number, slug, why, categories, reg_types in specs:
        padded = f"{year}{int(number):04d}"
        xml_rel = f"raw/uk/UK_{slug}.xml"
        pdf_rel = f"raw/uk/UK_{slug}.pdf"
        entry = make_entry(
            entry_id,
            "UK",
            title,
            "legislation.gov.uk",
            f"https://www.legislation.gov.uk/uksi/{year}/{number}/contents",
            [xml_rel, pdf_rel],
            why,
            categories,
            reg_types,
            source_type="uk_legislation",
        )
        entry["legislation_id"] = f"uksi/{year}/{number}"
        entry["_downloads"] = [
            {"url": f"https://www.legislation.gov.uk/uksi/{year}/{number}/data.xml", "file": xml_rel, "min_bytes": 1000},
            {
                "url": f"https://www.legislation.gov.uk/uksi/{year}/{number}/pdfs/uksi_{padded}_en.pdf",
                "file": pdf_rel,
                "min_bytes": 1000,
            },
        ]
        entries.append(entry)


def add_uk_full_scenario_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "uk-consumer-protection-act-1987",
            "Consumer Protection Act 1987",
            "ukpga/1987/43",
            "ukpga_19870043_en.pdf",
            "consumer_protection_act_1987",
            "UK statutory product liability and consumer safety baseline.",
            ["general_consumer_products", "children_products", "electronics"],
            ["product_safety", "market_surveillance"],
        ),
        (
            "uk-reach-enforcement-regulations-2008-original",
            "The REACH Enforcement Regulations 2008",
            "uksi/2008/2852",
            "uksi_20082852_en.pdf",
            "reach_enforcement_regulations_2008",
            "UK original REACH enforcement regulations.",
            ["chemicals", "general_consumer_products"],
            ["chemical", "market_surveillance"],
        ),
        (
            "uk-supply-of-machinery-safety-regulations-2008",
            "The Supply of Machinery (Safety) Regulations 2008",
            "uksi/2008/1597",
            "uksi_20081597_en.pdf",
            "supply_of_machinery_safety_regulations_2008",
            "UK machinery safety and conformity regulations.",
            ["machinery", "industrial_products"],
            ["product_safety", "conformity"],
        ),
        (
            "uk-ppe-enforcement-regulations-2018",
            "The Personal Protective Equipment (Enforcement) Regulations 2018",
            "uksi/2018/390",
            "uksi_20180390_en.pdf",
            "ppe_enforcement_regulations_2018",
            "UK PPE enforcement framework.",
            ["ppe", "apparel", "industrial_products"],
            ["product_safety", "conformity", "market_surveillance"],
        ),
        (
            "uk-gas-appliances-enforcement-regulations-2018",
            "The Gas Appliances (Enforcement) and Miscellaneous Amendments Regulations 2018",
            "uksi/2018/389",
            "uksi_20180389_en.pdf",
            "gas_appliances_enforcement_regulations_2018",
            "UK gas appliance safety and enforcement context.",
            ["home_appliances", "industrial_products"],
            ["product_safety", "conformity", "market_surveillance"],
        ),
        (
            "uk-ecodesign-energy-related-products-regulations-2010",
            "The Ecodesign for Energy-Related Products Regulations 2010",
            "uksi/2010/2617",
            "uksi_20102617_en.pdf",
            "ecodesign_energy_related_products_regulations_2010",
            "UK ecodesign requirements for energy-related products.",
            ["home_appliances", "electronics", "electrical_equipment"],
            ["sustainability", "technical_standard", "conformity"],
        ),
        (
            "uk-product-safety-metrology-ukni-amendment-2020",
            "The Product Safety and Metrology etc. (Amendment etc.) (UK(NI) Indication) (EU Exit) Regulations 2020",
            "uksi/2020/1460",
            "uksi_20201460_en.pdf",
            "product_safety_metrology_ukni_amendment_2020",
            "UK product safety and metrology amendment context for UK(NI) indication and post-Brexit compliance.",
            ["general_consumer_products", "electronics", "industrial_products"],
            ["conformity", "labelling", "market_surveillance"],
        ),
    ]
    for entry_id, title, legislation_id, pdf_name, slug, why, categories, reg_types in specs:
        xml_rel = f"raw/uk/UK_{slug}.xml"
        pdf_rel = f"raw/uk/UK_{slug}.pdf"
        entry = make_entry(
            entry_id,
            "UK",
            title,
            "legislation.gov.uk",
            f"https://www.legislation.gov.uk/{legislation_id}/contents",
            [xml_rel, pdf_rel],
            why,
            categories,
            reg_types,
            source_type="uk_legislation",
        )
        entry["legislation_id"] = legislation_id
        entry["_downloads"] = [
            {"url": f"https://www.legislation.gov.uk/{legislation_id}/data.xml", "file": xml_rel, "min_bytes": 1000},
            {
                "url": f"https://www.legislation.gov.uk/{legislation_id}/pdfs/{pdf_name}",
                "file": pdf_rel,
                "min_bytes": 1000,
            },
        ]
        entries.append(entry)


def add_australia_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "au-projectile-toys-safety-standard-2020",
            "Consumer Goods (Projectile Toys) Safety Standard 2020",
            "F2020L00687",
            "2021-08-03",
            "2021-08-03",
            "projectile_toys_safety_standard_2020",
            "Australia projectile toy safety requirements.",
            ["toys", "children_products"],
            ["product_safety", "mechanical"],
        ),
        (
            "au-aquatic-toys-safety-standard-2020",
            "Consumer Goods (Aquatic Toys) Safety Standard 2020",
            "F2020L00686",
            "asmade",
            "2020-06-11",
            "aquatic_toys_safety_standard_2020",
            "Australia aquatic toy safety requirements.",
            ["toys", "children_products"],
            ["product_safety", "mechanical"],
        ),
        (
            "au-baby-bath-aids-safety-standard-2017",
            "Consumer Goods (Baby Bath Aids) Safety Standard 2017",
            "F2017L01394",
            "asmade",
            "2017-10-26",
            "baby_bath_aids_safety_standard_2017",
            "Australia baby bath aid safety, warning, and labelling requirements.",
            ["children_products", "home_goods"],
            ["product_safety", "labelling"],
        ),
        (
            "au-bean-bags-safety-standard-2014",
            "Consumer Goods (Bean Bags) Safety Standard 2014",
            "F2014L01587",
            "2015-07-14",
            "2015-07-14",
            "bean_bags_safety_standard_2014",
            "Australia bean bag warning and child-safety requirements.",
            ["home_goods", "furniture", "children_products"],
            ["product_safety", "labelling"],
        ),
        (
            "au-swimming-flotation-aids-safety-standard-2017",
            "Consumer Goods (Swimming and Flotation Aids) Safety Standard 2017",
            "F2017L01662",
            "asmade",
            "2017-12-19",
            "swimming_flotation_aids_safety_standard_2017",
            "Australia swimming and flotation aid safety and labelling requirements.",
            ["children_products", "general_consumer_products"],
            ["product_safety", "labelling"],
        ),
    ]
    for entry_id, title, instrument_id, version, date, slug, why, categories, reg_types in specs:
        pdf_rel = f"raw/au/AU_{slug}.pdf"
        docx_rel = f"raw/au/AU_{slug}.docx"
        entry = make_entry(
            entry_id,
            "AU",
            title,
            "Federal Register of Legislation",
            f"https://www.legislation.gov.au/{instrument_id}/{version}/downloads",
            [pdf_rel, docx_rel],
            why,
            categories,
            reg_types,
            source_type="au_legislation",
        )
        entry["instrument_id"] = instrument_id
        entry["_downloads"] = [
            {
                "url": f"https://www.legislation.gov.au/{instrument_id}/{version}/{date}/text/original/pdf",
                "file": pdf_rel,
                "min_bytes": 1000,
            },
            {
                "url": f"https://www.legislation.gov.au/{instrument_id}/{version}/{date}/text/original/word",
                "file": docx_rel,
                "min_bytes": 1000,
            },
        ]
        entries.append(entry)


def add_canada_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "ca-energy-efficiency-regulations-2016",
            "Energy Efficiency Regulations, 2016",
            "https://laws-lois.justice.gc.ca/eng/XML/SOR-2016-311.xml",
            "raw/ca/CA_energy_efficiency_regulations_2016.xml",
            "Canadian energy efficiency requirements for regulated energy-using products.",
            ["electronics", "home_appliances"],
            ["sustainability", "labelling", "technical_standard"],
        ),
        (
            "ca-hazardous-products-act",
            "Hazardous Products Act",
            "https://laws-lois.justice.gc.ca/eng/XML/H-3.xml",
            "raw/ca/CA_hazardous_products_act.xml",
            "Canadian hazardous product statutory restrictions and safety context.",
            ["chemicals", "general_consumer_products"],
            ["chemical", "product_safety", "labelling"],
        ),
        (
            "ca-hazardous-products-regulations-sor-2015-17",
            "Hazardous Products Regulations (SOR/2015-17)",
            "https://laws-lois.justice.gc.ca/eng/XML/SOR-2015-17.xml",
            "raw/ca/CA_hazardous_products_regulations_SOR-2015-17.xml",
            "Canadian hazardous product classification, labelling, and safety data requirements.",
            ["chemicals"],
            ["chemical", "labelling", "documentation"],
        ),
        (
            "ca-textile-labelling-act",
            "Textile Labelling Act",
            "https://laws-lois.justice.gc.ca/eng/XML/T-10.xml",
            "raw/ca/CA_textile_labelling_act.xml",
            "Canadian textile labelling statutory context.",
            ["textiles", "apparel"],
            ["labelling"],
        ),
        (
            "ca-consumer-packaging-labelling-act",
            "Consumer Packaging and Labelling Act",
            "https://laws-lois.justice.gc.ca/eng/XML/C-38.xml",
            "raw/ca/CA_consumer_packaging_labelling_act.xml",
            "Canadian consumer packaging and labelling statutory context.",
            ["packaging", "general_consumer_products"],
            ["packaging", "labelling"],
        ),
        (
            "ca-cribs-cradles-bassinets-regulations-sor-2016-152",
            "Cribs, Cradles and Bassinets Regulations (SOR/2016-152)",
            "https://laws-lois.justice.gc.ca/eng/XML/SOR-2016-152.xml",
            "raw/ca/CA_cribs_cradles_bassinets_regulations_SOR-2016-152.xml",
            "Canadian infant sleep product safety requirements.",
            ["children_products", "furniture"],
            ["product_safety", "mechanical"],
        ),
        (
            "ca-playpens-regulations-sor-2018-186",
            "Playpens Regulations (SOR/2018-186)",
            "https://laws-lois.justice.gc.ca/eng/XML/SOR-2018-186.xml",
            "raw/ca/CA_playpens_regulations_SOR-2018-186.xml",
            "Canadian playpen safety requirements.",
            ["children_products", "furniture"],
            ["product_safety", "mechanical"],
        ),
    ]
    for entry_id, title, url, file_rel, why, categories, reg_types in specs:
        entry = make_entry(
            entry_id,
            "CA",
            title,
            "Justice Laws Website, Government of Canada",
            url,
            [file_rel],
            why,
            categories,
            reg_types,
            source_type="canada_justice_laws_xml",
        )
        entry["_downloads"] = [{"url": url, "file": file_rel, "min_bytes": 1000}]
        entries.append(entry)


def add_china_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "cn-compulsory-product-certification-management-regulations",
            "Measures for the Administration of Compulsory Product Certification",
            "State Administration for Market Regulation",
            "https://www.samr.gov.cn/cms_files/filemanager/1647978232/attach/20233/9d4904b4e88c4dc1add282c485aae896.pdf",
            "raw/cn/CN_compulsory_product_certification_management_regulations.pdf",
            "China CCC administration rules from the official SAMR regulation collection.",
            ["electronics", "electrical_equipment", "toys", "general_consumer_products"],
            ["conformity", "scope_classification"],
        ),
        (
            "cn-consumer-product-recall-interim-provisions",
            "Interim Provisions on the Administration of Consumer Product Recalls",
            "State Administration for Market Regulation",
            "https://www.samr.gov.cn/cms_files/filemanager/samr/www/samrnew/samrgkml/nsjg/fgs/201911/W020211126555725943517.pdf",
            "raw/cn/CN_consumer_product_recall_interim_provisions.pdf",
            "China consumer product recall management rules from SAMR.",
            ["general_consumer_products", "children_products"],
            ["product_safety", "market_surveillance"],
        ),
        (
            "cn-product-quality-supervision-sampling-interim-measures",
            "Interim Measures for the Administration of Product Quality Supervision and Random Inspection",
            "State Council / Government of China",
            "https://www.gov.cn/zhengce/2019-11/26/content_5723745.htm",
            "raw/cn/CN_product_quality_supervision_sampling_interim_measures.html",
            "China product quality supervision sampling rules published by the government portal.",
            ["general_consumer_products", "industrial_products"],
            ["market_surveillance", "testing"],
        ),
        (
            "cn-industrial-product-production-quality-safety-responsibility-regulation",
            "Provisions on the Supervision and Administration of Quality and Safety Responsibilities of Industrial Product Production Units",
            "State Administration for Market Regulation",
            "https://www.samr.gov.cn/cms_files/filemanager/1647978232/attach/20234/W020230412491100770093.pdf",
            "raw/cn/CN_industrial_product_production_quality_safety_responsibility_regulation.pdf",
            "China industrial product production quality-safety responsibility rules from SAMR.",
            ["industrial_products", "general_consumer_products"],
            ["product_safety", "market_surveillance", "documentation"],
        ),
        (
            "cn-industrial-product-sales-quality-safety-responsibility-regulation",
            "Provisions on the Supervision and Administration of Quality and Safety Responsibilities of Industrial Product Sellers",
            "State Administration for Market Regulation",
            "https://www.samr.gov.cn/cms_files/filemanager/1647978232/attach/20234/W020230412491416258616.pdf",
            "raw/cn/CN_industrial_product_sales_quality_safety_responsibility_regulation.pdf",
            "China industrial product seller quality-safety responsibility rules from SAMR.",
            ["industrial_products", "general_consumer_products"],
            ["product_safety", "market_surveillance", "documentation"],
        ),
        (
            "cn-ccc-electric-bicycle-battery-charger-2024",
            "Announcement on CCC Management for Lithium-ion Batteries and Chargers for Electric Bicycles",
            "State Council / Government of China",
            "https://www.gov.cn/zhengce/zhengceku/202407/content_6960795.htm",
            "raw/cn/CN_ccc_electric_bicycle_battery_charger_2024.html",
            "China CCC scope expansion context for electric bicycle batteries and chargers.",
            ["batteries", "electronics", "electrical_equipment"],
            ["conformity", "scope_classification"],
        ),
        (
            "cn-ccc-commercial-gas-burning-appliances-2024",
            "Announcement on CCC Management for Commercial Gas-burning Appliances and Other Products",
            "State Council / Government of China",
            "https://www.gov.cn/zhengce/zhengceku/202404/content_6943832.htm",
            "raw/cn/CN_ccc_commercial_gas_burning_appliances_2024.html",
            "China CCC scope expansion context for commercial gas-burning appliances.",
            ["home_appliances", "industrial_products"],
            ["conformity", "scope_classification", "product_safety"],
        ),
    ]
    for entry_id, title, channel, url, file_rel, why, categories, reg_types in specs:
        entry = make_entry(
            entry_id,
            "CN",
            title,
            channel,
            url,
            [file_rel],
            why,
            categories,
            reg_types,
            source_type="cn_official_source",
        )
        entry["_downloads"] = [{"url": url, "file": file_rel, "min_bytes": 1000}]
        entries.append(entry)


def add_china_full_scenario_entries(entries: list[dict[str, Any]]) -> None:
    specs = [
        (
            "cn-product-quality-law",
            "Product Quality Law of the People's Republic of China",
            "State Council / Government of China",
            "https://www.gov.cn/gongbao/content/2000/content_60325.htm",
            "raw/cn/CN_product_quality_law.html",
            "China product quality statutory baseline for producer and seller obligations.",
            ["general_consumer_products", "industrial_products"],
            ["product_safety", "market_surveillance"],
        ),
        (
            "cn-certification-and-accreditation-regulation",
            "Regulation of the People's Republic of China on Certification and Accreditation",
            "State Council / Government of China",
            "https://www.gov.cn/gongbao/content/2003/content_62427.htm",
            "raw/cn/CN_certification_and_accreditation_regulation.html",
            "China certification and accreditation framework relevant to CCC and conformity assessment.",
            ["general_consumer_products", "electronics", "electrical_equipment"],
            ["conformity", "testing", "market_surveillance"],
        ),
        (
            "cn-rohs-hazardous-substances-electrical-electronic-products",
            "Administrative Measures for the Restriction of the Use of Hazardous Substances in Electrical and Electronic Products",
            "State Council / Government of China",
            "https://www.gov.cn/gongbao/content/2016/content_5065677.htm",
            "raw/cn/CN_rohs_hazardous_substances_electrical_electronic_products.html",
            "China RoHS management measures for hazardous substances in electrical and electronic products.",
            ["electronics", "electrical_equipment", "chemicals"],
            ["chemical", "labelling", "conformity"],
        ),
        (
            "cn-rohs-compliance-management-catalogue-2018",
            "Compliance Management Catalogue for the Restriction of Hazardous Substances in Electrical and Electronic Products",
            "Ministry of Industry and Information Technology",
            "https://www.miit.gov.cn/cms_files/filemanager/oldfile/miit/n1146285/n1146352/n3054355/n3057542/n3057544/c6086848/part/6086863.pdf",
            "raw/cn/CN_rohs_compliance_management_catalogue_2018.pdf",
            "China RoHS catalogue and implementation list for electrical and electronic products.",
            ["electronics", "electrical_equipment", "chemicals"],
            ["chemical", "scope_classification", "conformity"],
        ),
        (
            "cn-defective-consumer-product-recall-management",
            "Measures for the Administration of Recalls of Defective Consumer Products",
            "State Council / Government of China",
            "https://www.gov.cn/gongbao/content/2016/content_5054757.htm",
            "raw/cn/CN_defective_consumer_product_recall_management.html",
            "China defective consumer product recall management rules.",
            ["general_consumer_products", "children_products"],
            ["product_safety", "market_surveillance"],
        ),
        (
            "cn-consumer-rights-protection-law-implementation-regulations-2024",
            "Implementation Regulations for the Law on the Protection of Consumer Rights and Interests",
            "State Council / Government of China",
            "https://www.gov.cn/zhengce/content/202403/content_6940158.htm",
            "raw/cn/CN_consumer_rights_protection_law_implementation_regulations_2024.html",
            "China consumer rights implementation rules relevant to sales, information, and after-sales obligations.",
            ["general_consumer_products", "electronics"],
            ["documentation", "labelling", "market_surveillance"],
        ),
        (
            "cn-reach-chemical-substance-environmental-management",
            "Measures for Environmental Management Registration of New Chemical Substances",
            "State Council / Government of China",
            "https://www.gov.cn/zhengce/zhengceku/2020-05/11/content_5510520.htm",
            "raw/cn/CN_new_chemical_substance_environmental_management_registration.html",
            "China new chemical substance registration requirements for upstream materials and imported substances.",
            ["chemicals", "raw_materials"],
            ["chemical", "documentation"],
        ),
    ]
    for entry_id, title, channel, url, file_rel, why, categories, reg_types in specs:
        entry = make_entry(
            entry_id,
            "CN",
            title,
            channel,
            url,
            [file_rel],
            why,
            categories,
            reg_types,
            source_type="cn_official_source",
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
    source_type: str,
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


def build_readme(manifest: dict[str, Any]) -> str:
    summary = manifest["summary"]
    return f"""# More Official Regulation Sources 2026-05-27

This directory contains an additional isolated batch of raw official or government-source legal/regulatory documents collected for review before ingestion.

## Scope

- Collected at: {manifest["created_at"]}
- Entries collected: {summary["regulation_entries"]}
- Raw files referenced: {summary["raw_files"]}
- Failed downloads: {summary["failed_downloads"]}
- Markets: {", ".join(summary["markets"])}
- Source manifest: manifest.json

## Coverage Themes

- Original statutes, statutory instruments, and current regulatory text from official sources
- Product safety, conformity, market surveillance, testing, and documentation
- Toys, children's products, apparel/textiles, packaging, electronics/radio, energy labelling, PPE, appliances, and industrial equipment
- PDF and DOCX originals where official sources provide them; XML/XHTML/RDF/HTML where official legal repositories expose machine-readable text

## Notes

- Files remain isolated from `data/corpus/processed/` and `data/faiss/` until reviewed.
- This batch complements earlier supplements by adding original legal texts alongside some topics previously represented by guidance pages.
- US eCFR files use the official eCFR API XML endpoint dated {summary["ecfr_date"]}.
- GovInfo entries include both PDF and USLM XML forms when available.
- UK entries include both legislation.gov.uk PDF and XML forms.
- Australia entries include both PDF and Word/DOCX originals from the Federal Register of Legislation.
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
    parser = argparse.ArgumentParser(description="Collect more official regulation source files.")
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
