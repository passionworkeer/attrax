"""Integrity sealing and validation for FAISS index bundles."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


MANIFEST_SCHEMA_VERSION = 2


class IndexIntegrityError(RuntimeError):
    """Raised when index, metadata, and manifest cannot be trusted together."""


@dataclass(frozen=True)
class IndexBundleSnapshot:
    index_path: Path
    metadata_path: Path
    manifest_path: Path
    index_sha256: str
    metadata_sha256: str
    dimension: int
    vector_count: int
    chunk_count: int


def sha256_file(path: str | Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        while block := stream.read(chunk_size):
            digest.update(block)
    return digest.hexdigest()


def _load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise IndexIntegrityError(f"cannot read JSON artifact: {path}") from exc


def _metadata_shape(metadata_path: Path) -> tuple[int, int]:
    """Deep build-time validation; intentionally not used on production boot."""
    payload = _load_json(metadata_path)
    if isinstance(payload, dict):
        dimension = payload.get("dim")
        chunks = payload.get("chunks")
    else:
        dimension = None
        chunks = payload
    if not isinstance(dimension, int) or dimension <= 0:
        raise IndexIntegrityError("metadata dimension is missing or invalid")
    if not isinstance(chunks, list) or not chunks:
        raise IndexIntegrityError("metadata chunks are missing or empty")
    identifiers: list[str] = []
    for index, chunk in enumerate(chunks):
        if not isinstance(chunk, dict):
            raise IndexIntegrityError(f"metadata chunk {index} is not an object")
        identifier = chunk.get("id")
        if not isinstance(identifier, str) or not identifier:
            raise IndexIntegrityError(f"metadata chunk {index} has no stable id")
        identifiers.append(identifier)
    if len(set(identifiers)) != len(identifiers):
        raise IndexIntegrityError("metadata contains duplicate chunk ids")
    return dimension, len(chunks)


def _faiss_shape(index_path: Path) -> tuple[int, int]:
    try:
        import faiss
    except ImportError as exc:
        raise IndexIntegrityError("faiss is required to validate the index") from exc
    try:
        index = faiss.read_index(str(index_path))
    except Exception as exc:
        raise IndexIntegrityError(f"cannot load FAISS index: {index_path}") from exc
    dimension = int(getattr(index, "d", 0))
    vector_count = int(getattr(index, "ntotal", 0))
    if dimension <= 0 or vector_count <= 0:
        raise IndexIntegrityError("FAISS index has invalid dimension or vector count")
    return dimension, vector_count


def _paths(
    index_path: str | Path,
    metadata_path: str | Path,
    manifest_path: str | Path,
) -> tuple[Path, Path, Path]:
    paths = tuple(
        Path(path).resolve()
        for path in (index_path, metadata_path, manifest_path)
    )
    missing = [str(path) for path in paths if not path.is_file()]
    if missing:
        raise IndexIntegrityError(f"index bundle is incomplete: {', '.join(missing)}")
    return paths


def inspect_index_bundle(
    index_path: str | Path,
    metadata_path: str | Path,
    manifest_path: str | Path,
) -> IndexBundleSnapshot:
    """Deep inspection used while sealing/building on a sufficiently large host."""
    index, metadata, manifest = _paths(index_path, metadata_path, manifest_path)
    metadata_dim, chunk_count = _metadata_shape(metadata)
    index_dim, vector_count = _faiss_shape(index)
    if index_dim != metadata_dim:
        raise IndexIntegrityError(
            f"dimension mismatch: index={index_dim}, metadata={metadata_dim}"
        )
    if vector_count > chunk_count:
        raise IndexIntegrityError(
            f"vector count exceeds metadata count: {vector_count}>{chunk_count}"
        )
    return IndexBundleSnapshot(
        index_path=index,
        metadata_path=metadata,
        manifest_path=manifest,
        index_sha256=sha256_file(index),
        metadata_sha256=sha256_file(metadata),
        dimension=index_dim,
        vector_count=vector_count,
        chunk_count=chunk_count,
    )


def seal_index_manifest(
    index_path: str | Path,
    metadata_path: str | Path,
    manifest_path: str | Path,
) -> dict[str, Any]:
    snapshot = inspect_index_bundle(index_path, metadata_path, manifest_path)
    raw = _load_json(snapshot.manifest_path)
    if not isinstance(raw, dict):
        raise IndexIntegrityError("manifest must be a JSON object")
    sealed = {
        **raw,
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "index_sha256": snapshot.index_sha256,
        "metadata_sha256": snapshot.metadata_sha256,
        "dim": snapshot.dimension,
        "vector_count": snapshot.vector_count,
        "chunk_count": snapshot.chunk_count,
    }
    temporary = snapshot.manifest_path.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(sealed, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(snapshot.manifest_path)
    return sealed


def validate_index_bundle(
    index_path: str | Path,
    metadata_path: str | Path,
    manifest_path: str | Path,
    *,
    require_hashes: bool = True,
    deep_metadata: bool = False,
) -> IndexBundleSnapshot:
    """Validate without loading the large metadata JSON by default.

    Production startup uses streaming SHA-256 plus sealed build-time counts.
    `deep_metadata=True` is reserved for build/test machines and additionally
    parses every chunk and checks duplicate ids.
    """
    index, metadata, manifest_path_resolved = _paths(
        index_path, metadata_path, manifest_path
    )
    manifest = _load_json(manifest_path_resolved)
    if not isinstance(manifest, dict):
        raise IndexIntegrityError("manifest must be a JSON object")

    index_dim, vector_count = _faiss_shape(index)
    dimension = manifest.get("dim")
    chunk_count = manifest.get("chunk_count")
    manifest_vector_count = manifest.get("vector_count")
    if not isinstance(dimension, int) or dimension <= 0:
        raise IndexIntegrityError("manifest dimension is missing or invalid")
    if not isinstance(chunk_count, int) or chunk_count <= 0:
        raise IndexIntegrityError("manifest chunk_count is missing or invalid")
    if manifest_vector_count != vector_count:
        raise IndexIntegrityError(
            f"manifest vector_count mismatch: expected {vector_count}, got {manifest_vector_count!r}"
        )
    if dimension != index_dim:
        raise IndexIntegrityError(
            f"manifest dimension mismatch: expected {index_dim}, got {dimension!r}"
        )
    if vector_count > chunk_count:
        raise IndexIntegrityError(
            f"vector count exceeds metadata count: {vector_count}>{chunk_count}"
        )

    index_hash = sha256_file(index)
    metadata_hash = sha256_file(metadata)
    if require_hashes:
        if manifest.get("schema_version") != MANIFEST_SCHEMA_VERSION:
            raise IndexIntegrityError("manifest is not sealed with schema version 2")
        if manifest.get("index_sha256") != index_hash:
            raise IndexIntegrityError("FAISS index hash does not match manifest")
        if manifest.get("metadata_sha256") != metadata_hash:
            raise IndexIntegrityError("metadata hash does not match manifest")

    if deep_metadata:
        metadata_dim, actual_chunk_count = _metadata_shape(metadata)
        if metadata_dim != dimension:
            raise IndexIntegrityError(
                f"metadata dimension mismatch: expected {dimension}, got {metadata_dim}"
            )
        if actual_chunk_count != chunk_count:
            raise IndexIntegrityError(
                f"metadata chunk count mismatch: expected {chunk_count}, got {actual_chunk_count}"
            )

    return IndexBundleSnapshot(
        index_path=index,
        metadata_path=metadata,
        manifest_path=manifest_path_resolved,
        index_sha256=index_hash,
        metadata_sha256=metadata_hash,
        dimension=index_dim,
        vector_count=vector_count,
        chunk_count=chunk_count,
    )
