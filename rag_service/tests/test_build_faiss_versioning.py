import json
import sys
from pathlib import Path

import pytest


sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts import build_faiss  # noqa: E402


def test_load_processed_files_accepts_custom_processed_dir(tmp_path):
    processed_dir = tmp_path / "processed"
    processed_dir.mkdir()
    (processed_dir / "EU_Official_test.json").write_text(
        json.dumps(
            {
                "id": "eu-test",
                "title": "EU Test",
                "region": "EU",
                "rawText": "Article 1 " + ("product safety " * 20),
                "metadata": {"source_url": "https://example.test"},
            }
        ),
        encoding="utf-8",
    )

    docs = build_faiss.load_processed_files(processed_dir=processed_dir)

    assert len(docs) == 1
    assert docs[0]["doc_id"] == "eu-test"
    assert docs[0]["region"] == "EU"
    assert docs[0]["file_name"] == "EU_Official_test.json"


def test_save_faiss_writes_index_manifest(tmp_path):
    chunks = [
        {
            "id": "chunk-1",
            "source_id": "eu-test",
            "source_file": "EU_Official_test.json",
            "region": "EU",
            "content": "Article 1 product safety",
            "vector": [1.0, 0.0],
        },
        {
            "id": "chunk-2",
            "source_id": "us-test",
            "source_file": "US_Official_test.json",
            "region": "US",
            "content": "Section 1 testing",
            "vector": [0.0, 1.0],
        },
    ]

    build_faiss.save_faiss(
        chunks,
        dim=2,
        faiss_dir=tmp_path,
        build_info={
            "version_label": "unit-test",
            "processed_dir": "data/corpus/processed",
            "documents_count": 2,
        },
    )

    assert (tmp_path / "legal_chunks.index").exists()
    assert (tmp_path / "legal_chunks_meta.json").exists()
    manifest = json.loads((tmp_path / "index_manifest.json").read_text(encoding="utf-8"))

    assert manifest["version_label"] == "unit-test"
    assert manifest["dim"] == 2
    assert manifest["vector_count"] == 2
    assert manifest["chunk_count"] == 2
    assert manifest["documents_count"] == 2
    assert manifest["processed_dir"] == "data/corpus/processed"
    assert manifest["chunks_by_region"] == {"EU": 1, "US": 1}
    assert manifest["source_files"] == ["EU_Official_test.json", "US_Official_test.json"]


def test_chunk_documents_preserves_source_metadata():
    docs = [
        {
            "file_path": "data/corpus/processed/EU_Official_test.json",
            "file_name": "EU_Official_test.json",
            "raw_text": "Article 1 product safety. " * 40,
            "title": "EU Product Safety",
            "doc_id": "eu-product-safety",
            "region": "EU",
            "metadata": {
                "source_url": "https://example.test/eu",
                "official_channel": "Official Journal",
                "product_categories": ["general_consumer_products"],
                "regulatory_types": ["product_safety"],
            },
        }
    ]

    chunks = build_faiss.chunk_documents(docs)

    assert chunks
    assert chunks[0]["source_id"] == "eu-product-safety"
    assert chunks[0]["source_url"] == "https://example.test/eu"
    assert chunks[0]["official_channel"] == "Official Journal"
    assert chunks[0]["product_categories"] == ["general_consumer_products"]
    assert chunks[0]["regulatory_types"] == ["product_safety"]


def test_embed_chunks_requires_api_embedder_unless_hash_fallback_enabled(monkeypatch):
    monkeypatch.setattr(build_faiss, "_probe_embedders", lambda: (None, "none"))
    monkeypatch.delenv("ALLOW_HASH_EMBED_FALLBACK", raising=False)

    with pytest.raises(RuntimeError, match="MODELSCOPE_API_KEY"):
        build_faiss.embed_chunks([{"content": "Article 1 product safety"}])


def _make_stub_embedder(dim: int, fail_text_suffix: str | None = None):
    """Embedder stub: deterministic NON-zero vectors; fails texts whose content
    ends with ``fail_text_suffix`` (stable across batches, unlike a positional
    ``fail_indices`` which resets per embed_batch call)."""
    class _Stub:
        DIM = dim

        def embed_batch(self, texts, batch_size=50):
            out = []
            for t in texts:
                if fail_text_suffix and t.endswith(fail_text_suffix):
                    out.append([0.0] * dim)
                else:
                    h = int(__import__("hashlib").sha256(t.encode()).hexdigest(), 16)
                    vec = [1.0]
                    vec.extend(((h >> (j % 64)) & 1) * 0.5 for j in range(dim - 1))
                    out.append(vec)
            return out

    return _Stub()


def test_embed_chunks_drops_zero_vectors_and_writes_cache(monkeypatch, tmp_path):
    """Zero vectors from failed embeddings must be dropped, not mixed in."""
    cache_path = tmp_path / "embed_cache.json"
    monkeypatch.setattr(build_faiss, "EMBED_CACHE_PATH", cache_path)
    # 1 failure in 200 chunks = 0.5%, under the 1% poison threshold.
    monkeypatch.setattr(build_faiss, "MAX_ZERO_VECTOR_FRACTION", 0.02)

    stub = _make_stub_embedder(dim=4, fail_text_suffix="__FAIL__")
    monkeypatch.setattr(build_faiss, "_probe_embedders", lambda: (stub, "stub"))
    monkeypatch.setattr(build_faiss, "_load_embed_cache", lambda: {})

    chunks = [
        {"content": "__FAIL__" if i == 1 else f"chunk {i}", "prepend_en": "", "id": str(i)}
        for i in range(200)
    ]
    good, dim = build_faiss.embed_chunks(chunks)

    assert dim == 4
    assert len(good) == 199, "failed (zero-vector) chunk must be dropped"
    assert all(c["id"] != "1" for c in good)
    assert cache_path.exists(), "cache must be checkpointed after a successful batch"


def test_embed_cache_skips_already_embedded_chunks(monkeypatch, tmp_path):
    """Already-cached chunks must not call the embedder again (resume)."""
    cache_path = tmp_path / "embed_cache.json"

    # Empty prepend_en ⇒ text == content ("chunk 0"), matching the impl's
    # ``prepend or content`` branch.
    cached_text = "chunk 0"
    cached_key = build_faiss._embed_cache_key("stub", cached_text)
    prebuilt_cache = {cached_key: [0.5, 0.5, 0.5, 0.5]}
    monkeypatch.setattr(build_faiss, "EMBED_CACHE_PATH", cache_path)
    monkeypatch.setattr(build_faiss, "_load_embed_cache", lambda: dict(prebuilt_cache))

    calls = {"n": 0}
    stub = _make_stub_embedder(dim=4)
    _orig = stub.embed_batch

    def _counting(texts, batch_size=50):
        calls["n"] += len(texts)
        return _orig(texts, batch_size)

    stub.embed_batch = _counting
    monkeypatch.setattr(build_faiss, "_probe_embedders", lambda: (stub, "stub"))

    chunks = [
        {"content": f"chunk {i}", "prepend_en": "", "id": str(i)} for i in range(3)
    ]
    good, _ = build_faiss.embed_chunks(chunks)

    assert len(good) == 3
    # The cached chunk (index 0) must NOT have been re-sent to the embedder.
    assert calls["n"] == 2, f"expected 2 API calls, got {calls['n']}"


def test_embed_chunks_aborts_when_failure_rate_exceeds_threshold(monkeypatch, tmp_path):
    """If too many chunks fail embedding, refuse to ship a poisoned index."""
    cache_path = tmp_path / "embed_cache.json"
    monkeypatch.setattr(build_faiss, "EMBED_CACHE_PATH", cache_path)

    # 4 of 5 fail → 80% failure rate, well above 1% threshold.
    stub = _make_stub_embedder(dim=4, fail_text_suffix="__FAIL__")
    monkeypatch.setattr(build_faiss, "_probe_embedders", lambda: (stub, "stub"))
    monkeypatch.setattr(build_faiss, "_load_embed_cache", lambda: {})

    chunks = [
        {"content": "__FAIL__" if i < 4 else f"chunk {i}", "prepend_en": "", "id": str(i)}
        for i in range(5)
    ]
    with pytest.raises(RuntimeError, match="poisoned index"):
        build_faiss.embed_chunks(chunks)


def test_chunk_documents_emits_parent_and_child_chunks():
    """Parent chunks must enter the chunk stream alongside children."""
    docs = [
        {
            "file_path": "data/corpus/processed/EU_Official_long.json",
            "file_name": "EU_Official_long.json",
            "raw_text": "Article 1 product safety. " * 200,
            "title": "EU Long Doc",
            "doc_id": "eu-long",
            "region": "EU",
            "metadata": {},
        }
    ]
    chunks = build_faiss.chunk_documents(docs)

    chunk_types = {c.get("chunk_type") for c in chunks}
    assert "parent" in chunk_types, "parent chunks must enter the index"
    assert "child" in chunk_types

    children = [c for c in chunks if c.get("chunk_type") == "child"]
    parents = [c for c in chunks if c.get("chunk_type") == "parent"]
    assert children, "expected at least one child"
    assert parents, "expected at least one parent"

    parent_ids = {p["id"] for p in parents}
    for child in children:
        assert child.get("parent_id") in parent_ids, (
            f"child {child['id']} parent_id {child.get('parent_id')} "
            f"must reference a real parent chunk"
        )


# ---------------------------------------------------------------------------
# A (high-risk): INCLUDE_PARENT_IN_INDEX gate
# ---------------------------------------------------------------------------

def test_save_faiss_excludes_parents_from_index_by_default(tmp_path):
    """A: parent chunks are NOT added to the FAISS index by default, but
    their metadata IS written so expand_to_parent keeps working."""
    chunks = [
        {"id": "c1", "chunk_type": "child", "parent_id": "p1",
         "source_id": "s1", "source_file": "EU_x.json", "region": "EU",
         "content": "child one", "vector": [1.0, 0.0]},
        {"id": "c2", "chunk_type": "child", "parent_id": "p1",
         "source_id": "s1", "source_file": "EU_x.json", "region": "EU",
         "content": "child two", "vector": [0.9, 0.1]},
        {"id": "p1", "chunk_type": "parent", "parent_id": None,
         "source_id": "s1", "source_file": "EU_x.json", "region": "EU",
         "content": "parent full text", "vector": [0.5, 0.5]},
    ]

    # Default: INCLUDE_PARENT_IN_INDEX=false (module-level constant).
    # Force the default explicitly in case the env is set in CI.
    original = build_faiss.INCLUDE_PARENT_IN_INDEX
    build_faiss.INCLUDE_PARENT_IN_INDEX = False
    try:
        build_faiss.save_faiss(chunks, dim=2, faiss_dir=tmp_path,
                               build_info={"version_label": "t"})
    finally:
        build_faiss.INCLUDE_PARENT_IN_INDEX = original

    import faiss as _faiss
    idx = _faiss.read_index(str(tmp_path / "legal_chunks.index"))
    # Only the 2 children are indexed as vectors.
    assert idx.ntotal == 2, (
        f"parents must be excluded from FAISS index by default, "
        f"got {idx.ntotal} vectors"
    )
    # But the meta JSON carries all 3 chunks (parent included).
    meta = json.loads((tmp_path / "legal_chunks_meta.json").read_text(encoding="utf-8"))
    meta_ids = {c["id"] for c in meta["chunks"]}
    assert meta_ids == {"c1", "c2", "p1"}, (
        "parent metadata must be in meta JSON even when excluded from index"
    )


def test_save_faiss_includes_parents_when_env_enabled(tmp_path):
    """A: setting INCLUDE_PARENT_IN_INDEX=true restores legacy behaviour."""
    chunks = [
        {"id": "c1", "chunk_type": "child", "parent_id": "p1",
         "source_id": "s1", "source_file": "EU_x.json", "region": "EU",
         "content": "child one", "vector": [1.0, 0.0]},
        {"id": "p1", "chunk_type": "parent", "parent_id": None,
         "source_id": "s1", "source_file": "EU_x.json", "region": "EU",
         "content": "parent full text", "vector": [0.5, 0.5]},
    ]

    original = build_faiss.INCLUDE_PARENT_IN_INDEX
    build_faiss.INCLUDE_PARENT_IN_INDEX = True
    try:
        build_faiss.save_faiss(chunks, dim=2, faiss_dir=tmp_path,
                               build_info={"version_label": "t"})
    finally:
        build_faiss.INCLUDE_PARENT_IN_INDEX = original

    import faiss as _faiss
    idx = _faiss.read_index(str(tmp_path / "legal_chunks.index"))
    assert idx.ntotal == 2, (
        f"parents must be indexed when INCLUDE_PARENT_IN_INDEX=true, "
        f"got {idx.ntotal} vectors"
    )


# ---------------------------------------------------------------------------
# FAISS_INDEX_TYPE=hnsw support (no ModelScope calls; uses pre-built vectors)
# ---------------------------------------------------------------------------

def test_build_faiss_hnsw_builds_hnsw_index_and_search_works(tmp_path, monkeypatch):
    """FAISS_INDEX_TYPE=hnsw builds an IndexHNSWFlat that can search and
    exposes efSearch after load via FaissRetriever."""
    import faiss as _faiss
    import numpy as np

    # Force the HNSW branch; no env needed for build (constant is read live),
    # but set env so FaissRetriever.load picks up efSearch on read-back.
    monkeypatch.setenv("FAISS_INDEX_TYPE", "hnsw")
    monkeypatch.setenv("FAISS_HNSW_M", "16")
    monkeypatch.setenv("FAISS_HNSW_EF_CONSTRUCTION", "40")
    monkeypatch.setenv("FAISS_HNSW_EF_SEARCH", "32")

    # Build a tiny deterministic dataset: 8 vectors in dim=4.
    rng = np.random.default_rng(seed=42)
    vectors = rng.standard_normal((8, 4)).astype(np.float32).tolist()
    chunks = [
        {"id": f"c{i}", "source_id": "s", "source_file": "f.json",
         "region": "EU", "content": f"chunk {i}", "vector": vectors[i]}
        for i in range(8)
    ]

    build_faiss.save_faiss(chunks, dim=4, faiss_dir=tmp_path,
                           build_info={"version_label": "hnsw-test"})

    index_path = str(tmp_path / "legal_chunks.index")
    idx = _faiss.read_index(index_path)

    # Must be HNSW, not FlatIP.
    assert isinstance(idx, _faiss.IndexHNSWFlat), (
        f"expected IndexHNSWFlat under FAISS_INDEX_TYPE=hnsw, got {type(idx).__name__}"
    )
    assert idx.ntotal == 8

    # efConstruction is recorded on the graph; efSearch defaults to 16.
    assert idx.hnsw.efConstruction == 40

    # Search works and returns sane results.
    q = np.array([vectors[0]], dtype=np.float32)
    _faiss.normalize_L2(q)
    _scores, ids = idx.search(q, 1)
    assert ids[0][0] == 0, "self-query must rank chunk 0 first"

    # Round-trip via FaissRetriever.load: efSearch is applied from env.
    from rag_service.retrieval.faiss_retriever import FaissRetriever
    retriever = FaissRetriever.load(
        index_path, str(tmp_path / "legal_chunks_meta.json")
    )
    assert hasattr(retriever.index, "hnsw")
    assert retriever.index.hnsw.efSearch == 32


def test_build_faiss_flat_remains_default(tmp_path, monkeypatch):
    """Default backend stays IndexFlatIP when FAISS_INDEX_TYPE is unset/flat."""
    import faiss as _faiss

    monkeypatch.delenv("FAISS_INDEX_TYPE", raising=False)

    chunks = [
        {"id": "c1", "source_id": "s", "source_file": "f.json",
         "region": "EU", "content": "x", "vector": [1.0, 0.0]},
        {"id": "c2", "source_id": "s", "source_file": "f.json",
         "region": "EU", "content": "y", "vector": [0.0, 1.0]},
    ]
    build_faiss.save_faiss(chunks, dim=2, faiss_dir=tmp_path,
                           build_info={"version_label": "flat-test"})

    idx = _faiss.read_index(str(tmp_path / "legal_chunks.index"))
    assert isinstance(idx, _faiss.IndexFlatIP), (
        f"default backend must be IndexFlatIP, got {type(idx).__name__}"
    )
