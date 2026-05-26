#!/usr/bin/env python3
"""Generate coverage reports for official regulation source batches."""
from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_REGISTRY = Path("data/regulation_sources/official_sources.json")
DEFAULT_PROCESSED_DIR = Path("data/corpus/processed")
DEFAULT_REPORT_DIR = Path("data/regulation_reports")


def load_json(path: Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_registry(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    data = load_json(path)
    if not isinstance(data, list):
        raise ValueError(f"registry must be a list: {path}")
    return data


def load_supplement_manifest(supplement_dir: Path) -> dict[str, Any]:
    manifest_path = Path(supplement_dir) / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"missing supplement manifest: {manifest_path}")
    manifest = load_json(manifest_path)
    manifest["_manifest_path"] = _portable_path(manifest_path)
    manifest["_supplement_dir"] = _portable_path(Path(supplement_dir))
    return manifest


def load_processed_documents(processed_dir: Path) -> dict[str, dict[str, Any]]:
    processed: dict[str, dict[str, Any]] = {}
    for path in sorted(Path(processed_dir).glob("*_Official_*.json")):
        try:
            data = load_json(path)
        except Exception:
            continue
        supplement_id = data.get("metadata", {}).get("supplement_id") or data.get("id") or path.stem
        processed[supplement_id] = {
            "id": supplement_id,
            "title": data.get("title", ""),
            "market": data.get("region", data.get("metadata", {}).get("region", "")),
            "source_type": data.get("sourceType", ""),
            "total_chars": data.get("totalChars", len(data.get("rawText", ""))),
            "source_url": data.get("metadata", {}).get("source_url", ""),
            "path": _portable_path(path),
        }
    return processed


def load_faiss_summary(faiss_meta_path: Path | None) -> dict[str, Any]:
    if not faiss_meta_path or not Path(faiss_meta_path).exists():
        return {
            "meta_path": "",
            "dim": 0,
            "chunks": 0,
            "chunks_by_region": {},
            "chunks_by_source_id": {},
            "source_files": [],
        }

    data = load_json(Path(faiss_meta_path))
    chunks = data.get("chunks", data) if isinstance(data, dict) else data
    chunks_by_region = Counter(chunk.get("region", "unknown") or "unknown" for chunk in chunks)
    chunks_by_source_id = Counter(
        chunk.get("source_id") or chunk.get("doc_id") or chunk.get("id", "unknown") for chunk in chunks
    )
    source_files = sorted({chunk.get("source_file", "") for chunk in chunks if chunk.get("source_file")})

    return {
        "meta_path": _portable_path(Path(faiss_meta_path)),
        "dim": data.get("dim", 0) if isinstance(data, dict) else 0,
        "chunks": len(chunks),
        "chunks_by_region": dict(sorted(chunks_by_region.items())),
        "chunks_by_source_id": dict(sorted(chunks_by_source_id.items())),
        "source_files": source_files,
    }


def build_coverage_report(
    *,
    registry_path: Path = DEFAULT_REGISTRY,
    supplement_dirs: list[Path],
    processed_dir: Path = DEFAULT_PROCESSED_DIR,
    faiss_meta_path: Path | None = None,
    generated_at: str | None = None,
) -> dict[str, Any]:
    generated_at = generated_at or datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    registry = load_registry(registry_path)
    manifests = [load_supplement_manifest(path) for path in supplement_dirs]
    processed = load_processed_documents(processed_dir)
    faiss_summary = load_faiss_summary(faiss_meta_path)

    registry_by_id = {entry["id"]: entry for entry in registry}
    supplement_entries = [entry for manifest in manifests for entry in manifest.get("entries", [])]
    supplement_by_id = {entry["id"]: entry for entry in supplement_entries}
    target_ids = sorted(set(registry_by_id) | set(supplement_by_id))
    processed_registry_ids = sorted(entry_id for entry_id in target_ids if entry_id in processed)
    missing_processed_ids = sorted(entry_id for entry_id in target_ids if entry_id not in processed)

    failed_downloads = sum(int(manifest.get("summary", {}).get("failed_downloads", 0)) for manifest in manifests)
    market_stats = _coverage_by_dimension(target_ids, registry_by_id, supplement_by_id, processed, "market")
    category_stats = _coverage_by_list_dimension(
        target_ids, registry_by_id, supplement_by_id, processed, "product_categories"
    )
    regulatory_type_stats = _coverage_by_list_dimension(
        target_ids, registry_by_id, supplement_by_id, processed, "regulatory_types"
    )

    return {
        "generated_at": generated_at,
        "inputs": {
            "registry_path": _portable_path(registry_path),
            "supplement_dirs": [_portable_path(path) for path in supplement_dirs],
            "processed_dir": _portable_path(processed_dir),
            "faiss_meta_path": faiss_summary["meta_path"],
        },
        "summary": {
            "registry_entries": len(registry),
            "supplement_entries": len(supplement_by_id),
            "processed_registry_entries": len(processed_registry_ids),
            "missing_processed_entries": len(missing_processed_ids),
            "processed_official_documents": len(processed),
            "faiss_chunks": faiss_summary["chunks"],
            "failed_downloads": failed_downloads,
        },
        "coverage_by_market": market_stats,
        "coverage_by_category": category_stats,
        "coverage_by_regulatory_type": regulatory_type_stats,
        "processed_entry_ids": processed_registry_ids,
        "missing_processed_entry_ids": missing_processed_ids,
        "supplements": [
            {
                "dir": manifest["_supplement_dir"],
                "manifest": manifest["_manifest_path"],
                "entries": len(manifest.get("entries", [])),
                "raw_files": manifest.get("summary", {}).get("raw_files", 0),
                "failed_downloads": manifest.get("summary", {}).get("failed_downloads", 0),
                "ingestion_status": manifest.get("ingestion_status", {}),
            }
            for manifest in manifests
        ],
        "faiss": faiss_summary,
    }


def _coverage_by_dimension(
    target_ids: list[str],
    registry_by_id: dict[str, dict[str, Any]],
    supplement_by_id: dict[str, dict[str, Any]],
    processed: dict[str, dict[str, Any]],
    field_name: str,
) -> dict[str, dict[str, int]]:
    buckets: dict[str, set[str]] = defaultdict(set)
    for entry_id in target_ids:
        source = registry_by_id.get(entry_id) or supplement_by_id.get(entry_id) or {}
        value = source.get(field_name) or processed.get(entry_id, {}).get(field_name) or "unknown"
        buckets[str(value)].add(entry_id)
    return _summarize_buckets(buckets, processed)


def _coverage_by_list_dimension(
    target_ids: list[str],
    registry_by_id: dict[str, dict[str, Any]],
    supplement_by_id: dict[str, dict[str, Any]],
    processed: dict[str, dict[str, Any]],
    field_name: str,
) -> dict[str, dict[str, int]]:
    buckets: dict[str, set[str]] = defaultdict(set)
    for entry_id in target_ids:
        source = registry_by_id.get(entry_id) or supplement_by_id.get(entry_id) or {}
        values = source.get(field_name) or ["unknown"]
        for value in values:
            buckets[str(value)].add(entry_id)
    return _summarize_buckets(buckets, processed)


def _summarize_buckets(
    buckets: dict[str, set[str]],
    processed: dict[str, dict[str, Any]],
) -> dict[str, dict[str, int]]:
    summary: dict[str, dict[str, int]] = {}
    for bucket, ids in sorted(buckets.items()):
        processed_count = sum(1 for entry_id in ids if entry_id in processed)
        summary[bucket] = {
            "registry_entries": len(ids),
            "processed_entries": processed_count,
            "missing_processed_entries": len(ids) - processed_count,
        }
    return summary


def render_markdown_report(report: dict[str, Any]) -> str:
    summary = report["summary"]
    lines = [
        "# Regulation Coverage Report",
        "",
        f"- Generated at: {report['generated_at']}",
        f"- Registry entries: {summary['registry_entries']}",
        f"- Supplement entries: {summary['supplement_entries']}",
        f"- Processed registry entries: {summary['processed_registry_entries']}",
        f"- Missing processed entries: {summary['missing_processed_entries']}",
        f"- Official processed documents: {summary.get('processed_official_documents', 0)}",
        f"- FAISS chunks: {summary['faiss_chunks']}",
        f"- Failed downloads: {summary['failed_downloads']}",
        "",
        "## Coverage By Market",
        "",
        "| Market | Registry | Processed | Missing |",
        "| --- | ---: | ---: | ---: |",
    ]
    for market, stats in report.get("coverage_by_market", {}).items():
        lines.append(
            f"| {market} | {stats['registry_entries']} | "
            f"{stats['processed_entries']} | {stats['missing_processed_entries']} |"
        )

    missing = report.get("missing_processed_entry_ids", [])
    lines.extend(["", "## Missing Processed Entries", ""])
    if missing:
        lines.extend(f"- {entry_id}" for entry_id in missing)
    else:
        lines.append("- None")

    return "\n".join(lines) + "\n"


def write_report(report: dict[str, Any], output_dir: Path, basename: str = "coverage_report") -> dict[str, str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / f"{basename}.json"
    markdown_path = output_dir / f"{basename}.md"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    markdown_path.write_text(render_markdown_report(report), encoding="utf-8")
    return {"json": _portable_path(json_path), "markdown": _portable_path(markdown_path)}


def _portable_path(path: Path) -> str:
    try:
        return path.resolve().relative_to(Path.cwd().resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate official regulation coverage report.")
    parser.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY)
    parser.add_argument("--supplement-dir", type=Path, action="append", required=True)
    parser.add_argument("--processed-dir", type=Path, default=DEFAULT_PROCESSED_DIR)
    parser.add_argument("--faiss-meta", type=Path, default=None)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_REPORT_DIR)
    parser.add_argument("--basename", default="coverage_report")
    args = parser.parse_args()

    report = build_coverage_report(
        registry_path=args.registry,
        supplement_dirs=args.supplement_dir,
        processed_dir=args.processed_dir,
        faiss_meta_path=args.faiss_meta,
    )
    paths = write_report(report, args.output_dir, args.basename)
    print(json.dumps({"summary": report["summary"], "paths": paths}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
