"""Process-wide shutdown signalling for in-flight LLM work (M2, 2026-09-18).

The FastAPI lifespan sets the flag as the first step of shutdown; the LLM
transports check it *between retry attempts* so an interrupted scan stops
issuing fresh provider requests while the process drains. Mid-request
cancellation is deliberately not implemented: a check on the request path
would add per-call overhead to the normal path and cannot interrupt a
blocked socket read anyway.

A module-level flag is the right scope because both the executor workers
(vision + report generation) and the event loop must see the same state,
and because the transports are constructed in several places (lifespan
singletons, per-call ``ReportGenerator`` instances in /profit-report) that
do not share an object graph.

``reset_shutdown`` runs at startup so a process that somehow re-enters the
lifespan (TestClient re-mounting the app, an in-process restart harness)
does not inherit a previous shutdown's flag.
"""
from __future__ import annotations

import threading

_shutdown = threading.Event()


def signal_shutdown() -> None:
    """Mark the process as shutting down (checked between LLM retries)."""
    _shutdown.set()


def is_shutting_down() -> bool:
    """True once shutdown has been signalled. Cheap; safe from any thread."""
    return _shutdown.is_set()


def reset_shutdown() -> None:
    """Clear the flag. Called at startup, and by tests that simulate a cycle."""
    _shutdown.clear()
