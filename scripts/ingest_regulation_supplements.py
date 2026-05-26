#!/usr/bin/env python3
"""
Ingest isolated official regulation supplements into data/corpus/processed.

The supplement manifest can point to several raw files for one regulation
(for example EU RDF metadata plus XHTML text). This script writes one processed
JSON document per manifest entry, preserving official source metadata.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import warnings
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

sys.path.insert(0, str(Path(__file__).parent.parent))

from bs4 import XMLParsedAsHTMLWarning
from rag_service.parser.html_parser import parse_html


DEFAULT_SUPPLEMENT_DIR = Path("data/regulation_supplements/2026-05-25_official_sources")
DEFAULT_PROCESSED_DIR = Path("data/corpus/processed")

TEXT_FILE_PRIORITY = {
    ".xhtml": 0,
    ".html": 1,
    ".htm": 1,
    ".xml": 2,
    ".rdf": 3,
    ".pdf": 4,
}


def choose_primary_file(entry: dict[str, Any]) -> Path:
    """Choose the raw file that contains the best full-text content."""
    files = [Path(file_name) for file_name in entry.get("files", [])]
    if not files:
        raise ValueError(f"Manifest entry {entry.get('id', '<unknown>')} has no files")

    return sorted(
        files,
        key=lambda path: (TEXT_FILE_PRIORITY.get(path.suffix.lower(), 99), path.as_posix()),
    )[0]


def parse_source_file(source_path: Path) -> dict[str, Any]:
    """Parse HTML/XHTML/XML/RDF raw files into the processed corpus shape."""
    suffix = source_path.suffix.lower()
    if suffix in {".html", ".htm", ".xhtml"}:
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)
            parsed = parse_html(str(source_path))
        raw_text = _clean_text(parsed.get("rawText", ""))
        tables = parsed.get("tables", [])
        return {
            "sourceType": suffix.lstrip("."),
            "pageCount": 1,
            "totalChars": len(raw_text),
            "hasTables": bool(tables),
            "tableCount": len(tables),
            "tables": tables,
            "rawText": raw_text,
        }

    if suffix in {".xml", ".rdf"}:
        raw_text = _parse_xml_text(source_path)
        return {
            "sourceType": suffix.lstrip("."),
            "pageCount": 1,
            "totalChars": len(raw_text),
            "hasTables": False,
            "tableCount": 0,
            "rawText": raw_text,
        }

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

    raise ValueError(f"Unsupported supplement source format: {source_path}")


def build_processed_document(
    entry: dict[str, Any],
    source_path: Path,
    supplement_dir: Path,
    parsed: dict[str, Any],
    collected_at: str | None,
) -> dict[str, Any]:
    """Build the processed JSON document consumed by build_faiss.py."""
    raw_text = parsed["rawText"]
    market = entry.get("market", "")
    metadata = _infer_metadata(raw_text, market)
    context_metadata = _infer_metadata(
        " ".join(
            [
                entry.get("title", ""),
                entry.get("why_added", ""),
                raw_text,
            ]
        ),
        market,
    )
    product_categories = list(
        entry.get("product_categories")
        or context_metadata.get("productCategories")
        or metadata.get("productCategories")
        or []
    )
    regulatory_types = list(
        entry.get("regulatory_types")
        or context_metadata.get("regulatoryTypes")
        or metadata.get("regulatoryTypes")
        or []
    )
    metadata.update(
        {
            "region": market,
            "supplement_id": entry.get("id", ""),
            "source_url": entry.get("source_url", ""),
            "content_url": entry.get("content_url", ""),
            "official_channel": entry.get("channel", ""),
            "why_added": entry.get("why_added", ""),
            "collected_at": collected_at or "",
            "raw_files": entry.get("files", []),
            "primary_file": _as_posix(source_path.relative_to(supplement_dir)),
            "product_categories": product_categories,
            "regulatory_types": regulatory_types,
            "productCategories": product_categories,
            "regulatoryTypes": regulatory_types,
        }
    )

    return {
        "id": entry.get("id", ""),
        "title": entry.get("title", entry.get("id", "")),
        "fileName": source_path.name,
        "sourcePath": _portable_path(source_path),
        "sourceType": parsed["sourceType"],
        "region": market,
        "pageCount": parsed.get("pageCount", 1),
        "totalChars": parsed.get("totalChars", len(raw_text)),
        "hasTables": parsed.get("hasTables", False),
        "tableCount": parsed.get("tableCount", 0),
        "pages": [
            {
                "pageNumber": 1,
                "charCount": len(raw_text),
                "hasText": len(raw_text.strip()) > 50,
                "hasTables": parsed.get("hasTables", False),
                "textPreview": raw_text[:200].replace("\n", " ").strip(),
            }
        ],
        "tables": parsed.get("tables", []),
        "rawText": raw_text,
        "metadata": metadata,
    }


def ingest_supplement(
    supplement_dir: Path = DEFAULT_SUPPLEMENT_DIR,
    processed_dir: Path = DEFAULT_PROCESSED_DIR,
    *,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Ingest every manifest entry and write an ingestion report."""
    supplement_dir = Path(supplement_dir)
    processed_dir = Path(processed_dir)
    manifest_path = supplement_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))

    generated_at = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    report: dict[str, Any] = {
        "generated_at": generated_at,
        "supplement_dir": _portable_path(supplement_dir),
        "processed_dir": _portable_path(processed_dir),
        "entries_total": len(manifest.get("entries", [])),
        "entries_processed": 0,
        "entries_failed": 0,
        "files_written": [],
        "failures": [],
        "dry_run": dry_run,
    }

    if not dry_run:
        processed_dir.mkdir(parents=True, exist_ok=True)

    for entry in manifest.get("entries", []):
        try:
            primary_rel = choose_primary_file(entry)
            primary_path = supplement_dir / primary_rel
            parsed = parse_source_file(primary_path)
            document = build_processed_document(
                entry=entry,
                source_path=primary_path,
                supplement_dir=supplement_dir,
                parsed=parsed,
                collected_at=manifest.get("created_at"),
            )
            output_path = processed_dir / make_output_filename(entry)
            if not dry_run:
                output_path.write_text(
                    json.dumps(document, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8",
                )
            report["entries_processed"] += 1
            report["files_written"].append(
                {
                    "id": entry.get("id", ""),
                    "market": entry.get("market", ""),
                    "title": entry.get("title", ""),
                    "primary_file": _as_posix(primary_rel),
                    "output_path": _portable_path(output_path),
                    "source_type": document["sourceType"],
                    "total_chars": document["totalChars"],
                }
            )
        except Exception as exc:  # pragma: no cover - report path is integration safety
            report["entries_failed"] += 1
            report["failures"].append(
                {
                    "id": entry.get("id", ""),
                    "title": entry.get("title", ""),
                    "error": str(exc),
                }
            )

    if not dry_run:
        report_path = supplement_dir / "ingestion_report.json"
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        manifest["ingestion_status"] = {
            "processed_into_current_corpus": report["entries_failed"] == 0,
            "faiss_rebuilt": False,
            "processed_at": generated_at,
            "processed_files": [
                item["output_path"] for item in report["files_written"]
            ],
            "report": _portable_path(report_path),
        }
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    return report


def make_output_filename(entry: dict[str, Any]) -> str:
    market = re.sub(r"[^A-Za-z0-9_-]+", "_", entry.get("market", "XX")).strip("_") or "XX"
    entry_id = re.sub(r"[^A-Za-z0-9_-]+", "_", entry.get("id", "supplement")).strip("_")
    return f"{market}_Official_{entry_id}.json"


def _parse_xml_text(source_path: Path) -> str:
    try:
        root = ElementTree.parse(source_path).getroot()
        return _clean_text(" ".join(root.itertext()))
    except ElementTree.ParseError:
        raw = source_path.read_text(encoding="utf-8", errors="ignore")
        text = re.sub(r"<[^>]+>", " ", raw)
        return _clean_text(text)


def _parse_pdf_text(source_path: Path) -> tuple[str, int]:
    try:
        import pdfplumber
    except ImportError as exc:
        raise RuntimeError("pdfplumber is required to parse PDF supplement sources") from exc

    text_parts: list[str] = []
    with pdfplumber.open(source_path) as pdf:
        page_count = len(pdf.pages)
        for page in pdf.pages:
            page_text = page.extract_text() or ""
            if page_text.strip():
                text_parts.append(page_text.strip())
    return "\n".join(text_parts), page_count


def _infer_metadata(raw_text: str, market: str) -> dict[str, Any]:
    text_lower = raw_text.lower()
    detected_markets = [market] if market else []
    regulatory_types: list[str] = []
    product_categories: list[str] = []

    keyword_groups = {
        "product_safety": ["product safety", "consumer product", "toy", "magnet", "button cell", "coin batter", "产品安全", "玩具"],
        "cybersecurity": ["cybersecurity", "cyber resilience", "security update", "vulnerability", "connectable product", "网络安全"],
        "conformity": ["conformity assessment", "ce marking", "ukca", "ccc", "compulsory product certification", "合格评定", "强制性产品认证"],
        "sustainability": ["ecodesign", "sustainable product", "digital product passport", "repairability", "recyclability"],
        "battery": ["battery", "batteries", "电池", "充电宝", "移动电源"],
        "liability": ["liability", "defective product", "损害赔偿"],
        "chemical": ["lead", "paint", "chemical", "rohs", "reach", "铅", "化学"],
    }
    for reg_type, keywords in keyword_groups.items():
        if any(keyword in text_lower or keyword in raw_text for keyword in keywords):
            regulatory_types.append(reg_type)

    product_groups = {
        "electronics": ["electronic", "radio equipment", "software", "connectable", "电子"],
        "battery": ["battery", "batteries", "button cell", "coin batter", "充电宝", "移动电源", "电池"],
        "toys": ["toy", "children", "magnet", "玩具", "儿童"],
        "painted_goods": ["paint", "coating", "铅"],
    }
    for product, keywords in product_groups.items():
        if any(keyword in text_lower or keyword in raw_text for keyword in keywords):
            product_categories.append(product)

    return {
        "detectedMarkets": detected_markets,
        "regulatoryTypes": regulatory_types,
        "productCategories": product_categories,
        "charCount": len(raw_text),
    }


def _clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _portable_path(path: Path) -> str:
    try:
        return _as_posix(path.resolve().relative_to(Path.cwd().resolve()))
    except ValueError:
        return _as_posix(path)


def _as_posix(path: Path) -> str:
    return path.as_posix()


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest official regulation supplements.")
    parser.add_argument("--supplement-dir", type=Path, default=DEFAULT_SUPPLEMENT_DIR)
    parser.add_argument("--processed-dir", type=Path, default=DEFAULT_PROCESSED_DIR)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    report = ingest_supplement(
        supplement_dir=args.supplement_dir,
        processed_dir=args.processed_dir,
        dry_run=args.dry_run,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if report["entries_failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
