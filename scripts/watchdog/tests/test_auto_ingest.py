"""Tests for scripts/watchdog/auto_ingest.py — update/create/mark semantics."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
import yaml

PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.watchdog.auto_ingest import (  # noqa: E402
    REGULATIONS_ROOT,
    INDEX_PATH,
    AutoIngestor,
    regulation_for_source,
    _citation_from_celex,
)
from scripts.watchdog.collectors.base import RegulationUpdate  # noqa: E402
from scripts.watchdog.state import Change, text_hash  # noqa: E402


def _update(source_id: str, text: str, source_type: str = "eu_celex") -> RegulationUpdate:
    return RegulationUpdate(
        source_id=source_id,
        market="EU",
        source_type=source_type,
        source_url=f"https://example.com/{source_id}",
        title=f"title {source_id}",
        text=text,
        content_hash=text_hash(text),
    )


def _change(source_id: str, kind: str = "modified", similarity: float = 0.42) -> Change:
    return Change(
        kind=kind,
        source_id=source_id,
        similarity=similarity,
        before_hash="b" * 64,
        after_hash="a" * 64,
        unified_diff="--- a\n+++ b\n@@\n-old\n+new",
    )


# ── mapping ──────────────────────────────────────────────────────────────


def test_celex_maps_to_regulation_id():
    entry = {"id": "eu-rohs", "celex": "32011L0065"}
    reg_id, path = regulation_for_source(entry)
    assert reg_id == "EU-2011-65"
    assert path.name == "EU-2011-65.yaml"
    assert path.parent.name == "eu"


def test_unmappable_sources_return_none():
    assert regulation_for_source({"id": "us", "ecfr_title": 16, "ecfr_part": 1307}) is None
    assert regulation_for_source({"id": "uk", "source_type": "gov_html"}) is None


def test_citation_from_celex():
    assert _citation_from_celex("32011L0065") == "Directive 2011/65/EU"
    assert _citation_from_celex("32023R0988") == "Regulation (EU) 2023/988"


# ── update / create / evidence (isolated tmp library) ───────────────────


@pytest.fixture()
def isolated_library(tmp_path, monkeypatch):
    """Point the ingestor's library + supplements roots at a tmp dir."""
    import scripts.watchdog.auto_ingest as ai

    regs = tmp_path / "regulations"
    (regs / "eu").mkdir(parents=True)
    # A pre-existing regulation (RoHS) to exercise the UPDATE path.
    (regs / "eu" / "EU-2011-65.yaml").write_text(
        yaml.safe_dump(
            {
                "id": "EU-2011-65",
                "official_citation": "Directive 2011/65/EU",
                "short_name": "RoHS",
                "region": "EU",
                "license": "public",
                "articles": [{"id": "art-4", "title": "t", "text": "x"}],
                "source_url": "https://old.example",
                "notes": "seed",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(ai, "REGULATIONS_ROOT", regs)
    monkeypatch.setattr(ai, "INDEX_PATH", regs / "regulations_index.json")
    monkeypatch.setattr(ai, "SUPPLEMENTS_DIR", tmp_path / "supplements")
    return ai


def test_update_backs_up_and_refreshes_fields(isolated_library):
    ingestor = AutoIngestor("2026-09-13")
    entry = {"id": "eu-rohs", "celex": "32011L0065"}
    update = _update("eu-rohs", "new rdf content")
    report = ingestor.apply(
        {"eu-rohs": entry}, {"eu-rohs": update}, [_change("eu-rohs")]
    )

    assert report.updated == ["EU-2011-65"]
    payload = yaml.safe_load(
        (isolated_library.REGULATIONS_ROOT / "eu" / "EU-2011-65.yaml").read_text()
    )
    assert payload["last_verified"] == "2026-09-13"
    assert payload["last_verified_by"] == "regwatch-auto"
    assert payload["checksum_sha256"] == update.content_hash
    assert payload["source_url"] == update.source_url
    assert "regwatch auto-modified 2026-09-13" in payload["notes"]
    assert "seed" in payload["notes"]  # original note preserved
    # articles untouched — mechanical ingest never rewrites article text
    assert payload["articles"][0]["id"] == "art-4"
    # backup exists
    backup = (
        isolated_library.SUPPLEMENTS_DIR
        / "auto-2026-09-13" / "backup" / "EU-2011-65.yaml"
    )
    assert backup.exists()
    assert yaml.safe_load(backup.read_text())["source_url"] == "https://old.example"
    # evidence stored
    evidence = isolated_library.SUPPLEMENTS_DIR / "auto-2026-09-13" / "eu-rohs"
    assert (evidence / "raw.rdf").exists()
    assert (evidence / "meta.json").exists()
    assert (evidence / "diff.txt").exists()
    # index rebuilt with the updated entry
    index = yaml.safe_load  # noqa: F841 — readability
    import json

    idx = json.loads((isolated_library.REGULATIONS_ROOT / "regulations_index.json").read_text())
    assert idx["count"] == 1
    assert idx["regulations"][0]["id"] == "EU-2011-65"
    assert idx["regulations"][0]["article_count"] == 1


def test_create_missing_regulation_from_celex(isolated_library):
    ingestor = AutoIngestor("2026-09-13")
    # WEEE 2012/19 exists as a source but has no library YAML — the CREATE path.
    entry = {"id": "eu-weee", "celex": "32012L0019"}
    update = _update("eu-weee", "wee rdf body")
    report = ingestor.apply({"eu-weee": entry}, {"eu-weee": update}, [_change("eu-weee", kind="added")])

    assert report.created == ["EU-2012-19"]
    created = isolated_library.REGULATIONS_ROOT / "eu" / "EU-2012-19.yaml"
    assert created.exists()
    payload = yaml.safe_load(created.read_text())
    assert payload["official_citation"] == "Directive 2012/19/EU"
    assert payload["license"] == "public"
    assert payload["articles"] == []
    assert "pending extraction" in payload["notes"]
    import json

    idx = json.loads((isolated_library.REGULATIONS_ROOT / "regulations_index.json").read_text())
    assert idx["count"] == 2  # RoHS + newly created WEEE


def test_unmappable_change_is_evidence_only(isolated_library):
    ingestor = AutoIngestor("2026-09-13")
    entry = {"id": "us-1307", "ecfr_title": 16, "ecfr_part": 1307}
    update = _update("us-1307", '{"results":[]}', source_type="ecfr_part")
    report = ingestor.apply(
        {"us-1307": entry}, {"us-1307": update}, [_change("us-1307")]
    )
    assert report.evidence_only == ["us-1307"]
    assert report.created == [] and report.updated == []
    evidence = isolated_library.SUPPLEMENTS_DIR / "auto-2026-09-13" / "us-1307"
    assert (evidence / "raw.json").exists()
    # index untouched (no regulation touched)
    assert not (isolated_library.REGULATIONS_ROOT / "regulations_index.json").exists()


def test_repeal_keyword_marks_regulation(isolated_library):
    ingestor = AutoIngestor("2026-09-13")
    entry = {"id": "eu-rohs", "celex": "32011L0065"}
    update = _update("eu-rohs", "body")
    update.title = "Removal of RoHS exemption"
    report = ingestor.apply({"eu-rohs": entry}, {"eu-rohs": update}, [_change("eu-rohs")])
    assert "EU-2011-65:repealed" in report.marked
    payload = yaml.safe_load(
        (isolated_library.REGULATIONS_ROOT / "eu" / "EU-2011-65.yaml").read_text()
    )
    assert payload["status"] == "repealed"


def test_failure_streak_marks_stale_not_deleted(isolated_library):
    ingestor = AutoIngestor("2026-09-13")
    entry = {"id": "eu-rohs", "celex": "32011L0065"}
    yaml_path = isolated_library.REGULATIONS_ROOT / "eu" / "EU-2011-65.yaml"
    for _ in range(6):
        ingestor.record_failure("eu-rohs", entry)
    # 6 failures: below threshold — no marking yet
    payload = yaml.safe_load(yaml_path.read_text())
    assert "status" not in payload
    ingestor.record_failure("eu-rohs", entry)  # 7th — threshold reached
    payload = yaml.safe_load(yaml_path.read_text())
    assert payload["status"] == "stale"
    assert yaml_path.exists()  # never hard-deleted
    # a success resets the streak
    ingestor.record_success("eu-rohs")
    state = yaml.safe_load  # noqa: F841
    import json

    auto_state = json.loads(
        (isolated_library.SUPPLEMENTS_DIR / ".auto_state.json").read_text()
    )
    assert "eu-rohs" not in auto_state["failureStreaks"]
