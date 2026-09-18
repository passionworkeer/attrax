"""Tests for scripts/watchdog/auto_ingest.py — update/create/mark semantics.

Covers (in order):
  - regulation_for_source() mapping for every source type:
      eu_celex, ecfr_part, canada_justice_xml, gov_html, direct_url,
      explicit regulation_id precedence, plus unmapped RSS feeds.
  - _citation_from_celex() + _citation_from_entry() — used by auto-CREATE.
  - update / create / evidence (UPDATE path on an existing regulation,
    CREATE path on a missing one, evidence-only for unmapped sources).
  - repeal keyword marks regulation, failure streak marks stale.

Plus (in test_collectors.py): gov_html chrome stripping + safety_gate JSON.
"""
from __future__ import annotations

import sys
import threading
import time
from pathlib import Path

import pytest
import yaml

PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.watchdog.auto_ingest import (  # noqa: E402
    AutoIngestor,
    regulation_for_source,
    _citation_from_celex,
    _citation_from_entry,
    _slug_to_reg_id,
    _write_atomic,
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
    entry = {"id": "eu-rohs", "source_type": "eu_celex", "celex": "32011L0065"}
    reg_id, path = regulation_for_source(entry)
    assert reg_id == "EU-2011-65"
    assert path.name == "EU-2011-65.yaml"
    assert path.parent.name == "eu"


def test_ecfr_part_maps_to_us_regulation_id():
    entry = {
        "id": "us-cfr-1307",
        "source_type": "ecfr_part",
        "market": "US",
        "ecfr_title": 16,
        "ecfr_part": "1307",
    }
    reg_id, path = regulation_for_source(entry)
    assert reg_id == "US-16-CFR-1307"
    assert path.name == "US-16-CFR-1307.yaml"
    assert path.parent.name == "us"


def test_canada_justice_xml_maps_to_sor_regulation_id():
    entry = {
        "id": "ca-chemicals-2001",
        "source_type": "canada_justice_xml",
        "market": "CA",
        "source_url": "https://laws-lois.justice.gc.ca/eng/XML/SOR-2001-269.xml",
    }
    reg_id, path = regulation_for_source(entry)
    assert reg_id == "CA-SOR-2001-269"
    assert path.name == "CA-SOR-2001-269.yaml"
    assert path.parent.name == "ca"


def test_gov_html_maps_uk_weee():
    entry = {
        "id": "uk-weee-regulations-guidance",
        "source_type": "gov_html",
        "market": "UK",
    }
    reg_id, path = regulation_for_source(entry)
    assert reg_id == "UK-WEEE"
    assert path.name == "UK-WEEE.yaml"
    assert path.parent.name == "uk"


def test_gov_html_maps_uk_packaging_epr():
    entry = {
        "id": "uk-packaging-epr-who-is-affected",
        "source_type": "gov_html",
        "market": "UK",
    }
    reg_id, _path = regulation_for_source(entry)
    # The slug fallback uppercases the meaningful tokens (the registry
    # carries an explicit regulation_id with mixed-case "EPR" — that path
    # is covered by test_explicit_regulation_id_takes_precedence).
    assert reg_id == "UK-PACKAGING-EPR"


def test_direct_url_maps_nz():
    entry = {
        "id": "nz-product-safety-standards-2005",
        "source_type": "direct_url",
        "market": "NZ",
    }
    reg_id, _path = regulation_for_source(entry)
    # 4-digit year drops; "standards" is a stop word; cap at 3 tokens.
    assert reg_id == "NZ-PRODUCT-SAFETY"


def test_explicit_regulation_id_takes_precedence():
    entry = {
        "id": "uk-packaging-epr-who-is-affected",
        "source_type": "gov_html",
        "market": "UK",
        "regulation_id": "UK-Packaging-EPR",
    }
    reg_id, path = regulation_for_source(entry)
    assert reg_id == "UK-Packaging-EPR"
    # Even though the inference would say UK-WEEE, the explicit id wins.
    assert path.parent.name == "uk"


def test_signal_streams_return_none():
    # Recall feeds are signals, not regulation texts.
    entry = {
        "id": "us-cpsc-recalls-api",
        "source_type": "cpsc_recall_api",
        "market": "US",
    }
    assert regulation_for_source(entry) is None
    for signal_type in ("safety_gate", "openfda_recalls"):
        entry["source_type"] = signal_type
        assert regulation_for_source(entry) is None


def test_unknown_market_for_slug_returns_none():
    # market not in _REGION_DIRS → no place to put the yaml, so we skip.
    entry = {
        "id": "xx-some-slug",
        "source_type": "gov_html",
        "market": "XX",
    }
    assert regulation_for_source(entry) is None


def test_slug_to_reg_id_filters_stop_words():
    assert _slug_to_reg_id("uk-reach-compliance-guidance", "UK") == "UK-REACH"
    assert _slug_to_reg_id("uk-hse-svhc-overview", "UK") == "UK-HSE-SVHC"
    # "standards" / "regulations" / "guidance" / "overview" are stop words
    # so the slug collapses to the first 3 meaningful tokens (3-token cap
    # to avoid unweildy ids). Year digits drop too.
    assert _slug_to_reg_id("nz-product-safety-standards-2005", "NZ") == "NZ-PRODUCT-SAFETY"
    assert _slug_to_reg_id("nz-product-safety-standards-household-cots-2016", "NZ") == "NZ-PRODUCT-SAFETY-HOUSEHOLD"


def test_citation_from_celex():
    assert _citation_from_celex("32011L0065") == "Directive 2011/65/EU"
    assert _citation_from_celex("32023R0988") == "Regulation (EU) 2023/988"
    # Decision (type_letter "D") — current rendering adds "(EU)" prefix
    assert _citation_from_celex("31999D0468") == "Decision (EU) 1999/468"
    # Legacy 6-digit CELEX (pre-1985 instruments) — the regex no longer
    # matches; the function falls back to returning the input verbatim
    # so callers can still see what was asked for.
    assert _citation_from_celex("376L0769") == "376L0769"


def test_citation_from_entry_per_source_type():
    eu = {"source_type": "eu_celex", "celex": "32011L0065"}
    assert _citation_from_entry(eu) == "Directive 2011/65/EU"
    us = {"source_type": "ecfr_part", "ecfr_title": 16, "ecfr_part": 1307}
    assert _citation_from_entry(us) == "16 CFR Part 1307"
    ca = {
        "source_type": "canada_justice_xml",
        "source_url": "https://laws-lois.justice.gc.ca/eng/XML/SOR-2001-269.xml",
    }
    assert _citation_from_entry(ca) == "SOR 2001/269"
    jp = {"source_type": "gov_html", "market": "JP", "title": "PSE List"}
    assert "PSE List" in _citation_from_entry(jp)


# ── update / create / evidence (isolated tmp library) ───────────────────


@pytest.fixture()
def isolated_library(tmp_path, monkeypatch):
    """Point the ingestor's library + supplements roots at a tmp dir."""
    import scripts.watchdog.auto_ingest as ai

    regs = tmp_path / "regulations"
    for sub in ("eu", "us", "ca", "uk", "nz", "cn", "jp", "kr", "sa", "ae", "br", "in"):
        (regs / sub).mkdir(parents=True)
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
    entry = {"id": "eu-rohs", "source_type": "eu_celex", "celex": "32011L0065"}
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
    import json

    idx = json.loads((isolated_library.REGULATIONS_ROOT / "regulations_index.json").read_text())
    assert idx["count"] == 1
    assert idx["regulations"][0]["id"] == "EU-2011-65"
    assert idx["regulations"][0]["article_count"] == 1


def test_create_missing_regulation_from_celex(isolated_library):
    ingestor = AutoIngestor("2026-09-13")
    # WEEE 2012/19 exists as a source but has no library YAML — the CREATE path.
    entry = {"id": "eu-weee", "source_type": "eu_celex", "celex": "32012L0019"}
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


def test_create_missing_regulation_from_ecfr_part(isolated_library):
    """A US CFR source whose YAML hasn't been authored yet still gets a
    CREATE — formerly evidence-only (was unmappable)."""
    ingestor = AutoIngestor("2026-09-13")
    entry = {
        "id": "us-cfr-1505",
        "source_type": "ecfr_part",
        "market": "US",
        "ecfr_title": 16,
        "ecfr_part": "1505",
    }
    update = _update("us-cfr-1505", '{"results":[]}', source_type="ecfr_part")
    report = ingestor.apply(
        {"us-cfr-1505": entry}, {"us-cfr-1505": update}, [_change("us-cfr-1505", kind="added")]
    )
    assert report.created == ["US-16-CFR-1505"]
    created = isolated_library.REGULATIONS_ROOT / "us" / "US-16-CFR-1505.yaml"
    assert created.exists()
    payload = yaml.safe_load(created.read_text())
    assert payload["region"] == "US"
    assert payload["official_citation"] == "16 CFR Part 1505"


def test_create_missing_regulation_from_gov_html(isolated_library):
    ingestor = AutoIngestor("2026-09-13")
    entry = {
        "id": "uk-some-new-reg",
        "source_type": "gov_html",
        "market": "UK",
    }
    update = _update("uk-some-new-reg", "<html><body>New UK regulation</body></html>", source_type="gov_html")
    report = ingestor.apply(
        {"uk-some-new-reg": entry}, {"uk-some-new-reg": update}, [_change("uk-some-new-reg", kind="added")]
    )
    # The auto-CREATE falls back to slug inference, so the id should land in uk/
    assert len(report.created) == 1
    assert report.created[0].startswith("UK-")
    created = isolated_library.REGULATIONS_ROOT / "uk" / f"{report.created[0]}.yaml"
    assert created.exists()
    payload = yaml.safe_load(created.read_text())
    assert payload["region"] == "UK"
    assert payload["license"] == "public"


def test_unmappable_signal_source_is_evidence_only(isolated_library):
    ingestor = AutoIngestor("2026-09-13")
    # Recall feeds are signal streams, not regulation texts.
    entry = {
        "id": "us-cpsc-recalls-api",
        "source_type": "cpsc_recall_api",
        "market": "US",
    }
    update = _update(
        "us-cpsc-recalls-api", '[{"RecallNumber": "26761"}]', source_type="cpsc_recall_api"
    )
    report = ingestor.apply(
        {"us-cpsc-recalls-api": entry},
        {"us-cpsc-recalls-api": update},
        [_change("us-cpsc-recalls-api")],
    )
    assert report.evidence_only == ["us-cpsc-recalls-api"]
    assert report.created == [] and report.updated == []
    evidence = isolated_library.SUPPLEMENTS_DIR / "auto-2026-09-13" / "us-cpsc-recalls-api"
    assert (evidence / "raw.json").exists()


def test_repeal_keyword_marks_regulation(isolated_library):
    ingestor = AutoIngestor("2026-09-13")
    entry = {"id": "eu-rohs", "source_type": "eu_celex", "celex": "32011L0065"}
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
    entry = {"id": "eu-rohs", "source_type": "eu_celex", "celex": "32011L0065"}
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
    import json

    auto_state = json.loads(
        (isolated_library.SUPPLEMENTS_DIR / ".auto_state.json").read_text()
    )
    assert "eu-rohs" not in auto_state["failureStreaks"]


def test_repeal_status_keeps_evidence_path(isolated_library):
    """repeal marking doesn't bypass the evidence layer (every change
    still gets a raw + meta.json under auto-{date}/{source_id}/)."""
    ingestor = AutoIngestor("2026-09-13")
    entry = {"id": "eu-rohs", "source_type": "eu_celex", "celex": "32011L0065"}
    update = _update("eu-rohs", "body")
    update.title = "Revocation of RoHS"
    ingestor.apply({"eu-rohs": entry}, {"eu-rohs": update}, [_change("eu-rohs")])
    evidence = isolated_library.SUPPLEMENTS_DIR / "auto-2026-09-13" / "eu-rohs"
    assert (evidence / "raw.rdf").exists()
    assert (evidence / "meta.json").exists()


# ── verbatim replacement pass (2026-09-16) ────────────────────────────────


from scripts.watchdog.auto_ingest import _extract_articles_from_text  # noqa: E402


def test_verbatim_extractor_promotes_when_articles_match():
    """A real EU Cellar fetch with Article 4/6/7 should overwrite the
    KB-condensed summaries and report official_verbatim for eu_celex."""
    text = (
        "Directive 2011/65/EU on the restriction of hazardous substances.\n"
        "\n"
        "Article 4\n"
        "Member States shall ensure that electrical and electronic equipment "
        "does not contain lead, mercury, cadmium or hexavalent chromium.\n"
        "\n"
        "Article 6\n"
        "The manufacturer shall prepare the technical documentation and the "
        "EU declaration of conformity.\n"
        "\n"
        "Article 7\n"
        "Market surveillance authorities shall perform adequate checks."
    )
    previous = [
        {"id": "art-4", "title": "Prevention", "text": "KB summary"},
        {"id": "art-6", "title": "Conformity", "text": "KB summary"},
        {"id": "art-7", "title": "Market surveillance", "text": "KB summary"},
    ]
    out = _extract_articles_from_text(text, previous, "eu_celex")
    assert out.matched_slots == 3
    assert out.promoted_kind == "official_verbatim"
    assert {a["id"] for a in out.articles} == {"art-4", "art-6", "art-7"}
    # body replaced; title preserved
    art4 = next(a for a in out.articles if a["id"] == "art-4")
    assert "lead, mercury, cadmium" in art4["text"]
    assert art4["title"] == "Prevention"


def test_verbatim_extractor_returns_official_summary_for_non_celex():
    text = (
        "Article 4\n"
        "Body of article 4 here.\n"
        "\n"
        "Article 5\n"
        "Body of article 5 here.\n"
    )
    previous = [
        {"id": "art-4", "title": "t", "text": "stub"},
        {"id": "art-5", "title": "t", "text": "stub"},
    ]
    out = _extract_articles_from_text(text, previous, "ecfr_part")
    # Non-Cellar source → official_summary, not verbatim.
    assert out.promoted_kind == "official_summary"
    assert out.matched_slots == 2


def test_verbatim_extractor_returns_empty_for_unstructured_text():
    text = "A long paragraph without any article markers whatsoever."
    previous = [{"id": "art-1", "title": "t", "text": "stub"}]
    out = _extract_articles_from_text(text, previous, "eu_celex")
    assert out.articles == []
    assert out.promoted_kind == "unverified"


def test_verbatim_extractor_returns_empty_when_no_previous_articles():
    """No previous slots → nothing to align to → safe no-op."""
    out = _extract_articles_from_text("Article 1\nbody", [], "eu_celex")
    assert out.articles == []
    assert out.promoted_kind == "unverified"


def test_update_promotes_source_kind_to_official(isolated_library):
    """Integration: UPDATE on an unverified regulation with a real
    structured fetch flips source_kind → official_verbatim AND records
    the verbatim step in the audit note."""
    import scripts.watchdog.auto_ingest as ai
    yaml_path = isolated_library.REGULATIONS_ROOT / "eu" / "EU-2011-65.yaml"
    yaml_path.write_text(
        yaml.safe_dump(
            {
                "id": "EU-2011-65",
                "official_citation": "Directive 2011/65/EU",
                "short_name": "RoHS",
                "region": "EU",
                "license": "public",
                "source_kind": "unverified",
                "articles": [
                    {"id": "art-4", "title": "Prevention", "text": "KB summary"},
                ],
                "source_url": "https://old.example",
                "notes": "seed",
            }
        ),
        encoding="utf-8",
    )
    ingested_text = (
        "Article 4\n"
        "Lead is restricted in electrical equipment per Annex II.\n"
    )
    entry = {"id": "eu-rohs", "source_type": "eu_celex", "celex": "32011L0065"}
    update = RegulationUpdate(
        source_id="eu-rohs",
        market="EU",
        source_type="eu_celex",
        source_url="https://example.com/eu-rohs",
        title="RoHS",
        text=ingested_text,
        content_hash=text_hash(ingested_text),
    )
    ingestor = AutoIngestor("2026-09-13")
    ingestor.apply(
        {"eu-rohs": entry}, {"eu-rohs": update}, [_change("eu-rohs")]
    )
    loaded = yaml.safe_load(yaml_path.read_text())
    assert loaded["source_kind"] == "official_verbatim"
    assert loaded["articles"][0]["text"] == "Lead is restricted in electrical equipment per Annex II."
    assert "verbatim official_verbatim" in loaded["notes"]


def test_update_leaves_official_alone(isolated_library):
    """If the YAML is already official_verbatim, UPDATE does not re-extract
    (the audit note records the skip)."""
    import scripts.watchdog.auto_ingest as ai
    yaml_path = isolated_library.REGULATIONS_ROOT / "eu" / "EU-2011-65.yaml"
    yaml_path.write_text(
        yaml.safe_dump(
            {
                "id": "EU-2011-65",
                "official_citation": "Directive 2011/65/EU",
                "short_name": "RoHS",
                "region": "EU",
                "license": "public",
                "source_kind": "official_verbatim",
                "articles": [
                    {"id": "art-4", "title": "Prevention", "text": "Original official text"},
                ],
                "source_url": "https://example.com/old",
                "notes": "seed",
            }
        ),
        encoding="utf-8",
    )
    entry = {"id": "eu-rohs", "source_type": "eu_celex", "celex": "32011L0065"}
    update = _update("eu-rohs", "Article 4\nDifferent text.")
    ingestor = AutoIngestor("2026-09-13")
    ingestor.apply({"eu-rohs": entry}, {"eu-rohs": update}, [_change("eu-rohs")])
    loaded = yaml.safe_load(yaml_path.read_text())
    # source_kind stays official_verbatim; the article body is left untouched
    # (the verbatim re-extract only fires when the YAML is unverified).
    assert loaded["source_kind"] == "official_verbatim"
    assert loaded["articles"][0]["text"] == "Original official text"
    assert "verbatim skipped" in loaded["notes"]


# ── H16/M20: parallel ingest (2026-09-18) ─────────────────────────────────


def _gov_html_entry(source_id: str, reg_id: str) -> dict:
    return {
        "id": source_id,
        "source_type": "gov_html",
        "market": "UK",
        "regulation_id": reg_id,
    }


def test_apply_ingests_sources_in_parallel(isolated_library, monkeypatch):
    """Four sources must sit inside ``_store_evidence`` at the same time —
    a barrier of size four only releases once every ingest has entered, so a
    serial implementation would break it (BrokenBarrierError) and fail one
    source into report.failed."""
    ingestor = AutoIngestor("2026-09-13")
    entries = {f"src-{i}": _gov_html_entry(f"src-{i}", f"UK-PAR-{i}") for i in range(4)}
    updates = {
        sid: _update(sid, f"body {sid}", source_type="gov_html") for sid in entries
    }
    changes = [_change(sid, kind="added") for sid in entries]

    barrier = threading.Barrier(len(changes), timeout=5)
    real_store = AutoIngestor._store_evidence

    def _slow_store(self, *args, **kwargs):
        barrier.wait()
        return real_store(self, *args, **kwargs)

    monkeypatch.setattr(AutoIngestor, "_store_evidence", _slow_store)

    report = ingestor.apply(entries, updates, changes)

    assert barrier.broken is False
    assert report.failed == []
    assert len(report.created) == 4


def test_apply_report_order_follows_input_not_completion(isolated_library, monkeypatch):
    """The report is merged in ``changes`` order, not thread-completion
    order — two passes over the same input must write identical output."""
    ingestor = AutoIngestor("2026-09-13")
    order = ["z-slow", "a-fast", "m-fast"]
    entries = {
        sid: _gov_html_entry(sid, f"UK-ORD-{sid[0].upper()}") for sid in order
    }
    updates = {
        sid: _update(sid, f"body {sid}", source_type="gov_html") for sid in order
    }
    delays = {"z-slow": 0.2, "a-fast": 0.0, "m-fast": 0.0}
    real_store = AutoIngestor._store_evidence

    def _slow_store(self, source_id, *args, **kwargs):
        # z-slow finishes last; a completion-ordered merge would emit it last.
        time.sleep(delays[source_id])
        return real_store(self, source_id, *args, **kwargs)

    monkeypatch.setattr(AutoIngestor, "_store_evidence", _slow_store)

    report = ingestor.apply(entries, updates, [_change(sid, kind="added") for sid in order])

    assert report.created == ["UK-ORD-Z", "UK-ORD-A", "UK-ORD-M"]
    assert [r["sourceId"] for r in report.records] == order


def test_regulation_lock_is_one_lock_per_id(isolated_library):
    """Two sources mapped to one regulation serialize on the same lock;
    different regulations do not share one. The registry is safe under a
    first-use race from several threads."""
    ingestor = AutoIngestor("2026-09-13")
    assert ingestor._regulation_lock("EU-A") is ingestor._regulation_lock("EU-A")
    assert ingestor._regulation_lock("EU-A") is not ingestor._regulation_lock("EU-B")

    seen: list[int] = []

    def _grab() -> None:
        seen.append(id(ingestor._regulation_lock("EU-RACE")))

    threads = [threading.Thread(target=_grab) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len(set(seen)) == 1


def test_two_sources_mapped_to_one_regulation_keep_both_notes(isolated_library):
    """The read-modify-write is serialized per regulation, so a second
    source's update cannot read a stale payload and drop the first one's
    audit note."""
    ingestor = AutoIngestor("2026-09-13")
    entry_a = {"id": "eu-rohs-a", "source_type": "eu_celex", "celex": "32011L0065"}
    entry_b = {"id": "eu-rohs-b", "source_type": "eu_celex", "celex": "32011L0065"}
    report = ingestor.apply(
        {"eu-rohs-a": entry_a, "eu-rohs-b": entry_b},
        {
            "eu-rohs-a": _update("eu-rohs-a", "content from A"),
            "eu-rohs-b": _update("eu-rohs-b", "content from B"),
        },
        [_change("eu-rohs-a"), _change("eu-rohs-b")],
    )

    payload = yaml.safe_load(
        (isolated_library.REGULATIONS_ROOT / "eu" / "EU-2011-65.yaml").read_text()
    )
    assert "eu-rohs-a" in payload["notes"]
    assert "eu-rohs-b" in payload["notes"]
    assert report.updated == ["EU-2011-65", "EU-2011-65"]
    assert report.failed == []


# ── H15: atomic writes under concurrency (2026-09-18) ─────────────────────


def test_write_atomic_never_exposes_a_partial_file(tmp_path):
    """Eight threads rewrite the same file; a reader must only ever observe
    a complete payload. This is what the per-call temp-file counter buys
    over a pid-only name: two threads in one process cannot share a temp
    file and interleave their writes."""
    target = tmp_path / "state.json"
    payloads = [f'{{"writer": {i}, "pad": "{"x" * 2000}"}}' for i in range(8)]
    target.write_text(payloads[0], encoding="utf-8")

    stop = threading.Event()
    seen_bad: list[str] = []

    def _reader() -> None:
        while not stop.is_set():
            text = target.read_text(encoding="utf-8")
            if text not in payloads:
                seen_bad.append(text[:80])

    def _writer(payload: str) -> None:
        for _ in range(50):
            _write_atomic(target, payload)

    reader = threading.Thread(target=_reader)
    reader.start()
    writers = [threading.Thread(target=_writer, args=(p,)) for p in payloads]
    for writer in writers:
        writer.start()
    for writer in writers:
        writer.join()
    stop.set()
    reader.join()

    assert seen_bad == []
    assert target.read_text(encoding="utf-8") in payloads


def test_write_atomic_uses_a_fresh_temp_name_per_call(tmp_path, monkeypatch):
    """Consecutive writes must never reuse the same temp path — that reuse
    is exactly how two threads in one process would corrupt each other's
    in-flight payload before the rename."""
    import scripts.watchdog.auto_ingest as ai

    target = tmp_path / "state.json"
    sources: list[str] = []
    real_replace = ai.os.replace

    def _recording_replace(src, dst):
        sources.append(str(src))
        return real_replace(src, dst)

    monkeypatch.setattr(ai.os, "replace", _recording_replace)
    for i in range(3):
        _write_atomic(target, f"payload {i}")

    assert len(sources) == 3
    assert len(set(sources)) == 3