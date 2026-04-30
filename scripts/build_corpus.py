#!/usr/bin/env python3
"""
build_corpus.py - Build and ingest corpus into Qdrant

Pipeline:
1. Load all processed JSON files from data/corpus/processed/
2. Parse rawText with appropriate parser (HTML/DOCX/PDF already done)
3. Chunk with LegalChunker
4. Embed with Cohere embed-multilingual-v3
5. Upsert to Qdrant legal_chunks collection
6. Also upsert parent chunks to legal_chunks_parents

Usage:
    .venv\Scripts\python.exe scripts/build_corpus.py [--limit N] [--collection NAME]
"""
import sys
sys.stdout.reconfigure(encoding="utf-8")

import os
import json
import time
import logging
from pathlib import Path
from typing import Optional

# Setup
sys.path.insert(0, str(Path(__file__).parent.parent))
os.chdir(Path(__file__).parent.parent)

import cohere
from qdrant_client import QdrantClient

from rag_service.config import settings
from rag_service.chunker.legal_chunker import chunk_document
from rag_service.retrieval.cohere_embedder import CohereEmbedder

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger(__name__)

PROCESSED_DIR = Path("data/corpus/processed")
BATCH_SIZE = 96  # Cohere API limit


def load_processed_files() -> list[dict]:
    """Load all processed JSON files."""
    files = sorted(PROCESSED_DIR.glob("*.json"))
    logger.info(f"Found {len(files)} processed JSON files")

    docs = []
    for f in files:
        if "Screenshot_Pending" in f.name:
            continue
        try:
            with open(f, "r", encoding="utf-8") as fp:
                data = json.load(fp)
            raw_text = data.get("rawText", "")
            if len(raw_text) < 100:
                logger.debug(f"Skipping empty: {f.name}")
                continue
            docs.append({
                "file_path": str(f),
                "file_name": f.name,
                "raw_text": raw_text,
                "title": data.get("title", f.stem[:50]),
                "doc_id": data.get("id", f.stem),
                "region": data.get("region", data.get("metadata", {}).get("region", "")),
                "metadata": data.get("metadata", {}),
            })
        except Exception as e:
            logger.warning(f"Failed to load {f.name}: {e}")

    logger.info(f"Loaded {len(docs)} documents with sufficient rawText")
    return docs


def chunk_documents(docs: list[dict]) -> list[dict]:
    """Chunk all documents using LegalChunker."""
    all_chunks = []

    for doc in docs:
        try:
            result = chunk_document(
                raw_text=doc["raw_text"],
                doc_name=doc["title"],
                doc_id=doc["doc_id"],
                region=doc["region"],
            )

            for child in result.get("child_chunks", []):
                child["source_file"] = doc["file_name"]
                child["source_id"] = doc["doc_id"]
                all_chunks.append(child)

        except Exception as e:
            logger.warning(f"Failed to chunk {doc['file_name']}: {e}")

    logger.info(f"Created {len(all_chunks)} child chunks from {len(docs)} documents")
    return all_chunks


def embed_chunks(cohere_key: str, chunks: list[dict]) -> list[dict]:
    """Embed chunks with Cohere embed-multilingual-v3."""
    if not cohere_key:
        logger.warning("No Cohere API key - skipping embedding")
        for chunk in chunks:
            chunk["vector"] = [0.0] * 1024
        return chunks

    client = cohere.ClientV2(api_key=cohere_key)
    results = []

    for i in range(0, len(chunks), BATCH_SIZE):
        batch = chunks[i:i+BATCH_SIZE]

        # Prepare text for embedding (with contextual prepend)
        texts = []
        for chunk in batch:
            prepend = chunk.get("prepend_en", chunk.get("prepend_zh", ""))
            content = chunk.get("content", "")
            texts.append(f"{prepend}\n{content}" if prepend else content)

        try:
            resp = client.embed(
                texts=texts,
                model="embed-multilingual-v3.0",
                input_type="search_document",
            )

            for chunk, vector in zip(batch, resp.embeddings):
                chunk["vector"] = vector
                results.append(chunk)

            logger.info(f"  Embedded {len(batch)} chunks ({i+len(batch)}/{len(chunks)})")

        except Exception as e:
            logger.error(f"Batch embed failed at {i}: {e}")
            for chunk in batch:
                chunk["vector"] = [0.0] * 1024
                results.append(chunk)

    return results


def upsert_to_qdrant(chunks: list[dict], qdrant_client: Optional[QdrantClient] = None):
    """Upsert chunks to Qdrant."""
    if qdrant_client is None:
        logger.warning("No Qdrant client - skipping upsert")
        return

    from qdrant_client.models import PointStruct, Vector, NamedVector

    points = []
    for chunk in chunks:
        if "vector" not in chunk or not chunk["vector"]:
            continue

        point = PointStruct(
            id=chunk["id"],
            vector=chunk["vector"],
            payload={
                "doc_name": chunk.get("doc_name", ""),
                "doc_id": chunk.get("doc_id", ""),
                "region": chunk.get("region", ""),
                "article_no": chunk.get("article_no", ""),
                "content": chunk.get("content", ""),
                "parent_id": chunk.get("parent_id", ""),
                "chunk_type": chunk.get("chunk_type", "child"),
                "source_file": chunk.get("source_file", ""),
            },
        )
        points.append(point)

    if not points:
        logger.warning("No points to upsert")
        return

    # Upsert in batches
    BATCH = 100
    for i in range(0, len(points), BATCH):
        batch = points[i:i+BATCH]
        try:
            qdrant_client.upsert(
                collection_name="legal_chunks",
                points=batch,
            )
            logger.info(f"  Upserted {len(batch)} points ({i+len(batch)}/{len(points)})")
        except Exception as e:
            logger.error(f"Upsert failed at {i}: {e}")


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="Limit number of documents")
    parser.add_argument("--skip-embed", action="store_true", help="Skip embedding (for testing)")
    args = parser.parse_args()

    logger.info("=" * 60)
    logger.info("  Build Corpus Pipeline")
    logger.info("=" * 60)

    # Step 1: Load
    docs = load_processed_files()
    if args.limit:
        docs = docs[:args.limit]
        logger.info(f"  Limited to {args.limit} documents")

    # Step 2: Chunk
    logger.info("  Chunking documents...")
    chunks = chunk_documents(docs)

    # Step 3: Embed
    if args.skip_embed:
        logger.info("  Skipping embedding (--skip-embed)")
        for chunk in chunks:
            chunk["vector"] = [0.0] * 1024
    else:
        logger.info("  Embedding chunks with Cohere...")
        embedder = CohereEmbedder(api_key=settings.COHERE_API_KEY)
        chunks = embed_chunks(settings.COHERE_API_KEY, chunks)

    # Step 4: Upsert to Qdrant
    logger.info("  Upserting to Qdrant...")
    try:
        qc = QdrantClient(host=settings.QDRANT_HOST, port=settings.QDRANT_PORT)
        qc.health()
        upsert_to_qdrant(chunks, qc)
        logger.info("  Qdrant upsert complete")
    except Exception as e:
        logger.warning(f"  Qdrant upsert skipped: {e}")
        logger.info("  (Run scripts/init_qdrant.py first to set up collections)")

    # Step 5: Summary
    logger.info("=" * 60)
    logger.info("  Summary")
    logger.info("=" * 60)
    logger.info(f"  Documents processed: {len(docs)}")
    logger.info(f"  Chunks created: {len(chunks)}")

    # Stats by region
    from collections import Counter
    regions = Counter(c.get("region", "unknown") for c in chunks)
    for region, count in sorted(regions.items()):
        logger.info(f"    {region or 'unknown'}: {count} chunks")

    # Save chunk manifest
    manifest_path = Path("data/corpus/chunk_manifest.json")
    manifest = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "total_chunks": len(chunks),
        "total_docs": len(docs),
        "regions": dict(regions),
    }
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    logger.info(f"  Manifest saved: {manifest_path}")

    logger.info("  Done!")


if __name__ == "__main__":
    main()
