#!/usr/bin/env python3
"""
build_faiss.py - Build Faiss index from corpus

Pipeline:
1. Load all processed JSON files from data/corpus/processed/
2. Chunk with LegalChunker
3. Embed with ModelScope Qwen3-Embedding-0.6B (requires MODELSCOPE_API_KEY)
4. Save Faiss index + JSON metadata to data/faiss/

Usage:
    D:\python\python.exe scripts/build_faiss.py [--limit N]
"""
import sys
sys.stdout.reconfigure(encoding="utf-8")

import os
import json
import logging
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
os.chdir(Path(__file__).parent.parent)

from rag_service.config import settings
from rag_service.chunker.legal_chunker import chunk_document
from rag_service.retrieval.modelScope_embedder import ModelScopeEmbedder

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger(__name__)

PROCESSED_DIR = Path("data/corpus/processed")
FAISS_DIR = Path("data/faiss")
BATCH_SIZE = 1


def load_processed_files() -> list[dict]:
    """Load all processed JSON files with sufficient rawText."""
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


def embed_chunks(chunks: list[dict]) -> list[dict]:
    """Embed chunks with local ModelScope Qwen3-Embedding-0.6B."""
    embedder = ModelScopeEmbedder()
    texts = []
    for chunk in chunks:
        prepend = chunk.get("prepend_en", chunk.get("prepend_zh", ""))
        content = chunk.get("content", "")
        texts.append(f"{prepend}\n{content}" if prepend else content)

    vectors = embedder.embed_batch(texts)
    for chunk, vec in zip(chunks, vectors):
        chunk["vector"] = vec

    return chunks


def save_faiss(chunks: list[dict]):
    """Save chunks to Faiss index + JSON metadata."""
    import faiss
    import numpy as np

    FAISS_DIR.mkdir(exist_ok=True)

    vectors = [c["vector"] for c in chunks if c.get("vector")]
    chunks_with_vec = [c for c in chunks if c.get("vector")]

    if not vectors:
        logger.error("No vectors to save")
        return

    mat = np.array(vectors, dtype=np.float32)
    faiss.normalize_L2(mat)

    index = faiss.IndexFlatIP(1024)
    index.add(mat)

    index_path = str(FAISS_DIR / "legal_chunks.index")
    meta_path = str(FAISS_DIR / "legal_chunks_meta.json")

    faiss.write_index(index, index_path)
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(chunks_with_vec, f, ensure_ascii=False)

    logger.info(f"Saved Faiss index: {index.ntotal} vectors -> {index_path}")
    logger.info(f"Saved metadata: {len(chunks_with_vec)} chunks -> {meta_path}")


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--skip-embed", action="store_true", help="Skip embedding")
    args = parser.parse_args()

    logger.info("=" * 60)
    logger.info("  Build Faiss Index Pipeline")
    logger.info("=" * 60)

    docs = load_processed_files()
    if args.limit:
        docs = docs[:args.limit]

    chunks = chunk_documents(docs)

    if not args.skip_embed:
        chunks = embed_chunks(chunks)
    else:
        logger.info("Skipping embedding (--skip-embed)")
        return

    save_faiss(chunks)

    from collections import Counter
    regions = Counter(c.get("region", "unknown") for c in chunks)
    logger.info(f"  Chunks by region: {dict(regions)}")
    logger.info("  Done!")


if __name__ == "__main__":
    main()