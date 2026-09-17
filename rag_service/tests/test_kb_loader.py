#!/usr/bin/env python3
"""
test_kb_loader.py - Unit tests for the YAML-backed KB loader (De-RAG spec §7.1).

Covers:
- 44 YAML files exist and parse cleanly
- All must_check.py anchors are represented (no data loss in §7.1 migration)
- get_anchors_by_category / get_anchors_by_feature / get_anchor_by_regulation_id
  return expected shapes
- Every entry has the required schema fields + schema_validator-compatible license
  semantics (spec §6.4, future-proofing)
- ALWAYS_INCLUDE_REGIONS is exactly {"UN"}
- Cache invalidation works (dev / test reload path)

Run: rag_service/.venv/bin/python3 -m pytest rag_service/tests/test_kb_loader.py -v
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import yaml
from pathlib import Path

from rag_service.retrieval import kb_loader
from rag_service.retrieval.kb_loader import (
    ALWAYS_INCLUDE_REGIONS,
    get_anchor_by_regulation_id,
    get_anchors_by_category,
    get_anchors_by_feature,
    invalidate_cache,
    list_all_regulations,
)


ANCHORS_DIR = kb_loader.get_anchors_dir()


def _all_yaml_paths() -> list[Path]:
    return sorted(ANCHORS_DIR.glob("*.yaml"))


class TestKbFileInventory:
    #: Floor, not an exact count. The library grows as markets are covered
    #: (44 → 58 on 2026-09-17 when CA/NZ/JP/KR/AE/SA/BR/IN got their first
    #: regulations); shrinking below the floor means something was deleted
    #: by accident.
    MIN_ANCHORS = 44

    def test_anchor_count_meets_the_baseline(self):
        paths = _all_yaml_paths()
        assert len(paths) >= self.MIN_ANCHORS, (
            f"expected at least {self.MIN_ANCHORS} YAML files, got {len(paths)}"
        )

    def test_anchor_count_matches_the_regulation_library(self):
        """Anchors and regulations are 1:1 — an anchor with no regulation
        behind it (or vice versa) means the two trees drifted apart."""
        from rag_service.retrieval.kb_loader import list_all_regulations
        from rag_service.retrieval.article_loader import list_regulation_ids

        anchored = set(list_all_regulations())
        regulated = set(list_regulation_ids())
        assert anchored == regulated, (
            f"anchor-only: {sorted(anchored - regulated)}; "
            f"regulation-only: {sorted(regulated - anchored)}"
        )

    def test_every_yaml_parses(self):
        for path in _all_yaml_paths():
            data = yaml.safe_load(path.read_text(encoding="utf-8"))
            assert isinstance(data, dict), f"{path.name}: not a dict"

    def test_filename_uniqueness(self):
        names = [p.name for p in _all_yaml_paths()]
        assert len(names) == len(set(names)), "duplicate filenames detected"


class TestKbSchema:
    REQUIRED = {
        "id", "regulation_id", "doc_name", "official_citation",
        "applies_if", "key_articles", "key_points", "license",
        "last_verified", "verified_by", "verification_status", "schema_version",
    }

    def test_required_fields_present(self):
        for path in _all_yaml_paths():
            data = yaml.safe_load(path.read_text(encoding="utf-8"))
            missing = self.REQUIRED - data.keys()
            assert not missing, f"{path.name}: missing fields {missing}"

    def test_schema_version_is_1(self):
        for path in _all_yaml_paths():
            data = yaml.safe_load(path.read_text(encoding="utf-8"))
            assert data["schema_version"] == 1, f"{path.name}: schema_version != 1"

    def test_license_is_valid_enum(self):
        valid = {"public", "private_with_summary"}
        for path in _all_yaml_paths():
            data = yaml.safe_load(path.read_text(encoding="utf-8"))
            assert data["license"] in valid, (
                f"{path.name}: invalid license {data['license']!r}"
            )

    def test_public_license_has_source_url(self):
        for path in _all_yaml_paths():
            data = yaml.safe_load(path.read_text(encoding="utf-8"))
            if data["license"] == "public":
                assert data.get("source_url"), (
                    f"{path.name}: public license missing source_url"
                )

    def test_private_license_has_purchase_url(self):
        for path in _all_yaml_paths():
            data = yaml.safe_load(path.read_text(encoding="utf-8"))
            if data["license"] == "private_with_summary":
                assert data.get("purchase_url"), (
                    f"{path.name}: private license missing purchase_url"
                )

    def test_private_license_has_empty_key_articles(self):
        # Spec §6.4 schema_validator rule: private articles must be empty or
        # title-only (<200 chars). For our initial seed, key_articles is []
        # for all private entries.
        for path in _all_yaml_paths():
            data = yaml.safe_load(path.read_text(encoding="utf-8"))
            if data["license"] == "private_with_summary":
                assert not data["key_articles"], (
                    f"{path.name}: private license should not list key_articles "
                    f"(would imply verifiable citations)"
                )

    def test_applies_if_has_required_keys(self):
        for path in _all_yaml_paths():
            data = yaml.safe_load(path.read_text(encoding="utf-8"))
            applies = data["applies_if"]
            assert "markets" in applies, f"{path.name}: applies_if.markets missing"
            assert "category" in applies, f"{path.name}: applies_if.category missing"
            assert "features_any" in applies, f"{path.name}: applies_if.features_any missing"

    def test_markets_non_empty(self):
        for path in _all_yaml_paths():
            data = yaml.safe_load(path.read_text(encoding="utf-8"))
            assert data["applies_if"]["markets"], (
                f"{path.name}: applies_if.markets empty (every regulation must "
                f"specify a market or 'GLOBAL')"
            )


class TestKbCoverage:
    """Every must_check.py anchor must be represented in the YAML files."""

    def _must_check_keys(self) -> set[tuple[str, str]]:
        from rag_service.retrieval.must_check import CATEGORY_REGULATIONS, FEATURE_REGULATIONS
        keys: set[tuple[str, str]] = set()
        for entries in CATEGORY_REGULATIONS.values():
            for e in entries:
                region = str(e.get("region", "")).strip().upper()
                doc_name = str(e.get("doc_name", "")).strip()
                keys.add((region, doc_name))
        for entries in FEATURE_REGULATIONS.values():
            for e in entries:
                region = str(e.get("region", "")).strip().upper()
                doc_name = str(e.get("doc_name", "")).strip()
                keys.add((region, doc_name))
        return keys

    def _yaml_keys(self) -> set[tuple[str, str]]:
        keys: set[tuple[str, str]] = set()
        for path in _all_yaml_paths():
            data = yaml.safe_load(path.read_text(encoding="utf-8"))
            markets = data["applies_if"]["markets"]
            region = markets[0] if markets and markets[0] != "GLOBAL" else ""
            keys.add((region, data["doc_name"]))
        return keys

    def test_all_must_check_anchors_have_yaml(self):
        missing = self._must_check_keys() - self._yaml_keys()
        assert not missing, (
            f"{len(missing)} must_check anchors missing from YAML files:\n"
            + "\n".join(f"  - ({r!r}, {n!r})" for r, n in sorted(missing))
        )

    def test_yaml_count_matches_must_check_unique(self):
        """The two sources of truth agree on how many regulations exist."""
        assert len(self._yaml_keys()) == len(self._must_check_keys())


class TestKbLoaderApi:
    def test_always_include_regions_is_un_only(self):
        assert ALWAYS_INCLUDE_REGIONS == {"UN"}

    def test_list_all_regulations_meets_the_baseline(self):
        invalidate_cache()
        assert len(list_all_regulations()) >= 44

    def test_get_anchor_by_regulation_id_round_trip(self):
        invalidate_cache()
        all_ids = list_all_regulations()
        sample = all_ids[0]
        entry = get_anchor_by_regulation_id(sample)
        assert entry is not None
        assert entry["regulation_id"] == sample
        assert "applies_if" in entry
        assert "key_points" in entry

    def test_get_anchor_by_regulation_id_unknown_returns_none(self):
        invalidate_cache()
        assert get_anchor_by_regulation_id("NOPE-NOT-EXIST") is None

    def test_get_anchors_by_category_returns_legacy_shape(self):
        # The battery category carried 5 anchors when only the original
        # markets were covered; the 2026-09-17 expansion added battery rules
        # for JP / KR / AE / BR / IN. Assert the originals are still there and
        # the shape holds, rather than freezing the count.
        entries = get_anchors_by_category("battery")
        assert len(entries) >= 5
        names = {e["doc_name"] for e in entries}
        assert any("Battery" in name and "2023/1542" in name for name in names), names
        for e in entries:
            assert "doc_name" in e
            assert "region" in e
            assert "reason" in e
            assert "kb_entry" in e  # new KB payload

    def test_get_anchors_by_category_unknown_returns_empty(self):
        assert get_anchors_by_category("nonexistent_category") == []

    def test_get_anchors_by_feature_returns_legacy_shape(self):
        entries = get_anchors_by_feature("wireless")
        assert entries, "wireless feature should have anchors"
        for e in entries:
            assert "doc_name" in e
            assert "kb_entry" in e

    def test_get_anchors_by_feature_unknown_returns_empty(self):
        assert get_anchors_by_feature("unknown_feature") == []

    def test_category_and_feature_overlap(self):
        # Battery Reg 2023/1542 is triggered by both battery category and
        # battery feature (must_check.py original). Both queries must yield it.
        from_cat = {e["doc_name"] for e in get_anchors_by_category("battery")}
        from_feat = {e["doc_name"] for e in get_anchors_by_feature("battery")}
        assert "Battery Regulation (EU) 2023/1542" in from_cat
        assert "Battery Regulation (EU) 2023/1542" in from_feat

    def test_license_distribution_matches_spec(self):
        # Spec §6.2 fixed the original split at 33 public + 11
        # private_with_summary. The 2026-09-17 market expansion added public
        # regulations (CA/NZ/JP/KR/AE/SA/BR/IN), so the private count is the
        # stable half: every private standard is an authored summary that
        # must not silently disappear or get relabelled public.
        invalidate_cache()
        counts = {"public": 0, "private_with_summary": 0}
        for path in _all_yaml_paths():
            data = yaml.safe_load(path.read_text(encoding="utf-8"))
            counts[data["license"]] += 1
        assert counts["private_with_summary"] == 11
        assert counts["public"] >= 33
        assert counts["public"] + counts["private_with_summary"] == len(_all_yaml_paths())

    def test_invalidate_cache_clears_state(self):
        # Warm cache
        get_anchors_by_category("battery")
        assert kb_loader._cache is not None
        invalidate_cache()
        assert kb_loader._cache is None


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-v"]))
