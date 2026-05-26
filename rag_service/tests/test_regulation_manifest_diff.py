import json
import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.diff_regulation_manifests import compare_manifests, load_manifest, write_diff_report  # noqa: E402


def _entry(entry_id, sha, *, source_version=None):
    return {
        "id": entry_id,
        "title": entry_id,
        "file_stats": [{"file": f"raw/{entry_id}.xml", "bytes": 10, "sha256": sha}],
        "source_version": source_version or {"kind": "direct_url", "source_url": f"https://example.test/{entry_id}"},
    }


def test_compare_manifests_reports_added_removed_changed_and_version_changed():
    previous = {
        "entries": [
            _entry("unchanged", "aaa", source_version={"kind": "ecfr_part", "ecfr_date": "2026-05-14"}),
            _entry("changed", "bbb"),
            _entry("version-only", "ccc", source_version={"kind": "ecfr_part", "ecfr_date": "2026-05-14"}),
            _entry("removed", "ddd"),
        ]
    }
    current = {
        "entries": [
            _entry("unchanged", "aaa", source_version={"kind": "ecfr_part", "ecfr_date": "2026-05-14"}),
            _entry("changed", "new-bbb"),
            _entry("version-only", "ccc", source_version={"kind": "ecfr_part", "ecfr_date": "2026-05-21"}),
            _entry("added", "eee"),
        ]
    }

    diff = compare_manifests(previous, current)

    assert diff["summary"] == {
        "previous_entries": 4,
        "current_entries": 4,
        "added": 1,
        "removed": 1,
        "changed": 1,
        "unchanged": 2,
        "version_changed": 1,
    }
    assert [entry["id"] for entry in diff["added_entries"]] == ["added"]
    assert [entry["id"] for entry in diff["removed_entries"]] == ["removed"]
    assert [entry["id"] for entry in diff["changed_entries"]] == ["changed"]
    assert diff["version_changed_entries"][0]["id"] == "version-only"


def test_compare_manifests_treats_missing_previous_as_all_added():
    current = {"entries": [_entry("new-a", "aaa"), _entry("new-b", "bbb")]}

    diff = compare_manifests(None, current)

    assert diff["summary"]["previous_entries"] == 0
    assert diff["summary"]["added"] == 2
    assert [entry["id"] for entry in diff["added_entries"]] == ["new-a", "new-b"]


def test_load_manifest_accepts_missing_path_as_empty(tmp_path):
    assert load_manifest(tmp_path / "missing.json") is None


def test_write_diff_report_outputs_json(tmp_path):
    diff = compare_manifests(None, {"entries": [_entry("new-a", "aaa")]})
    output_path = tmp_path / "diff.json"

    write_diff_report(diff, output_path)

    payload = json.loads(output_path.read_text(encoding="utf-8"))
    assert payload["summary"]["added"] == 1
