#!/usr/bin/env python3
"""Canonical FAISS build command: build the index, then seal its manifest."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from rag_service.retrieval.index_integrity import seal_index_manifest


def main() -> None:
    root = Path(__file__).parent.parent.resolve()
    output_dir = Path(os.environ.get("FAISS_INDEX_DIR", root / "data" / "faiss")).resolve()
    command = [sys.executable, str(root / "scripts" / "build_faiss.py"), *sys.argv[1:]]
    subprocess.run(command, cwd=root, check=True)
    seal_index_manifest(
        output_dir / "legal_chunks.index",
        output_dir / "legal_chunks_meta.json",
        output_dir / "index_manifest.json",
    )
    print(f"Sealed FAISS bundle: {output_dir}")


if __name__ == "__main__":
    main()
