"""Shared pytest configuration for rag_service.

Centralizes the project-root sys.path insertion so individual test files no
longer need to be the sole carrier of that responsibility. Existing per-file
`sys.path.insert(...)` lines are intentionally left in place (they are
idempotent) to avoid disturbing working imports.

Marker taxonomy (see also pyproject.toml / pytest.ini):
  - unit            : pure-logic, no FAISS index / no external model / no network
  - integration     : touches multiple modules or in-memory fakes together
  - requires_index  : needs a built data/faiss index (cannot run in CI yet)
  - slow            : long-running; excluded from the default fast gate
"""
from __future__ import annotations

import os
import sys

# Project root = parent of this conftest's package directory (rag_service/).
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)
