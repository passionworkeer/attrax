"""Tests for query_planner node — product-type detection, smart expansion
with exclusion guards, multi-market decomposition, and the node entrypoint.

These behaviors were previously untested: the smart_expand exclusion logic
(earphone must NOT expand to power-bank terms) and the product-type fallback
to vision_result are easy to regress.
"""
from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rag_service.orchestrator.nodes.query_planner import (
    _detect_product_type,
    _smart_expand,
    expand_synonyms,
    decompose_markets,
    query_planner_node,
)


# ── _detect_product_type ─────────────────────────────────────────────────────

def test_detect_product_type_earphone_english():
    assert _detect_product_type("wireless earphone with charging case") == "耳机"


def test_detect_product_type_power_bank_chinese():
    assert _detect_product_type("这是一个充电宝") == "充电宝"


def test_detect_product_type_humidifier():
    assert _detect_product_type("USB humidifier product") == "加湿器"


def test_detect_product_type_unknown_returns_none():
    assert _detect_product_type("a generic widget with no signal") is None


def test_detect_product_type_case_insensitive():
    assert _detect_product_type("POWER BANK 10000mAh") == "充电宝"


# ── _smart_expand ────────────────────────────────────────────────────────────

def test_smart_expand_no_product_type_returns_unchanged():
    # No confirmed type -> minimal expansion (query returned as-is).
    assert _smart_expand("some generic query", None) == "some generic query"


def test_smart_expand_unknown_type_returns_unchanged():
    # Type detected but not in SYNTACTIC_KEYWORDS -> no synonyms added.
    assert _smart_expand("query", "未知产品") == "query"


def test_smart_expand_power_bank_adds_synonyms():
    out = _smart_expand("充电宝", "充电宝")
    # Synonyms for 充电宝: 移动电源, power bank, 便携式充电器
    assert "移动电源" in out
    assert "power bank" in out


def test_smart_expand_power_bank_excludes_battery_terms():
    """Critical: 充电宝 must NOT expand to 电池/锂电池/电池组 (EXCLUDED_EXPANSION).

    Without this guard, earphone-with-charging-case queries would pull in
    battery regulations and pollute retrieval.
    """
    out = _smart_expand("充电宝", "充电宝")
    assert "电池" not in out.split()
    assert "锂电池" not in out.split()
    assert "电池组" not in out.split()


def test_smart_expand_idempotent_does_not_duplicate():
    out = _smart_expand("充电宝 移动电源", "充电宝")
    # 移动电源 already present -> should not appear twice.
    assert out.count("移动电源") == 1


# ── expand_synonyms (legacy delegate) ────────────────────────────────────────

def test_expand_synonyms_delegates_to_smart_expand():
    assert expand_synonyms("充电宝") == _smart_expand("充电宝", "充电宝")


def test_expand_synonyms_unknown_query_unchanged():
    assert expand_synonyms("generic widget") == "generic widget"


# ── decompose_markets ────────────────────────────────────────────────────────

def test_decompose_markets_one_subquery_per_market():
    out = decompose_markets("充电宝", ["EU", "US", "CN"], "充电宝")
    assert len(out) == 3
    assert [s["market"] for s in out] == ["EU", "US", "CN"]
    # Each sub-query carries the expanded query + product type.
    for s in out:
        assert s["query"] == out[0]["query"]
        assert s["product_type"] == "充电宝"


def test_decompose_markets_no_product_type_passes_none():
    out = decompose_markets("widget", ["EU"], None)
    assert out[0]["product_type"] is None
    assert out[0]["query"] == "widget"


def test_decompose_markets_empty_markets_returns_empty():
    assert decompose_markets("query", [], "充电宝") == []


# ── query_planner_node (end-to-end) ──────────────────────────────────────────

def test_query_planner_node_detects_type_from_query():
    state = {"query": "充电宝产品", "markets": ["EU", "US"], "category": "electronics"}
    out = query_planner_node(state)
    assert len(out["sub_queries"]) == 2
    assert out["sub_queries"][0]["product_type"] == "充电宝"
    # Trace entry appended.
    trace = out["agent_trace"][-1]
    assert trace["node"] == "query_planner"
    assert trace["sub_queries_count"] == 2
    assert trace["product_type"] == "充电宝"


def test_query_planner_node_falls_back_to_vision_result():
    """When query has no signal, product_type comes from vision_result."""
    state = {
        "query": "generic product image",
        "markets": ["EU"],
        "category": "electronics",
        "vision_result": {"product_type": "加湿器"},
    }
    out = query_planner_node(state)
    assert out["sub_queries"][0]["product_type"] == "加湿器"


def test_query_planner_node_unknown_type_logs_unknown():
    state = {"query": "widget", "markets": ["EU"], "category": ""}
    out = query_planner_node(state)
    trace = out["agent_trace"][-1]
    assert trace["product_type"] == "unknown"


def test_query_planner_node_preloads_must_check_for_category():
    state = {"query": "充电宝", "markets": ["EU"], "category": "electronics"}
    out = query_planner_node(state)
    trace = out["agent_trace"][-1]
    # electronics has 9 must-check entries in CATEGORY_REGULATIONS.
    assert trace["must_check_count"] > 0


def test_query_planner_node_no_category_zero_must_checks():
    state = {"query": "widget", "markets": ["EU"], "category": ""}
    out = query_planner_node(state)
    assert out["agent_trace"][-1]["must_check_count"] == 0


def test_query_planner_node_default_market_when_missing():
    state = {"query": "充电宝", "category": "electronics"}
    out = query_planner_node(state)
    # markets defaults to ["EU"] when absent.
    assert len(out["sub_queries"]) == 1
    assert out["sub_queries"][0]["market"] == "EU"


def test_query_planner_node_preserves_existing_trace():
    existing = [{"node": "vision", "status": "success"}]
    state = {"query": "充电宝", "markets": ["EU"], "category": "electronics", "agent_trace": existing}
    out = query_planner_node(state)
    # Original trace entry preserved + new query_planner entry appended.
    assert out["agent_trace"][0] == existing[0]
    assert out["agent_trace"][-1]["node"] == "query_planner"
    assert len(out["agent_trace"]) == 2
