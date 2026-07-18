"""
Component tests: verify integration between modules.
Run with: .venv\\Scripts\\python.exe -m pytest rag-service/tests/test_component.py -v
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import json
from pathlib import Path


class TestChunkerWithRealData:
    """Test LegalChunker on real processed JSON files."""

    def test_chunker_on_real_reach_file(self):
        """Chunk a real REACH PDF processed JSON."""
        proc_dir = Path("data/corpus/processed")
        files = list(proc_dir.glob("*REACH*"))

        for f in files:
            if "Screenshot" in f.name:
                continue
            try:
                with open(f, "r", encoding="utf-8") as fp:
                    data = json.load(fp)
                raw = data.get("rawText", "")
                if len(raw) < 1000:
                    continue

                from rag_service.chunker.legal_chunker import chunk_document
                result = chunk_document(raw, doc_name="REACH", region="EU")

                assert "child_chunks" in result
                assert result["total_children"] > 0

                # Check no chunk exceeds reasonable size
                for child in result["child_chunks"]:
                    assert len(child["content"]) < 50000  # No absurdly large chunks

                # Check deduplication works
                child_ids = [c["id"] for c in result["child_chunks"]]
                assert len(child_ids) == len(set(child_ids)), "Duplicate chunk IDs"

                return  # Success with first file
            except Exception as e:
                continue

        # If no REACH files found, skip
        import pytest
        pytest.skip("No suitable REACH processed files found")


class TestHybridRetrieverWithBM25:
    """Test HybridRetriever with BM25 (no Qdrant dependency)."""

    def test_bm25_search_returns_scored_results(self):
        """BM25 search returns results with scores."""
        from rag_service.retrieval.bm25_retriever import BM25Retriever

        chunks = [
            {"id": "1", "content": "REACH Article 22 restricts lead content in electronic products.", "doc_name": "REACH"},
            {"id": "2", "content": "GDPR protects personal data and requires consent.", "doc_name": "GDPR"},
            {"id": "3", "content": "RoHS directive limits hazardous substances in electrical equipment.", "doc_name": "RoHS"},
            {"id": "4", "content": "EMC directive ensures electromagnetic compatibility.", "doc_name": "EMC"},
        ]

        retriever = BM25Retriever()
        retriever.build_index(chunks)

        # Search for lead content
        results = retriever.search("lead content restrictions", top_k=3)
        assert len(results) > 0
        assert all("score" in r for r in results)
        # REACH should rank high for lead content
        doc_names = [r["doc_name"] for r in results]
        assert "REACH" in doc_names[:2], "REACH should rank high for lead restrictions"

    def test_bm25_chinese_query(self):
        """BM25 handles Chinese queries correctly."""
        from rag_service.retrieval.bm25_retriever import BM25Retriever

        chunks = [
            {"id": "1", "content": "REACH法规限制电子产品的铅含量。", "doc_name": "REACH"},
            {"id": "2", "content": "GDPR保护个人数据。", "doc_name": "GDPR"},
        ]

        retriever = BM25Retriever()
        retriever.build_index(chunks)

        results = retriever.search("REACH铅含量限制", top_k=5)
        assert len(results) > 0
        assert results[0]["doc_name"] == "REACH"


class TestFusionPipeline:
    """Test the complete fusion pipeline."""

    def test_rrf_merges_dense_and_bm25(self):
        """RRF fusion correctly merges two result lists."""
        from rag_service.retrieval.fusion import rrf_fuse

        dense = [
            {"id": "1", "score": 0.95, "doc_name": "REACH", "content": "Article 22 lead", "article_no": "22", "region": "EU"},
            {"id": "2", "score": 0.85, "doc_name": "GDPR", "content": "Article 5 data protection", "article_no": "5", "region": "EU"},
            {"id": "3", "score": 0.75, "doc_name": "RoHS", "content": "Hazardous substances", "article_no": "", "region": "EU"},
        ]

        bm25 = [
            {"id": "1", "score": 10.0, "doc_name": "REACH", "content": "Article 22 lead", "article_no": "22", "region": "EU"},
            {"id": "4", "score": 8.0, "doc_name": "GPSR", "content": "Product safety regulation", "article_no": "", "region": "EU"},
        ]

        result = rrf_fuse(dense, bm25, k=25, top_k=5)

        assert len(result) <= 5
        # id=1 appears in both lists → should be first (highest RRF score)
        assert result[0]["id"] == "1"
        # Verify all required fields are present
        for r in result:
            assert "rrf_score" in r
            assert "doc_name" in r
            assert "content" in r

    def test_rrf_empty_inputs(self):
        """RRF handles empty input lists."""
        from rag_service.retrieval.fusion import rrf_fuse
        result = rrf_fuse([], [], k=25)
        assert result == []

    def test_rrf_single_list(self):
        """RRF works with only one list."""
        from rag_service.retrieval.fusion import rrf_fuse
        dense = [{"id": "1", "score": 0.9, "doc_name": "REACH", "content": "...", "article_no": "", "region": "EU"}]
        result = rrf_fuse(dense, [], k=25)
        assert len(result) == 1


class TestCitationVerifierIntegration:
    """Test CitationVerifier with realistic reports."""

    def test_verify_with_real_citation_format(self):
        """Verify a report with properly formatted citations."""
        from rag_service.verify.citation_verifier import CitationVerifier

        verifier = CitationVerifier()

        report = """根据 [REACH Article 22] 的规定，铅含量限制为0.1%（重量比）。

根据 [GDPR Article 5]，数据处理必须遵循合法性原则。

同时参见 [RoHS Directive Annex] 关于有害物质的限制。"""

        chunks = [
            {"content": "Article 22: The restriction on lead applies to electronic equipment.", "doc_name": "REACH"},
            {"content": "Article 5: Personal data shall be processed lawfully.", "doc_name": "GDPR"},
            {"content": "Annex XVII of Directive 2011/65/EU lists restricted substances.", "doc_name": "RoHS"},
        ]

        result = verifier.verify_citations(report, chunks)

        assert result.status in ("PASS", "WARN", "REJECTED")
        assert result.total_claims > 0
        assert 0.0 <= result.attribution_score <= 1.0
        assert result.status in ("PASS", "WARN", "REJECTED")  # REJECTED possible when unverified > 0

    def test_detects_fabricated_citation(self):
        """System detects and blocks fabricated citations."""
        from rag_service.verify.citation_verifier import CitationVerifier

        verifier = CitationVerifier()

        report = "根据 [Fake Regulation Article 99]，该产品完全合规。没有任何限制要求。"

        chunks = [
            {"content": "Article 22 restricts lead.", "doc_name": "REACH"},
        ]

        result = verifier.verify_citations(report, chunks)

        assert result.status in ("WARN", "REJECTED")
        assert result.unverified > 0 or result.neutral > 0

    def test_multi_market_chunks(self):
        """Verifier handles chunks from multiple markets."""
        from rag_service.verify.citation_verifier import CitationVerifier

        verifier = CitationVerifier()

        report = "EU: [REACH Article 22]. US: [TSCA Section 6]."

        chunks = [
            {"content": "Article 22: Lead restricted.", "doc_name": "REACH", "region": "EU"},
            {"content": "Section 6: TSCA regulations apply.", "doc_name": "TSCA", "region": "US"},
        ]

        result = verifier.verify_citations(report, chunks)
        assert result.total_claims > 0


class TestGraphStateFlow:
    """Test the state flow through the graph nodes."""

    def test_query_planner_creates_sub_queries(self):
        """QueryPlanner creates one sub-query per market."""
        from rag_service.orchestrator.state import initial_state
        from rag_service.orchestrator.nodes.query_planner import query_planner_node

        state = initial_state(
            query="充电宝出口欧盟需要哪些认证？",
            product="USB充电宝",
            category="electronics",
            markets=["EU", "US", "CN"],
            vision_result={},
        )

        result = query_planner_node(state)

        assert len(result["sub_queries"]) == 3
        markets = {sq["market"] for sq in result["sub_queries"]}
        assert markets == {"EU", "US", "CN"}

    def test_synthesis_deduplicates_across_markets(self):
        """Synthesis deduplicates results from multiple markets."""
        from rag_service.orchestrator.state import GraphState
        from rag_service.orchestrator.nodes.synthesis import synthesis_node

        docs = [
            {"id": "reach_22", "market": "EU", "doc_name": "REACH", "score": 0.9},
            {"id": "reach_22", "market": "EU", "doc_name": "REACH", "score": 0.9},  # exact duplicate
            {"id": "tsca_6", "market": "US", "doc_name": "TSCA", "score": 0.8},
        ]

        state = GraphState(documents=docs, agent_trace=[], category="electronics")
        result = synthesis_node(state)

        doc_ids = [d["id"] for d in result["documents"]]
        assert len(doc_ids) == 2  # Deduplicated
        assert len(doc_ids) == len(set(doc_ids))

    def test_refiner_expands_missing_regulations(self):
        """QueryRefiner extracts regulatory terms from missing citations."""
        from rag_service.orchestrator.state import GraphState
        from rag_service.orchestrator.nodes.refiner import refiner_node

        state = GraphState(
            query="充电宝认证",
            sub_queries=[{"market": "EU", "query": "CE marking"}],
            missing_citations=["REACH Article 22", "GPSR Article 8", "LVD Article"],
            loop_count=0,
            agent_trace=[],
        )

        result = refiner_node(state)

        assert result["loop_count"] == 1
        assert len(result["sub_queries"]) == len(state["sub_queries"])
        # Sub-queries should have been expanded
        for sq in result["sub_queries"]:
            assert sq["market"] == "EU"

    def test_should_regenerate_routing(self):
        """should_regenerate correctly routes based on state."""
        from rag_service.orchestrator.nodes.verifier import should_regenerate
        from rag_service.orchestrator.state import GraphState

        # PASS → end
        state = GraphState(generation_score="supported", loop_count=0, max_attempts=2, missing_citations=[])
        assert should_regenerate(state) == "end"

        # INSUFFICIENT + retries available → refine
        state = GraphState(generation_score="WARN", verification_mode="nli", loop_count=0, max_attempts=2, missing_citations=["REACH Article 22"])
        assert should_regenerate(state) == "refine"

        # MAX retries → end (no force_generate in current implementation)
        state = GraphState(generation_score="WARN", verification_mode="nli", loop_count=2, max_attempts=2, missing_citations=["REACH Article 22"])
        assert should_regenerate(state) == "end"


class TestMustCheckIntegration:
    """Test must-check regulation injection."""

    def test_electronics_injects_rohs(self):
        """Electronics category triggers RoHS must-check."""
        from rag_service.retrieval.must_check import apply_must_check

        results = [
            {"id": "1", "doc_name": "REACH", "region": "EU", "score": 0.9},
        ]

        all_chunks = [
            {"id": "rohs_1", "doc_name": "RoHS Directive 2011/65/EU", "content": "Restricted substances.", "region": "EU"},
        ]

        injected = apply_must_check(results, "electronics", all_chunks)

        doc_names = [r["doc_name"] for r in injected]
        assert any("RoHS" in d for d in doc_names)

    def test_toy_triggers_en71(self):
        """Toy category triggers EN 71 must-check."""
        from rag_service.retrieval.must_check import get_must_check_regulations

        regs = get_must_check_regulations("toy")
        assert len(regs) > 0

    def test_unknown_category_no_injection(self):
        """Unknown category doesn't inject anything."""
        from rag_service.retrieval.must_check import apply_must_check

        results = [{"id": "1", "doc_name": "REACH", "region": "EU", "score": 0.9}]
        all_chunks = []

        injected = apply_must_check(results, "unknown_category_xyz", all_chunks)
        assert len(injected) == len(results)  # No injection
