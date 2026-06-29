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
from glob import escape as glob_escape
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

        Note (P1-4): only the FAISS index (binary, opened by the faiss C
        extension) needs the ASCII-temp copy. The metadata JSON is read via
        Python's stdlib which handles Unicode paths natively, so we no longer
        copy meta_path. This avoids a 345 MB copy on every startup in the
        real deployment (data path contains non-ASCII chars).
        """
        inst = cls(index_path=index_path, meta_path=meta_path)

        _index_path = index_path
        tmp_dir: Optional[str] = None

        # Detect non-ASCII paths (faiss C extension can't open them on Windows).
        # Only the index file matters; the JSON is opened by Python directly.
        def has_non_ascii(s: str) -> bool:
            return any(ord(c) > 127 for c in s)

        if has_non_ascii(index_path):
            tmp_dir = tempfile.mkdtemp(prefix="faiss_")
            logger.warning(
                f"Non-ASCII index path detected ({index_path}), "
                f"copying index only to temp dir {tmp_dir} for faiss C extension compatibility"
            )
            _index_path = os.path.join(tmp_dir, os.path.basename(index_path))
            shutil.copy2(index_path, _index_path)
            logger.info(f"Copied index file to temp location: {_index_path}")

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

            # P1-4: prefer sharded metadata when the operator has split the
            # 345 MB single-file meta into ordered shards (see
            # ``FaissRetriever.split_meta_to_shards``). Shards load one file at
            # a time, dropping each parsed+raw string before the next read so
            # the transient peak is bounded by one shard (~tens of MB) instead
            # of the whole 345 MB. Falls back to the legacy single-file load.
            inst.chunks, shard_dim = cls._load_meta_chunks(meta_path)
            if shard_dim:
                inst.dim = shard_dim
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

    # ─── P1-4: sharded metadata loading ──────────────────────────────────────
    # Operators may split the 345 MB single-file ``legal_chunks_meta.json``
    # into ordered shards ``legal_chunks_meta.00000.json`` … ``.NNNNN.json``
    # next to the original file. When present, each shard is loaded and its
    # parsed list concatenated in numeric order so ``self.chunks[i]`` keeps
    # the same positional contract that ``search()`` relies on (FAISS row i).
    #
    # Each shard is read into a str, ``json.loads``-parsed, appended, then
    # both the str and the per-shard list are released before the next file
    # is opened — so the transient peak is bounded by ONE shard instead of
    # the full 345 MB. With ~50 shards this caps the meta peak at ~10 MB +
    # the steady-state parsed list, vs. ~800 MB peak for the eager single
    # ``json.load`` path (raw bytes + CPython parser intermediate).
    #
    # Migration (no rebuild, no re-embedding): run
    #   python -c "from rag_service.retrieval.faiss_retriever import \
    # FaissRetriever as F; F.split_meta_to_shards('<meta_path>', <shards>)"
    # then optionally delete or move aside the original meta file. The loader
    # auto-detects shards vs. single-file on every load.

    @staticmethod
    def _list_meta_shards(meta_path: str) -> Optional[list[str]]:
        """Return shard file paths in numeric order, or None when absent.

        A "shard" sibling of ``meta_path`` matches
        ``<stem>.<NNNNN>.json`` with 5-digit zero-padded numbering and lives
        in the same directory. Returns None when zero shards exist so callers
        fall back to the legacy single-file path.
        """
        p = Path(meta_path)
        if not p.is_absolute():
            p = p.resolve()
        parent = p.parent
        stem = p.stem  # e.g. "legal_chunks_meta" (without .json)
        shards: list[tuple[int, str]] = []
        for entry in parent.glob(f"{glob_escape(stem)}.*.json"):
            suffix = entry.stem[len(stem) + 1:]
            if suffix.isdigit():
                shards.append((int(suffix), str(entry)))
        if not shards:
            return None
        shards.sort(key=lambda t: t[0])
        return [path for _, path in shards]

    @classmethod
    def _load_meta_chunks(
        cls, meta_path: str
    ) -> tuple[list[dict], Optional[int]]:
        """Load chunk list + dim from either shards or the single meta file.

        Returns (chunks, dim). ``dim`` is None when not present in the meta
        (caller preserves its current ``self.dim`` in that case).
        """
        shards = cls._list_meta_shards(meta_path)
        if shards:
            return cls._load_meta_shards(shards)
        return cls._load_meta_single(meta_path)

    @classmethod
    def _load_meta_single(
        cls, meta_path: str
    ) -> tuple[list[dict], Optional[int]]:
        """Legacy single-file load. Mirrors the previous on-disk contract."""
        with open(meta_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            chunks = data.get("chunks", data)
            dim = data.get("dim")
        else:
            chunks = data
            dim = None
        return list(chunks), dim

    @classmethod
    def _load_meta_shards(
        cls, shard_paths: list[str]
    ) -> tuple[list[dict], Optional[int]]:
        """Stream shards one at a time to bound transient memory.

        Each shard is a JSON object ``{"dim": 1024, "chunks": [...]}``.
        ``dim`` is taken from the first shard that defines it. Chunk order
        across shards is the shard's numeric order, which preserves the
        positional contract with the FAISS index rows.
        """
        chunks: list[dict] = []
        dim: Optional[int] = None
        total = len(shard_paths)
        for i, path in enumerate(shard_paths, start=1):
            # Read+parse+append then drop references before the next file.
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            shard_chunks = (
                data.get("chunks", []) if isinstance(data, dict) else data
            )
            shard_dim = data.get("dim") if isinstance(data, dict) else None
            if shard_dim is not None and dim is None:
                dim = shard_dim
            chunks.extend(shard_chunks)
            logger.info(
                f"Loaded meta shard {i}/{total}: {path} "
                f"({len(shard_chunks)} chunks)"
            )
            del data, shard_chunks
        logger.info(
            f"Loaded all {total} meta shards: {len(chunks)} chunks total"
        )
        return chunks, dim

    @staticmethod
    def split_meta_to_shards(meta_path: str, num_shards: int = 50) -> list[str]:
        """Split an existing single-file meta JSON into ordered shards.

        One-shot migration helper for P1-4. No rebuild, no re-embedding: it
        only re-saves the same chunk list into ``num_shards`` files named
        ``<stem>.<NNNNN>.json`` next to the original. Preserves the chunk
        order so the FAISS row->chunk positional contract is unchanged.

        The original file is left untouched; delete it manually after
        verifying the shards load correctly.

        Returns the list of created shard paths in numeric order.
        """
        if num_shards <= 0:
            raise ValueError("num_shards must be a positive integer")
        with open(meta_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        dim = data.get("dim") if isinstance(data, dict) else None
        chunks = data.get("chunks", []) if isinstance(data, dict) else data
        total = len(chunks)
        per = (total + num_shards - 1) // num_shards

        stem = Path(meta_path).stem
        out_dir = Path(meta_path).parent
        created: list[str] = []
        for i in range(num_shards):
            start = i * per
            end = min(start + per, total)
            if start >= end:
                break
            shard_chunks = chunks[start:end]
            shard_path = str(out_dir / f"{stem}.{i:05d}.json")
            with open(shard_path, "w", encoding="utf-8") as out:
                json.dump(
                    {"dim": dim, "chunks": shard_chunks},
                    out,
                    ensure_ascii=False,
                )
            created.append(shard_path)
            logger.info(
                f"Wrote shard {shard_path}: {len(shard_chunks)} chunks "
                f"([{start}:{end}])"
            )
        logger.info(
            f"Split {meta_path} ({total} chunks) into {len(created)} shards"
        )
        return created

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
