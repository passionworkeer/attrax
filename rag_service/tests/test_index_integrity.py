import json

import pytest

from rag_service.retrieval import index_integrity as integrity


def write_bundle(tmp_path):
    index = tmp_path / "legal_chunks.index"
    metadata = tmp_path / "legal_chunks_meta.json"
    manifest = tmp_path / "index_manifest.json"
    index.write_bytes(b"fake-faiss-index")
    metadata.write_text(
        json.dumps(
            {
                "dim": 4,
                "chunks": [
                    {"id": "parent-1", "chunk_type": "parent"},
                    {"id": "child-1", "chunk_type": "child"},
                    {"id": "child-2", "chunk_type": "child"},
                ],
            }
        ),
        encoding="utf-8",
    )
    manifest.write_text(
        json.dumps({"dim": 4, "vector_count": 2, "chunk_count": 3}),
        encoding="utf-8",
    )
    return index, metadata, manifest


def test_seal_then_validate_binds_index_metadata_and_counts(tmp_path, monkeypatch):
    index, metadata, manifest = write_bundle(tmp_path)
    monkeypatch.setattr(integrity, "_faiss_shape", lambda path: (4, 2))

    sealed = integrity.seal_index_manifest(index, metadata, manifest)
    snapshot = integrity.validate_index_bundle(index, metadata, manifest)

    assert sealed["schema_version"] == 2
    assert sealed["index_sha256"] == snapshot.index_sha256
    assert sealed["metadata_sha256"] == snapshot.metadata_sha256
    assert snapshot.vector_count == 2
    assert snapshot.chunk_count == 3


def test_validation_rejects_metadata_changed_after_sealing(tmp_path, monkeypatch):
    index, metadata, manifest = write_bundle(tmp_path)
    monkeypatch.setattr(integrity, "_faiss_shape", lambda path: (4, 2))
    integrity.seal_index_manifest(index, metadata, manifest)
    payload = json.loads(metadata.read_text(encoding="utf-8"))
    payload["chunks"][1]["content"] = "tampered"
    metadata.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(integrity.IndexIntegrityError, match="metadata hash"):
        integrity.validate_index_bundle(index, metadata, manifest)


def test_validation_rejects_duplicate_chunk_ids(tmp_path, monkeypatch):
    index, metadata, manifest = write_bundle(tmp_path)
    monkeypatch.setattr(integrity, "_faiss_shape", lambda path: (4, 2))
    payload = json.loads(metadata.read_text(encoding="utf-8"))
    payload["chunks"][2]["id"] = "child-1"
    metadata.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(integrity.IndexIntegrityError, match="duplicate"):
        integrity.inspect_index_bundle(index, metadata, manifest)


def test_validation_rejects_more_vectors_than_metadata(tmp_path, monkeypatch):
    index, metadata, manifest = write_bundle(tmp_path)
    monkeypatch.setattr(integrity, "_faiss_shape", lambda path: (4, 4))

    with pytest.raises(integrity.IndexIntegrityError, match="vector count exceeds"):
        integrity.inspect_index_bundle(index, metadata, manifest)
