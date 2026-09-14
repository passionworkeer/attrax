import hashlib
import json
from pathlib import Path
import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SUPPLEMENT_DIR = REPO_ROOT / "data" / "regulation_supplements" / "2026-05-26_registry_official_sources"
MANIFEST_PATH = SUPPLEMENT_DIR / "manifest.json"


def load_manifest() -> dict:
    if not MANIFEST_PATH.exists():
        pytest.skip(f"Historical supplement data omitted in this deployment: {MANIFEST_PATH}")
    # 2026-09-14: raw/ 原件（PDF/RDF/XHTML，~400MB）已从 git untrack。
    # manifest.json 仍在库里，但 fresh clone 没有 raw/ —— 断言 raw 文件
    # sha256 的用例只有在数据落盘（采集过或从服务器拷贝）时才有意义。
    raw_dir = SUPPLEMENT_DIR / "raw"
    if not raw_dir.is_dir() or not any(raw_dir.iterdir()):
        pytest.skip(
            "raw supplement files are untracked since 2026-09-14; "
            "manifest sha assertions need the on-disk data"
        )
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
            raw = raw_path.read_bytes()
            # Git may materialize XML/RDF sources with CRLF on Windows even
            # though the manifest was produced from the canonical LF bytes.
            # Accept that one reversible transport conversion, but continue
            # to reject every other byte or digest change.
            canonical = raw.replace(b"\r\n", b"\n")
            candidates = (raw, canonical)
            assert stat["bytes"] in {len(value) for value in candidates}, (
                raw_path,
                stat["bytes"],
                len(raw),
                len(canonical),
            )
            assert stat["bytes"] > 128
            assert len(stat["sha256"]) == 64
            assert stat["sha256"] in {
                hashlib.sha256(value).hexdigest() for value in candidates
            }, raw_path

    assert len(referenced_files) == manifest["summary"]["raw_files"]


def test_registry_supplement_has_readme_and_no_failure_report():
    load_manifest()
    assert (SUPPLEMENT_DIR / "README.md").exists()
    assert not (SUPPLEMENT_DIR / "download_failures.json").exists()
