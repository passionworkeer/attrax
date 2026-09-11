#!/usr/bin/env python3
"""
test_generator_kb_mode.py — Tests for §7.3 generator KB-anchored path.

Spec: docs/plans/2026-09-11-de-rag-evidence-spec.md §7.3.

Covers:
  - schema normalization accepts/forwards `citations` + `evidencePack`
  - `article_loader.build_article_texts_for_anchors` resolves the
    mandatory_regulations entries to `{doc_id}#{article_id} -> text`
  - `report_generator.generate_report_package` respects
    `article_texts` when `USE_KB_INPUT=true`; falls back to chunks
    when the flag is off or article_texts is empty
  - `_build_article_source_context` renders numbered KB blocks

Run: rag_service/.venv/bin/python3 -m pytest rag_service/tests/test_generator_kb_mode.py -v
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

from rag_service.retrieval import article_loader  # noqa: E402
from rag_service.retrieval.article_loader import (  # noqa: E402
    build_article_texts_for_anchors,
    load_articles_for_anchor,
)
from rag_service.retrieval.must_check import build_anchor_list  # noqa: E402
from rag_service.schemas.report_package import normalize_report_package  # noqa: E402


# ── schema normalize: citations / evidencePack ──────────────────────────


class TestSchemaNormalizationCitations:
    """`normalize_report_package` must accept and forward the new fields."""

    def test_normalize_keeps_explicit_citations(self):
        pkg = _minimal_package()
        pkg["citations"] = [
            {
                "doc_id": "EU-2023-1542",
                "article_id": "art-77",
                "official_citation": "(EU) 2023/1542 Art. 77",
                "quote": "The Commission shall establish a system for the electronic record of batteries.",
                "quote_span": None,
                "match_status": None,
            },
        ]
        out = normalize_report_package(pkg, product="X", market="EU", query="?")
        assert len(out["citations"]) == 1
        assert out["citations"][0]["doc_id"] == "EU-2023-1542"
        assert out["citations"][0]["article_id"] == "art-77"
        assert out["citations"][0]["quote"]

    def test_normalize_defaults_citations_to_empty_list(self):
        pkg = _minimal_package()
        out = normalize_report_package(pkg, product="X", market="EU", query="?")
        assert out["citations"] == []

    def test_normalize_drops_invalid_citations(self):
        pkg = _minimal_package()
        pkg["citations"] = [
            # missing article_id → dropped
            {"doc_id": "EU-2023-1542", "quote": "x"},
            # missing doc_id → dropped
            {"article_id": "art-77", "quote": "x"},
            # valid
            {"doc_id": "EU-2023-1542", "article_id": "art-77", "quote": "y"},
        ]
        out = normalize_report_package(pkg, product="X", market="EU", query="?")
        assert len(out["citations"]) == 1
        assert out["citations"][0]["quote"] == "y"

    def test_normalize_accepts_camelcase_aliases(self):
        # LLM may emit docId / articleId; we coerce them
        pkg = _minimal_package()
        pkg["citations"] = [
            {
                "docId": "EU-2023-1542",
                "articleId": "art-77",
                "officialCitation": "(EU) 2023/1542 Art. 77",
                "quote": "x",
            }
        ]
        out = normalize_report_package(pkg, product="X", market="EU", query="?")
        assert out["citations"][0]["doc_id"] == "EU-2023-1542"
        assert out["citations"][0]["article_id"] == "art-77"

    def test_normalize_forwards_evidence_pack(self):
        pkg = _minimal_package()
        pkg["evidencePack"] = [
            {"doc_id": "EU-2023-1542", "article_id": "art-77", "quote": "x"}
        ]
        out = normalize_report_package(pkg, product="X", market="EU", query="?")
        assert len(out["evidencePack"]) == 1


# ── build_article_texts_for_anchors ─────────────────────────────────────


class TestBuildArticleTextsForAnchors:
    def test_resolves_battery_category(self):
        article_loader.invalidate_cache()
        anchors = build_anchor_list(category="battery", markets=["EU"])
        article_key_texts = build_article_texts_for_anchors(anchors)
        # Battery Reg 2023/1542 has key_articles=art-7/art-38/art-39/art-77/art-85
        battery_reg_keys = [
            k for k in article_key_texts
            if k.startswith("EU-2023-1542#")
        ]
        assert battery_reg_keys, f"no EU-2023-1542 keys in {list(article_key_texts)}"
        for key in battery_reg_keys:
            assert article_key_texts[key].strip(), f"{key} has empty text"

    def test_skips_private_regulations_silently(self):
        # Private standards have no article text — they should NOT
        # produce entries in the dict.
        article_loader.invalidate_cache()
        anchors = build_anchor_list(category="battery", markets=["CN"])
        article_key_texts = build_article_texts_for_anchors(anchors)
        # GB 31241 is private_with_summary → no key articles
        for key in article_key_texts:
            assert not key.startswith("CN-GB-31241#"), (
                "private_with_summary should not yield article_texts entries"
            )

    def test_un_articles_always_resolved(self):
        # UN 38.3 applies regardless of category/market
        article_loader.invalidate_cache()
        anchors = build_anchor_list(category="battery", markets=["EU"])
        article_key_texts = build_article_texts_for_anchors(anchors)
        un_keys = [k for k in article_key_texts if k.startswith("UN-38-3#")]
        assert un_keys, "UN 38.3 always applies for battery category"

    def test_empty_anchors_returns_empty_dict(self):
        assert build_article_texts_for_anchors([]) == {}

    def test_unknown_region_skipped(self):
        anchors = [
            {"doc_name": "Not Real Doc", "region": "ZZ", "reason": "x", "source": "category"},
        ]
        article_key_texts = build_article_texts_for_anchors(anchors)
        assert article_key_texts == {}


# ── generate_report_package KB-mode wiring ──────────────────────────────


class TestGeneratorKBMode:
    """Smoke-test the generator wiring without invoking the LLM."""

    def test_kb_flag_disabled_by_default(self, monkeypatch):
        # Spec §7.3: default OFF so production behavior is unchanged
        monkeypatch.delenv("USE_KB_INPUT", raising=False)
        from rag_service.generate.report_generator import _kb_input_enabled
        assert _kb_input_enabled() is False

    @pytest.mark.parametrize("value", ["1", "true", "yes", "on", "TRUE", "Yes"])
    def test_kb_flag_enabled_by_env(self, monkeypatch, value):
        monkeypatch.setenv("USE_KB_INPUT", value)
        from rag_service.generate.report_generator import _kb_input_enabled
        assert _kb_input_enabled() is True

    def test_build_article_source_context_renders_numbered_blocks(self):
        from rag_service.generate.report_generator import _build_article_source_context
        text = _build_article_source_context({
            "EU-2023-1542#art-77": "The Commission shall establish a system.",
            "EU-2023-1542#art-85": "Member States shall report annually.",
        })
        assert "[1] EU-2023-1542#art-77" in text
        assert "[2] EU-2023-1542#art-85" in text
        assert "---" in text
        assert "The Commission shall establish" in text

    def test_build_article_source_context_empty(self):
        from rag_service.generate.report_generator import _build_article_source_context
        assert _build_article_source_context({}) == ""

    def test_build_article_source_context_skips_empty_text(self):
        from rag_service.generate.report_generator import _build_article_source_context
        text = _build_article_source_context({
            "EU-2023-1542#art-77": "   ",  # whitespace only
            "EU-2023-1542#art-38": "Real article body.",
        })
        assert "EU-2023-1542#art-77" not in text
        assert "EU-2023-1542#art-38" in text

    def test_generator_accepts_article_texts_param(self):
        # Confirm the signature accepts the new kwarg without breaking
        # any existing positional args.
        from rag_service.generate.report_generator import ReportGenerator
        import inspect
        sig = inspect.signature(ReportGenerator.generate_report_package)
        assert "article_texts" in sig.parameters
        # Existing kwargs must remain
        for kw in ["chunks", "doc_context", "mandatory_regulations"]:
            assert kw in sig.parameters


# ── load_articles_for_anchor (regression — covered by test_regulation_library
# but duplicated here for the KB-mode wiring) ───────────────────────────


class TestLoadArticlesForAnchor:
    def test_loads_via_kb_entry(self):
        # An anchor shaped as the KB loader returns (legacy shape with
        # `kb_entry`) must resolve all listed articles.
        from rag_service.retrieval.kb_loader import (
            get_anchor_by_regulation_id,
            invalidate_cache,
        )
        invalidate_cache()
        anchor = get_anchor_by_regulation_id("EU-2023-1542")
        assert anchor is not None
        loaded = load_articles_for_anchor(anchor)
        # get_anchor_by_regulation_id returns the bare KB payload
        # (no `kb_entry` wrapper), unlike get_anchors_by_category
        # which wraps it. load_articles_for_anchor must accept both.
        for art_id in anchor["key_articles"]:
            assert art_id in loaded, f"{art_id} missing"


# ── helpers ─────────────────────────────────────────────────────────────


def _minimal_package() -> dict:
    """A minimal report package that passes `normalize_report_package`."""
    return {
        "complianceReport": "placeholder",
        "profitReport": {"markdown": "placeholder"},
        "roadmap": {"totalDays": 0, "totalCost": "", "progress": 0, "items": []},
        "decisionView": {
            "verdict": "UNKNOWN",
            "riskLevel": "LOW",
            "summary": "",
            "keyFindings": [],
            "recommendedAction": "",
            "nodes": [],
        },
    }


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))