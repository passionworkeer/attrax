import json

from rag_service.retrieval.corpus_loader import load_bm25_chunks_from_corpus


def test_load_bm25_chunks_from_processed_corpus(tmp_path):
    processed = tmp_path / "processed"
    processed.mkdir()
    (processed / "EU_Official_lvd.json").write_text(
        json.dumps(
            {
                "id": "eu-lvd",
                "title": "EU Low Voltage Directive",
                "rawText": "Article 1\n" + ("Electrical equipment safety requirements. " * 20),
                "metadata": {
                    "source_url": "https://example.test/lvd",
                    "product_categories": ["electronics"],
                },
            }
        ),
        encoding="utf-8",
    )
    (processed / "too-short.json").write_text(
        json.dumps({"rawText": "short"}), encoding="utf-8"
    )

    chunks = load_bm25_chunks_from_corpus(processed)

    assert chunks
    # Article-level parents cover the source text without indexing the same
    # content again as thousands of dense-retrieval child windows.
    assert {chunk["chunk_type"] for chunk in chunks} == {"parent"}
    assert all(chunk["region"] == "EU" for chunk in chunks)
    assert all(chunk["source_id"] == "eu-lvd" for chunk in chunks)
    assert all(chunk["source_url"] == "https://example.test/lvd" for chunk in chunks)
    assert all(chunk["product_categories"] == ["electronics"] for chunk in chunks)
