#!/usr/bin/env python3
"""Diff official regulation supplement manifests by entry id and file hashes."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def load_manifest(path: str | Path | None) -> dict[str, Any] | None:
    """Load a manifest, returning None when no path or missing file is provided."""
    if not path:
        return None
    manifest_path = Path(path)
    if not manifest_path.exists():
        return None
    return json.loads(manifest_path.read_text(encoding="utf-8-sig"))


def compare_manifests(
    previous: dict[str, Any] | None,
    current: dict[str, Any],
) -> dict[str, Any]:
    """Compare previous/current manifests and classify entry-level changes."""
    previous_entries = _entry_map(previous)
    current_entries = _entry_map(current)

    added_ids = sorted(set(current_entries) - set(previous_entries))
    removed_ids = sorted(set(previous_entries) - set(current_entries))
    shared_ids = sorted(set(previous_entries) & set(current_entries))

    changed_entries = []
    unchanged_entries = []
    version_changed_entries = []

    for entry_id in shared_ids:
        previous_entry = previous_entries[entry_id]
        current_entry = current_entries[entry_id]
        previous_hashes = _file_hashes(previous_entry)
        current_hashes = _file_hashes(current_entry)
        if previous_hashes == current_hashes:
            unchanged_entries.append(_entry_summary(current_entry))
        else:
            changed_entries.append(
                {
                    **_entry_summary(current_entry),
                    "previous_hashes": previous_hashes,
                    "current_hashes": current_hashes,
                    "changed_files": sorted(
                        set(previous_hashes)
                        | set(current_hashes)
                    ),
                }
            )

        previous_version = previous_entry.get("source_version", {})
        current_version = current_entry.get("source_version", {})
        if previous_version != current_version:
            version_changed_entries.append(
                {
                    **_entry_summary(current_entry),
                    "previous_version": previous_version,
                    "current_version": current_version,
                }
            )

    added_entries = [_entry_summary(current_entries[entry_id]) for entry_id in added_ids]
    removed_entries = [_entry_summary(previous_entries[entry_id]) for entry_id in removed_ids]

    return {
        "summary": {
            "previous_entries": len(previous_entries),
            "current_entries": len(current_entries),
            "added": len(added_entries),
            "removed": len(removed_entries),
            "changed": len(changed_entries),
            "unchanged": len(unchanged_entries),
            "version_changed": len(version_changed_entries),
        },
        "added_entries": added_entries,
        "removed_entries": removed_entries,
        "changed_entries": changed_entries,
        "unchanged_entries": unchanged_entries,
        "version_changed_entries": version_changed_entries,
    }


def write_diff_report(diff: dict[str, Any], output_path: str | Path) -> None:
    """Write a manifest diff report as JSON."""
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(diff, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _entry_map(manifest: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    if not manifest:
        return {}
    return {
        str(entry.get("id", "")): entry
        for entry in manifest.get("entries", [])
        if entry.get("id")
    }


def _file_hashes(entry: dict[str, Any]) -> dict[str, str]:
    hashes = {}
    for item in entry.get("file_stats", []):
        file_name = str(item.get("file", ""))
        sha256 = str(item.get("sha256", ""))
        if file_name and sha256:
            hashes[file_name] = sha256
    return dict(sorted(hashes.items()))


def _entry_summary(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": entry.get("id", ""),
        "market": entry.get("market", ""),
        "title": entry.get("title", ""),
        "source_version": entry.get("source_version", {}),
        "files": entry.get("files", []),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Diff two regulation supplement manifests.")
    parser.add_argument("--previous", type=Path, default=None)
    parser.add_argument("--current", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()

    diff = compare_manifests(load_manifest(args.previous), load_manifest(args.current) or {"entries": []})
    if args.output:
        write_diff_report(diff, args.output)
    print(json.dumps(diff["summary"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
