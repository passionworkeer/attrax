#!/usr/bin/env python3
"""
test_retrieval_flag.py — Tests for §7.7 step 1 RETRIEVAL_ENABLED flag.

Spec: docs/plans/2026-09-11-de-rag-evidence-spec.md §7.7 step 1.

Default is TRUE (legacy retrieval active) so the deployed system is
unchanged. Setting RETRIEVAL_ENABLED=false bypasses the retrieval
stack: `retriever_node` returns `{"documents": []}` without touching
FAISS/BM25/embedder, and `fan_out_markets` collapses to a single Send.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

from rag_service.orchestrator.nodes import retriever as retriever_module  # noqa: E402


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("RETRIEVAL_ENABLED", raising=False)


class TestRetrievalFlag:
    def test_default_is_enabled(self, monkeypatch):
        # No env var → legacy retrieval active (deployed behavior)
        monkeypatch.delenv("RETRIEVAL_ENABLED", raising=False)
        assert retriever_module._retrieval_enabled() is True

    @pytest.mark.parametrize("value", ["0", "false", "no", "off", "FALSE"])
    def test_disabled_values(self, monkeypatch, value):
        monkeypatch.setenv("RETRIEVAL_ENABLED", value)
        assert retriever_module._retrieval_enabled() is False

    @pytest.mark.parametrize("value", ["1", "true", "yes", "on", "TRUE"])
    def test_enabled_values(self, monkeypatch, value):
        monkeypatch.setenv("RETRIEVAL_ENABLED", value)
        assert retriever_module._retrieval_enabled() is True

    def test_retriever_node_returns_empty_when_disabled(self, monkeypatch):
        # With RETRIEVAL_ENABLED=false the node short-circuits to
        # {"documents": []} — no retriever instance needed.
        monkeypatch.setenv("RETRIEVAL_ENABLED", "false")
        retriever_module._retriever_instance = None
        retriever_module._is_injected = True  # avoid lazy init
        state = {"sub_queries": [{"query": "x", "market": "EU"}]}
        result = retriever_module.retriever_node(state)
        assert result == {"documents": []}

    def test_fan_out_collapses_to_one_send_when_disabled(self, monkeypatch):
        monkeypatch.setenv("RETRIEVAL_ENABLED", "false")
        state = {
            "sub_queries": [
                {"query": "x", "market": "EU"},
                {"query": "y", "market": "US"},
            ]
        }
        sends = retriever_module.fan_out_markets(state)
        # Collapsed pipeline: exactly one Send (the no-op marker)
        assert len(sends) == 1

    def test_fan_out_full_when_enabled(self, monkeypatch):
        monkeypatch.setenv("RETRIEVAL_ENABLED", "true")
        state = {
            "sub_queries": [
                {"query": "x", "market": "EU"},
                {"query": "y", "market": "US"},
            ]
        }
        sends = retriever_module.fan_out_markets(state)
        assert len(sends) == 2  # one per market (legacy fan-out)


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))