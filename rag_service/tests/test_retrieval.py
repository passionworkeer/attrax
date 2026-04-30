import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rag_service.retrieval.fusion import rrf_fuse, normalize_scores
from rag_service.retrieval.bm25_retriever import BM25Retriever
from rag_service.retrieval.must_check import get_must_check_regulations, apply_must_check


def test_rrf_fuse_ranking():
    """RRF puts documents appearing in both lists at top."""
    dense = [
        {"id": "1", "score": 0.9, "doc_name": "REACH", "content": "..."},
        {"id": "2", "score": 0.8, "doc_name": "GDPR", "content": "..."},
    ]
    bm25 = [
        {"id": "2", "score": 10, "doc_name": "GDPR", "content": "..."},
        {"id": "3", "score": 8, "doc_name": "RoHS", "content": "..."},
    ]
    result = rrf_fuse(dense, bm25, k=25)
    # id=2 appears in both, should be ranked first
    assert result[0]["id"] == "2"


def test_rrf_fuse_deduplication():
    """Duplicate IDs are merged."""
    dense = [{"id": "1", "score": 0.9, "doc_name": "A", "content": ""}]
    bm25 = [{"id": "1", "score": 5, "doc_name": "A", "content": ""}]
    result = rrf_fuse(dense, bm25, k=25)
    assert len(result) == 1


def test_bm25_chinese_tokenization():
    """BM25 tokenizes Chinese queries."""
    retriever = BM25Retriever()
    chunks = [
        {"id": "1", "content": "REACH法规铅含量限制要求"},
        {"id": "2", "content": "GDPR数据保护规定"},
    ]
    retriever.build_index(chunks)
    results = retriever.search("REACH铅含量限制", top_k=5)
    assert len(results) > 0


def test_must_check_electronics():
    """Electronics category triggers must-check regulations."""
    regs = get_must_check_regulations("electronics")
    assert len(regs) > 0
    assert any("RoHS" in r["doc_name"] for r in regs)


def test_must_check_no_category():
    """Unknown category returns empty list."""
    regs = get_must_check_regulations("unknown_category_xyz")
    assert regs == []


def test_apply_must_check_injects():
    """Must-check items are injected if not in results."""
    results = [{"id": "1", "doc_name": "REACH"}]
    all_chunks = [
        {"id": "2", "doc_name": "RoHS Directive 2011/65/EU", "content": "..."},
    ]
    injected = apply_must_check(results, "electronics", all_chunks)
    doc_names = [r["doc_name"] for r in injected]
    assert any("RoHS" in d for d in doc_names)


def test_normalize_scores():
    """Scores are normalized to 0-1 range."""
    results = [
        {"dense_score": 10, "bm25_score": 5, "rrf_score": 0.5},
        {"dense_score": 20, "bm25_score": 10, "rrf_score": 1.0},
    ]
    normalized = normalize_scores(results)
    # Check normalized fields exist
    for r in normalized:
        assert "dense_score_norm" in r
        assert 0 <= r["dense_score_norm"] <= 1
