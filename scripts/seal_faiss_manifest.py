#!/usr/bin/env python3
"""Seal an existing Attrax FAISS bundle with hashes and structural metadata."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from rag_service.retrieval.index_integrity import seal_index_manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--index", type=Path, default=Path("data/faiss/legal_chunks.index"))
    parser.add_argument(
        "--metadata",
        type=Path,
        default=Path("data/faiss/legal_chunks_meta.json"),
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("data/faiss/index_manifest.json"),
    )
    args = parser.parse_args()
    sealed = seal_index_manifest(args.index, args.metadata, args.manifest)
    print(json.dumps(sealed, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
