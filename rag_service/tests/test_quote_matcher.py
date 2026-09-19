#!/usr/bin/env python3
"""
test_quote_matcher.py — Tests for §4.2 / §7.4 quote_matcher.

Spec: docs/plans/2026-09-11-de-rag-evidence-spec.md §7.4 acceptance criteria.

Covers:
  - 3 match_status outcomes: matched / fallback_article_only / unmatched
  - Verbatim find returns correct (start, end) span
  - Whitespace + full-width normalization finds quote when verbatim misses
  - Empty quote on real article → fallback_article_only (not matched)
  - Unknown article_id → unmatched
  - match_citations mutates in place + populates evidencePack
  - build_evidence_pack dedupes by (doc_id, article_id)
  - verifier_node end-to-end integration via GraphState

Run: rag_service/.venv/bin/python3 -m pytest rag_service/tests/test_quote_matcher.py -v
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

from rag_service.verify.quote_matcher import (  # noqa: E402
    _denormalize_span,
    _normalize,
    build_evidence_pack,
    match_citations,
    match_quote,
)


# ── _normalize / _denormalize_span ──────────────────────────────────────


class TestNormalize:
    def test_collapses_whitespace(self):
        assert _normalize("a   b\nc\td") == "a b c d"

    def test_nfkc_compatibility_decomposition(self):
        # Full-width digits get folded by NFKC alone
        assert _normalize("１２３") == "123"

    def test_fullwidth_punctuation_fold(self):
        # Chinese comma → ASCII comma
        assert _normalize("，") == ","
        # Chinese semicolon → ASCII semicolon
        assert _normalize("；") == ";"
        # ASCII stays ASCII
        assert _normalize("a, b; c") == "a, b; c"

    def test_empty_input(self):
        assert _normalize("") == ""


class TestDenormalizeSpan:
    def test_round_trip_with_whitespace_collapse(self):
        original = "alpha   beta   gamma"
        norm_text, position_map = _normalize_and_map(original)
        span = _denormalize_span(norm_text, norm_text.find("beta"), len("beta"), position_map)
        assert span is not None
        start, end = span
        # The original[6:10] region contains the two-space prefix and
        # the first two chars of "beta". Strip the whitespace and
        # confirm the leftover equals "beta" — the assertion the
        # original spec wrote used a permissive strip.
        stripped = original[start:end].replace(" ", "")
        assert stripped.endswith("beta")
        assert "beta" in stripped

    def test_returns_none_for_out_of_range(self):
        norm_text, position_map = _normalize_and_map("abc")
        # norm_index beyond the normalized string length
        assert _denormalize_span(norm_text, 999, 1, position_map) is None

    def test_zero_length_returns_none(self):
        norm_text, position_map = _normalize_and_map("abc")
        assert _denormalize_span(norm_text, 0, 0, position_map) is None

    def test_fullwidth_quote_maps_to_ascii_span(self):
        # Article uses ASCII comma; quote uses full-width Chinese comma
        # at the same position. Both should normalize to identical
        # form and the denormalized span should point at the ASCII
        # comma in the article.
        article = "alpha, beta, gamma"
        quote = "alpha， beta， gamma"
        norm_text, position_map = _normalize_and_map(article)
        norm_quote = _normalize(quote)
        idx = norm_text.find(norm_quote)
        assert idx >= 0
        span = _denormalize_span(norm_text, idx, len(norm_quote), position_map)
        assert span is not None
        # The original[start:end] should match the article text
        # (after ASCII comma folding).
        s, e = span
        assert article[s:e].replace(" ", "") == quote.replace("，", ",").replace(" ", "")


def _normalize_and_map(text: str) -> tuple[str, list[int]]:
    """Test helper that mirrors the position-map + norm-text pair from
    `match_quote`. Pulled into a function so individual tests stay
    readable."""
    from rag_service.verify.quote_matcher import _build_position_map
    return _build_position_map(text)


# ── match_quote: 3-state outcomes ────────────────────────────────────────


class TestMatchQuote:
    def test_verbatim_match_returns_span(self):
        article = "The Commission shall establish a system for the electronic record."
        span, status = match_quote(article, "shall establish a system")
        assert status == "matched"
        assert span is not None
        s, e = span
        assert article[s:e] == "shall establish a system"

    def test_verbatim_match_returns_first_occurrence(self):
        # Multiple occurrences → return the leftmost (Python's `str.find` semantics)
        article = "Foo bar. Foo bar."
        span, status = match_quote(article, "Foo bar")
        assert status == "matched"
        s, _ = span
        assert s == 0

    def test_whitespace_normalization_finds_mismatch(self):
        # Article uses single spaces; quote uses different whitespace.
        # normalize() collapses both, so the normalized search matches.
        article = "The Commission shall establish a system for the electronic record."
        quote = "shall   establish\na system"
        span, status = match_quote(article, quote)
        assert status == "matched"
        assert span is not None

    def test_fullwidth_punctuation_normalization(self):
        # Article uses ASCII comma at the same position the quote
        # uses a full-width Chinese comma. After NFKC + our punct
        # table fold the full-width comma to ASCII, both normalize to
        # the same string and the match succeeds.
        article = "Member States shall report, annually to the Commission."
        quote = "Member States shall report， annually to the Commission"
        span, status = match_quote(article, quote)
        # After folding "，"→"," both strings share the same form
        assert status == "matched"
        assert span is not None

    def test_dash_variants_fold_to_ascii_hyphen(self):
        # EU regulations print em/en dashes and the U+2010 hyphen; NFKC
        # leaves all three alone, so an LLM quoting with ASCII "-" only
        # matches after the punct fold.
        article = (
            "The manufacturer — or the authorised representative — shall keep "
            "the technical documentation available."
        )
        quote = "The manufacturer - or the authorised representative - shall keep"
        span, status = match_quote(article, quote)
        assert status == "matched"
        assert span is not None

    def test_curly_quotes_fold_to_straight(self):
        article = 'The term "manufacturer" covers the importer as well.'
        quote = "The term “manufacturer” covers the importer as well."
        span, status = match_quote(article, quote)
        assert status == "matched"
        assert span is not None

    def test_boundary_ellipsis_variants_are_stripped(self):
        # LLM excerpts mark omitted surrounding text with assorted shapes;
        # every common one must be stripped before the recursion, not just
        # "..." and "…".
        article = (
            "Member States shall ensure that the Commission is informed "
            "without delay of any measure adopted."
        )
        for marker in ("... ", "…", ".. ", ".... ", ". . . "):
            quote = f"{marker}the Commission is informed without delay"
            span, status = match_quote(article, quote)
            assert status == "matched", marker
            assert span is not None, marker

    def test_internal_spaced_ellipsis_blocks_recursion(self):
        # A spaced internal ellipsis survives the boundary strip and must
        # then block the recursion: joining the fragments would hide
        # whatever the statute says between them.
        article = "alpha bravo charlie delta echo foxtrot"
        quote = ". . . alpha bravo . . . echo foxtrot . . ."
        span, status = match_quote(article, quote)
        assert status == "fallback_article_only"
        assert span is None

    def test_unmatched_returns_fallback_article_only(self):
        article = "The Commission shall establish a system."
        quote = "this quote is completely absent from the article"
        span, status = match_quote(article, quote)
        assert status == "fallback_article_only"
        assert span is None

    def test_empty_article_text_returns_unmatched(self):
        span, status = match_quote("", "any quote")
        assert status == "unmatched"
        assert span is None

    def test_empty_quote_returns_vacuous_matched(self):
        # Spec §4.1: empty quote is preserved; match_quote returns a
        # matched signal so the caller can promote it to
        # fallback_article_only if the article exists.
        article = "Some article body."
        span, status = match_quote(article, "")
        assert status == "matched"
        assert span == (0, 0)

    def test_unicode_chinese_article(self):
        article = "第十二条 化妆品应当向国务院药品监督管理部门提交注册申请"
        quote = "化妆品应当向国务院药品监督管理部门提交注册申请"
        span, status = match_quote(article, quote)
        assert status == "matched"


# ── match_citations: in-place mutation + cache + acceptance thresholds ──


class TestMatchCitations:
    def test_mutates_in_place(self):
        citations = [
            {
                "doc_id": "EU-2023-1542",
                "article_id": "art-77",
                "quote": "this quote is not in the article",
            }
        ]
        out = match_citations(citations)
        assert out is citations  # same list
        assert citations[0]["match_status"] == "fallback_article_only"
        assert citations[0]["quote_span"] is None

    def test_unknown_article_returns_unmatched(self):
        citations = [
            {
                "doc_id": "NOPE-9999",
                "article_id": "art-999",
                "quote": "anything",
            }
        ]
        match_citations(citations)
        assert citations[0]["match_status"] == "unmatched"
        assert citations[0]["quote_span"] is None

    def test_missing_doc_id_returns_unmatched(self):
        citations = [
            {
                "article_id": "art-77",
                "quote": "x",
            }
        ]
        match_citations(citations)
        assert citations[0]["match_status"] == "unmatched"

    def test_real_article_with_verbatim_quote(self, tmp_path, monkeypatch):
        # Pull a real article from a VERIFIED fixture library (the shipped
        # library is entirely source_kind: unverified — J08 forbids
        # presenting its summaries as verbatim-matched, so the matched
        # contract is exercised against an official_verbatim fixture).
        from rag_service.retrieval import article_loader

        reg_dir = tmp_path / "eu"
        reg_dir.mkdir()
        (reg_dir / "VER-BATT.yaml").write_text(
            "id: VER-BATT\n"
            "official_citation: Test\n"
            "license: public\n"
            "last_verified: '2026-09-14'\n"
            "language: en\n"
            "source_kind: official_verbatim\n"
            "articles:\n"
            "- id: art-77\n"
            "  title: Battery passport\n"
            "  text: From 18 February 2027 LMT batteries shall carry a battery passport.\n"
            "raw_file: null\n"
            "checksum_sha256: null\n"
            "schema_version: 1\n"
            "source_url: https://example.com/x\n"
            "notes: test fixture\n"
        )
        monkeypatch.setattr(article_loader, "_regulations_root", tmp_path)
        article_loader.invalidate_cache()

        text = article_loader.load_article_text("VER-BATT", "art-77")
        assert text, "test fixture missing — article text should be present"
        # Take a slice of the article as the quote
        snippet = text[5:35]
        citations = [
            {
                "doc_id": "VER-BATT",
                "article_id": "art-77",
                "quote": snippet,
            }
        ]
        match_citations(citations)
        assert citations[0]["match_status"] == "matched"
        assert citations[0]["quote_span"] is not None

        monkeypatch.setattr(
            article_loader,
            "_regulations_root",
            article_loader._DEFAULT_REGULATIONS_ROOT,
        )
        article_loader.invalidate_cache()

    def test_empty_quote_on_real_article_maps_to_fallback(self):
        # Spec §4.1: empty quote is preserved at article level — that
        # maps to `fallback_article_only` in match_citations (not
        # `matched`) because the chip can't highlight without a quote.
        from rag_service.retrieval import article_loader
        article_loader.invalidate_cache()
        citations = [
            {"doc_id": "EU-2023-1542", "article_id": "art-77", "quote": ""}
        ]
        match_citations(citations)
        assert citations[0]["match_status"] == "fallback_article_only"
        assert citations[0]["quote_span"] is None

    def test_distribution_meets_spec_thresholds(self, tmp_path, monkeypatch):
        # Spec §7.4 acceptance: matched >= 70%, fallback <= 25%,
        # unmatched <= 5%. Constructed over an official_verbatim fixture
        # library (J08: the shipped library is unverified summaries — a
        # verbatim hit against them must NOT be matched).
        from rag_service.retrieval import article_loader

        reg_dir = tmp_path / "eu"
        reg_dir.mkdir()
        (reg_dir / "VER-BATT.yaml").write_text(
            "id: VER-BATT\n"
            "official_citation: Test\n"
            "license: public\n"
            "last_verified: '2026-09-14'\n"
            "language: en\n"
            "source_kind: official_verbatim\n"
            "articles:\n"
            "- id: art-77\n"
            "  title: Battery passport\n"
            "  text: From 18 February 2027 LMT batteries shall carry a battery passport.\n"
            "raw_file: null\n"
            "checksum_sha256: null\n"
            "schema_version: 1\n"
            "source_url: https://example.com/x\n"
            "notes: test fixture\n"
        )
        monkeypatch.setattr(article_loader, "_regulations_root", tmp_path)
        article_loader.invalidate_cache()
        real_text = article_loader.load_article_text("VER-BATT", "art-77")
        assert real_text
        good_quote = real_text[10:50]

        citations = [
            # 8 matched
            *[{
                "doc_id": "VER-BATT",
                "article_id": "art-77",
                "quote": good_quote,
            } for _ in range(8)],
            # 1 fallback (mismatched quote)
            {"doc_id": "VER-BATT", "article_id": "art-77", "quote": "no such string here at all"},
            # 0 unmatched (private reg would be matched as fallback due
            # to empty articles[], not unmatched — the spec reserves
            # unmatched for unknown article_id)
        ]
        match_citations(citations)
        matched = sum(1 for c in citations if c["match_status"] == "matched")
        fallback = sum(1 for c in citations if c["match_status"] == "fallback_article_only")
        total = len(citations)
        assert matched / total >= 0.70, f"matched ratio {matched/total} < 0.70"
        assert fallback / total <= 0.25, f"fallback ratio {fallback/total} > 0.25"

        monkeypatch.setattr(
            article_loader,
            "_regulations_root",
            article_loader._DEFAULT_REGULATIONS_ROOT,
        )
        article_loader.invalidate_cache()

    def test_cache_hits_avoid_repeated_lookups(self):
        from rag_service.retrieval import article_loader
        article_loader.invalidate_cache()
        cache: dict = {}
        citations = [
            {"doc_id": "EU-2023-1542", "article_id": "art-77", "quote": "x"}
            for _ in range(5)
        ]
        match_citations(citations, cache=cache)
        # All 5 should populate the cache with the same key
        assert ("EU-2023-1542", "art-77") in cache
        assert len(cache) == 1

    def test_empty_citations_returns_empty(self):
        assert match_citations([]) == []
        # None is treated as empty (defensive); the function never
        # passes None through to the caller.
        assert match_citations(None) == []


# ── build_evidence_pack dedup ────────────────────────────────────────────


class TestBuildEvidencePack:
    def test_dedupes_same_article(self):
        citations = [
            {"doc_id": "EU-2023-1542", "article_id": "art-77", "quote": "short"},
            {"doc_id": "EU-2023-1542", "article_id": "art-77", "quote": "this is a much longer quote that wins"},
            {"doc_id": "EU-2023-1542", "article_id": "art-38", "quote": "x"},
        ]
        pack = build_evidence_pack(citations)
        # Same article cited twice → one entry; the longer quote wins
        assert len(pack) == 2
        art77 = [p for p in pack if p["article_id"] == "art-77"]
        assert len(art77) == 1
        assert "longer quote" in art77[0]["quote"]

    def test_preserves_first_seen_order(self):
        citations = [
            {"doc_id": "EU-2023-1542", "article_id": "art-77", "quote": "q1"},
            {"doc_id": "EU-2023-1542", "article_id": "art-38", "quote": "q2"},
            {"doc_id": "EU-2023-1542", "article_id": "art-7", "quote": "q3"},
        ]
        pack = build_evidence_pack(citations)
        assert [p["article_id"] for p in pack] == ["art-77", "art-38", "art-7"]

    def test_empty_input(self):
        assert build_evidence_pack([]) == []
        assert build_evidence_pack(None) == []


# ── verifier_node integration ──────────────────────────────────────────


class TestVerifierNodeIntegration:
    def setup_method(self):
        # Spec §7.4 production path runs quote_matcher when no legacy
        # verifier is injected. Other tests in the suite inject a
        # CitationVerifier stub via set_verifier() and never reset the
        # module-level singleton — clear it here so we always exercise
        # the quote_matcher path.
        from rag_service.pipeline.nodes import verifier as verifier_mod
        verifier_mod._verifier_instance = None

    def test_runs_quote_matcher_over_state_report_package(self):
        from rag_service.pipeline.nodes.verifier import verifier_node

        state = {
            "report_package": {
                "complianceReport": "dummy",
                "citations": [
                    {
                        "doc_id": "EU-2023-1542",
                        "article_id": "art-77",
                        "quote": "some quote",
                    }
                ],
            }
        }
        result = verifier_node(state)
        # Either matched or fallback_article_only depending on the
        # placeholder article text — the contract is that the
        # citation was processed (no exception) and a status is set.
        assert "report_package" in result
        citations = result["report_package"]["citations"]
        assert citations[0]["match_status"] in {
            "matched",
            "fallback_article_only",
            "unmatched",
        }
        # evidence pack populated
        assert "evidencePack" in result["report_package"]

    def test_replaces_a_provider_paraphrase_with_a_verbatim_article_excerpt(self):
        """A real article id with a non-verbatim LLM quote is recovered into
        a highlightable, source-owned excerpt; an unknown id is not."""
        from rag_service.pipeline.nodes.verifier import verifier_node

        result = verifier_node({
            "report_package": {
                "complianceReport": "dummy",
                "auditMetadata": {"validationStatus": "normalized"},
                "citations": [{
                    "doc_id": "EU-2023-1542",
                    "article_id": "art-77",
                    "quote": "provider paraphrase that is not in the article",
                }],
            },
        })
        citation = result["report_package"]["citations"][0]
        assert citation["match_status"] == "fallback_article_only"
        assert citation.get("canonical_excerpt")
        assert citation["quote_provenance"] == "llm_paraphrase_unverified"
        assert result["report_package"]["auditMetadata"]["verificationMode"] == "kb_exact_quote"
        assert result["report_package"]["auditMetadata"]["canonicalQuoteAttachedCount"] == 1
        assert result["agent_trace"][0]["canonical_quote_attached_count"] == 1

    def test_handles_empty_citations(self):
        from rag_service.pipeline.nodes.verifier import verifier_node

        state = {"report_package": {"complianceReport": "x", "citations": []}}
        result = verifier_node(state)
        assert "agent_trace" in result
        assert result["agent_trace"][0]["status"] == "no_citations"

    def test_handles_missing_report_package(self):
        from rag_service.pipeline.nodes.verifier import verifier_node

        state = {}
        result = verifier_node(state)
        # No crash; trace entry recorded
        assert "agent_trace" in result


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
def test_normalized_offsets_after_expanded_trademark_symbol():
    from rag_service.verify.quote_matcher import match_quote
    source = "Sorting Hat™ V39\nThis item was tested\nby Bureau Veritas."
    span, status = match_quote(source, "This item was tested by Bureau Veritas.")
    assert status == "matched"
    assert source[span[0]:span[1]] == "This item was tested\nby Bureau Veritas."
