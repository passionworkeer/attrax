#!/usr/bin/env python3
"""
test_regulation_library.py — Tests for §7.2 deliverable.

Spec: docs/plans/2026-09-11-de-rag-evidence-spec.md §7.2 acceptance criteria.

Covers:
  1. retrieval/article_loader.py — load_regulation / load_article_text /
     load_articles_for_anchor
  2. data/regulations/ — library-wide invariants (44 KB anchors, license
     split, schema_version, regulations_index.json)

(Removed 2026-09-14 cleanup: parser/legal_parser.py tests + the
schema_validator subprocess/API tests, both targets removed in the
same sweep.)
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from rag_service.retrieval import article_loader  # noqa: E402


REPO = Path(__file__).resolve().parents[2]


# ── retrieval/article_loader.py ───────────────────────────────────────────


class TestArticleLoader:
    def test_list_regulation_ids_meets_the_baseline(self):
        # Floor, not an exact count: the library grew from 44 to 58 on
        # 2026-09-17 when CA/NZ/JP/KR/AE/SA/BR/IN got their first
        # regulations. Falling below the floor means something was dropped.
        ids = article_loader.list_regulation_ids()
        assert len(ids) >= 44

    def test_load_regulation_round_trip(self):
        reg = article_loader.load_regulation("EU-2011-65")
        assert reg is not None
        assert reg["id"] == "EU-2011-65"
        assert reg["license"] in {"public", "private_with_summary"}

    def test_load_regulation_unknown_returns_none(self):
        assert article_loader.load_regulation("DOES-NOT-EXIST") is None

    def test_load_article_text_returns_text(self):
        text = article_loader.load_article_text("EU-2011-65", "art-4")
        assert text is not None
        assert len(text) > 0

    def test_load_article_text_missing_returns_none(self):
        assert article_loader.load_article_text("EU-2011-65", "art-9999") is None

    def test_load_article_text_unknown_reg_returns_none(self):
        assert article_loader.load_article_text("DOES-NOT-EXIST", "art-1") is None

    def test_load_articles_for_anchor_returns_key_articles(self):
        # anchor shape: {"kb_entry": {"regulation_id": ..., "key_articles": [...]}}
        anchor = {
            "kb_entry": {
                "regulation_id": "EU-2011-65",
                "key_articles": ["art-4"],
            }
        }
        result = article_loader.load_articles_for_anchor(anchor)
        assert "art-4" in result
        assert len(result["art-4"]) > 0

    def test_load_articles_for_anchor_skips_unknown_articles(self):
        anchor = {
            "kb_entry": {
                "regulation_id": "EU-2011-65",
                "key_articles": ["art-4", "art-does-not-exist"],
            }
        }
        result = article_loader.load_articles_for_anchor(anchor)
        assert "art-4" in result
        assert "art-does-not-exist" not in result

    def test_load_articles_for_anchor_returns_empty_for_missing_key_articles(self):
        # No key_articles → empty result (caller falls back to key_points).
        anchor = {"kb_entry": {"regulation_id": "EU-2011-65", "key_articles": []}}
        assert article_loader.load_articles_for_anchor(anchor) == {}

    def test_load_articles_for_anchor_returns_empty_for_unknown_reg(self):
        anchor = {
            "kb_entry": {
                "regulation_id": "DOES-NOT-EXIST",
                "key_articles": ["art-1"],
            }
        }
        assert article_loader.load_articles_for_anchor(anchor) == {}

    def test_load_articles_for_anchor_accepts_bare_payload(self):
        # Bare payload (no kb_entry wrapper): same fields directly on the dict.
        anchor = {"regulation_id": "EU-2011-65", "key_articles": ["art-4"]}
        result = article_loader.load_articles_for_anchor(anchor)
        assert "art-4" in result


# ── library-wide invariants ──────────────────────────────────────────────


class TestLibraryInvariants:
    """Cross-cutting checks on the regulation library."""

    def test_library_contains_all_anchor_regulations(self):
        """Every KB anchor's regulation_id must be loadable from the library."""
        from rag_service.retrieval.kb_loader import list_all_regulations
        article_loader.invalidate_cache()
        kb_ids = set(list_all_regulations())
        lib_ids = set(article_loader.list_regulation_ids())
        missing = kb_ids - lib_ids
        assert not missing, f"KB regulations missing from library: {missing}"

    def test_license_split_matches_spec(self):
        """Spec §6.2 fixed the original split at 33 public + 11
        private_with_summary. The 2026-09-17 market expansion added public
        regulations, so the private count is the half that must not drift:
        each one is an authored summary of a paid standard."""
        article_loader.invalidate_cache()
        counts = {"public": 0, "private_with_summary": 0}
        for reg_id in article_loader.list_regulation_ids():
            reg = article_loader.load_regulation(reg_id)
            counts[reg["license"]] += 1
        assert counts["private_with_summary"] == 11
        assert counts["public"] >= 33

    def test_every_regulation_has_schema_version_1(self):
        for reg_id in article_loader.list_regulation_ids():
            reg = article_loader.load_regulation(reg_id)
            assert reg["schema_version"] == 1

    def test_regulations_index_matches_the_library(self):
        """The shipped index must describe the shipped YAML tree — a stale
        index is how the frontend ends up citing regulations that no longer
        exist."""
        index_path = REPO / "data" / "regulations" / "regulations_index.json"
        assert index_path.exists()
        data = json.loads(index_path.read_text())
        assert data["count"] == len(data["regulations"])
        assert data["count"] == len(article_loader.list_regulation_ids())


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-v"]))