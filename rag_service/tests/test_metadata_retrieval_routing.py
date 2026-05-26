from rag_service.retrieval.bm25_retriever import BM25Retriever
from rag_service.retrieval.hybrid_retriever import HybridRetriever
from rag_service.retrieval.metadata_filter import chunk_matches, extract_chunk_metadata, filter_chunks


def test_extract_chunk_metadata_normalizes_nested_official_fields():
    chunk = {
        "id": "chunk-1",
        "region": "EU",
        "source_id": "eu-2011-65-rohs",
        "metadata": {
            "productCategories": ["electronics", "electrical_equipment"],
            "regulatoryTypes": ["chemical", "conformity"],
            "official_channel": "Publications Office of the European Union",
            "source_url": "https://publications.europa.eu/resource/celex/32011L0065",
        },
    }

    metadata = extract_chunk_metadata(chunk)

    assert metadata["region"] == "EU"
    assert metadata["source_id"] == "eu-2011-65-rohs"
    assert metadata["product_categories"] == ["electronics", "electrical_equipment"]
    assert metadata["regulatory_types"] == ["chemical", "conformity"]
    assert metadata["is_official"] is True


def test_filter_chunks_matches_market_category_type_and_official_source():
    chunks = [
        {
            "id": "rohs",
            "region": "EU",
            "source_id": "eu-2011-65-rohs",
            "product_categories": ["electronics"],
            "regulatory_types": ["chemical"],
            "official_channel": "Publications Office of the European Union",
        },
        {
            "id": "toy",
            "region": "EU",
            "source_id": "eu-2009-48-toy-safety",
            "product_categories": ["toys"],
            "regulatory_types": ["product_safety"],
            "official_channel": "Publications Office of the European Union",
        },
        {
            "id": "blog",
            "region": "EU",
            "source_id": "blog-rohs",
            "product_categories": ["electronics"],
            "regulatory_types": ["chemical"],
        },
    ]

    assert chunk_matches(
        chunks[0],
        region="EU",
        product_category="electronics",
        regulatory_types=["chemical"],
        official_only=True,
    )
    filtered = filter_chunks(
        chunks,
        region="EU",
        product_category="electronics",
        regulatory_types=["chemical"],
        official_only=True,
    )

    assert [chunk["id"] for chunk in filtered] == ["rohs"]


def test_hybrid_retriever_routes_with_strict_metadata_filters():
    chunks = [
        {
            "id": "rohs-1",
            "content": "RoHS restricted substances lead mercury cadmium electronics chemical compliance.",
            "doc_name": "Directive 2011/65/EU on RoHS",
            "region": "EU",
            "source_id": "eu-2011-65-rohs",
            "product_categories": ["electronics"],
            "regulatory_types": ["chemical", "conformity"],
            "official_channel": "Publications Office of the European Union",
        },
        {
            "id": "toy-1",
            "content": "Toy safety mechanical chemical warnings for children.",
            "doc_name": "Directive 2009/48/EC on toy safety",
            "region": "EU",
            "source_id": "eu-2009-48-toy-safety",
            "product_categories": ["toys", "children_products"],
            "regulatory_types": ["product_safety", "chemical"],
            "official_channel": "Publications Office of the European Union",
        },
        {
            "id": "unofficial-1",
            "content": "RoHS restricted substances lead mercury cadmium unofficial summary.",
            "doc_name": "Unofficial RoHS blog",
            "region": "EU",
            "source_id": "blog-rohs",
            "product_categories": ["electronics"],
            "regulatory_types": ["chemical"],
        },
    ]
    retriever = HybridRetriever(bm25=BM25Retriever(), faiss_retriever=None)
    retriever.load_chunks(chunks)

    results = retriever.retrieve(
        "restricted substances lead mercury",
        product_category="electronics",
        region="EU",
        regulatory_types=["chemical"],
        official_only=True,
        top_k=10,
    )

    assert [result["source_id"] for result in results] == ["eu-2011-65-rohs"]
    assert results[0]["product_categories"] == ["electronics"]
    assert results[0]["regulatory_types"] == ["chemical", "conformity"]


def test_bm25_indexes_doc_name_and_source_metadata_for_short_official_docs():
    chunks = [
        {
            "id": "toy-short",
            "content": "Article 1 scope.",
            "doc_name": "Directive 2009/48/EC on the safety of toys",
            "region": "EU",
            "source_id": "eu-2009-48-toy-safety",
            "product_categories": ["toys", "children_products"],
            "regulatory_types": ["product_safety", "chemical"],
            "official_channel": "Publications Office of the European Union",
        },
        {
            "id": "gpsr",
            "content": "General consumer product safety requirements.",
            "doc_name": "Regulation (EU) 2023/988 on general product safety",
            "region": "EU",
            "source_id": "eu-2023-988-general-product-safety",
            "product_categories": ["general_consumer_products"],
            "regulatory_types": ["product_safety"],
            "official_channel": "Publications Office of the European Union",
        },
    ]
    bm25 = BM25Retriever()
    bm25.build_index(chunks)

    results = bm25.search("toy safety directive", top_k=2)

    assert results[0]["source_id"] == "eu-2009-48-toy-safety"
