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
