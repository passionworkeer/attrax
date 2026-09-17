"""Source-type plugin registry for the regulation watchdog.

Replaces the if/else dispatch chain that used to live in
``collectors/base.py:collect_source``. Every collector declares its own
``source_type`` with the ``@register`` decorator; adding a new source type is
then a single new file plus a registry line, with no edits to shared code.

Registration is triggered by importing ``scripts.watchdog.collectors`` — that
package's ``__init__`` pulls every collector module, and each module's
``@register`` call runs as an import side effect. ``collect_source`` below
performs that import lazily so callers that only need ``base.fetch_url``
(e.g. an isolated unit test) do not pay for the whole collector tree.

Unknown source types fall back to ``collect_generic`` — the raw-bytes
fetcher — which keeps a typo in ``official_sources.json`` from dropping a
source out of the pass entirely.
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:  # pragma: no cover — typing only, no runtime import cost
    from scripts.watchdog.collectors.base import RegulationUpdate

logger = logging.getLogger("attrax.regwatch.registry")

#: source_type string → collector callable. Populated at import time by each
#: collector module's ``@register(...)`` decorator.
REGISTRY: dict[str, Callable[[dict], "RegulationUpdate"]] = {}

_COLLECTORS_IMPORTED = False


def register(source_type: str) -> Callable:
    """Decorator: bind ``source_type`` to the decorated collector.

    Raises ``ValueError`` when two *different* functions claim the same
    source_type — a silent overwrite would make dispatch depend on import
    order, which is exactly the class of bug this registry exists to remove.
    Re-registering the same function object is allowed so a test that
    re-imports a module does not explode.
    """

    def decorator(func: Callable[[dict], "RegulationUpdate"]) -> Callable:
        existing = REGISTRY.get(source_type)
        if existing is not None and existing is not func:
            raise ValueError(
                f"source_type {source_type!r} already registered to "
                f"{existing.__module__}.{existing.__qualname__}; "
                f"{func.__module__}.{func.__qualname__} cannot claim it too"
            )
        REGISTRY[source_type] = func
        return func

    return decorator


def _ensure_collectors_imported() -> None:
    """Import the collector package once so every ``@register`` has run."""
    global _COLLECTORS_IMPORTED
    if _COLLECTORS_IMPORTED:
        return
    # Import for the side effect (each module registers itself). The name is
    # unused deliberately — this is the trigger, not a consumer.
    import scripts.watchdog.collectors  # noqa: F401

    _COLLECTORS_IMPORTED = True


def registered_types() -> list[str]:
    """Sorted list of every source_type currently dispatchable."""
    _ensure_collectors_imported()
    return sorted(REGISTRY)


def collect_source(entry: dict) -> "RegulationUpdate":
    """Dispatch one ``official_sources.json`` entry to its registered collector.

    Falls back to ``collect_generic`` when the source_type has no handler, so
    an unrecognised (or newly added but not yet implemented) type still gets
    fetched and hashed rather than silently skipped.
    """
    _ensure_collectors_imported()
    source_type = str(entry.get("source_type") or "").strip()
    handler = REGISTRY.get(source_type)
    if handler is None:
        if source_type:
            logger.warning(
                "no collector registered for source_type %r (source %s) — "
                "falling back to collect_generic",
                source_type,
                entry.get("id", "?"),
            )
        from scripts.watchdog.collectors.base import collect_generic

        return collect_generic(entry)
    return handler(entry)
