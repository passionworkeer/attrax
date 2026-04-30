#!/usr/bin/env python3
"""
faiss_retriever.py - Pure Python Faiss vector store, no Docker required.

Uses IndexFlatIP (inner product) + L2-normalize = equivalent to cosine.
Dimension is auto-detected from loaded index or input vectors (not hardcoded).
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Optional

import faiss
import numpy as np

logger = logging.getLogger(__name__)

# Default dimension (Qwen3-Embedding-0.6B); will be overridden on load
DEFAULT_DIM = 1024


class FaissRetriever:
    """
    Simple Faiss-based vector store.
    Supports build/search/save/load with JSON metadata.
    Dimension is detected automatically from the index or input vectors.
    """

    def __init__(self, index_path: Optional[str] = None, meta_path: Optional[str] = None):
        self.index: Optional[faiss.Index] = None
        self.chunks: list[dict] = []
        self.index_path = index_path
        self.meta_path = meta_path
        self.dim: int = DEFAULT_DIM  # runtime dimension

    @property
    def is_loaded(self) -> bool:
        return self.index is not None

    def build_index(self, chunks: list[dict], vectors: list[list[float]]) -> None:
        """
        Build Faiss index from chunks + pre-computed vectors.
        Dimension is inferred from the first vector.

        Args:
            chunks: list of chunk dicts (must have 'id' field)
            vectors: list of float vectors (any supported dimension)
        """
        if not chunks or not vectors:
            raise ValueError("chunks and vectors must be non-empty")

        mat = np.array(vectors, dtype=np.float32)
        if mat.ndim == 1:
            mat = mat.reshape(1, -1)

        self.dim = mat.shape[1]
        logger.info(f"FaissRetriever building index: dim={self.dim}, count={mat.shape[0]}")

        faiss.normalize_L2(mat)
        self.index = faiss.IndexFlatIP(self.dim)
        self.index.add(mat)
        self.chunks = list(chunks)

        logger.info(f"Faiss index built: {self.index.ntotal} vectors, dim={self.dim}")

    def search(self, query_vec: list[float], top_k: int = 50) -> list[dict]:
        """
        Search index for top_k nearest chunks.

        Args:
            query_vec: query vector (dimension must match index)
            top_k: number of results

        Returns:
            list of chunk dicts with 'id', 'score' fields added
        """
        if self.index is None:
            logger.warning("Faiss index not built, returning empty")
            return []

        q = np.array([query_vec], dtype=np.float32)

        if q.shape[1] != self.dim:
            logger.warning(
                f"Query vector dim={q.shape[1]} != index dim={self.dim}, "
                "skipping Faiss search (fallback to BM25)"
            )
            return []

        faiss.normalize_L2(q)
        scores, indices = self.index.search(q, min(top_k, int(self.index.ntotal)))

        results = []
        for j, idx in enumerate(indices[0]):
            if idx < 0:
                continue
            chunk = dict(self.chunks[idx])
            chunk["score"] = float(scores[0][j])
            results.append(chunk)

        return results

    def save(self, index_path: str, meta_path: str) -> None:
        """Persist index + metadata to disk."""
        if self.index is None:
            raise RuntimeError("No index to save")

        os.makedirs(os.path.dirname(index_path) or ".", exist_ok=True)
        faiss.write_index(self.index, index_path)

        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump({
                "dim": self.dim,
                "chunks": self.chunks,
            }, f, ensure_ascii=False)

        logger.info(f"Saved index to {index_path} ({self.index.ntotal} vectors, dim={self.dim})")

    @classmethod
    def load(cls, index_path: str, meta_path: str) -> "FaissRetriever":
        """Load index + metadata from disk; detects dimension automatically."""
        inst = cls(index_path=index_path, meta_path=meta_path)
        inst.index = faiss.read_index(index_path)

        with open(meta_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            # Support both old format (list) and new format (dict with dim)
            inst.chunks = data.get("chunks", data) if isinstance(data, dict) else data
            inst.dim = data.get("dim", DEFAULT_DIM) if isinstance(data, dict) else DEFAULT_DIM

        logger.info(
            f"Loaded index from {index_path} "
            f"({inst.index.ntotal} vectors, dim={inst.dim})"
        )
        return inst

    def __len__(self) -> int:
        return int(self.index.ntotal) if self.index else 0
