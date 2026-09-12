#!/usr/bin/env python3
"""
test_regulation_library.py — Tests for §7.2 deliverable.

Spec: docs/plans/2026-09-11-de-rag-evidence-spec.md §7.2 acceptance criteria.

Covers:
  1. parser/legal_parser.py — 5 region recognizers (≥ 8 tests per spec)
  2. retrieval/article_loader.py — load_regulation / load_article_text /
     load_articles_for_anchor
  3. scripts/schema_validator.py — validate-regulations runs clean on the
     shipped 44-file library

Run: rag_service/.venv/bin/python3 -m pytest rag_service/tests/test_regulation_library.py -v
"""
import json
import subprocess
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from rag_service.parser.legal_parser import (  # noqa: E402
    detect_region,
    normalize_article_id,
    parse_text,
)
from rag_service.retrieval import article_loader  # noqa: E402


REPO = Path(__file__).resolve().parents[2]


# ── parser/legal_parser.py ────────────────────────────────────────────────


class TestLegalParserRegionRecognition:
    """≥ 1 test per region (spec acceptance)."""

    def test_eu_detect_and_normalize(self):
        text = """
        Article 77
        Battery passport (electronic record)

        The Commission shall establish by means of implementing acts
        a system for the electronic record of batteries.

        Article 85
        Reporting obligations

        Member States shall report annually to the Commission.
        """
        articles = parse_text(text, region="EU")
        assert len(articles) == 2
        assert articles[0]["id"] == "art-77"
        assert articles[1]["id"] == "art-85"
        assert "electronic record" in articles[0]["text"]
        assert "Member States shall report" in articles[1]["text"]

    def test_us_detect_and_normalize(self):
        text = """
        § 173.185
        Lithium cells and batteries

        Each person who offers a lithium battery for transportation
        must comply with the testing requirements of UN Manual of Tests
        and Criteria.

        § 173.186
        Exceptions

        Small lithium batteries are excepted under conditions.
        """
        articles = parse_text(text, region="US")
        assert len(articles) == 2
        assert articles[0]["id"] == "section-173-185"
        assert articles[1]["id"] == "section-173-186"
        assert "lithium battery" in articles[0]["text"]

    def test_uk_detect_and_normalize(self):
        text = """
        Regulation 8
        Restrictions on placing batteries on the market

        A producer shall not place batteries on the market that contain
        certain hazardous substances above the specified thresholds.

        Regulation 9
        Labelling requirements

        All batteries shall be marked with the crossed-out wheeled bin symbol.
        """
        articles = parse_text(text, region="UK")
        assert len(articles) == 2
        assert articles[0]["id"] == "regulation-8"
        assert articles[1]["id"] == "regulation-9"
        assert "producer shall not" in articles[0]["text"]

    def test_cn_detect_and_normalize(self):
        text = """
        第十二条
        特殊化妆品注册

        特殊化妆品应当向国务院药品监督管理部门提交注册申请。
        国产特殊化妆品由省级人民政府药品监督管理部门进行初步审查。

        第十七条
        备案管理

        普通化妆品备案人应当按照国务院药品监督管理部门的规定
        提交备案资料。
        """
        articles = parse_text(text, region="CN")
        assert len(articles) == 2
        assert articles[0]["id"] == "第十二条"
        assert articles[1]["id"] == "第十七条"
        assert "特殊化妆品应当" in articles[0]["text"]

    def test_un_detect_and_normalize(self):
        text = """
        Section 38.3
        Lithium metal and lithium ion batteries

        The tests T.1 to T.8 shall be conducted in sequence on each
        cell or battery type to be transported.

        Section 38.4
        Classification

        Cells and batteries that pass all required tests are
        classified as Class 9 dangerous goods.
        """
        articles = parse_text(text, region="UN")
        assert len(articles) == 2
        assert articles[0]["id"] == "section-38-3"
        assert articles[1]["id"] == "section-38-4"
        assert "T.1 to T.8" in articles[0]["text"]

    def test_eu_annex_normalization(self):
        # Annexes use Roman numerals and need the annex-* prefix
        text = """
        ANNEX I
        Essential requirements

        Radio equipment shall be constructed so as to ensure...

        ANNEX II
        Conformity assessment modules

        The conformity assessment modules are described in this Annex.
        """
        articles = parse_text(text, region="EU")
        assert len(articles) == 2
        assert articles[0]["id"] == "annex-1"
        assert articles[1]["id"] == "annex-2"

    def test_detect_region_picks_densest_markers(self):
        # Mixed text — US markers should win (3 § hits vs 1 Article hit)
        text = """
        This instrument aligns with Article 5 of Regulation (EU) 2023/988.

        § 2056a General requirements
        § 2056b Mandatory standards
        § 2057c Tracking labels
        """
        assert detect_region(text) == "US"

    def test_normalize_handles_partial_markers(self):
        assert normalize_article_id("Article 77", "EU") == "art-77"
        assert normalize_article_id("§ 173.185", "US") == "section-173-185"
        assert normalize_article_id("regulation (8)", "UK") == "regulation-8"
        assert normalize_article_id("Section 38.3", "UN") == "section-38-3"
        assert normalize_article_id("第十二条", "CN") == "第十二条"
        assert normalize_article_id("annex iv", "EU") == "annex-4"

    def test_parse_unknown_region_returns_empty(self):
        # Unknown region code returns [] rather than crashing
        text = "Some text"
        assert parse_text(text, region="ZZ") == []


# ── retrieval/article_loader.py ───────────────────────────────────────────


class TestArticleLoader:
    """Loader round-trip + invariants for the 44-file library."""

    def test_list_regulation_ids_returns_44(self):
        article_loader.invalidate_cache()
        assert len(article_loader.list_regulation_ids()) == 44

    def test_load_regulation_round_trip(self):
        reg = article_loader.load_regulation("EU-2023-1542")
        assert reg is not None
        assert reg["region"] == "EU"
        assert reg["license"] == "public"
        assert reg["schema_version"] == 1
        assert reg["source_url"], "public reg must have source_url"

    def test_load_regulation_unknown_returns_none(self):
        assert article_loader.load_regulation("NOPE-123") is None

    def test_load_article_text_returns_text(self):
        text = article_loader.load_article_text("EU-2023-1542", "art-77")
        assert text is not None
        assert "battery passport" in text.lower() or "passport" in text.lower()

    def test_load_article_text_missing_returns_none(self):
        # Unknown article id returns None (graceful fallback to KB key_points)
        assert article_loader.load_article_text("EU-2023-1542", "art-9999") is None

    def test_load_article_text_unknown_reg_returns_none(self):
        assert article_loader.load_article_text("NOPE", "art-1") is None

    def test_load_articles_for_anchor_returns_key_articles(self):
        # Build a fake anchor mimicking kb_loader's legacy shape
        anchor = {
            "doc_name": "Battery Regulation (EU) 2023/1542",
            "region": "EU",
            "kb_entry": {
                "regulation_id": "EU-2023-1542",
                "key_articles": ["art-7", "art-38", "art-77"],
            },
        }
        loaded = article_loader.load_articles_for_anchor(anchor)
        assert "art-77" in loaded
        assert "art-38" in loaded
        assert "art-7" in loaded
        for art_id, text in loaded.items():
            assert text.strip(), f"{art_id} has empty text"

    def test_load_articles_for_anchor_skips_unknown(self):
        # Anchor referencing a real reg but a non-existent article — should
        # silently skip the missing article, not crash.
        anchor = {
            "kb_entry": {
                "regulation_id": "EU-2023-1542",
                "key_articles": ["art-77", "art-9999"],
            },
        }
        loaded = article_loader.load_articles_for_anchor(anchor)
        assert "art-77" in loaded
        assert "art-9999" not in loaded

    def test_load_articles_for_anchor_no_reg_id(self):
        # Defensive: anchor with no regulation_id returns empty dict
        loaded = article_loader.load_articles_for_anchor({"kb_entry": {}})
        assert loaded == {}

    def test_private_regulation_has_no_article_text(self):
        # Spec §6.4: private_with_summary has empty articles[] and no
        # quotable text. load_article_text must return None even when
        # the caller asks for an article id.
        text = article_loader.load_article_text("CN-GB-31241", "any")
        assert text is None
        reg = article_loader.load_regulation("CN-GB-31241")
        assert reg["license"] == "private_with_summary"
        assert reg["articles"] == []
        assert reg.get("purchase_url"), "private reg must have purchase_url"


# ── library-wide invariants ──────────────────────────────────────────────


class TestLibraryInvariants:
    """Cross-cutting checks on the 44-file regulation library."""

    def test_library_contains_all_44_anchor_regulations(self):
        """Every KB anchor's regulation_id must be loadable from the library."""
        from rag_service.retrieval.kb_loader import list_all_regulations
        article_loader.invalidate_cache()
        kb_ids = set(list_all_regulations())
        lib_ids = set(article_loader.list_regulation_ids())
        missing = kb_ids - lib_ids
        assert not missing, f"KB regulations missing from library: {missing}"

    def test_license_split_matches_spec(self):
        """Spec §6.2: 33 public + 11 private_with_summary."""
        article_loader.invalidate_cache()
        counts = {"public": 0, "private_with_summary": 0}
        for reg_id in article_loader.list_regulation_ids():
            reg = article_loader.load_regulation(reg_id)
            counts[reg["license"]] += 1
        assert counts["public"] == 33
        assert counts["private_with_summary"] == 11

    def test_every_regulation_has_schema_version_1(self):
        for reg_id in article_loader.list_regulation_ids():
            reg = article_loader.load_regulation(reg_id)
            assert reg["schema_version"] == 1

    def test_regulations_index_exists_and_has_44(self):
        index_path = REPO / "data" / "regulations" / "regulations_index.json"
        assert index_path.exists()
        data = json.loads(index_path.read_text())
        assert data["count"] == 44
        assert len(data["regulations"]) == 44


# ── scripts/schema_validator.py (run via subprocess) ────────────────────


class TestSchemaValidator:
    """Validate the schema validator runs cleanly on the shipped library."""

    def test_validate_regulations_exits_zero(self):
        # Use current running Python interpreter (which has all deps installed).
        import sys
        proc = subprocess.run(
            [
                sys.executable,
                str(REPO / "scripts" / "schema_validator.py"),
                "validate-regulations",
            ],
            capture_output=True,
            text=True,
        )
        assert proc.returncode == 0, (
            f"validator failed:\nstdout={proc.stdout}\nstderr={proc.stderr}"
        )
        assert "All 44 regulations pass schema validation" in proc.stdout

    def test_validator_catches_missing_required_field(self):
        # Feed a synthetic bad payload through the validator API directly
        sys.path.insert(0, str(REPO / "scripts"))
        from schema_validator import _validate_jsonschema
        schema = json.loads(
            (REPO / "data" / "regulations" / "schema" / "regulation.schema.json").read_text()
        )
        bad = {"id": "TEST-X", "license": "public"}  # missing most required fields
        failures = _validate_jsonschema(bad, schema)
        assert any("Missing required" in f for f in failures)

    def test_validator_catches_unknown_license(self):
        sys.path.insert(0, str(REPO / "scripts"))
        from schema_validator import _validate_jsonschema
        schema = json.loads(
            (REPO / "data" / "regulations" / "schema" / "regulation.schema.json").read_text()
        )
        bad = {
            "id": "TEST-X", "official_citation": "X",
            "license": "totally-made-up",
            "last_verified": "2026-09-11", "language": "en",
            "schema_version": 1, "articles": [], "raw_file": None,
            "checksum_sha256": None,
        }
        failures = _validate_jsonschema(bad, schema)
        assert any("not in enum" in f for f in failures)


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-v"]))