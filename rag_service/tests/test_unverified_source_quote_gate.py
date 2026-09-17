"""Red-team proof + regression for the J08 unverified-text loophole.

Hypothesis under attack: `quote_matcher`/`verifier` only match by
(doc_id, article_id) — they never read the regulation library's
``source_kind``. Therefore an LLM that quotes the *unverified summary* text
of e.g. EU-2009-48 verbatim gets ``match_status = "matched"`` — the page
then presents a curated summary as 已对照原文 (verbatim-checked official
text). That is exactly what the governance note in
data/regulations/eu/EU-2009-48.yaml forbids:

    source_kind: unverified — these are summaries, NOT verbatim official
    text; they must not enter the exact-quote flow or be labeled 已对照原文.

The fix (mirroring the note): when the article comes from an unverified
source, a verbatim quote hit is downgraded to ``fallback_article_only``
(article located, not verbatim-verified against official text).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

from rag_service.retrieval import article_loader  # noqa: E402
from rag_service.verify import quote_matcher  # noqa: E402


VERIFIED_KINDS = {"official_verbatim", "official_summary", "curated_summary"}
UNVERIFIED_KINDS = {"unverified", ""}


class TestUnverifiedTextCannotMatchVerbatim:
    def test_unverified_article_verbatim_quote_is_downgraded(self, tmp_path, monkeypatch):
        # Library with one regulation marked source_kind: unverified.
        reg_dir = tmp_path / "eu"
        reg_dir.mkdir()
        (reg_dir / "UNV-1.yaml").write_text(
            "id: UNV-1\n"
            "official_citation: Test\n"
            "license: public\n"
            "last_verified: '2026-09-14'\n"
            "language: en\n"
            "source_kind: unverified\n"
            "articles:\n"
            "- id: art-1\n"
            "  title: T\n"
            "  text: 这是未经验证的摘要文本，不是官方原文。\n"
            "raw_file: null\n"
            "checksum_sha256: null\n"
            "schema_version: 1\n"
            "source_url: https://example.com/x\n"
            "notes: test fixture\n",
            encoding="utf-8",
        )
        monkeypatch.setattr(article_loader, "_regulations_root", tmp_path)
        article_loader.invalidate_cache()

        # The LLM "quotes" the unverified summary verbatim.
        citations = [
            {
                "doc_id": "UNV-1",
                "article_id": "art-1",
                "quote": "这是未经验证的摘要文本，不是官方原文。",
            }
        ]
        quote_matcher.match_citations(citations)
        # MUST NOT be matched — the source is unverified, so a verbatim hit
        # against the summary is article-location only.
        assert citations[0]["match_status"] == "fallback_article_only"
        assert citations[0]["quote_span"] is None

        monkeypatch.setattr(
            article_loader, "_regulations_root", article_loader._DEFAULT_REGULATIONS_ROOT
        )
        article_loader.invalidate_cache()

    def test_verified_article_verbatim_quote_still_matches(self, tmp_path, monkeypatch):
        # The same quote flow over an official_verbatim source must keep
        # producing matched + a span — the downgrade is scoped to
        # unverified sources only, not a blanket ban.
        reg_dir = tmp_path / "eu"
        reg_dir.mkdir()
        (reg_dir / "VER-1.yaml").write_text(
            "id: VER-1\n"
            "official_citation: Test\n"
            "license: public\n"
            "last_verified: '2026-09-14'\n"
            "language: en\n"
            "source_kind: official_verbatim\n"
            "articles:\n"
            "- id: art-1\n"
            "  title: T\n"
            "  text: The manufacturer shall affix CE marking.\n"
            "raw_file: null\n"
            "checksum_sha256: null\n"
            "schema_version: 1\n"
            "source_url: https://example.com/x\n"
            "notes: test fixture\n",
            encoding="utf-8",
        )
        monkeypatch.setattr(article_loader, "_regulations_root", tmp_path)
        article_loader.invalidate_cache()

        citations = [
            {
                "doc_id": "VER-1",
                "article_id": "art-1",
                "quote": "shall affix CE marking",
            }
        ]
        quote_matcher.match_citations(citations)
        assert citations[0]["match_status"] == "matched"
        assert citations[0]["quote_span"] is not None

        monkeypatch.setattr(
            article_loader, "_regulations_root", article_loader._DEFAULT_REGULATIONS_ROOT
        )
        article_loader.invalidate_cache()

    def test_missing_source_kind_is_treated_as_unverified(self, tmp_path, monkeypatch):
        # Legacy YAML files predate source_kind; absent metadata cannot be
        # trusted as official — treat as unverified (safe default).
        reg_dir = tmp_path / "eu"
        reg_dir.mkdir()
        (reg_dir / "LEG-1.yaml").write_text(
            "id: LEG-1\n"
            "official_citation: Test\n"
            "license: public\n"
            "last_verified: '2026-09-01'\n"
            "language: en\n"
            "articles:\n"
            "- id: art-1\n"
            "  title: T\n"
            "  text: legacy text without source kind\n"
            "raw_file: null\n"
            "checksum_sha256: null\n"
            "schema_version: 1\n"
            "source_url: https://example.com/x\n"
            "notes: test fixture\n",
            encoding="utf-8",
        )
        monkeypatch.setattr(article_loader, "_regulations_root", tmp_path)
        article_loader.invalidate_cache()

        citations = [
            {
                "doc_id": "LEG-1",
                "article_id": "art-1",
                "quote": "legacy text without source kind",
            }
        ]
        quote_matcher.match_citations(citations)
        assert citations[0]["match_status"] == "fallback_article_only"

        monkeypatch.setattr(
            article_loader, "_regulations_root", article_loader._DEFAULT_REGULATIONS_ROOT
        )
        article_loader.invalidate_cache()

    def test_real_eu_2009_48_library_entry_cannot_match_verbatim(self):
        # The actual governance-pass file: EU-2009-48 is source_kind:
        # unverified. Quoting its art-10 summary verbatim must be
        # fallback_article_only, never matched.
        article_loader.invalidate_cache()
        text = article_loader.load_article_text("EU-2009-48", "art-10")
        assert text, "fixture missing — EU-2009-48 art-10 should exist"
        citations = [
            {"doc_id": "EU-2009-48", "article_id": "art-10", "quote": text[:80]}
        ]
        quote_matcher.match_citations(citations)
        assert citations[0]["match_status"] == "fallback_article_only"


class TestArticleLoaderSourceKind:
    def test_load_source_kind_for_regulation(self):
        # The loader exposes the governance metadata the matcher needs.
        assert hasattr(article_loader, "load_source_kind")

    def test_source_kind_values_in_library(self):
        article_loader.invalidate_cache()
        kinds = {
            reg_id: article_loader.load_source_kind(reg_id)
            for reg_id in article_loader.list_regulation_ids()
        }
        # Every value must be a known kind or empty (legacy default).
        for reg_id, kind in kinds.items():
            assert kind in {"official_verbatim", "official_summary", "curated_summary", "unverified", ""}, (
                f"{reg_id} carries unknown source_kind {kind!r}"
            )
        # The governance pass specifically marked these EU files unverified.
        for reg_id in ("EU-2009-48", "EU-2011-65", "EU-1907-2006"):
            if reg_id in kinds:
                assert kinds[reg_id] == "unverified"
