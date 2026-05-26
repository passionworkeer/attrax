import json
import sys
from pathlib import Path


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
