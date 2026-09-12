#!/usr/bin/env python3
"""
pipeline package — the collapsed De-RAG scan pipeline (spec §7.7).

Replaces the LangGraph orchestrator with a linear three-step flow:

    vision → generate (KB-anchored) → verify (quote matcher)

`run_compliance_graph` keeps the exact signature the application layer
(`main.py`, `ScanService`) already calls, so the collapse is invisible
to callers.
"""
from rag_service.pipeline.runner import run_compliance_graph

__all__ = ["run_compliance_graph"]