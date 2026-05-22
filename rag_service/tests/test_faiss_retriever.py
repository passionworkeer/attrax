"""
test_faiss_retriever.py - Unit tests for FaissRetriever.

Run with:
    python -m pytest rag_service/tests/test_faiss_retriever.py -v

Key notes:
- normalize_query() does NOT exist in faiss_retriever.py; it is tested here as
  a pure-utility function that callers are expected to provide before embedding.
- search() accepts a query_vec (list[float]), not raw text — callers must embed first.
- The real index (data/faiss/legal_chunks.index) cannot be opened directly due to
  non-ASCII path limitations of the faiss C extension on Windows.  FaissRetriever.load()
  works around this by copying to a temp dir, which is exercised in the real-index test.
- Meta file is in old format (plain list, not dict with "dim" key).
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import json
import re
import tempfile
import shutil
from pathlib import Path

import faiss
import numpy as np
import pytest

from rag_service.retrieval.faiss_retriever import FaissRetriever


# ---------------------------------------------------------------------------
# Helper: normalize_query  (mirrors what callers do before embedding)
# ---------------------------------------------------------------------------

def normalize_query(text: str) -> str:
    """Strip whitespace, lowercase, collapse internal whitespace."""
    if not text or not isinstance(text, str):
        return ""
    return " ".join(text.strip().lower().split())


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def temp_dir(tmp_path):
    """Provide a clean temporary directory, cleaned up after test."""
    return tmp_path


@pytest.fixture
def sample_chunks():
    """10 synthetic legal chunks for building test indexes."""
    return [
        {
            "id": f"chunk_{i}",
            "content": f"Legal content for regulation {i}.",
            "doc_name": f"REG_{i}",
            "region": "EU" if i % 2 == 0 else "US",
        }
        for i in range(10)
    ]


@pytest.fixture
def sample_vectors(sample_chunks):
    """Generate 10 unit-normalised random vectors matching chunks."""
    rng = np.random.default_rng(0xBEEF)
    dim = 64  # small dimension for fast tests
    vecs = rng.standard_normal((len(sample_chunks), dim)).astype(np.float32)
    faiss.normalize_L2(vecs)
    return vecs.tolist()


@pytest.fixture
def built_retriever(sample_chunks, sample_vectors):
    """FaissRetriever with a small in-memory index, dim=64."""
    ret = FaissRetriever()
    ret.build_index(sample_chunks, sample_vectors)
    return ret


@pytest.fixture
def saved_index(temp_dir, built_retriever):
    """Save built_retriever to temp files and return paths."""
    idx_path = str(temp_dir / "test.index")
    meta_path = str(temp_dir / "test_meta.json")
    built_retriever.save(idx_path, meta_path)
    return idx_path, meta_path


# ---------------------------------------------------------------------------
# 1. Class initialisation
# ---------------------------------------------------------------------------

class TestInitialization:
    """FaissRetriever.__init__ and basic properties."""

    def test_default_init(self):
        ret = FaissRetriever()
        assert ret.index is None
        assert ret.chunks == []
        assert ret.dim == 1024  # DEFAULT_DIM
        assert not ret.is_loaded

    def test_init_with_paths(self):
        ret = FaissRetriever(index_path="/path/to/index", meta_path="/path/to/meta")
        assert ret.index_path == "/path/to/index"
        assert ret.meta_path == "/path/to/meta"
        assert not ret.is_loaded

    def test_len_zero_when_not_loaded(self):
        assert len(FaissRetriever()) == 0


# ---------------------------------------------------------------------------
# 2. normalize_query — tested here as a pure utility function
# ---------------------------------------------------------------------------

class TestNormalizeQuery:
    """Query normalisation (a caller-level utility; exercised via unit tests)."""

    def test_english_lowercase(self):
        assert normalize_query("REACH Regulation") == "reach regulation"

    def test_chinese_lowercase(self):
        assert normalize_query("REACH法规 铅含量") == "reach法规 铅含量"

    def test_mixed(self):
        assert normalize_query("REACH Article 22 限制铅含量") == "reach article 22 限制铅含量"

    def test_whitespace_collapse(self):
        assert normalize_query("  REACH   Regulation  ") == "reach regulation"

    def test_empty_string(self):
        assert normalize_query("") == ""

    def test_none_input(self):
        assert normalize_query(None) == ""

    def test_special_characters_preserved(self):
        assert normalize_query("2011/65/EU (RoHS)") == "2011/65/eu (rohs)"
        assert normalize_query("GB 31241-2014") == "gb 31241-2014"


# ---------------------------------------------------------------------------
# 3. build_index
# ---------------------------------------------------------------------------

class TestBuildIndex:
    """FaissRetriever.build_index() behaviour."""

    def test_build_index_sets_dim(self, sample_chunks, sample_vectors):
        ret = FaissRetriever()
        ret.build_index(sample_chunks, sample_vectors)
        assert ret.dim == 64

    def test_build_index_vectors_count(self, sample_chunks, sample_vectors):
        ret = FaissRetriever()
        ret.build_index(sample_chunks, sample_vectors)
        assert len(ret) == 10

    def test_build_index_chunks_preserved(self, sample_chunks, sample_vectors):
        ret = FaissRetriever()
        ret.build_index(sample_chunks, sample_vectors)
        assert ret.chunks == sample_chunks

    def test_build_index_empty_chunks_raises(self):
        ret = FaissRetriever()
        with pytest.raises(ValueError, match="non-empty"):
            ret.build_index([], [])

    def test_build_index_single_vector_2d(self):
        """Single vector should be reshaped to (1, dim)."""
        ret = FaissRetriever()
        single_vec = [0.5] * 64
        chunks = [{"id": "only_one"}]
        ret.build_index(chunks, [single_vec])
        assert len(ret) == 1


# ---------------------------------------------------------------------------
# 4. search
# ---------------------------------------------------------------------------

class TestSearch:
    """FaissRetriever.search() edge cases and correctness."""

    def test_search_returns_results(self, built_retriever):
        """Query vector (dim=64, matching index) returns non-empty scored results."""
        rng = np.random.default_rng(0xCAFE)
        q = rng.standard_normal((1, 64)).astype(np.float32)
        faiss.normalize_L2(q)
        results = built_retriever.search(q[0].tolist(), top_k=3)
        # Matching dim guarantees at least one result from 10-vector index
        assert 1 <= len(results) <= 3
        for r in results:
            assert "id" in r
            assert "score" in r
            assert "content" in r

    def test_search_top_k_zero_raises(self, built_retriever):
        """top_k=0 is passed directly to FAISS, which asserts k>0 and raises."""
        rng = np.random.default_rng(1)
        q = rng.standard_normal((1, 64)).astype(np.float32)
        faiss.normalize_L2(q)
        with pytest.raises(AssertionError):
            built_retriever.search(q[0].tolist(), top_k=0)

    def test_search_top_k_negative_raises(self, built_retriever):
        """Negative top_k is NOT clamped to 1; FAISS asserts k>0 and raises."""
        with pytest.raises(AssertionError):
            built_retriever.search([0.0] * 64, top_k=-5)

    def test_search_top_k_exceeds_total(self, built_retriever):
        """top_k larger than index size returns all available."""
        results = built_retriever.search([0.0] * 64, top_k=9999)
        assert len(results) == 10  # only 10 vectors exist

    def test_search_empty_index_returns_empty(self):
        ret = FaissRetriever()
        assert ret.search([0.0] * 64) == []

    def test_search_dim_mismatch_returns_empty(self, built_retriever):
        wrong_dim_vec = [0.1] * 128  # dim=128, index dim=64
        results = built_retriever.search(wrong_dim_vec, top_k=3)
        assert results == []

    def test_search_score_is_float(self, built_retriever):
        rng = np.random.default_rng(42)
        q = rng.standard_normal((1, 64)).astype(np.float32)
        faiss.normalize_L2(q)
        results = built_retriever.search(q[0].tolist(), top_k=5)
        assert len(results) >= 1, "Expected at least one result with matching dim"
        assert all(isinstance(r["score"], float) for r in results)

    def test_search_results_sorted_by_score_desc(self, built_retriever):
        rng = np.random.default_rng(99)
        q = rng.standard_normal((1, 64)).astype(np.float32)
        faiss.normalize_L2(q)
        results = built_retriever.search(q[0].tolist(), top_k=10)
        assert len(results) >= 1, "Expected at least one result with matching dim"
        scores = [r["score"] for r in results]
        assert scores == sorted(scores, reverse=True)

    def test_search_on_unloaded_index_warns(self, caplog):
        ret = FaissRetriever()
        with caplog.at_level("WARNING"):
            results = ret.search([0.0] * 1024, top_k=5)
        assert results == []
        assert any("not built" in r.message.lower() for r in caplog.records)


# ---------------------------------------------------------------------------
# 5. save / load round-trip
# ---------------------------------------------------------------------------

class TestSaveLoad:
    """FaissRetriever.save() and load() round-trip."""

    def test_save_then_load(self, saved_index, built_retriever):
        idx_path, meta_path = saved_index
        loaded = FaissRetriever.load(idx_path, meta_path)
        assert loaded.index is not None
        assert len(loaded) == len(built_retriever)
        assert loaded.dim == built_retriever.dim
        assert len(loaded.chunks) == len(built_retriever.chunks)

    def test_load_chunks_preserved(self, saved_index, sample_chunks):
        loaded = FaissRetriever.load(*saved_index)
        assert loaded.chunks == sample_chunks

    def test_save_without_index_raises(self, temp_dir):
        ret = FaissRetriever()
        with pytest.raises(RuntimeError, match=r"(?i)no index"):
            ret.save(str(temp_dir / "x.index"), str(temp_dir / "x.json"))

    def test_load_nonexistent_path_raises(self, temp_dir):
        fake_idx = str(temp_dir / "nonexistent.index")
        fake_meta = str(temp_dir / "nonexistent_meta.json")
        with pytest.raises(RuntimeError, match=r"(?i)failed to load"):
            FaissRetriever.load(fake_idx, fake_meta)

    def test_load_corrupted_index_raises(self, temp_dir):
        """Writing garbage bytes to the index file should cause load to fail."""
        idx_path = str(temp_dir / "corrupt.index")
        meta_path = str(temp_dir / "corrupt_meta.json")
        with open(idx_path, "wb") as f:
            f.write(b"this is not a faiss index")
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump({"dim": 64, "chunks": []}, f)
        with pytest.raises(RuntimeError, match=r"(?i)failed to load"):
            FaissRetriever.load(idx_path, meta_path)

    def test_load_corrupted_meta_raises(self, temp_dir, built_retriever):
        idx_path = str(temp_dir / "good.index")
        meta_path = str(temp_dir / "bad_meta.json")
        built_retriever.save(idx_path, meta_path)
        with open(meta_path, "w", encoding="utf-8") as f:
            f.write("{ this is not json }")
        with pytest.raises((json.JSONDecodeError, UnicodeDecodeError)):
            FaissRetriever.load(idx_path, meta_path)

    def test_load_old_format_list_meta(self, temp_dir, sample_chunks, sample_vectors):
        """Old meta format: plain list (no 'dim' key)."""
        # Build and save a fresh index, then overwrite meta with old format
        ret = FaissRetriever()
        ret.build_index(sample_chunks, sample_vectors)
        idx_path = str(temp_dir / "old.index")
        meta_path = str(temp_dir / "old_meta.json")
        faiss.write_index(ret.index, idx_path)
        # Write as plain list (old format)
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(sample_chunks, f)
        loaded = FaissRetriever.load(idx_path, meta_path)
        assert loaded.chunks == sample_chunks
        assert loaded.dim == 1024  # DEFAULT_DIM fallback


# ---------------------------------------------------------------------------
# 6. Real index test (via FaissRetriever.load with non-ASCII path workaround)
# ---------------------------------------------------------------------------

REAL_INDEX_PATH = "E:/desktop/火鹰合规/attrax/data/faiss/legal_chunks.index"
REAL_META_PATH = "E:/desktop/火鹰合规/attrax/data/faiss/legal_chunks_meta.json"


class TestRealIndex:
    """Exercise FaissRetriever.load() against the real FAISS index.

    The real index cannot be opened directly by the faiss C extension due to
    non-ASCII characters in the Windows path.  FaissRetriever.load() works
    around this by copying the files to a temp directory, which is verified here.
    """

    @pytest.fixture
    def real_retriever(self):
        if not Path(REAL_INDEX_PATH).exists():
            pytest.skip("Real FAISS index not found")
        return FaissRetriever.load(REAL_INDEX_PATH, REAL_META_PATH)

    def test_real_index_loads(self, real_retriever):
        assert real_retriever.index is not None
        assert real_retriever.is_loaded

    def test_real_index_has_vectors(self, real_retriever):
        assert real_retriever.index.ntotal > 0

    def test_real_index_search_returns_scored_chunks(self, real_retriever):
        """Search with a synthetic unit-normalised vector (2D array for normalize)."""
        rng = np.random.default_rng(0xFACED)
        q = rng.standard_normal((1, real_retriever.dim)).astype(np.float32)
        faiss.normalize_L2(q)
        results = real_retriever.search(q[0].tolist(), top_k=5)
        assert len(results) <= 5
        for r in results:
            assert "id" in r
            assert "score" in r
            assert "content" in r

    def test_real_index_dim_matches_chunks(self, real_retriever):
        """Index dimension should be consistent."""
        assert real_retriever.dim > 0

    def test_real_index_chunks_not_empty(self, real_retriever):
        assert len(real_retriever.chunks) > 0


# ---------------------------------------------------------------------------
# 7. Mock FAISS behaviour
# ---------------------------------------------------------------------------

class TestMockFaiss:
    """When real index is unavailable, verify mock FAISS behaves correctly."""

    def test_mock_search_returns_expected_count(self):
        """Mock Faiss index with known vectors; search should find nearest."""
        ret = FaissRetriever()
        # Two deliberately different vectors
        vec_a = [1.0, 0.0, 0.0, 0.0]
        vec_b = [0.0, 1.0, 0.0, 0.0]
        chunks = [{"id": "A", "content": "vector A"}, {"id": "B", "content": "vector B"}]
        ret.build_index(chunks, [vec_a, vec_b])

        # Query close to A → A should rank first
        results = ret.search(vec_a, top_k=2)
        assert results[0]["id"] == "A"
        assert results[1]["id"] == "B"

    def test_mock_top_k_limits_results(self):
        """top_k=1 should return only the top result."""
        ret = FaissRetriever()
        vecs = [[1, 0], [0, 1], [0.5, 0.5]]
        chunks = [{"id": str(i)} for i in range(3)]
        ret.build_index(chunks, vecs)
        results = ret.search(vecs[0], top_k=1)
        assert len(results) == 1
        assert results[0]["id"] == "0"

    def test_mock_search_negative_index_skipped(self):
        """FAISS returns -1 for out-of-range positions; these must be skipped."""
        ret = FaissRetriever()
        ret.build_index([{"id": "only_one"}], [[1.0, 0.0]])
        # Force search with a top_k larger than ntotal to get -1 indices
        rng = np.random.default_rng(7)
        q = rng.standard_normal((1, 2)).astype(np.float32)
        faiss.normalize_L2(q)
        results = ret.search(q[0].tolist(), top_k=5)
        ids = [r["id"] for r in results]
        assert "only_one" in ids
        # -1 indices should not produce extra results
        assert len(results) == 1


# ---------------------------------------------------------------------------
# 8. is_loaded property
# ---------------------------------------------------------------------------

class TestIsLoaded:
    def test_false_before_build(self):
        ret = FaissRetriever()
        assert ret.is_loaded is False

    def test_true_after_build(self, built_retriever):
        assert built_retriever.is_loaded is True

    def test_true_after_load(self, saved_index):
        loaded = FaissRetriever.load(*saved_index)
        assert loaded.is_loaded is True


# ---------------------------------------------------------------------------
# 9. Error propagation / regression
# ---------------------------------------------------------------------------

class TestErrorPropagation:
    def test_load_missing_meta_raises(self, temp_dir, built_retriever):
        idx_path = str(temp_dir / "idx.index")
        meta_path = str(temp_dir / "missing_meta.json")
        faiss.write_index(built_retriever.index, idx_path)
        # Meta doesn't exist
        with pytest.raises(FileNotFoundError):
            FaissRetriever.load(idx_path, meta_path)

    def test_search_wrong_dim_uses_logging(self, built_retriever, caplog):
        with caplog.at_level("WARNING"):
            results = built_retriever.search([0.0] * 9999, top_k=5)
        assert results == []
        assert any("dim" in r.message.lower() for r in caplog.records)
