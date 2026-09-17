"""Tests for the source-registry health check.

The check exists because nine registry entries spent their whole life
pointing at endpoints that answered 403/404, and nothing noticed. These
tests pin the two things that make it useful: it exercises the real
collector path (so a broken parser counts as a broken source), and it
distinguishes "upstream is fine, our copy is current" (304) from "this
source is dead".
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.watchdog import check_sources  # noqa: E402
from scripts.watchdog.collectors.base import (  # noqa: E402
    FetchDeadlineExceeded,
    NotModified,
    RegulationUpdate,
)
from scripts.watchdog.state import text_hash  # noqa: E402


def _update(source_id: str) -> RegulationUpdate:
    # Comfortably above THIN_DIGEST_CHARS: the real content-bearing sources
    # in the registry run 1 KB–180 KB, so a tiny fixture would trip the
    # shell-only heuristic and test the wrong branch.
    text = f"body of {source_id}\n" * 80
    return RegulationUpdate(
        source_id=source_id,
        market="EU",
        source_type="gov_html",
        source_url=f"https://example.com/{source_id}",
        title=source_id,
        text=text,
        content_hash=text_hash(text),
    )


def _ok(source_id: str, chars: int = 4000) -> dict:
    return {
        "sourceId": source_id,
        "sourceType": "gov_html",
        "status": "ok",
        "bytes": chars,
        "hash": "0" * 12,
    }


def _entry(source_id: str, **overrides) -> dict:
    base = {
        "id": source_id,
        "market": "EU",
        "source_type": "gov_html",
        "source_url": f"https://example.com/{source_id}",
        "human_view_url": f"https://example.com/{source_id}",
    }
    base.update(overrides)
    return base


# ── registry validation ──────────────────────────────────────────────────


def test_validate_registry_accepts_a_well_formed_entry():
    assert check_sources.validate_registry([_entry("a"), _entry("b")]) == []


def test_validate_registry_flags_missing_required_fields():
    problems = check_sources.validate_registry([_entry("a", human_view_url="")])
    assert len(problems) == 1
    assert "human_view_url" in problems[0]


def test_validate_registry_flags_duplicate_ids():
    problems = check_sources.validate_registry([_entry("dup"), _entry("dup")])
    assert any("duplicate id" in problem for problem in problems)


# ── probing ──────────────────────────────────────────────────────────────


def test_probe_reports_ok_with_size_and_hash(monkeypatch):
    monkeypatch.setattr(check_sources, "collect_source", lambda entry: _update(entry["id"]))
    result = check_sources.probe(_entry("a"))
    assert result["status"] == "ok"
    assert result["bytes"] > check_sources.THIN_DIGEST_CHARS
    assert len(result["hash"]) == 12


def test_probe_flags_a_thin_digest_as_a_shell(monkeypatch):
    """A page that fetches but yields only its title is a JS shell — it
    would report "no change" forever, which is worse than not tracking it."""

    def _shell(entry: dict) -> RegulationUpdate:
        text = "Ministry of Industry and Advanced Technology"
        return RegulationUpdate(
            source_id=entry["id"],
            market="AE",
            source_type="gov_html",
            source_url=entry["source_url"],
            title=entry["id"],
            text=text,
            content_hash=text_hash(text),
        )

    monkeypatch.setattr(check_sources, "collect_source", _shell)
    result = check_sources.probe(_entry("a"))
    assert result["status"] == "thin"
    assert "JS shell" in result["error"]
    assert result["bytes"] < check_sources.THIN_DIGEST_CHARS


def test_probe_does_not_flag_a_small_json_digest(monkeypatch):
    """A JSON API returning a few records is legitimately small — flagging
    it would be a false positive that trains operators to ignore the
    warning."""

    def _small_json(entry: dict) -> RegulationUpdate:
        text = "Z-0001-04 | 2003-10-27 | Class I | Sedecal X-Ray | skin distance"
        return RegulationUpdate(
            source_id=entry["id"],
            market="US",
            source_type="openfda_recalls",
            source_url=entry["source_url"],
            title=entry["id"],
            text=text,
            content_hash=text_hash(text),
        )

    monkeypatch.setattr(check_sources, "collect_source", _small_json)
    result = check_sources.probe(_entry("a", source_type="openfda_recalls"))
    assert result["status"] == "ok"
    assert result["bytes"] < check_sources.THIN_DIGEST_CHARS


def test_probe_treats_304_as_healthy(monkeypatch):
    """An unchanged source is a working source — not a failure."""

    def _not_modified(entry: dict):
        raise NotModified(entry["source_url"])

    monkeypatch.setattr(check_sources, "collect_source", _not_modified)
    assert check_sources.probe(_entry("a"))["status"] == "not-modified"


def test_probe_reports_a_collector_exception_as_failed(monkeypatch):
    def _boom(entry: dict):
        raise ValueError("payload did not parse")

    monkeypatch.setattr(check_sources, "collect_source", _boom)
    result = check_sources.probe(_entry("a"))
    assert result["status"] == "failed"
    assert "payload did not parse" in result["error"]


def test_probe_reports_a_deadline_as_timeout(monkeypatch):
    def _slow(entry: dict):
        raise FetchDeadlineExceeded("too slow")

    monkeypatch.setattr(check_sources, "collect_source", _slow)
    assert check_sources.probe(_entry("a"))["status"] == "timeout"


# ── main() ───────────────────────────────────────────────────────────────


@pytest.fixture()
def fake_registry(monkeypatch):
    """Serve a fixed entry list and a fixed probe result set."""

    def _configure(entries: list[dict], outcomes: dict[str, dict]):
        monkeypatch.setattr(check_sources, "load_sources", lambda: entries)
        monkeypatch.setattr(check_sources, "probe", lambda entry: outcomes[entry["id"]])
    return _configure


def test_main_returns_ok_when_every_source_fetches(fake_registry, capsys):
    entries = [_entry("a"), _entry("b")]
    fake_registry(
        entries,
        {
            "a": _ok("a"),
            "b": {"sourceId": "b", "sourceType": "gov_html", "status": "not-modified"},
        },
    )
    assert check_sources.main([]) == check_sources.EXIT_OK
    assert "2 healthy, 0 thin, 0 failed" in capsys.readouterr().out


def test_main_returns_failures_and_lists_the_offenders(fake_registry, capsys):
    entries = [_entry("good"), _entry("bad")]
    fake_registry(
        entries,
        {
            "good": _ok("good"),
            "bad": {
                "sourceId": "bad",
                "sourceType": "gov_html",
                "status": "failed",
                "error": "HTTPError: 404 Not Found",
            },
        },
    )
    assert check_sources.main([]) == check_sources.EXIT_FAILURES
    out = capsys.readouterr().out
    assert "bad" in out
    assert "HTTPError: 404 Not Found" in out


def test_main_reports_thin_sources_without_failing(fake_registry, capsys):
    """A JS shell is a warning, not a failure — the fetch did succeed."""
    entries = [_entry("shell")]
    fake_registry(
        entries,
        {
            "shell": {
                "sourceId": "shell",
                "sourceType": "gov_html",
                "status": "thin",
                "bytes": 44,
                "hash": "0" * 12,
                "error": "only 44 chars of trackable text — likely a JS shell",
            }
        },
    )
    assert check_sources.main([]) == check_sources.EXIT_OK
    out = capsys.readouterr().out
    assert "0 healthy, 1 thin, 0 failed" in out
    assert "too thin to track" in out


def test_main_skips_unreachable_sources_by_default(fake_registry, capsys):
    entries = [_entry("live"), _entry("dead", fetch_status="unreachable")]
    fake_registry(entries, {"live": _ok("live")})
    assert check_sources.main([]) == check_sources.EXIT_OK
    assert "checked 1 source" in capsys.readouterr().out


def test_main_skips_shell_only_sources_by_default(fake_registry, capsys):
    entries = [_entry("live"), _entry("shell", fetch_status="shell_only")]
    fake_registry(entries, {"live": _ok("live")})
    assert check_sources.main([]) == check_sources.EXIT_OK
    assert "checked 1 source" in capsys.readouterr().out


def test_main_can_probe_unreachable_sources_on_request(fake_registry, capsys):
    entries = [_entry("dead", fetch_status="unreachable")]
    fake_registry(
        entries,
        {"dead": {"sourceId": "dead", "sourceType": "gov_html", "status": "failed", "error": "403"}},
    )
    assert check_sources.main(["--include-skipped"]) == check_sources.EXIT_FAILURES


def test_main_json_output_is_parseable(fake_registry, capsys):
    entries = [_entry("a")]
    fake_registry(
        entries,
        {"a": {"sourceId": "a", "sourceType": "gov_html", "status": "ok", "bytes": 10, "hash": "0" * 12}},
    )
    assert check_sources.main(["--json"]) == check_sources.EXIT_OK
    payload = json.loads(capsys.readouterr().out)
    assert payload["checked"] == 1
    assert payload["results"][0]["sourceId"] == "a"


def test_main_rejects_a_malformed_registry(monkeypatch, capsys):
    monkeypatch.setattr(check_sources, "load_sources", lambda: [_entry("a", source_url="")])
    assert check_sources.main([]) == check_sources.EXIT_BAD_REGISTRY
    assert "missing required field" in capsys.readouterr().err


def test_main_rejects_an_unknown_selector(monkeypatch, capsys):
    monkeypatch.setattr(check_sources, "load_sources", lambda: [_entry("a")])
    assert check_sources.main(["--only", "nope"]) == check_sources.EXIT_BAD_REGISTRY
    assert "unknown source id" in capsys.readouterr().err


# ── the shipped registry ─────────────────────────────────────────────────


def test_shipped_registry_is_structurally_valid():
    """The real official_sources.json must pass the checker's own validation."""
    from scripts.watchdog.orchestrator import load_sources

    entries = load_sources()
    assert check_sources.validate_registry(entries) == []
    assert len(entries) >= 35


def test_shipped_registry_source_types_all_have_collectors():
    """Every source_type in the registry must dispatch to a real collector.

    An unregistered source_type silently falls back to collect_generic,
    which hashes raw bytes — it would "work" while detecting nothing
    meaningful. Catch the typo here instead.
    """
    from scripts.watchdog.orchestrator import load_sources
    from scripts.watchdog.registry import REGISTRY, registered_types

    registered = set(registered_types())
    declared = {str(e.get("source_type") or "") for e in load_sources()}
    assert declared <= registered, f"unregistered source_type(s): {sorted(declared - registered)}"
    assert "gov_html" in REGISTRY
