#!/usr/bin/env python3
r"""
build_faiss.py - Build Faiss index from corpus

Pipeline:
1. Load all processed JSON files from data/corpus/processed/
2. Chunk with LegalChunker
3. Embed with ModelScope Qwen3-Embedding-0.6B (requires MODELSCOPE_API_KEY)
4. Save Faiss index + JSON metadata to data/faiss/ (or FAISS_INDEX_DIR env var)

Usage:
    D:\python\python.exe scripts/build_faiss.py [--limit N]
"""
import sys
sys.stdout.reconfigure(encoding="utf-8")

import os
import json
import logging
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
os.chdir(Path(__file__).parent.parent)

from rag_service.config import settings
from rag_service.chunker.legal_chunker import chunk_document
from rag_service.retrieval.hybrid_retriever import _probe_embedders

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger(__name__)

PROCESSED_DIR = Path("data/corpus/processed")
FAISS_DIR = Path(os.environ.get("FAISS_INDEX_DIR", "data/faiss"))
BATCH_SIZE = 1


def load_processed_files(processed_dir: Path = PROCESSED_DIR) -> list[dict]:
    """Load all processed JSON files with sufficient rawText."""
    processed_dir = Path(processed_dir)
    files = sorted(processed_dir.glob("*.json"))
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
                child["metadata"] = dict(doc.get("metadata", {}))
                child["source_url"] = doc.get("metadata", {}).get("source_url", "")
                child["content_url"] = doc.get("metadata", {}).get("content_url", "")
                child["official_channel"] = doc.get("metadata", {}).get("official_channel", "")
                child["product_categories"] = (
                    doc.get("metadata", {}).get("product_categories")
                    or doc.get("metadata", {}).get("productCategories")
                    or []
                )
                child["regulatory_types"] = (
                    doc.get("metadata", {}).get("regulatory_types")
                    or doc.get("metadata", {}).get("regulatoryTypes")
                    or []
                )
                child["raw_files"] = doc.get("metadata", {}).get("raw_files", [])
                all_chunks.append(child)
        except Exception as e:
            logger.warning(f"Failed to chunk {doc['file_name']}: {e}")

    logger.info(f"Created {len(all_chunks)} child chunks from {len(docs)} documents")
    return all_chunks


def _hash_embed(text: str, dim: int = 384) -> list[float]:
    import hashlib
    import numpy as np

    vec = np.zeros(dim, dtype=np.float32)
    tokens = [tok for tok in re.split(r"\s+", text) if tok]
    if not tokens:
        tokens = [text[:128] or "empty"]
    for token in tokens:
        digest = hashlib.sha256(token.encode("utf-8", errors="ignore")).digest()
        for i, b in enumerate(digest):
            idx = (b + i * 131) % dim
            vec[idx] += 1.0 if b % 2 else -1.0
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return vec.tolist()


def embed_chunks(chunks: list[dict]) -> tuple[list[dict], int]:
    """Embed chunks with the production ModelScope API embedder."""
    embedder, name = _probe_embedders()
    if embedder is None:
        if os.environ.get("ALLOW_HASH_EMBED_FALLBACK", "false").lower() != "true":
            raise RuntimeError("No embedding provider available. Set MODELSCOPE_API_KEY or enable ALLOW_HASH_EMBED_FALLBACK.")
        logger.warning("No embedding provider available; using deterministic hash fallback index")
        for chunk in chunks:
            text = f"{chunk.get('prepend_en', '')}\n{chunk.get('content', '')}"
            chunk["vector"] = _hash_embed(text)
        return chunks, 384
    logger.info(f"Using embedder: {name} ({getattr(embedder, 'DIM', 'unknown')}-dim)")
    texts = []
    for chunk in chunks:
        prepend = chunk.get("prepend_en", chunk.get("prepend_zh", ""))
        content = chunk.get("content", "")
        texts.append(f"{prepend}\n{content}" if prepend else content)

    vectors = embedder.embed_batch(texts)
    for chunk, vec in zip(chunks, vectors):
        chunk["vector"] = vec

    return chunks, getattr(embedder, "DIM", len(vectors[0]) if vectors else 0)


def save_faiss(
    chunks: list[dict],
    dim: int,
    faiss_dir: Path = FAISS_DIR,
    build_info: dict | None = None,
):
    """Save chunks to Faiss index + JSON metadata."""
    import faiss
    import numpy as np

    faiss_dir = Path(faiss_dir)
    faiss_dir.mkdir(parents=True, exist_ok=True)

    vectors = [c["vector"] for c in chunks if c.get("vector")]
    chunks_with_vec = [c for c in chunks if c.get("vector")]

    if not vectors:
        logger.error("No vectors to save")
        return

    mat = np.array(vectors, dtype=np.float32)
    faiss.normalize_L2(mat)

    index = faiss.IndexFlatIP(dim)
    index.add(mat)

    index_path = str(faiss_dir / "legal_chunks.index")
    meta_path = str(faiss_dir / "legal_chunks_meta.json")
    manifest_path = faiss_dir / "index_manifest.json"

    faiss.write_index(index, index_path)
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump({"dim": dim, "chunks": chunks_with_vec}, f, ensure_ascii=False)

    manifest = build_index_manifest(chunks_with_vec, dim, build_info or {}, int(index.ntotal))
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    logger.info(f"Saved Faiss index: {index.ntotal} vectors -> {index_path}")
    logger.info(f"Saved metadata: {len(chunks_with_vec)} chunks -> {meta_path}")
    logger.info(f"Saved index manifest -> {manifest_path}")


def build_index_manifest(
    chunks: list[dict],
    dim: int,
    build_info: dict,
    vector_count: int,
) -> dict:
    """Build an auditable manifest for a generated FAISS index."""
    regions = Counter(c.get("region", "unknown") or "unknown" for c in chunks)
    source_files = sorted({c.get("source_file", "") for c in chunks if c.get("source_file")})
    source_ids = sorted({c.get("source_id", "") for c in chunks if c.get("source_id")})
    return {
        "version_label": build_info.get("version_label", ""),
        "generated_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "processed_dir": build_info.get("processed_dir", str(PROCESSED_DIR)),
        "documents_count": int(build_info.get("documents_count", 0)),
        "dim": dim,
        "vector_count": vector_count,
        "chunk_count": len(chunks),
        "chunks_by_region": dict(sorted(regions.items())),
        "source_files": source_files,
        "source_ids": source_ids,
    }


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--skip-embed", action="store_true", help="Skip embedding")
    parser.add_argument("--processed-dir", type=Path, default=PROCESSED_DIR)
    parser.add_argument("--output-dir", type=Path, default=FAISS_DIR)
    parser.add_argument("--version-label", default="")
    args = parser.parse_args()

    logger.info("=" * 60)
    logger.info("  Build Faiss Index Pipeline")
    logger.info("=" * 60)

    docs = load_processed_files(processed_dir=args.processed_dir)
    if args.limit:
        docs = docs[:args.limit]

    chunks = chunk_documents(docs)

    if not args.skip_embed:
        chunks, dim = embed_chunks(chunks)
    else:
        logger.info("Skipping embedding (--skip-embed)")
        return

    save_faiss(
        chunks,
        dim,
        faiss_dir=args.output_dir,
        build_info={
            "version_label": args.version_label,
            "processed_dir": str(args.processed_dir),
            "documents_count": len(docs),
        },
    )

    regions = Counter(c.get("region", "unknown") for c in chunks)
    logger.info(f"  Chunks by region: {dict(regions)}")
    logger.info("  Done!")


if __name__ == "__main__":
    main()
