#!/usr/bin/env python3
"""
state.py — Pipeline state for the collapsed De-RAG scan (spec §7.7).

A plain TypedDict threaded through the linear pipeline
(vision → generate → verify). The LangGraph `Annotated[..., operator.add]`
reducers are gone: with no Send() fan-out, each node returns a partial
dict and `runner._merge` concatenates list fields explicitly.
"""
from typing import TypedDict


class PipelineState(TypedDict, total=False):
    # === Input ===
    query: str
    product: str
    category: str
    markets: list[str]
    session_id: str                 # scan identity for observation ids (plan §6)
    vision_result: dict
    images: list[dict]  # [{"buffer": bytes, "mime_type": str}]
    user_documents: list[dict]  # [{"name": str, "mime_type": str, "text": str}]

    # === Intermediate state ===
    generation: str                 # Current draft report
    report_package: dict            # Four-scene package + citations + evidencePack
    agent_trace: list[dict]         # Node execution trace (append-only)

    # === Output ===
    final_report: str
    status: str                     # PASS | WARN | REJECTED | UNKNOWN


# Backwards-compatible alias: main.py / tests import GraphState by name.
GraphState = PipelineState


def initial_state(query: str, product: str, category: str,
                  markets: list[str], vision_result: dict,
                  images: list[dict] = None,
                  documents: list[dict] = None,
                  session_id: str = "scan") -> PipelineState:
    """Create the initial pipeline state."""
    return PipelineState(
        query=query,
        product=product,
        category=category,
        markets=markets,
        session_id=session_id,
        vision_result=vision_result,
        images=images or [],
        user_documents=documents or [],
        generation="",
        report_package={},
        agent_trace=[],
        final_report="",
        status="PENDING",
    )