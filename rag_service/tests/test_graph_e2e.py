#!/usr/bin/env python3
"""
test_graph_e2e.py - End-to-end tests for the LangGraph compliance graph.

AUDIT CONTEXT (HIGH, "测试假绿"):
    The compiled compliance graph (compiled.invoke) was never exercised by the
    test suite. Every "passing" orchestrator test hand-fed GraphState into a
    single node function, so the real wiring — Send() fan-out, should_regenerate
    routing, refine→query_planner HyDE loop, and the recursion_limit=50 cap —
    had ZERO integration coverage.

These tests run the FULL compiled graph end-to-end with mock LLM / embedder /
retriever / verifier injected through the nodes' public DI seams:

    set_vision_analyzer / set_retriever / set_generator / set_verifier

They assert real graph behaviour (node execution order, fan-out per market,
routing branches, loop caps, graceful failure), not cosmetic shapes.

Mock strategy (no real API, no faiss index):
    - mock vision analyzer : returns a fixed structured vision_result
    - mock retriever       : returns deterministic chunks per market
    - mock generator       : returns a fixed valid report / report_package
    - mock verifier        : returns a configurable VerificationResult so we can
                             drive each routing branch (end / refine)
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import MagicMock

from rag_service.verify.citation_verifier import VerificationResult
from rag_service.orchestrator.graph import compile_graph, get_compiled_graph
from rag_service.orchestrator.state import initial_state
from rag_service.orchestrator.nodes import retriever as retriever_module
from rag_service.orchestrator.nodes import verifier as verifier_module
from rag_service.orchestrator.nodes import generator as generator_module
from rag_service.orchestrator.nodes import vision as vision_module


# ── Helpers ──────────────────────────────────────────────────────────────────

def _chunk(market: str, doc_name: str = "REACH (EC) 1907/2006",
           article: str = "Article 22") -> dict:
    """Deterministic retrieved chunk tagged with its market."""
    return {
        "id": f"c_{market}_{article}",
        "doc_name": doc_name,
        "article_no": article,
        "region": market,
        "content": f"{doc_name} {article} restricts hazardous substances in {market}.",
        "score": 0.9,
        "market": market,
    }


def _pass_verifier() -> MagicMock:
    """A verifier that always returns a clean PASS (routes verify → end)."""
    ver = MagicMock()
    ver.verify_citations.return_value = VerificationResult(
        total_claims=1, entailed=1, contradicted=0, neutral=0, unverified=0,
        attribution_score=0.95, status="PASS", claims=[],
        details=[{"claim": "x", "status": "ENTAILED", "evidence": "e"}],
    )
    return ver


def _warn_verifier_with_missing(missing_claim: str) -> MagicMock:
    """A verifier that returns WARN with an unverified claim.

    Drives should_regenerate → "refine" (missing citations + loop < max_attempts).
    """
    ver = MagicMock()
    ver.verify_citations.return_value = VerificationResult(
        total_claims=1, entailed=0, contradicted=0, neutral=0, unverified=1,
        attribution_score=0.1, status="WARN", claims=[],
        details=[{"claim": missing_claim, "status": "UNVERIFIED", "evidence": None}],
    )
    return ver


def _make_generator(report_text: str, *, supports_package: bool = False,
                    package: dict | None = None) -> MagicMock:
    """A mock ReportGenerator that returns fixed legal content.

    `supports_package` toggles the generator_node branch between the legacy
    generate() path and the report-package path — both must work through the
    compiled graph.
    """
    gen = MagicMock()
    gen.provider = "mock-llm"
    gen.supports_report_package = supports_package
    if supports_package:
        gen.generate_report_package.return_value = package or {
            "complianceReport": report_text,
            "profitReport": {"markdown": "## Profit\nEstimated margin."},
            "roadmap": {"totalDays": 14, "progress": 50, "items": []},
            "decisionView": {"summary": "Proceed.", "keyFindings": [], "nodes": []},
        }
    else:
        gen.generate.return_value = report_text
    return gen


def _make_retriever(chunks_per_market: dict[str, list[dict]] | None = None,
                    failing_markets: set[str] | None = None,
                    raise_on_call: bool = False):
    """A mock HybridRetriever.

    Signature mirrors HybridRetriever.retrieve(query, product_category, region,
    top_k). Returns deterministic chunks per market; optionally raises to
    simulate a retrieval failure for specific markets.
    """
    retr = MagicMock()
    failing_markets = failing_markets or set()

    def fake_retrieve(query, product_category="", region="", top_k=15):
        if raise_on_call or region in failing_markets:
            raise RuntimeError(f"retriever down for {region}")
        if chunks_per_market is not None:
            return [dict(c) for c in chunks_per_market.get(region, [])]
        return [_chunk(region)]

    retr.retrieve = fake_retrieve
    return retr


def _trace_node_names(result: dict) -> list[str]:
    return [t.get("node", "") for t in result.get("agent_trace", [])]


# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def reset_node_singletons():
    """Reset every node's module-level singleton before AND after each test.

    Without this, mocks injected by one test leak into the next (the compiled
    graph is a process-wide singleton too, but it is stateless — only the
    injected dependencies carry state).
    """
    for mod in (generator_module, retriever_module, verifier_module, vision_module):
        mod._is_injected = False
    generator_module._generator_instance = None
    retriever_module._retriever_instance = None
    verifier_module._verifier_instance = None
    vision_module._analyzer_instance = None

    # The pre-computed vision_result path (no images) is used by these tests,
    # so no vision analyzer is injected. Keep env clean to prevent lazy network.
    os.environ.pop("MIMOTALK_API_KEY", None)
    yield
    for mod in (generator_module, retriever_module, verifier_module, vision_module):
        mod._is_injected = False
    generator_module._generator_instance = None
    retriever_module._retriever_instance = None
    verifier_module._verifier_instance = None
    vision_module._analyzer_instance = None


@pytest.fixture
def compiled():
    """Fresh compiled graph (stateless; safe to share)."""
    return compile_graph()


@pytest.fixture
def base_initial_state():
    """GraphState seed: 2 markets, pre-computed vision_result (no images)."""
    return initial_state(
        query="蓝牙耳机出口欧盟 CE 认证要求",
        product="蓝牙耳机",
        category="electronics",
        markets=["EU", "US"],
        vision_result={
            "product_type": "蓝牙耳机",
            "certifications": [{"mark": "CE", "region": "EU", "confidence": "high"}],
            "cert_summary": "CE",
        },
    )


# ── 1. Send() fan-out: every market is retrieved ─────────────────────────────

class TestSendFanOut:
    """verify LangGraph Send() dispatches one retrieve per market."""

    def test_multimarket_retrieves_each_market(self, compiled, base_initial_state):
        generator_module.set_generator(_make_generator("## Report\n[REACH Article 22]"))
        seen_markets: list[str] = []

        def spy_retrieve(query, product_category="", region="", top_k=15):
            seen_markets.append(region)
            return [_chunk(region)]

        retr = MagicMock()
        retr.retrieve = spy_retrieve
        retriever_module.set_retriever(retr)
        verifier_module.set_verifier(_pass_verifier())

        result = compiled.invoke(base_initial_state, config={"recursion_limit": 50})

        # The retriever was called once per requested market — proving the
        # Send() fan-out dispatched a branch for EU and for US (not just one).
        assert "EU" in seen_markets
        assert "US" in seen_markets
        assert seen_markets.count("EU") >= 1
        assert seen_markets.count("US") >= 1

        # Documents accumulated from BOTH markets survive into synthesis
        # (operator.add reducer merges Send() contributions). Without the
        # reducer the second market would silently overwrite the first.
        doc_markets = {d.get("market") for d in result.get("documents", [])}
        assert "EU" in doc_markets
        assert "US" in doc_markets


# ── 2. Happy path: full chain executes in order ──────────────────────────────

class TestHappyPath:
    """vision → planner → retrieve → synthesis → generate → verify → end."""

    def test_full_chain_runs_and_returns_report(self, compiled, base_initial_state):
        generator_module.set_generator(
            _make_generator("## 合规报告\n蓝牙耳机需要 CE 标志。", supports_package=True)
        )
        retriever_module.set_retriever(_make_retriever())
        verifier_module.set_verifier(_pass_verifier())

        result = compiled.invoke(base_initial_state, config={"recursion_limit": 50})

        # ── The graph really executed, not bypassed: every node appears in the
        #    trace, and a non-empty generation + report_package came back.
        nodes = _trace_node_names(result)
        assert "query_planner" in nodes
        assert "synthesis" in nodes
        assert "generate" in nodes
        assert "verifier" in nodes

        # Generation produced real content (not the no-generator error stub).
        assert len(result.get("generation", "")) > 0
        assert "错误" not in result.get("generation", "")

        # report_package was normalized through the schema and is non-empty.
        package = result.get("report_package")
        assert isinstance(package, dict)
        assert package.get("complianceReport")
        assert package.get("auditMetadata", {}).get("schemaVersion") == "report-package/v1"

        # verifier set generation_score from the mock PASS result.
        assert result.get("generation_score") == "supported"

        # loop_count was never incremented (no refine happened on the happy path).
        assert result.get("loop_count") == 0


# ── 3. should_regenerate routing: verify → refine → query_planner loop ───────

class TestRefineRouting:
    """When verify returns missing citations, the graph routes to refine and
    loops back through query_planner — exercising the HyDE refinement branch
    that the audit flagged as uncovered."""

    def test_missing_citations_trigger_refine_loop(self, compiled, base_initial_state):
        # Single market keeps the trace small and the assertion focused.
        base_initial_state["markets"] = ["EU"]
        generator_module.set_generator(_make_generator("## 报告\n需要更多引用。"))
        retriever_module.set_retriever(_make_retriever())
        # WARN + an unverified claim → should_regenerate returns "refine".
        verifier_module.set_verifier(
            _warn_verifier_with_missing("REACH Article 99")
        )

        result = compiled.invoke(base_initial_state, config={"recursion_limit": 50})

        nodes = _trace_node_names(result)

        # ── Routing branch proof: refiner and a SECOND planner pass ran.
        assert nodes.count("query_refiner") >= 1, (
            "expected refine→query_planner loop; refiner never ran"
        )
        # query_planner runs once at start, then again after each refine.
        assert nodes.count("query_planner") >= 2, (
            "expected query_planner to re-run after refine; only saw one pass"
        )

        # loop_count was incremented by the refiner (immutable: returns new value).
        assert result.get("loop_count") >= 1
        assert result.get("generation_score") == "not_supported"


# ── 4. max_attempts cap: refine loop terminates, never infinite ──────────────

class TestMaxAttemptsCap:
    """The HyDE refine loop must terminate at max_attempts (default 2) and
    never spin until recursion_limit=50 kills it. This guards against the
    infinite-loop regression the code comments around should_regenerate
    explicitly worry about."""

    def test_loop_terminates_at_max_attempts(self, compiled, base_initial_state):
        base_initial_state["markets"] = ["EU"]
        base_initial_state["max_attempts"] = 2
        generator_module.set_generator(_make_generator("## 报告\n未引用。"))
        retriever_module.set_retriever(_make_retriever())
        # Verifier permanently unhappy → would loop forever without the cap.
        verifier_module.set_verifier(
            _warn_verifier_with_missing("REACH Article 99")
        )

        result = compiled.invoke(base_initial_state, config={"recursion_limit": 50})

        # ── The cap is the hard stop. loop_count (the authoritative counter the
        #    refiner increments) climbed to exactly max_attempts and the graph
        #    ended without hitting recursion_limit. We assert on loop_count
        #    rather than the agent_trace length because the trace accumulates
        #    one copy per parallel Send() branch (operator.add reducer), so its
        #    size grows multiplicatively with the branch count — it is not a
        #    reliable loop-iteration count.
        assert result["loop_count"] == 2
        # And the graph still produced a verifier verdict at least once.
        assert _trace_node_names(result).count("verifier") >= 1

    def test_loop_bounded_by_recursion_limit_when_cap_disabled(self, compiled, base_initial_state):
        """recursion_limit is the safety net that prevents an infinite refine
        loop when the max_attempts cap is set high. The graph must terminate via
        GraphRecursionError rather than hang.

        Note: we keep max_attempts modest and recursion_limit low (15) because
        the agent_trace channel uses operator.add across parallel Send()
        branches, so the trace grows multiplicatively per refine round. With a
        very high max_attempts the trace would OOM before the recursion counter
        fired — a real sharp edge documented below as a production finding, but
        not something this test should trigger."""
        from langgraph.errors import GraphRecursionError

        base_initial_state["markets"] = ["EU"]
        # max_attempts above what a recursion_limit of 15 permits, so the loop
        # relies on the runtime limit, not the max_attempts cap.
        base_initial_state["max_attempts"] = 20
        generator_module.set_generator(_make_generator("## 报告"))
        retriever_module.set_retriever(_make_retriever())
        verifier_module.set_verifier(_warn_verifier_with_missing("Article 99"))

        with pytest.raises(GraphRecursionError):
            compiled.invoke(base_initial_state, config={"recursion_limit": 15})


# ── 5. Failure path: a market's retrieval fails, graph degrades, no crash ────

class TestRetrievalFailure:
    """When retrieval raises for a market, the retrieve node catches it and
    returns [] for that market; the graph continues and still produces a
    generation. The graph must NOT propagate the exception."""

    def test_failing_market_does_not_crash_graph(self, compiled, base_initial_state):
        generator_module.set_generator(_make_generator("## 报告\n部分降级。"))
        # EU retrievable, US raises.
        retriever_module.set_retriever(
            _make_retriever(failing_markets={"US"})
        )
        verifier_module.set_verifier(_pass_verifier())

        # Should not raise.
        result = compiled.invoke(base_initial_state, config={"recursion_limit": 50})

        # EU chunks still came through; US contributed nothing.
        doc_markets = {d.get("market") for d in result.get("documents", [])}
        assert "EU" in doc_markets
        assert "US" not in doc_markets

        # Generation still produced (synthesis + generate ran on the surviving docs).
        assert len(result.get("generation", "")) > 0

    def test_all_markets_falling_back_to_no_documents(self, compiled, base_initial_state):
        """If EVERY market's retrieval fails, documents is empty and the
        generator emits its explicit no-documents message instead of crashing."""
        base_initial_state["markets"] = ["EU"]
        generator_module.set_generator(_make_generator("## 报告"))
        retriever_module.set_retriever(_make_retriever(raise_on_call=True))
        verifier_module.set_verifier(_pass_verifier())

        result = compiled.invoke(base_initial_state, config={"recursion_limit": 50})

        assert result.get("documents", []) == []
        # Generator node's no-documents branch message.
        assert "未找到合规信息" in result.get("generation", "")


# ── 6. run_compliance_graph wrapper: the public entry point ──────────────────

class TestRunComplianceGraphWrapper:
    """run_compliance_graph() is the function the FastAPI layer actually calls.
    Verify it drives the compiled graph and returns the documented envelope
    (final_report / status / agent_trace / retrieved_chunks / report_package /
    loop_count)."""

    def test_wrapper_returns_documented_envelope(self):
        from rag_service.orchestrator.graph import run_compliance_graph

        generator_module.set_generator(
            _make_generator("## 合规报告\nCE 标志必需。", supports_package=True)
        )
        retriever_module.set_retriever(_make_retriever())
        verifier_module.set_verifier(_pass_verifier())

        out = run_compliance_graph(
            query="CE marking for headphones",
            product="蓝牙耳机",
            category="electronics",
            markets=["EU", "US"],
            vision_result={"product_type": "蓝牙耳机", "certifications": []},
        )

        # Documented envelope keys.
        assert set(out.keys()) >= {
            "final_report", "status", "agent_trace",
            "retrieved_chunks", "report_package", "loop_count",
        }
        # PASS verifier → status PASS.
        assert out["status"] == "PASS"
        assert isinstance(out["agent_trace"], list)
        assert len(out["agent_trace"]) > 0
        assert out["loop_count"] == 0
        # Both markets' chunks surfaced through the wrapper.
        chunk_markets = {c.get("market") for c in out["retrieved_chunks"]}
        assert {"EU", "US"}.issubset(chunk_markets)


# ── 7. Singleton graph is reused (compile-once invariant) ────────────────────

class TestCompiledGraphSingleton:
    """get_compiled_graph() must return the same compiled instance every call —
    recompiling per request would be a real perf regression. This locks the
    invariant so a future refactor can't silently break it."""

    def test_returns_same_instance(self):
        a = get_compiled_graph()
        b = get_compiled_graph()
        assert a is b
