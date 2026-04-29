#!/usr/bin/env python3
"""
query_planner.py - Query planning node

Handles:
1. Synonym expansion (rule-based)
2. Multi-market decomposition (LLM or rule fallback)
3. Must-check regulation preloading
"""
from orchestrator.state import GraphState
from retrieval.must_check import get_must_check_regulations

SYNONYM_MAP = {
    "充电宝": ["移动电源", "power bank", "便携式充电器", "USB charger", "移动充电器"],
    "加湿器": ["超声波加湿器", "humidifier", "mist maker", "空气加湿器"],
    "电池": ["电池组", "battery pack", "锂电池", "lithium battery", "蓄电池"],
    "玩具": ["儿童玩具", "玩具产品", "toy", "儿童产品"],
    "化妆品": ["美妆", "cosmetic", "护肤品", "beauty product"],
    "CE": ["CE标志", "CE marking", "Conformité Européenne"],
    "FCC": ["FCC认证", "FCC certification", "美国联邦通信委员会"],
}


def expand_synonyms(query: str) -> str:
    """Expand query with synonyms."""
    expanded = query
    for keyword, synonyms in SYNONYM_MAP.items():
        if keyword in query:
            for syn in synonyms:
                if syn not in expanded:
                    expanded += f" {syn}"
    return expanded


def decompose_markets(query: str, markets: list[str]) -> list[dict]:
    """Decompose query per market."""
    sub_queries = []
    for market in markets:
        expanded = expand_synonyms(query)
        sub_queries.append({
            "market": market,
            "query": expanded,
        })
    return sub_queries


def query_planner_node(state: GraphState) -> dict:
    """Plan sub-queries for each market with synonym expansion."""
    query = state["query"]
    markets = state.get("markets", ["EU"])
    category = state.get("category", "")

    sub_queries = decompose_markets(query, markets)

    # Preload must-check regulations
    must_checks = get_must_check_regulations(category) if category else []

    trace_entry = {
        "node": "query_planner",
        "sub_queries_count": len(sub_queries),
        "must_check_count": len(must_checks),
    }

    return {
        "sub_queries": sub_queries,
        "agent_trace": state.get("agent_trace", []) + [trace_entry],
    }
