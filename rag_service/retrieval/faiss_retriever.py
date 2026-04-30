#!/usr/bin/env python3
"""
faiss_retriever.py - Pure Python Faiss vector store, no Docker required.

Uses IndexFlatIP (inner product) + L2-normalize = equivalent to cosine.
5000 chunks x 1024dim x 4bytes = ~20MB, search < 1ms.
"""
from __future__ import annotations

import json
import logging
import os
import pickle
from pathlib import Path
from typing import Optional

import faiss
import numpy as np

logger = logging.getLogger(__name__)

DIM = 1024  # ModelScope Qwen3-Embedding-0.6B


class FaissRetriever:
    """
    Simple Faiss-based vector store.
    Supports build/search/save/load with JSON metadata.
    """

    def __init__(self, index_path: Optional[str] = None, meta_path: Optional[str] = None):
        self.index: Optional[faiss.Index] = None
        self.chunks: list[dict] = []
        self.index_path = index_path
        self.meta_path = meta_path

    def build_index(self, chunks: list[dict], vectors: list[list[float]]) -> None:
        """
        Build Faiss index from chunks + pre-computed vectors.

        Args:
            chunks: list of chunk dicts (must have 'id' field)
            vectors: list of 1024-dim float vectors, aligned with chunks
        """
        if not chunks or not vectors:
            raise ValueError("chunks and vectors must be non-empty")

        mat = np.array(vectors, dtype=np.float32)
        assert mat.shape == (len(chunks), DIM), f"Expected ({len(chunks)}, {DIM}), got {mat.shape}"

        # Normalize for cosine similarity via inner product
        faiss.normalize_L2(mat)

        self.index = faiss.IndexFlatIP(DIM)
        self.index.add(mat)
        self.chunks = list(chunks)

        logger.info(f"Faiss index built: {self.index.ntotal} vectors, dim={DIM}")

    def search(self, query_vec: list[float], top_k: int = 50) -> list[dict]:
        """
        Search index for top_k nearest chunks.

        Args:
            query_vec: 1024-dim query vector
            top_k: number of results

        Returns:
            list of chunk dicts with 'id', 'score' fields added
        """
        if self.index is None:
            logger.warning("Faiss index not built, returning empty")
            return []

        q = np.array([query_vec], dtype=np.float32)
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
            json.dump(self.chunks, f, ensure_ascii=False)

        logger.info(f"Saved index to {index_path} ({self.index.ntotal} vectors)")

    @classmethod
    def load(cls, index_path: str, meta_path: str) -> "FaissRetriever":
        """Load index + metadata from disk."""
        inst = cls(index_path=index_path, meta_path=meta_path)
        inst.index = faiss.read_index(index_path)

        with open(meta_path, "r", encoding="utf-8") as f:
            inst.chunks = json.load(f)

        logger.info(f"Loaded index from {index_path} ({inst.index.ntotal} vectors)")
        return inst

    def __len__(self) -> int:
        return int(self.index.ntotal) if self.index else 0