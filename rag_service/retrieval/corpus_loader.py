"""Load processed regulation documents for the sparse BM25 fallback path."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from rag_service.chunker.legal_chunker import chunk_document

logger = logging.getLogger(__name__)


def _region_from_filename(filename: str) -> str:
    head = filename.split("_", 1)[0]
    return head.upper() if head else ""


def _source_metadata(chunk: dict, source: dict) -> dict:
    metadata = dict(source.get("metadata") or {})
    return {
        **chunk,
        "_fast_sparse": True,
        "source_file": source["file_name"],
        "source_id": source["doc_id"],
        "metadata": metadata,
        "source_url": metadata.get("source_url", ""),
        "content_url": metadata.get("content_url", ""),
        "official_channel": metadata.get("official_channel", ""),
        "product_categories": metadata.get("product_categories")
        or metadata.get("productCategories")
        or [],
        "regulatory_types": metadata.get("regulatory_types")
        or metadata.get("regulatoryTypes")
        or [],
        "raw_files": metadata.get("raw_files", []),
    }


def load_bm25_chunks_from_corpus(processed_dir: str | Path) -> list[dict]:
    """Build in-memory chunks when the dense FAISS index is unavailable.

    This path performs no embedding and writes no index files. It keeps the
    report pipeline operational with sparse retrieval while readiness still
    exposes ``faiss=false`` and ``modelscope_api_key=false``.
    """
    root = Path(processed_dir)
    chunks: list[dict] = []
    loaded_documents = 0

    for path in sorted(root.glob("*.json")):
        if "Screenshot_Pending" in path.name:
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            raw_text = data.get("rawText", "")
            if not isinstance(raw_text, str) or len(raw_text) < 100:
                continue
            metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
            source = {
                "file_name": path.name,
                "doc_id": data.get("id", path.stem),
                "title": data.get("title", path.stem[:50]),
                "region": data.get("region")
                or metadata.get("region")
                or _region_from_filename(path.name),
                "metadata": metadata,
            }
            result = chunk_document(
                raw_text=raw_text,
                doc_name=source["title"],
                doc_id=source["doc_id"],
                region=source["region"],
            )
            chunks.extend(
                _source_metadata(chunk, source)
                for chunk in result.get("parent_chunks", [])
            )
            loaded_documents += 1
        except (OSError, ValueError, TypeError) as exc:
            logger.warning("Skipping processed regulation %s: %s", path.name, exc)

    logger.info(
        "Sparse corpus fallback loaded %d chunks from %d documents",
        len(chunks),
        loaded_documents,
    )
    return chunks
