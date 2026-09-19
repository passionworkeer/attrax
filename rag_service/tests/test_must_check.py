#!/usr/bin/env python3
"""
test_must_check.py - Unit tests for the must_check matrix (A+B hybrid core).

Covers the 2026-09-10 additions:
    - detect_features: keyword → feature matching (incl. CJK, precision cases)
    - get_feature_regulations: feature → regulation lookup
    - build_anchor_list: category+feature merge, dedup, market filter,
      UN-transport always-include rule
    - CATEGORY_REGULATIONS: every matrix entry carries the required fields

And the pre-existing retrieval-side injection (apply_must_check) which stays
as the corpus citation path.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rag_service.retrieval.must_check import (
    ALWAYS_INCLUDE_REGIONS,
    CATEGORY_REGULATIONS,
    FEATURE_KEYWORDS,
    FEATURE_REGULATIONS,
    build_anchor_list,
    detect_features,
    get_feature_regulations,
    get_must_check_regulations,
)


class TestDetectFeatures:
    def test_battery_keywords_zh(self):
        assert detect_features("入耳式蓝牙耳机；有线充电盒；锂电池供电") == ["battery", "wireless"]

    def test_battery_keywords_en(self):
        assert "battery" in detect_features("Bluetooth speaker with rechargeable li-ion cell")
        assert "wireless" in detect_features("Bluetooth speaker with rechargeable li-ion cell")

    def test_mains_adapter(self):
        assert detect_features("电源适配器供电，220V") == ["mains"]

    def test_children(self):
        assert detect_features("儿童早教玩具") == ["children"]

    def test_no_false_positive_from_category_words(self):
        # "玩具" alone is a category word, not a feature trigger
        assert detect_features("毛绒玩具") == []

    def test_empty_and_none_safe(self):
        assert detect_features() == []
        assert detect_features("", None, "") == []

    def test_case_insensitive(self):
        assert detect_features("WI-FI enabled") == ["wireless"]


class TestBuildAnchorList:
    def test_category_only_market_filtered(self):
        anchors = build_anchor_list("electronics", markets=["EU"])
        regions = {a["region"] for a in anchors}
        # 2026-09-19 全库接入后 GLOBAL（IEC/ISO 等国际标准）随 UN 一起 ALWAYS_INCLUDE
        assert "EU" in regions
        assert regions <= {"EU", "UN", "GLOBAL"}
        names = {a["doc_name"] for a in anchors}
        assert "RoHS Directive 2011/65/EU" in names

    def test_un_transport_always_included(self):
        anchors = build_anchor_list("battery", markets=["CN"])
        regions = {a["region"] for a in anchors}
        assert "UN" in regions  # UN 38.3 applies regardless of target market
        assert regions <= {"CN", "UN", "GLOBAL"}

    def test_feature_merge_and_dedup(self):
        # "3c" category already carries RED for EU; wireless feature also
        # carries RED for EU — must appear exactly once.
        anchors = build_anchor_list("3c", markets=["EU"], features=["wireless"])
        red_entries = [a for a in anchors if "RED" in a["doc_name"]]
        assert len(red_entries) == 1

    def test_feature_injects_regulation_missing_from_category(self):
        # toy category has no UN 38.3; a battery-powered toy must get it
        anchors = build_anchor_list("toy", markets=["US"], features=["battery"])
        names = {a["doc_name"] for a in anchors}
        assert "UN 38.3 Transport Testing" in names
        assert "CPSIA Children Product Safety" in names

    def test_source_field(self):
        anchors = build_anchor_list("toy", markets=["EU"], features=["battery"])
        sources = {a["source"] for a in anchors}
        # market = 市场级横切锚点（数据保护等领域），随目标市场注入
        assert sources <= {"category", "feature", "market"}
        assert "category" in sources

    def test_unknown_category_returns_feature_only(self):
        anchors = build_anchor_list("nonexistent", markets=["EU"], features=["wireless"])
        assert anchors, "feature anchors must survive an unknown category"
        sources = {a["source"] for a in anchors}
        assert sources <= {"feature", "market"}
        assert any(a["source"] == "feature" for a in anchors)

    def test_empty_markets_keeps_everything(self):
        anchors = build_anchor_list("electronics", markets=[])
        assert len(anchors) == len(get_must_check_regulations("electronics"))

    def test_no_mutation_of_module_matrices(self):
        before = len(get_must_check_regulations("electronics"))
        build_anchor_list("electronics", markets=["EU"], features=["battery", "wireless"])
        after = len(get_must_check_regulations("electronics"))
        assert before == after


class TestMatrixIntegrity:
    def test_every_category_entry_has_required_fields(self):
        for category, entries in CATEGORY_REGULATIONS.items():
            for e in entries:
                assert e.get("doc_name"), f"{category}: missing doc_name"
                assert e.get("region"), f"{category}: missing region"
                assert e.get("reason"), f"{category}: missing reason"

    def test_every_feature_entry_has_required_fields(self):
        for feature, entries in FEATURE_REGULATIONS.items():
            assert feature in FEATURE_KEYWORDS, f"feature {feature} has no keywords"
            for e in entries:
                assert e.get("doc_name"), f"{feature}: missing doc_name"
                assert e.get("region"), f"{feature}: missing region"
                assert e.get("reason"), f"{feature}: missing reason"

    def test_every_keyword_feature_has_matrix(self):
        for feature in FEATURE_KEYWORDS:
            assert feature in FEATURE_REGULATIONS, f"keywords for {feature} but no matrix"

    def test_frontend_category_alignment(self):
        # lib/types.ts ProductCategory (2026-09-10): these categories are
        # selectable in the UI and must have a matrix row (except "other").
        frontend = {"electronics", "appliance", "3c", "toy", "home",
                    "battery", "cosmetic", "textile", "food_contact"}
        missing = frontend - set(CATEGORY_REGULATIONS)
        assert not missing, f"frontend categories without matrix rows: {missing}"

    def test_always_include_regions_is_un_and_global(self):
        assert ALWAYS_INCLUDE_REGIONS == {"UN", "GLOBAL"}


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-v"]))
