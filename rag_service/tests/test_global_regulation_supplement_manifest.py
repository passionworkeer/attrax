import json
from pathlib import Path
import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SUPPLEMENT_DIR = REPO_ROOT / "data" / "regulation_supplements" / "2026-05-26_global_official_sources"


def test_global_regulation_manifest_covers_markets_and_raw_files():
    manifest_path = SUPPLEMENT_DIR / "manifest.json"
    if not manifest_path.exists():
        pytest.skip(f"Historical supplement data omitted in this deployment: {manifest_path}")
    # 2026-09-14: raw/ 原件已从 git untrack（~400MB）。fresh clone 只有
    # manifest.json；断言 raw 文件存在性/sha 的用例需要数据落盘才有意义。
    raw_dir = SUPPLEMENT_DIR / "raw"
    if not raw_dir.is_dir() or not any(raw_dir.iterdir()):
        pytest.skip(
            "raw supplement files are untracked since 2026-09-14; "
            "manifest raw-file assertions need the on-disk data"
        )
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    summary = manifest["summary"]
    entries = manifest["entries"]
    markets = set(summary["markets"])

    assert summary["failed_downloads"] == 0
    assert summary["regulation_entries"] >= 55
    assert summary["raw_files"] >= 60
    assert {
        "AU",
        "BR",
        "CA",
        "EU",
        "GCC",
        "IN",
        "JP",
        "KR",
        "MX",
        "SG",
        "UK",
        "US",
    }.issubset(markets)
    assert {
        "batteries",
        "cosmetics",
        "electronics",
        "food_contact",
        "packaging",
        "radio",
        "textiles",
        "toys",
    }.issubset(set(summary["product_categories"]))

    for entry in entries:
        assert entry["id"]
        assert entry["market"]
        assert entry["source_url"].startswith("https://")
        assert entry["files"]
        for file_name in entry["files"]:
            source_file = SUPPLEMENT_DIR / file_name
            assert source_file.exists(), file_name
            assert source_file.stat().st_size > 128, file_name

    assert any(
        entry["id"] == "eu-2023-1230-machinery"
        and entry.get("content_url", "").startswith("https://publications.europa.eu/resource/cellar/")
        and any(file_name.endswith(".xhtml") for file_name in entry["files"])
        for entry in entries
    )
