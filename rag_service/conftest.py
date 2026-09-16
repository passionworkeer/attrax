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

import pytest


@pytest.fixture(autouse=True)
def _isolated_vision_cache(tmp_path, monkeypatch):
    """Point the vision response cache at a per-test tmp dir.

    The cache is module-global and (in production) persists across
    sessions by design — without this fixture a successful analyze test
    poisons every later failure-path test that reuses the same image
    bytes (observed 2026-09-13 when the cache landed).
    """
    from rag_service.verify import vision_cache

    monkeypatch.setattr(
        "rag_service.pipeline.nodes.vision._vision_cache",
        vision_cache.VisionResponseCache(tmp_path),
    )
    yield


@pytest.fixture(autouse=True)
def _disable_live_vision_fallback(monkeypatch):
    """Keep unit tests off the live DeepSeek fallback endpoints.

    ``resolve_deepseek_config`` reads the process env, and ``rag_service.config``
    seeds that env from ``rag_service/.env`` at import time — so a developer with
    a real key in their .env would have every "primary provider failed" test make
    a real network call, and a non-default ``DEEPSEEK_MAX_TOKENS`` would leak
    into the budget assertions. Clearing the names here makes "no fallback
    configured" the test default; fallback tests set what they need explicitly.
    """
    for name in (
        "DEEPSEEK_API_KEY",
        "DEEPSEEK_BASE_URL",
        "DEEPSEEK_ANTHROPIC_BASE_URL",
        "DEEPSEEK_MODEL",
        "DEEPSEEK_MAX_TOKENS",
    ):
        monkeypatch.delenv(name, raising=False)
    yield
