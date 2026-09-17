"""Tests for the watchdog review CLI (list / show / revert).

The CLI is the human-oversight half of the auto-ingest trade-off, so the
behaviours worth pinning are: it surfaces the source→regulation audit trail,
it can find the bytes behind a change, and its revert restores the pre-change
YAML rather than the auto-applied one.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
import yaml

PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import scripts.watchdog.auto_ingest as ai  # noqa: E402
import scripts.watchdog.review as review  # noqa: E402
from scripts.watchdog.auto_ingest import AutoIngestor  # noqa: E402
from scripts.watchdog.collectors.base import RegulationUpdate  # noqa: E402
from scripts.watchdog.state import Change, text_hash  # noqa: E402

RUN_DATE = "2026-09-17"


@pytest.fixture()
def library(tmp_path, monkeypatch):
    """Isolated regulation library + supplements root, wired into both the
    ingestor and the review CLI (they read separate module globals)."""
    regs = tmp_path / "regulations"
    (regs / "eu").mkdir(parents=True)
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
    supplements = tmp_path / "supplements"

    monkeypatch.setattr(ai, "REGULATIONS_ROOT", regs)
    monkeypatch.setattr(ai, "INDEX_PATH", regs / "regulations_index.json")
    monkeypatch.setattr(ai, "SUPPLEMENTS_DIR", supplements)

    monkeypatch.setattr(review, "REGULATIONS_ROOT", regs)
    monkeypatch.setattr(review, "SUPPLEMENTS_DIR", supplements)
    return regs, supplements


def _ingest_one_update(regs, supplements) -> None:
    """Run a real auto-ingest UPDATE for EU-2011-65 under RUN_DATE."""
    ingestor = AutoIngestor(RUN_DATE)
    entry = {"id": "eu-rohs", "source_type": "eu_celex", "celex": "32011L0065"}
    text = "new rdf content"
    update = RegulationUpdate(
        source_id="eu-rohs",
        market="EU",
        source_type="eu_celex",
        source_url="https://example.com/eu-rohs",
        title="RoHS",
        text=text,
        content_hash=text_hash(text),
    )
    change = Change(
        kind="modified",
        source_id="eu-rohs",
        similarity=0.42,
        before_hash="b" * 64,
        after_hash="a" * 64,
        unified_diff="--- a\n+++ b\n@@\n-old\n+new",
    )
    report = ingestor.apply({"eu-rohs": entry}, {"eu-rohs": update}, [change])

    # The orchestrator writes applied.json; the CLI reads it, so mirror that
    # here rather than reaching into the ingestor's internals.
    out_dir = supplements / f"watchdog-{RUN_DATE}"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "applied.json").write_text(
        json.dumps({"date": RUN_DATE, "mode": "auto", **report.to_dict()}, indent=2),
        encoding="utf-8",
    )
    return report


# ── list ─────────────────────────────────────────────────────────────────


def test_list_changes_reports_the_audit_trail(library, capsys):
    regs, supplements = library
    _ingest_one_update(regs, supplements)

    assert review.main(["--date", RUN_DATE]) == review.EXIT_OK
    out = capsys.readouterr().out
    assert "EU-2011-65" in out
    assert "eu-rohs" in out
    assert "updated" in out


def test_list_changes_without_a_pass_is_not_an_error(library, capsys):
    _regs, supplements = library
    # A day where every source failed writes errors.json but no applied.json.
    out_dir = supplements / f"watchdog-{RUN_DATE}"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "errors.json").write_text(
        json.dumps([{"sourceId": "eu-rohs", "error": "URLError: down"}]), encoding="utf-8"
    )

    assert review.main(["--date", RUN_DATE]) == review.EXIT_NOTHING_TO_DO
    out = capsys.readouterr().out
    assert "no auto-ingest output" in out
    assert "eu-rohs" in out


# ── show ─────────────────────────────────────────────────────────────────


def test_show_prints_raw_meta_and_diff(library, capsys):
    regs, supplements = library
    _ingest_one_update(regs, supplements)

    assert review.main(["--date", RUN_DATE, "--show", "EU-2011-65"]) == review.EXIT_OK
    out = capsys.readouterr().out
    assert "new rdf content" in out  # the raw fetch
    assert "meta.json" in out
    assert "diff.txt" in out
    assert "-old" in out and "+new" in out
    # The operator is pointed at the rollback for a reversible change.
    assert "--revert EU-2011-65" in out


def test_show_unknown_regulation_reports_nothing(library, capsys):
    regs, supplements = library
    _ingest_one_update(regs, supplements)

    assert review.main(["--date", RUN_DATE, "--show", "EU-NOPE"]) == review.EXIT_NOTHING_TO_DO
    assert "no ingest record" in capsys.readouterr().err


# ── revert ───────────────────────────────────────────────────────────────


def test_revert_restores_the_pre_change_yaml(library, capsys):
    regs, supplements = library
    _ingest_one_update(regs, supplements)

    live = regs / "eu" / "EU-2011-65.yaml"
    # The auto-update mutated the live YAML...
    assert yaml.safe_load(live.read_text())["source_url"] == "https://example.com/eu-rohs"

    assert review.main(["--date", RUN_DATE, "--revert", "EU-2011-65"]) == review.EXIT_OK

    restored = yaml.safe_load(live.read_text())
    assert restored["source_url"] == "https://old.example"
    assert restored["notes"] == "seed"
    # The index was rebuilt from the restored tree.
    index = json.loads((regs / "regulations_index.json").read_text())
    assert index["count"] == 1
    assert index["regulations"][0]["id"] == "EU-2011-65"


def test_revert_dry_run_leaves_the_file_alone(library, capsys):
    regs, supplements = library
    _ingest_one_update(regs, supplements)

    live = regs / "eu" / "EU-2011-65.yaml"
    before = live.read_bytes()

    assert (
        review.main(["--date", RUN_DATE, "--revert", "EU-2011-65", "--dry-run"])
        == review.EXIT_OK
    )
    assert live.read_bytes() == before
    assert "dry run" in capsys.readouterr().out


def test_revert_without_a_backup_explains_why(library, capsys):
    """A CREATE has no prior state, so there is nothing to restore."""
    regs, supplements = library

    assert (
        review.main(["--date", RUN_DATE, "--revert", "EU-2011-65"])
        == review.EXIT_NOTHING_TO_DO
    )
    err = capsys.readouterr().err
    assert "no backup" in err
    assert "no prior state" in err


def test_revert_refuses_when_the_live_yaml_is_missing(library, capsys):
    """A backup with no live target must not be written to a guessed path."""
    regs, supplements = library
    _ingest_one_update(regs, supplements)
    (regs / "eu" / "EU-2011-65.yaml").unlink()

    assert (
        review.main(["--date", RUN_DATE, "--revert", "EU-2011-65"])
        == review.EXIT_BAD_INPUT
    )
    assert "no live YAML found" in capsys.readouterr().err


# ── argument handling ────────────────────────────────────────────────────


def test_bad_date_is_rejected():
    with pytest.raises(SystemExit, match="YYYY-MM-DD"):
        review.main(["--date", "17/09/2026"])
