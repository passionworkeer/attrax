import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rag_service.retrieval.fusion import rrf_fuse, normalize_scores
from rag_service.retrieval.bm25_retriever import BM25Retriever
from rag_service.retrieval.must_check import get_must_check_regulations, apply_must_check
from rag_service.retrieval.hybrid_retriever import HybridRetriever


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


# ---------------------------------------------------------------------------
# Immutability regression tests (added with the fusion.py immutability fix)
# ---------------------------------------------------------------------------

def test_rrf_fuse_does_not_mutate_inputs():
    """rrf_fuse must not write score_norm into caller-owned BM25 dicts.

    Regression: the previous implementation did
    ``for r in bm25_results: r['score_norm'] = ...`` which leaked fusion
    state back into the caller and the BM25 result cache, corrupting
    later queries that reused the same chunk dicts.
    """
    dense = [
        {"id": "1", "score": 0.9, "doc_name": "REACH", "content": "..."},
        {"id": "2", "score": 0.8, "doc_name": "GDPR", "content": "..."},
    ]
    bm25 = [
        {"id": "2", "score": 10, "doc_name": "GDPR", "content": "..."},
        {"id": "3", "score": 8, "doc_name": "RoHS", "content": "..."},
    ]
    # Snapshot keys before fusion.
    dense_before = [dict(r) for r in dense]
    bm25_before = [dict(r) for r in bm25]

    rrf_fuse(dense, bm25, k=25)

    # Inputs must be unchanged — no score_norm injected, no new keys.
    assert dense == dense_before
    assert bm25 == bm25_before
    assert all("score_norm" not in r for r in bm25)
    assert all("score_norm" not in r for r in dense)


def test_rrf_fuse_dense_weight_affects_ranking():
    """dense_weight=0 makes dense contributions vanish; bm25 dominates."""
    dense_only = [{"id": "d_only", "score": 0.99, "doc_name": "D", "content": "..."}]
    bm25 = [{"id": "bm_only", "score": 5, "doc_name": "B", "content": "..."}]
    # Equal weight: both get 1/(25+0)=0.04 each; tie broken by id sort.
    fused_equal = rrf_fuse(dense_only, bm25, k=25, top_k=2)
    # With dense_weight=0, the dense-only item scores 0 and bm_only wins.
    fused_no_dense = rrf_fuse(dense_only, bm25, k=25, top_k=2, dense_weight=0.0)
    assert fused_no_dense[0]["id"] == "bm_only"
    # Sanity: with equal weight both surface.
    assert {r["id"] for r in fused_equal} == {"d_only", "bm_only"}


def test_normalize_scores_does_not_mutate_input():
    """normalize_scores must return new dicts, leaving inputs untouched."""
    results = [
        {"dense_score": 10, "bm25_score": 5, "rrf_score": 0.5},
        {"dense_score": 20, "bm25_score": 10, "rrf_score": 1.0},
    ]
    before = [dict(r) for r in results]
    normalize_scores(results)
    assert results == before
    assert all("dense_score_norm" not in r for r in results)


# ---------------------------------------------------------------------------
# Cross-agent contract: dense_dim_mismatch_count attribute
# ---------------------------------------------------------------------------

def test_dense_dim_mismatch_count_is_int_attribute():
    """HybridRetriever exposes dense_dim_mismatch_count as an int attribute.

    Contract: main.py health endpoint reads
    ``getattr(retriever, 'dense_dim_mismatch_count', 0)`` to surface the
    silent-degradation failure mode. This test pins the contract: the
    attribute exists, is an int, and starts at 0.
    """
    hr = HybridRetriever()
    # Contract: attribute exists (not a method).
    assert hasattr(hr, "dense_dim_mismatch_count")
    assert isinstance(hr.dense_dim_mismatch_count, int)
    assert hr.dense_dim_mismatch_count == 0
    # getattr-with-default contract used by main.py health endpoint.
    assert getattr(hr, "dense_dim_mismatch_count", 0) == 0


def test_embedder_name_is_public_attribute():
    """A (high-risk) contract: HybridRetriever exposes a PUBLIC
    ``embedder_name`` string attribute.

    R3's main.py reads ``_retriever.embedder_name`` instead of reflecting
    into the module-private ``_embedder_name``. This pins that the
    attribute exists, is a str, and starts at the module default before
    the lazy embedder property is first touched.
    """
    hr = HybridRetriever()
    assert hasattr(hr, "embedder_name")
    assert isinstance(hr.embedder_name, str)
    # Before probe, the public attribute mirrors the module-level default.
    from rag_service.retrieval import hybrid_retriever as hr_mod
    assert hr.embedder_name == hr_mod._embedder_name


def test_dense_dim_mismatch_count_atomic_increment_under_concurrency():
    """E (high-risk): the mismatch counter must not lose updates when
    multiple threads bump it concurrently.

    Regression: ``self.dense_dim_mismatch_count += 1`` is not atomic in
    Python — under LangGraph Send() fan-out the dense branch of retrieve()
    runs in parallel across markets, and the bare compound assignment lost
    increments. The fix wraps the increment in ``self._dim_mismatch_lock``.

    This test drives the increment path directly (it does not exercise the
    full retrieve() pipeline, which would need a real FAISS index with a
    mismatched dim) by spawning N threads that each enter the guarded
    increment, then asserts the final count equals N exactly. Losing even
    one increment would surface as ``count < N``.
    """
    import threading
    hr = HybridRetriever()
    N = 200

    # Reproduce the exact critical section the fix guards. We simulate the
    # locked increment + last-update bookkeeping that _dense_search performs.
    def bump():
        for _ in range(5):
            with hr._dim_mismatch_lock:
                hr.dense_dim_mismatch_count += 1
                hr.dense_dim_mismatch_last = {"embedder_dim": 8, "faiss_dim": 4}

    threads = [threading.Thread(target=bump) for _ in range(N)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    expected = N * 5
    assert hr.dense_dim_mismatch_count == expected, (
        f"E regression: counter lost updates under concurrency; "
        f"expected {expected}, got {hr.dense_dim_mismatch_count}"
    )
    # last_update contract preserved
    assert hr.dense_dim_mismatch_last == {"embedder_dim": 8, "faiss_dim": 4}


def test_bm25_retriever_uses_explicit_params():
    """BM25 is built with k1=1.2, b=0.75 (pinned, not library default)."""
    from rag_service.retrieval.bm25_retriever import BM25Retriever
    retriever = BM25Retriever()
    retriever.build_index([
        {"id": "1", "content": "REACH法规铅含量限制要求"},
        {"id": "2", "content": "GDPR数据保护规定"},
    ])
    # rank_bm25 exposes k1 and b on the instance.
    assert retriever.bm25.k1 == 1.2
    assert retriever.bm25.b == 0.75


def test_bm25_save_index_no_on2_checksum():
    """save_index persists only chunk_ids, not an O(n^2) scores sum.

    Regression: the previous implementation re-ran get_scores for every
    chunk on save, which dominated save latency on large corpora.
    """
    import json
    import tempfile
    from rag_service.retrieval.bm25_retriever import BM25Retriever
    retriever = BM25Retriever()
    retriever.build_index([
        {"id": "a", "content": "first"},
        {"id": "b", "content": "second"},
    ])
    with tempfile.NamedTemporaryFile(mode="r", suffix=".json", delete=False) as tf:
        path = tf.name
    retriever.save_index(path)
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    # Only chunk_ids key should be present (no scores_sum).
    assert "chunk_ids" in data
    assert "scores_sum" not in data
    assert data["chunk_ids"] == ["a", "b"]
