#!/usr/bin/env python3
r"""
convert_faiss_to_hnsw.py - Convert an existing IndexFlatIP to IndexHNSWFlat
without re-embedding.

The production index (data/faiss/legal_chunks.index) is an IndexFlatIP that
holds the L2-normalised ModelScope vectors. Switching the backend to HNSW
gives sub-linear search at the cost of approximate recall. Rebuilding from
scratch would re-burn ModelScope quota (no embed_cache.json exists), but the
vectors are already in the flat index — we can reconstruct them and build the
HNSW graph directly. No API calls, minutes not hours.

The on-disk metadata (legal_chunks_meta.json) is untouched: HNSW keeps the
same row→chunk positional contract as the flat index, so ``search()`` returns
the same chunk ids.

Usage:
    # Convert the default production index in place (backs up the flat file):
    D:\python\python.exe scripts/convert_faiss_to_hnsw.py

    # Point at a different index / tune HNSW params:
    D:\python\python.exe scripts/convert_faiss_to_hnsw.py \
        --index data/faiss/legal_chunks.index \
        --m 32 --ef-construction 200

    # After converting, validate recall vs the flat backup:
    D:\python\python.exe scripts/convert_faiss_to_hnsw.py --validate
"""
import sys
sys.stdout.reconfigure(encoding="utf-8")

import argparse
import shutil
import tempfile
import time
from pathlib import Path

import faiss
import numpy as np

_APP_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INDEX = _APP_ROOT / "data" / "faiss" / "legal_chunks.index"
BACKUP_SUFFIX = ".flat.index.bak"


def _has_non_ascii(s: str) -> bool:
    return any(ord(c) > 127 for c in s)


class _AsciiWorkDir:
    """Stage index files in an ASCII temp dir for the faiss C extension.

    The faiss C extension cannot open paths containing non-ASCII chars on
    Windows (the production data dir lives under 火鹰合规/). FaissRetriever.load
    already works around this; we mirror the same trick for read AND write.
    """

    def __init__(self):
        self.path = Path(tempfile.mkdtemp(prefix="faiss_convert_"))

    def ascii(self, src: Path) -> Path:
        """Copy ``src`` into the temp dir and return the ASCII path."""
        dest = self.path / src.name
        shutil.copy2(src, dest)
        return dest

    def cleanup(self):
        shutil.rmtree(self.path, ignore_errors=True)


def _read_flat_vectors(index_path: str) -> tuple[np.ndarray, int]:
    """Load a flat index and reconstruct its raw stored vectors.

    IndexFlat stores vectors verbatim, so ``reconstruct_n`` returns exactly
    what was added (already L2-normalised at build time). Returns a
    contiguous (ntotal, dim) float32 array.
    """
    idx = faiss.read_index(index_path)
    ntotal = int(idx.ntotal)
    dim = int(idx.d)
    if ntotal == 0:
        raise RuntimeError(f"Index at {index_path} has 0 vectors")
    vecs = idx.reconstruct_n(0, ntotal)
    vecs = vecs.reshape(ntotal, dim).astype(np.float32, copy=False)
    return vecs, dim


def convert(
    index_path: Path,
    m: int,
    ef_construction: int,
    backup: bool,
) -> dict:
    """Convert IndexFlatIP → IndexHNSWFlat in place. Returns a stats dict."""
    index_path = index_path.resolve()
    if not index_path.exists():
        raise FileNotFoundError(f"Index not found: {index_path}")

    work = _AsciiWorkDir()
    try:
        # Stage the source into an ASCII temp path so faiss can open it.
        read_path = str(work.ascii(index_path))

        t0 = time.monotonic()
        vecs, dim = _read_flat_vectors(read_path)
        t_read = time.monotonic() - t0
        ntotal = vecs.shape[0]
        print(
            f"[1/3] Reconstructed {ntotal} vectors (dim={dim}) "
            f"from flat index in {t_read:.1f}s"
        )

        # Vectors in the flat index are already L2-normalised (build_faiss
        # normalises before add). Re-normalising is a cheap no-op safety net so
        # HNSW + INNER_PRODUCT keeps cosine semantics regardless of float drift.
        faiss.normalize_L2(vecs)

        t1 = time.monotonic()
        hnsw = faiss.IndexHNSWFlat(dim, m, faiss.METRIC_INNER_PRODUCT)
        hnsw.hnsw.efConstruction = ef_construction
        hnsw.add(vecs)
        t_build = time.monotonic() - t1
        assert hnsw.ntotal == ntotal, (
            f"HNSW ntotal {hnsw.ntotal} != input {ntotal}"
        )
        print(
            f"[2/3] Built IndexHNSWFlat(M={m}, efConstruction={ef_construction}) "
            f"in {t_build:.1f}s"
        )

        backup_path = index_path.with_suffix(BACKUP_SUFFIX)
        if backup:
            if backup_path.exists():
                print(f"      Backup already exists, keeping existing: {backup_path}")
            else:
                shutil.copy2(index_path, backup_path)
                print(f"      Backed up flat index → {backup_path}")

        # Write HNSW to an ASCII temp sibling (faiss C ext limitation), then
        # move it atomically to the final (possibly non-ASCII) location.
        tmp_ascii = work.path / "legal_chunks.hnsw.index"
        faiss.write_index(hnsw, str(tmp_ascii))
        if _has_non_ascii(str(index_path)):
            # shutil.move across filesystems handles the ASCII→non-ASCII hop.
            shutil.move(str(tmp_ascii), str(index_path))
        else:
            tmp_ascii.replace(index_path)
        print(f"[3/3] Wrote HNSW index → {index_path}")
    finally:
        work.cleanup()

    return {
        "vector_count": ntotal,
        "dim": dim,
        "m": m,
        "ef_construction": ef_construction,
        "backup_path": str(backup_path) if backup else None,
        "read_secs": round(t_read, 2),
        "build_secs": round(t_build, 2),
    }


def validate(
    index_path: Path,
    n_queries: int,
    ks: tuple[int, ...],
    ef_search: int,
    seed: int,
) -> dict:
    """Compare HNSW recall@k against the flat backup on shared random queries.

    Queries are random unit vectors in index dim — the point is to measure
    HNSW approximation error vs the exact flat baseline, independent of any
    embedding API. Reports recall@k = |HNSW_topk ∩ flat_topk| / k.
    """
    index_path = index_path.resolve()
    backup_path = index_path.with_suffix(BACKUP_SUFFIX)
    if not backup_path.exists():
        raise FileNotFoundError(
            f"No flat backup at {backup_path} to validate against. "
            "Run conversion first."
        )

    work = _AsciiWorkDir()
    try:
        flat = faiss.read_index(str(work.ascii(backup_path)))
        hnsw = faiss.read_index(str(work.ascii(index_path)))
    finally:
        work.cleanup()
    if not hasattr(hnsw, "hnsw"):
        raise RuntimeError(
            f"Index at {index_path} is not HNSW (type={type(hnsw).__name__})"
        )
    hnsw.hnsw.efSearch = ef_search
    print(
        f"Validating: {int(flat.ntotal)} vectors, "
        f"{n_queries} queries, efSearch={ef_search}, ks={list(ks)}"
    )

    dim = int(flat.d)
    rng = np.random.default_rng(seed)
    queries = rng.standard_normal((n_queries, dim)).astype(np.float32)
    faiss.normalize_L2(queries)

    max_k = max(ks)
    _, flat_ids = flat.search(queries, max_k)
    _, hnsw_ids = hnsw.search(queries, max_k)

    results: dict = {"n_queries": n_queries, "ef_search": ef_search}
    for k in ks:
        overlaps = []
        for i in range(n_queries):
            flat_set = set(int(x) for x in flat_ids[i, :k] if x >= 0)
            hnsw_set = set(int(x) for x in hnsw_ids[i, :k] if x >= 0)
            if not flat_set:
                continue
            overlaps.append(len(flat_set & hnsw_set) / len(flat_set))
        recall = float(np.mean(overlaps)) if overlaps else 0.0
        results[f"recall@{k}"] = round(recall, 4)
        print(f"  recall@{k:<2} = {recall:.4f}")
    return results


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Convert IndexFlatIP → IndexHNSWFlat (no re-embedding)."
    )
    parser.add_argument(
        "--index",
        type=Path,
        default=DEFAULT_INDEX,
        help=f"Path to legal_chunks.index (default: {DEFAULT_INDEX})",
    )
    parser.add_argument("--m", type=int, default=32, help="HNSW M (default 32)")
    parser.add_argument(
        "--ef-construction", type=int, default=200, help="efConstruction (default 200)"
    )
    parser.add_argument(
        "--no-backup", action="store_true", help="Skip backing up the flat index"
    )
    parser.add_argument(
        "--validate",
        action="store_true",
        help="Validate HNSW recall vs the flat backup instead of converting",
    )
    parser.add_argument(
        "--n-queries", type=int, default=500, help="Queries for --validate (default 500)"
    )
    parser.add_argument(
        "--ef-search",
        type=int,
        default=int(__import__("os").environ.get("FAISS_HNSW_EF_SEARCH", "64")),
        help="efSearch for --validate (default 64)",
    )
    parser.add_argument("--seed", type=int, default=20260629, help="RNG seed")
    args = parser.parse_args()

    if args.validate:
        validate(
            args.index,
            n_queries=args.n_queries,
            ks=(1, 5, 10, 20),
            ef_search=args.ef_search,
            seed=args.seed,
        )
        return 0

    stats = convert(
        args.index,
        m=args.m,
        ef_construction=args.ef_construction,
        backup=not args.no_backup,
    )
    print(
        f"\nDone: {stats['vector_count']} vectors converted "
        f"(read {stats['read_secs']}s, build {stats['build_secs']}s)."
    )
    if stats["backup_path"]:
        print(f"Flat backup kept at {stats['backup_path']}")
    print(
        "Verify recall with: "
        f"{sys.argv[0]} --validate --index {args.index}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
