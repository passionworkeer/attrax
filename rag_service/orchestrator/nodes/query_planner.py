#!/usr/bin/env python3
"""
query_planner.py - Query planning node

Handles:
1. Smart query expansion based on confirmed product type
2. Multi-market decomposition
3. Must-check regulation preloading
"""
from rag_service.orchestrator.state import GraphState
from rag_service.retrieval.must_check import get_must_check_regulations

# Only expand to related products if product type is CONFIRMED as the primary product.
# This prevents false associations like "earphone with charging case" → "power bank".
SYNTACTIC_KEYWORDS = {
    "充电宝": ["移动电源", "power bank", "便携式充电器"],
    "加湿器": ["超声波加湿器", "humidifier", "mist maker"],
    "电池": ["电池组", "battery pack", "锂电池", "lithium battery"],
    "玩具": ["儿童玩具", "玩具产品", "toy", "儿童产品"],
    "化妆品": ["美妆", "cosmetic", "护肤品", "beauty product"],
}

# Product types that should NOT be expanded to certain synonyms
# e.g., "耳机" should NOT expand to power bank related terms
EXCLUDED_EXPANSION = {
    "充电宝": {"exclude": ["电池", "锂电池", "电池组"]},  # only expand within power bank family
}

# Category aliases that indicate a specific product type
PRODUCT_TYPE_SIGNALS = {
    "耳机": ["耳机", "earphone", "headphone", "earbuds", "蓝牙耳机", "有线耳机", "audio", "音频"],
    "蓝牙音箱": ["蓝牙音箱", "speaker", "音箱", "无线音箱"],
    "充电器": ["充电器", "charger", "充电头", "适配器", "adapter"],
    "充电宝": ["充电宝", "移动电源", "power bank", "便携充电器"],
    "加湿器": ["加湿器", "humidifier"],
    "玩具": ["玩具", "toy", "儿童玩具"],
    "家电": ["家电", "appliance", "家用电器"],
}


def _detect_product_type(query: str) -> str | None:
    """Detect product type from query text."""
    query_lower = query.lower()
    for ptype, signals in PRODUCT_TYPE_SIGNALS.items():
        for sig in signals:
            if sig in query_lower:
                return ptype
    return None


def _smart_expand(query: str, product_type: str | None = None) -> str:
    """
    Expand query with related terms only when product type is confirmed.
    Prevents false expansion: earphone → power bank associations.
    """
    if not product_type:
        # No confirmed type — do minimal expansion, only add cert terms
        return query

    # Only expand if product type is in our synonym map
    if product_type not in SYNTACTIC_KEYWORDS:
        return query

    expanded = query
    excluded = EXCLUDED_EXPANSION.get(product_type, {}).get("exclude", [])

    synonyms = SYNTACTIC_KEYWORDS.get(product_type, [])
    for syn in synonyms:
        # Skip excluded terms
        if any(ex in syn for ex in excluded):
            continue
        if syn not in expanded:
            expanded += f" {syn}"

    return expanded


def expand_synonyms(query: str) -> str:
    """Legacy expand — now delegates to smart expand."""
    product_type = _detect_product_type(query)
    return _smart_expand(query, product_type)


def decompose_markets(query: str, markets: list[str], product_type: str | None = None) -> list[dict]:
    """Decompose query per market with smart expansion."""
    expanded = _smart_expand(query, product_type)
    return [
        {"market": market, "query": expanded, "product_type": product_type}
        for market in markets
    ]


def query_planner_node(state: GraphState) -> dict:
    """Plan sub-queries for each market with smart expansion."""
    query = state["query"]
    markets = state.get("markets", ["EU"])
    category = state.get("category", "")

    # Try to detect product type from query or vision result
    product_type = _detect_product_type(query)
    if not product_type:
        vision_result = state.get("vision_result", {})
        if vision_result:
            # Use structured product_type from vision analysis
            product_type = vision_result.get("product_type", "")

    sub_queries = decompose_markets(query, markets, product_type)

    # Preload must-check regulations for confirmed category
    must_checks = get_must_check_regulations(category) if category else []

    trace_entry = {
        "node": "query_planner",
        "sub_queries_count": len(sub_queries),
        "must_check_count": len(must_checks),
        "product_type": product_type or "unknown",
    }

    return {
        "sub_queries": sub_queries,
        "agent_trace": [trace_entry],
    }
