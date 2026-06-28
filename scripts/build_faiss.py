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
import hashlib
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

# A (high-risk): parent chunks carry full Article/Section text used for LLM
# context expansion (see FaissRetriever.expand_to_parent). Indexing them as
# FAISS vectors used to double the on-disk index size for no retrieval
# benefit — retrieval scores children and expands to parent via meta lookup,
# never by dense similarity on the parent vector itself.
#
# ``INCLUDE_PARENT_IN_INDEX`` (default false) controls whether parent chunks
# are added to the main FAISS IndexFlatIP. Parent metadata is ALWAYS written
# to legal_chunks_meta.json regardless, so expand_to_parent keeps working.
# Flip to "true" to restore the legacy behaviour (e.g. for an A/B comparison).
INCLUDE_PARENT_IN_INDEX = os.environ.get(
    "INCLUDE_PARENT_IN_INDEX", "false"
).strip().lower() in ("1", "true", "yes", "on")

# FAISS index backend. ``flat`` (default) keeps the long-running
# IndexFlatIP path that the production index was built with; ``hnsw`` builds
# an IndexHNSWFlat graph (M=32, efConstruction=200 defaults) for sub-linear
# search. HNSW is opt-in because switching backends requires a full rebuild,
# which burns ModelScope quota; the existing flat index stays load-bearing.
# Defaults (env-overridable): FAISS_HNSW_M, FAISS_HNSW_EF_CONSTRUCTION,
# FAISS_HNSW_EF_SEARCH (search-time, applied in faiss_retriever.load).


def _build_index_backend(dim: int, faiss_module):
    """Return a fresh FAISS index honouring ``FAISS_INDEX_TYPE``.

    Both branches use L2-normalised vectors + inner product so the on-disk
    format and search semantics stay compatible across flat/hnsw: ``search``
    returns cosine-similarity scores regardless of backend.
    """
    index_type = os.environ.get("FAISS_INDEX_TYPE", "flat").strip().lower()
    if index_type == "hnsw":
        # Read live env so tests/CI can override per-invocation.
        m = int(os.environ.get("FAISS_HNSW_M", "32"))
        ef_construction = int(os.environ.get("FAISS_HNSW_EF_CONSTRUCTION", "200"))
        index = faiss_module.IndexHNSWFlat(
            dim, m, faiss_module.METRIC_INNER_PRODUCT
        )
        index.hnsw.efConstruction = ef_construction
        logger.info(
            f"Building HNSW index: M={m}, efConstruction={ef_construction}"
        )
        return index
    if index_type != "flat":
        logger.warning(
            f"Unknown FAISS_INDEX_TYPE={index_type!r}, falling back to flat"
        )
    return faiss_module.IndexFlatIP(dim)

# Per-chunk embed cache: lets build_faiss resume after a partial run without
# re-embedding chunks that already succeeded. Keyed by a stable hash of
# (embedder name, text) so changing embedders invalidates safely.
EMBED_CACHE_PATH = FAISS_DIR / "embed_cache.json"
# Reject the whole index when more than this fraction of chunks fail embedding,
# so we never silently ship a poisoned index full of zero vectors.
MAX_ZERO_VECTOR_FRACTION = 0.01


def _embed_cache_key(embedder_name: str, text: str) -> str:
    raw = f"{embedder_name}|{text}"
    return hashlib.sha256(raw.encode("utf-8", errors="ignore")).hexdigest()


def _load_embed_cache() -> dict:
    try:
        if EMBED_CACHE_PATH.exists():
            with open(EMBED_CACHE_PATH, "r", encoding="utf-8") as f:
                cache = json.load(f)
            if isinstance(cache, dict):
                return cache
    except Exception as e:
        logger.warning(f"Embed cache unreadable, starting fresh: {e}")
    return {}


def _save_embed_cache(cache: dict) -> None:
    EMBED_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = EMBED_CACHE_PATH.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False)
    os.replace(tmp, EMBED_CACHE_PATH)


def _is_zero_vector(vec) -> bool:
    return not vec or all(abs(float(x)) < 1e-9 for x in vec)


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
            # Region: prefer explicit JSON field, fall back to filename prefix
            # so chunks get a meaningful region even when source JSON omits it.
            region = (
                data.get("region", "")
                or data.get("metadata", {}).get("region", "")
            )
            if not region.strip():
                region = _region_from_filename(f.name)
            docs.append({
                "file_path": str(f),
                "file_name": f.name,
                "raw_text": raw_text,
                "title": data.get("title", f.stem[:50]),
                "doc_id": data.get("id", f.stem),
                "region": region,
                "metadata": data.get("metadata", {}),
            })
        except Exception as e:
            logger.warning(f"Failed to load {f.name}: {e}")

    logger.info(f"Loaded {len(docs)} documents with sufficient rawText")
    return docs


def _region_from_filename(filename: str) -> str:
    """
    Derive a region tag from the file's leading prefix.

    Patterns seen in data/corpus/processed/:
      AE_*.json, CN_*.json, EU_Official_*.json   -> use prefix as-is
      GCC_*.json, WIPO_*.json, Reference_*.json   -> use prefix as-is

    The chunk's region field is only used by ``metadata_filter.chunk_matches``,
    which does case-insensitive equality. GCC/WIPO/Reference chunks will only
    surface when the user explicitly queries for those regions, which is the
    correct behaviour (a WIPO treaty is not a specific market regulation).
    """
    head = filename.split("_", 1)[0]
    return head.upper() if head else ""


def _inject_source_meta(chunk: dict, doc: dict) -> dict:
    """Return a new chunk dict with source-file metadata attached (immutable)."""
    meta = dict(doc.get("metadata", {}))
    return {
        **chunk,
        "source_file": doc["file_name"],
        "source_id": doc["doc_id"],
        "metadata": meta,
        "source_url": meta.get("source_url", ""),
        "content_url": meta.get("content_url", ""),
        "official_channel": meta.get("official_channel", ""),
        "product_categories": (
            meta.get("product_categories") or meta.get("productCategories") or []
        ),
        "regulatory_types": (
            meta.get("regulatory_types") or meta.get("regulatoryTypes") or []
        ),
        "raw_files": meta.get("raw_files", []),
    }


def chunk_documents(docs: list[dict]) -> list[dict]:
    """Chunk all documents using LegalChunker.

    Parent-Child architecture: BOTH parent chunks (full Article/Section text,
    used for context expansion) and child chunks (300-500 token retrieval
    units) are returned so they can be indexed together. Each chunk carries a
    ``chunk_type`` of ``"parent"`` or ``"child"`` in its metadata, and every
    child records ``parent_id`` so retrieval can expand to its parent.
    """
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
                all_chunks.append(_inject_source_meta(child, doc))
            for parent in result.get("parent_chunks", []):
                all_chunks.append(_inject_source_meta(parent, doc))
        except Exception as e:
            logger.warning(f"Failed to chunk {doc['file_name']}: {e}")

    child_count = sum(1 for c in all_chunks if c.get("chunk_type") == "child")
    parent_count = sum(1 for c in all_chunks if c.get("chunk_type") == "parent")
    logger.info(
        f"Created {len(all_chunks)} chunks "
        f"({child_count} child, {parent_count} parent) from {len(docs)} documents"
    )
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
    """Embed chunks with the production ModelScope API embedder.

    Safety guarantees (vs. the previous implementation):
    - Failed/zero-vector chunks are DROPPED from the returned list, never
      silently mixed into the index as poison vectors.
    - A persistent ``embed_cache.json`` keys every successful embedding by
      ``(embedder, text)`` so rebuilds resume instead of re-paying the
      ModelScope quota for chunks we already have.
    - If the zero/failed fraction exceeds ``MAX_ZERO_VECTOR_FRACTION`` the
      whole run aborts: writing an index dominated by zero vectors produces
      silently broken retrieval and must never happen.
    """
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

    cache = _load_embed_cache()
    cache_hits = 0
    cache_misses = 0

    # Phase 1 — resolve everything we already have cached.
    pending_idx: list[int] = []
    pending_texts: list[str] = []
    for i, chunk in enumerate(chunks):
        prepend = chunk.get("prepend_en") or chunk.get("prepend_zh", "")
        content = chunk.get("content", "")
        text = f"{prepend}\n{content}" if prepend else content
        key = _embed_cache_key(name, text)
        cached = cache.get(key)
        if cached is not None:
            chunk["vector"] = cached
            cache_hits += 1
        else:
            pending_idx.append(i)
            pending_texts.append(text)
            cache_misses += 1

    logger.info(
        f"Embed cache: {cache_hits} hits, {cache_misses} misses "
        f"(cache file: {EMBED_CACHE_PATH})"
    )

    # Phase 2 — batch the misses through the embedder (50/batch, matching
    # ModelScope's free-tier rate limit), checkpointing after every batch so
    # an interrupted run can resume without losing work.
    failed_count = 0
    dim = getattr(embedder, "DIM", 0)
    for start in range(0, len(pending_texts), 50):
        batch_idx = pending_idx[start:start + 50]
        batch_texts = pending_texts[start:start + 50]
        try:
            vectors = embedder.embed_batch(batch_texts)
        except Exception as e:
            logger.error(f"Embed batch at {start} failed permanently: {e}")
            vectors = [[0.0] * (dim or 1024)] * len(batch_texts)

        for j, vec in enumerate(vectors):
            chunk = chunks[batch_idx[j]]
            if _is_zero_vector(vec):
                failed_count += 1
                chunk["vector"] = None  # mark for drop
                continue
            chunk["vector"] = vec
            if dim == 0:
                dim = len(vec)
            key = _embed_cache_key(name, batch_texts[j])
            cache[key] = vec

        _save_embed_cache(cache)

    # Phase 3 — drop poisoned chunks; they must never enter the index.
    good_chunks = [c for c in chunks if c.get("vector") is not None and not _is_zero_vector(c["vector"])]
    dropped = len(chunks) - len(good_chunks)

    if chunks:
        zero_fraction = dropped / len(chunks)
        if zero_fraction > MAX_ZERO_VECTOR_FRACTION:
            _save_embed_cache(cache)  # keep what we did learn
            raise RuntimeError(
                f"Embedding failure rate {zero_fraction:.1%} exceeds safe "
                f"threshold {MAX_ZERO_VECTOR_FRACTION:.0%}; refusing to write "
                f"a poisoned index ({dropped}/{len(chunks)} chunks dropped)."
            )

    if dropped:
        logger.warning(
            f"Dropped {dropped} chunks with missing/zero vectors "
            f"({dropped/len(chunks):.1%} of input)"
        )

    if dim == 0 and good_chunks:
        dim = len(good_chunks[0]["vector"])

    logger.info(
        f"Embedded {len(good_chunks)}/{len(chunks)} chunks "
        f"({dropped} dropped, dim={dim})"
    )
    return good_chunks, dim


def save_faiss(
    chunks: list[dict],
    dim: int,
    faiss_dir: Path = FAISS_DIR,
    build_info: dict | None = None,
):
    """Save chunks to Faiss index + JSON metadata.

    A (high-risk): parent chunks (``chunk_type == "parent"``) are always
    written to ``legal_chunks_meta.json`` so ``FaissRetriever.expand_to_parent``
    can resolve them, but they are only added to the main FAISS IndexFlatIP
    when ``INCLUDE_PARENT_IN_INDEX=true``. Defaulting to false halves the
    on-disk index size without losing context-expansion capability, because
    retrieval scores children and expands to parent via meta lookup, never
    by dense similarity on the parent vector itself.
    """
    import faiss
    import numpy as np

    faiss_dir = Path(faiss_dir)
    faiss_dir.mkdir(parents=True, exist_ok=True)

    # All chunks with a valid vector go into the metadata file so the
    # parent/sibling graph stays complete for expand_to_parent.
    chunks_with_vec = [c for c in chunks if c.get("vector") and not _is_zero_vector(c["vector"])]

    # FAISS index candidates: optionally exclude parent chunks to keep the
    # vector matrix lean. Parent metadata still ships in the meta JSON.
    if INCLUDE_PARENT_IN_INDEX:
        index_chunks = chunks_with_vec
    else:
        index_chunks = [c for c in chunks_with_vec if c.get("chunk_type") != "parent"]
        parent_only = len(chunks_with_vec) - len(index_chunks)
        if parent_only:
            logger.info(
                f"Excluding {parent_only} parent chunks from FAISS index "
                f"(INCLUDE_PARENT_IN_INDEX=false); parent metadata still "
                f"written to {faiss_dir / 'legal_chunks_meta.json'}"
            )

    vectors = [c["vector"] for c in index_chunks]
    if not vectors:
        logger.error("No vectors to save")
        return

    # Defense in depth: refuse to ever normalize zero vectors into the index,
    # even if a caller bypassed embed_chunks' guards.
    zero_count = sum(1 for v in vectors if all(abs(float(x)) < 1e-9 for x in v))
    if zero_count:
        raise RuntimeError(
            f"Refusing to write {zero_count} zero vectors into the index"
        )

    mat = np.array(vectors, dtype=np.float32)
    faiss.normalize_L2(mat)

    index = _build_index_backend(dim, faiss)
    index.add(mat)

    index_path = str(faiss_dir / "legal_chunks.index")
    meta_path = str(faiss_dir / "legal_chunks_meta.json")
    manifest_path = faiss_dir / "index_manifest.json"

    faiss.write_index(index, index_path)
    # Metadata carries the full chunk set (parents included) so
    # expand_to_parent can resolve parent + sibling context regardless of
    # whether parents were indexed as vectors.
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
