#!/usr/bin/env python3
"""Collect official regulation sources from a declarative registry."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
from pathlib import Path
from typing import Any

try:
    from scripts.collect_global_regulation_sources import (
        Collector,
        as_posix,
        build_readme,
        make_entry,
        sha256_file,
    )
except ImportError:  # pragma: no cover - direct script execution path
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


def eu_cellar_content_variants() -> list[str]:
    variants: list[str] = []
    for i in range(1, 21):
        for suffix in ("04", "03", "02", "01"):
            variants.append(f"{i:04d}.{suffix}")
    return variants


def ensure_eu_text(collector: Collector, entry: dict[str, Any], celex: str, rdf_rel: str, xhtml_rel: str) -> None:
    rdf_path = collector.supplement_dir / rdf_rel
    if not rdf_path.exists() or rdf_path.stat().st_size < 128:
        collector.download(f"https://publications.europa.eu/resource/celex/{celex}", rdf_rel, min_bytes=500)

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
        collector.failures.append(
            {
                "url": entry["source_url"],
                "file": xhtml_rel,
                "error": f"could not resolve Cellar UUID for {celex}",
            }
        )
        return

    for variant in eu_cellar_content_variants():
        content_url = f"https://publications.europa.eu/resource/cellar/{cellar_uuid}.{variant}/DOC_1"
        result = collector.download(
            content_url,
            xhtml_rel,
            force=not (collector.supplement_dir / xhtml_rel).exists(),
            min_bytes=1000,
            fallback_curl=False,
            record_failure=False,
        )
        if result["status"] in {"downloaded", "existing"}:
            entry["content_url"] = content_url
            if xhtml_rel not in entry["files"]:
                entry["files"].append(xhtml_rel)
            return

    collector.failures.append(
        {
            "url": entry["source_url"],
            "file": xhtml_rel,
            "error": f"could not download XHTML for {celex} cellar {cellar_uuid}",
        }
    )


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
        ensure_eu_text(collector, manifest_entry, entry["celex"], rdf_rel, xhtml_rel)
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
    ecfr_dates = sorted({entry.get("ecfr_date", "") for entry in registry if entry.get("ecfr_date")})
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
            "ecfr_date": ecfr_dates[0] if ecfr_dates else "",
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
