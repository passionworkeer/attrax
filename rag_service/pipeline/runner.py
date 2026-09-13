#!/usr/bin/env python3
"""
runner.py — Linear scan pipeline (De-RAG spec §7.7).

Replaces the LangGraph StateGraph with a plain three-step flow:

    1. vision      — analyze uploaded images (MiniMax vision call)
    2. generate    — KB-anchored LLM generation:
                     mandatory_regulations (KB anchors)
                     + article_texts (regulation library bodies)
                     + key_points → one package JSON incl. citations[]
    3. verify      — deterministic quote matching:
                     citations[].quote_span + match_status + evidencePack

No retrieval stack, no embedder, no LangGraph. The only external API is
the MiniMax LLM (vision + generation share the key).

`run_compliance_graph` keeps the exact signature and return shape the
application layer (main.py `_run_scan_request`) already consumes, so the
collapse is invisible to HTTP callers.

Final status mapping (§7.7 contract change): the legacy graph derived
PASS/REJECTED from the NLI `generation_score`, which no longer exists.
The pipeline derives status from the LLM's own `decisionView.verdict`,
falling back to generation success:
  - verdict PASS/WARN/REJECTED → surfaced as-is
  - verdict missing/UNKNOWN + generation failed → REJECTED
  - verdict missing/UNKNOWN + generation ok → UNKNOWN surfaced honestly
"""
from __future__ import annotations

import logging
from typing import Callable, Optional

from rag_service.pipeline.state import GraphState, initial_state
from rag_service.pipeline.nodes.vision import vision_analysis_node
from rag_service.pipeline.nodes.generator import generator_node
from rag_service.pipeline.nodes.verifier import verifier_node

logger = logging.getLogger(__name__)


# Stage progress milestones (audit 2026-09-13 §4.1). The plan calls for an
# explicit [floor, ceiling] per stage so the burning page can drive a smooth
# async animation between polls. These defaults are used when the runner is
# called directly (tests, scripts). When called from ScanService, the
# application layer injects a `progress_callback` that maps the same stage
# key to its session.update() side-effect.
STAGE_PROGRESS: dict[str, tuple[int, int]] = {
    "vision":   (12, 30),
    "applicability": (30, 36),
    "generate": (36, 83),
    "verify":   (83, 93),
    "persist":  (93, 98),
}


def _merge(state: GraphState, update: dict) -> GraphState:
    """Merge a node's partial return into the state.

    Mirrors the LangGraph semantics the nodes were written against:
    - `agent_trace` is append-only (nodes return only their NEW entry —
      the 2026-06-29 audit invariant survives the collapse).
    - every other key overwrites.
    """
    next_state = dict(state)
    for key, value in update.items():
        if key == "agent_trace" and isinstance(value, list):
            next_state["agent_trace"] = list(state.get("agent_trace", [])) + list(value)
        else:
            next_state[key] = value
    return next_state


def _emit(
    callback: Optional[Callable[[str, str, int], None]],
    stage_key: str,
    stage_state: str,
    progress: int,
) -> None:
    """Fire a progress event to the application layer if a callback exists.

    The callback is invoked from the executor thread; the application layer
    is responsible for thread safety (FileBackend.save_session holds an
    RLock, so the default backend is fine).
    """
    if callback is None:
        return
    try:
        callback(stage_key, stage_state, progress)
    except Exception as exc:  # pragma: no cover - safety net only
        logger.debug("progress_callback for %s failed: %s", stage_key, exc)


def _final_status(state: GraphState) -> str:
    """Derive PASS/WARN/REJECTED from the package with strict validation grounding."""
    pkg = state.get("report_package") or {}
    audit = pkg.get("auditMetadata") or {}
    validation_status = audit.get("validationStatus")

    # If the package failed schema validation or fell back to an unverified template,
    # never grant a fake PASS or WARN.
    if validation_status in {"invalid", "fallback"}:
        return "UNKNOWN"

    generation = str(state.get("generation") or "").strip()
    if not generation or generation.startswith("错误") or generation.lower().startswith("error"):
        return "UNKNOWN"

    verdict = str((pkg.get("decisionView") or {}).get("verdict") or "").upper()
    if verdict in {"PASS", "WARN", "REJECTED", "UNKNOWN"}:
        return verdict

    return "UNKNOWN"


def run_compliance_graph(
    query: str,
    product: str = "",
    category: str = "",
    markets: list[str] = None,
    vision_result: dict = None,
    images: list[dict] = None,
    documents: list[dict] = None,
    progress_callback: Optional[Callable[[str, str, int], None]] = None,
) -> dict:
    """Run the collapsed three-step pipeline.

    Args:
        query: user query
        product: product name
        category: product category (electronics/toy/battery/...)
        markets: target markets (EU/US/UK/CN/AU)
        vision_result: pre-computed vision analysis result (API path)
        images: list of {"buffer": bytes, "mime_type": str}
        documents: user-uploaded docs [{"name", "mime_type", "text"}]
        progress_callback: optional `(stage_key, stage_state, progress) -> None`
            invoked at every stage boundary. Used by ScanService to drive the
            burning page's progress bar (audit 2026-09-13 §4.1 — the prior
            version only emitted 10/100). The callback runs on the executor
            thread; the caller is responsible for thread safety.

    Returns:
        dict with final_report, status, agent_trace, retrieved_chunks,
        report_package, loop_count — same shape the graph returned, so
        main.py and the v1 API keep working unchanged.
    """
    if markets is None:
        markets = ["EU"]
    if vision_result is None:
        vision_result = {}
    if images is None:
        images = []
    if documents is None:
        documents = []

    state = initial_state(
        query=query,
        product=product,
        category=category,
        markets=markets,
        vision_result=vision_result,
        images=images,
        documents=documents,
    )

    _emit(progress_callback, "vision", "running", STAGE_PROGRESS["vision"][0])
    state = _merge(state, vision_analysis_node(state))
    _emit(progress_callback, "vision", "done", STAGE_PROGRESS["vision"][1])

    _emit(progress_callback, "applicability", "running", STAGE_PROGRESS["applicability"][0])
    _emit(progress_callback, "applicability", "done", STAGE_PROGRESS["applicability"][1])

    _emit(progress_callback, "generate", "running", STAGE_PROGRESS["generate"][0])
    state = _merge(state, generator_node(state))
    _emit(progress_callback, "generate", "done", STAGE_PROGRESS["generate"][1])

    _emit(progress_callback, "verify", "running", STAGE_PROGRESS["verify"][0])
    state = _merge(state, verifier_node(state))
    _emit(progress_callback, "verify", "done", STAGE_PROGRESS["verify"][1])

    _emit(progress_callback, "persist", "running", STAGE_PROGRESS["persist"][0])

    final_report = state.get("generation", "") or state.get("final_report", "")

    return {
        "final_report": final_report,
        "status": _final_status(state),
        "agent_trace": state.get("agent_trace", []),
        # Retrieval is gone; keep the key for response-model compatibility.
        "retrieved_chunks": [],
        "report_package": state.get("report_package", {}),
        "loop_count": 0,  # no refine loop in the collapsed pipeline
    }