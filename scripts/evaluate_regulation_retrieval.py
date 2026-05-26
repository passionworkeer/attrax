#!/usr/bin/env python3
"""CLI wrapper for the regulation retrieval evaluation runner."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rag_service.eval.regulation_retrieval_eval import main


if __name__ == "__main__":
    raise SystemExit(main())
