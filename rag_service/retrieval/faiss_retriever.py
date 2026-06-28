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
import shutil
import tempfile
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
            # P0-2 fail-loud: this used to be a silent warning + empty
            # result, which made dense retrieval appear healthy while
            # actually being 100% disabled. Promote to ERROR so the
            # mismatch is visible in production logs.
            logger.error(
                "FAISS search DISABLED: query vector dim=%d != index dim=%d. "
                "Previously this silently returned [], hiding the fact that "
                "dense retrieval was offline. Caller should rebuild the "
                "index or switch embedder.",
                q.shape[1],
                self.dim,
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
        """Load index + metadata from disk; detects dimension automatically.

        Handles non-ASCII paths (e.g. Chinese characters in Windows paths) by
        copying files to a temp location that the faiss C extension can open.
        The temp dir is always cleaned up; previously the copies leaked on
        every load and were left for the OS temp lifecycle to GC.
        """
        inst = cls(index_path=index_path, meta_path=meta_path)

        _index_path = index_path
        _meta_path = meta_path
        tmp_dir: Optional[str] = None

        # Detect non-ASCII paths (faiss C extension can't open them on Windows)
        def has_non_ascii(s: str) -> bool:
            return any(ord(c) > 127 for c in s)

        if has_non_ascii(index_path) or has_non_ascii(meta_path):
            tmp_dir = tempfile.mkdtemp(prefix="faiss_")
            logger.warning(
                f"Non-ASCII path detected ({index_path}), "
                f"copying index to temp dir {tmp_dir} for faiss C extension compatibility"
            )
            _index_path = os.path.join(tmp_dir, os.path.basename(index_path))
            _meta_path = os.path.join(tmp_dir, os.path.basename(meta_path))
            shutil.copy2(index_path, _index_path)
            shutil.copy2(meta_path, _meta_path)
            logger.info(f"Copied index files to temp location: {_index_path}")

        try:
            try:
                inst.index = faiss.read_index(_index_path)
            except Exception as e:
                raise RuntimeError(
                    f"Failed to load faiss index from {_index_path}. "
                    f"Original path was {index_path}. Error: {e}"
                ) from e

            # HNSW indices need an efSearch hint before search to trade recall
            # vs. latency. Flat indices do not expose ``hnsw`` so this is a no-op
            # for the default flat backend, keeping load semantics unchanged.
            if hasattr(inst.index, "hnsw"):
                ef_search = int(os.environ.get("FAISS_HNSW_EF_SEARCH", "64"))
                inst.index.hnsw.efSearch = ef_search
                logger.info(f"HNSW efSearch set to {ef_search}")

            with open(_meta_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                # Support both old format (list) and new format (dict with dim)
                inst.chunks = data.get("chunks", data) if isinstance(data, dict) else data
                inst.dim = data.get("dim", DEFAULT_DIM) if isinstance(data, dict) else DEFAULT_DIM
        finally:
            # Always clean up the temp dir we created so repeated loads do
            # not leak files. Best-effort: failures here are logged and
            # swallowed because the index is already loaded (or the load
            # error already raised) by this point.
            if tmp_dir is not None:
                try:
                    shutil.rmtree(tmp_dir, ignore_errors=True)
                except Exception as cleanup_err:  # pragma: no cover - best-effort
                    logger.warning(f"Temp faiss dir cleanup failed: {cleanup_err}")

        logger.info(
            f"Loaded index from {index_path} "
            f"({inst.index.ntotal} vectors, dim={inst.dim})"
        )
        return inst

    def __len__(self) -> int:
        return int(self.index.ntotal) if self.index else 0

    # ─── A (high-risk): parent-context expansion ────────────────────────────
    # The index mixes parent chunks (full Article/Section text, used for LLM
    # context) and child chunks (300-500 token retrieval units). Retrieval
    # surfaces children by score; the generator then expands a child to its
    # parent + siblings so the LLM sees the surrounding legal context.
    #
    # Previously this expansion did not exist: A4 ingested parent_chunks into
    # the index but no retrieval-layer API exposed them, so the parent data
    # was effectively dead weight. ``expand_to_parent`` closes that loop.
    # It is read-only and side-effect-free (returns new dicts); callers
    # (generator node) decide whether/when to invoke it.

    def expand_to_parent(self, child_chunks: list[dict]) -> list[dict]:
        """Expand child chunks to their parent + sibling context.

        For each child that carries a ``parent_id``, look up the parent
        chunk and all other chunks sharing that ``parent_id`` (siblings)
        from the loaded metadata, and return a de-duplicated, order-stable
        list that includes the originals plus their expanded context.

        Parent chunks themselves (``chunk_type == "parent"``) and chunks
        without a ``parent_id`` pass through unchanged.

        Args:
            child_chunks: scored retrieval hits (typically the output of
                ``search()``). Dicts are not mutated.

        Returns:
            A new list of chunk dicts. Each input child is preserved, and
            for every child with a ``parent_id`` the matching parent chunk
            (if present in the loaded metadata) and any sibling children
            of the same parent are appended. De-duplicated by chunk ``id``
            in stable insertion order.
        """
        if not child_chunks:
            return []

        # Index loaded metadata by id and by parent_id for O(1) lookups.
        # ``self.chunks`` is the authoritative source: parent chunks live
        # here alongside their children (build_faiss writes both into the
        # meta JSON even when INCLUDE_PARENT_IN_INDEX=false keeps parents
        # out of the FAISS vectors themselves).
        by_id: dict[str, dict] = {}
        by_parent: dict[str, list[dict]] = {}
        for c in self.chunks:
            cid = c.get("id")
            if cid is not None:
                by_id[cid] = c
            pid = c.get("parent_id")
            if pid:
                by_parent.setdefault(pid, []).append(c)

        # Parent chunks themselves are also retrievable by their own id so
        # ``expand_to_parent`` on a parent input returns it unchanged.
        for c in self.chunks:
            if c.get("chunk_type") == "parent" and c.get("id") is not None:
                # Already in by_id; nothing extra to do.
                pass

        seen: set[str] = set()
        expanded: list[dict] = []

        def _emit(chunk: dict) -> None:
            cid = chunk.get("id")
            key = cid if cid is not None else id(chunk)
            if key in seen:
                return
            seen.add(key)
            expanded.append(dict(chunk))

        for child in child_chunks:
            _emit(child)
            pid = child.get("parent_id")
            if not pid:
                continue
            # 1) The parent chunk itself (full Article/Section text).
            parent = by_id.get(pid)
            if parent is not None:
                _emit(parent)
            # 2) Sibling children of the same parent (surrounding context).
            for sibling in by_parent.get(pid, []):
                _emit(sibling)

        return expanded
