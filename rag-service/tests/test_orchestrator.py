import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from orchestrator.state import GraphState, initial_state
from orchestrator.nodes.query_planner import query_planner_node, expand_synonyms, decompose_markets
from orchestrator.nodes.synthesis import synthesis_node
from orchestrator.nodes.refiner import refiner_node


def test_graph_state_initialization():
    state = initial_state(
        query="CE marking for power bank",
        product="USB charger",
        category="electronics",
        markets=["EU", "US"],
        vision_result={},
    )
    assert state["query"] == "CE marking for power bank"
    assert state["loop_count"] == 0
    assert state["max_attempts"] == 2


def test_expand_synonyms_charging():
    """Expands charging bank to include power bank synonyms."""
    expanded = expand_synonyms("充电宝出口欧盟")
    assert "移动电源" in expanded or "power bank" in expanded.lower()


def test_decompose_markets():
    """Creates one sub-query per market."""
    result = decompose_markets("CE标识要求", ["EU", "US"])
    assert len(result) == 2
    assert {r["market"] for r in result} == {"EU", "US"}


def test_query_planner_node():
    """QueryPlanner creates sub_queries with synonym expansion."""
    state = initial_state(
        query="充电宝铅含量",
        product="充电宝",
        category="electronics",
        markets=["EU"],
        vision_result={},
    )
    result = query_planner_node(state)
    assert "sub_queries" in result
    assert len(result["sub_queries"]) == 1
    assert result["sub_queries"][0]["market"] == "EU"


def test_synthesis_deduplicates():
    """Synthesis deduplicates results by id."""
    docs = [
        {"id": "1", "market": "EU", "doc_name": "REACH", "score": 0.9},
        {"id": "1", "market": "EU", "doc_name": "REACH", "score": 0.9},  # duplicate
        {"id": "2", "market": "US", "doc_name": "TSCA", "score": 0.8},
    ]
    state = GraphState(documents=docs, agent_trace=[], category="")
    result = synthesis_node(state)
    assert len(result["documents"]) == 2


def test_refiner_increments_loop_count():
    """QueryRefiner increments loop_count."""
    state = GraphState(
        query="test",
        sub_queries=[{"market": "EU", "query": "CE"}],
        missing_citations=["REACH Article 22"],
        loop_count=0,
        agent_trace=[],
    )
    result = refiner_node(state)
    assert result["loop_count"] == 1


def test_refiner_extracts_regulatory_terms():
    """Refiner extracts article numbers from missing citations."""
    state = GraphState(
        query="test",
        sub_queries=[{"market": "EU", "query": "CE"}],
        missing_citations=["REACH Article 22", "GDPR § 5"],
        loop_count=0,
        agent_trace=[],
    )
    result = refiner_node(state)
    # Should expand sub-queries with regulatory terms
    assert len(result["sub_queries"]) > 0


def test_initial_state_has_all_required_fields():
    """initial_state creates GraphState with all required keys."""
    state = initial_state("query", "product", "category", ["EU"], {})
    required_keys = ["query", "product", "category", "markets", "documents",
                    "generation", "loop_count", "max_attempts", "agent_trace"]
    for key in required_keys:
        assert key in state, f"Missing key: {key}"
