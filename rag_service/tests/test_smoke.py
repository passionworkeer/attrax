"""
Smoke tests: verify core modules can be imported and instantiated.
Run with: .venv\\Scripts\\python.exe -m pytest rag-service/tests/test_smoke.py -v
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def test_config_imports():
    from config import Settings
    s = Settings(cohere_api_key="test", anthropic_api_key="test")
    assert s.cohere_api_key == "test"
    assert s.anthropic_api_key == "test"


def test_state_imports():
    from orchestrator.state import GraphState, initial_state
    state = initial_state("test query", "test product", "electronics", ["EU"], {})
    assert state["query"] == "test query"
    assert state["loop_count"] == 0


def test_graph_imports():
    from orchestrator.graph import build_compliance_graph, run_compliance_graph
    graph = build_compliance_graph()
    assert graph is not None


def test_hybrid_retriever_instantiates():
    from rag_service.retrieval.hybrid_retriever import HybridRetriever
    from rag_service.retrieval.cohere_embedder import CohereEmbedder
    from rag_service.retrieval.bm25_retriever import BM25Retriever
    hr = HybridRetriever()
    assert hr is not None


def test_citation_verifier_instantiates():
    from rag_service.verify.citation_verifier import CitationVerifier
    v = CitationVerifier()
    assert v is not None


def test_report_generator_instantiates():
    from rag_service.generate.report_generator import ReportGenerator
    g = ReportGenerator()
    assert g is not None


def test_legal_chunker_imports():
    from rag_service.chunker.legal_chunker import chunk_document, detect_boundary
    result = detect_boundary("Article 22 Restrictions")
    assert result is not None
    assert result["type"] == "EU"


def test_parser_imports():
    from rag_service.parser.html_parser import parse_html, clean_html
    from rag_service.parser.docx_parser import parse_docx
    assert callable(parse_html)
    assert callable(clean_html)
    assert callable(parse_docx)


def test_fusion_imports():
    from rag_service.retrieval.fusion import rrf_fuse
    result = rrf_fuse([], [], k=25)
    assert isinstance(result, list)


def test_must_check_imports():
    from rag_service.retrieval.must_check import get_must_check_regulations, apply_must_check
    regs = get_must_check_regulations("electronics")
    assert len(regs) > 0


def test_fastapi_app_imports():
    from rag_service.main import app
    assert app is not None
    assert app.title == "火鹰合规 RAG Service"


def test_all_nodes_import():
    from rag_service.orchestrator.nodes import (
        query_planner_node, retriever_node, synthesis_node,
        verifier_node, refiner_node, generator_node,
    )
    assert callable(query_planner_node)
    assert callable(synthesis_node)


def test_bm25_tokenization():
    import jieba
    tokens = jieba.lcut("REACH法规铅含量限制")
    assert len(tokens) > 0


def test_query_planner_expands():
    from rag_service.orchestrator.nodes.query_planner import expand_synonyms
    result = expand_synonyms("充电宝CE标识")
    assert "充电宝" in result
    assert len(result) > len("充电宝CE标识")
