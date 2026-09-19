#!/usr/bin/env python3
"""
kb_loader.py — Knowledge base loader (data/kb/anchors/*.yaml)

Spec: docs/plans/2026-09-11-de-rag-evidence-spec.md §3.2 + §7.1

Loads the curated KB YAML files into Python data structures. Replaces the
in-module dict of must_check.py so that adding/removing/editing an anchor is
a one-file change to YAML (no Python edit, no rebuild).

Public API (consumed by must_check.py shim and the generator pipeline):

    get_anchors_by_category(category: str) -> list[dict]
        Returns legacy-shaped entries for a category trigger. Each entry:
            {
                "doc_name":    "...",        # must_check-style display name
                "region":      "EU",          # single market code
                "reason":      "...",         # one-line trigger rationale
                "kb_entry":    {...full yaml...},  # full payload for new code
            }

    get_anchors_by_feature(feature: str) -> list[dict]
        Same shape; filtered by feature trigger.

    get_anchor_by_regulation_id(regulation_id: str) -> dict | None
        Returns the full KB payload for a regulation (article loader etc.).

    list_all_regulations() -> list[str]
        All regulation_ids — used by freshness collectors.

    ALWAYS_INCLUDE_REGIONS: set[str] = {"UN"}
        Transport regimes apply to every market.

    invalidate_cache() -> None
        Tests / dev: clear cache to force re-read of YAML files.

Caching: the anchors are read once per process and then kept, but the cache
self-invalidates — every entry point recomputes a cheap (mtime_ns, size)
stamp over the anchors directory and rebuilds when it moved. That is what
keeps the regwatch auto-ingest (which writes anchor YAMLs at 03:00) visible
to a long-running process without a restart. Read paths must NOT call
invalidate_cache() to force freshness; that turns a read-only probe into a
full re-parse on every request (see invalidate_cache's docstring).
"""
from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Any

import yaml

from rag_service.domain.categories import normalize_category

logger = logging.getLogger(__name__)


# Anchors root directory — overridable for tests / alternative layouts.
_DEFAULT_ANCHORS_DIR = Path(__file__).resolve().parents[2] / "data" / "kb" / "anchors"


# Transport regimes that apply to every market.
ALWAYS_INCLUDE_REGIONS: set[str] = {"UN"}


# ── cache ──────────────────────────────────────────────────────────────────
_cache: dict[str, dict] | None = None
_anchors_dir: Path = _DEFAULT_ANCHORS_DIR
# Stamp of the files the current cache was built from:
# {path_str: (mtime_ns, size)}. None until the first load.
_cache_stamp: dict[str, tuple[int, int]] | None = None
# Serializes rebuilds so concurrent scans cannot each re-parse every YAML.
_cache_lock = threading.Lock()


def get_anchors_dir() -> Path:
    """Return the directory holding the curated KB YAML files."""
    return _anchors_dir


def set_anchors_dir(path: Path | str) -> None:
    """Override the anchors directory (tests / alternative layouts)."""
    global _anchors_dir
    _anchors_dir = Path(path)
    invalidate_cache()


def invalidate_cache() -> None:
    """Clear the YAML cache. Tests use this between cases.

    Explicit-invalidation only. Read paths must NOT call this: it forces the
    next call to re-parse every anchor YAML, so a probe that runs on a timer
    (``_readiness_snapshot()`` in main.py, hit by the uptime monitor every
    5 minutes) turns into a repeating full re-parse. Those paths get freshness
    from the on-disk stamp in ``_load_all`` instead.
    """
    global _cache, _cache_stamp
    _cache = None
    _cache_stamp = None  # no cache, no baseline — see article_loader's twin


def _library_stamp() -> dict[str, tuple[int, int]]:
    """Snapshot {(path): (mtime_ns, size)} for every anchor YAML.

    One glob plus a stat per file. Used to notice an anchor edited or added
    on disk (regwatch auto-ingest writes these at 03:00) without a restart.
    """
    stamp: dict[str, tuple[int, int]] = {}
    anchors_dir = get_anchors_dir()
    if not anchors_dir.exists():
        return stamp
    for path in anchors_dir.glob("*.yaml"):
        try:
            stat = path.stat()
        except OSError:
            # Vanished between glob and stat — leaving it out of the stamp
            # makes the comparison fail, which forces a rebuild.
            continue
        stamp[str(path)] = (stat.st_mtime_ns, stat.st_size)
    return stamp


def _load_all() -> dict[str, dict]:
    """Load the KB YAMLs once and cache by regulation_id.

    Self-invalidating: the on-disk stamp is recomputed on every call and the
    cache is rebuilt when it moved.
    """
    global _cache, _cache_stamp
    with _cache_lock:
        stamp = _library_stamp()
        if _cache is not None and _cache_stamp == stamp:
            return _cache

        anchors_dir = get_anchors_dir()
        if not anchors_dir.exists():
            logger.warning("KB anchors directory does not exist: %s", anchors_dir)
            _cache = {}
            _cache_stamp = stamp
            return _cache

        loaded: dict[str, dict] = {}
        for path in anchors_dir.glob("*.yaml"):
            try:
                data = yaml.safe_load(path.read_text(encoding="utf-8"))
            except Exception as exc:
                logger.error("Failed to load KB YAML %s: %r", path, exc)
                continue
            if not isinstance(data, dict):
                logger.error("KB YAML %s did not parse to a dict", path)
                continue
            reg_id = data.get("regulation_id")
            if not reg_id:
                logger.error("KB YAML %s missing regulation_id", path)
                continue
            if reg_id in loaded:
                logger.error(
                    "Duplicate KB regulation_id %s in %s (already in %s); skipping",
                    reg_id, path, loaded[reg_id].get("_path"),
                )
                continue
            data["_path"] = str(path)
            loaded[reg_id] = data
        _cache = loaded
        _cache_stamp = stamp
        return _cache


# ── legacy-shape adapter ────────────────────────────────────────────────────


def _to_legacy_shape(payload: dict) -> dict:
    """Convert a KB YAML payload into the must_check entry shape.

    Legacy fields (doc_name / region / reason) come from the YAML's doc_name
    field, applies_if.markets[0], and risk_hint (with key_points[0] as
    fallback). The full payload is preserved under "kb_entry" for new code
    paths.
    """
    applies = payload.get("applies_if") or {}
    markets = applies.get("markets") or []
    region = markets[0] if markets else ""
    if region == "GLOBAL":
        region = ""
    key_points = payload.get("key_points") or []
    risk_hint = payload.get("risk_hint") or ""
    reason = risk_hint or (key_points[0] if key_points else "")
    return {
        "doc_name": payload["doc_name"],
        "region": region,
        "reason": reason,
        "kb_entry": payload,
    }


# ── public API ──────────────────────────────────────────────────────────────


def list_all_regulations() -> list[str]:
    """Return all regulation_ids in the KB (used by freshness checks)."""
    return list(_load_all().keys())


def get_anchor_by_regulation_id(regulation_id: str) -> dict | None:
    """Return the full KB payload for a regulation, or None if unknown."""
    return _load_all().get(regulation_id)


def get_anchors_by_category(category: str) -> list[dict]:
    """Return legacy-shaped entries whose applies_if.category contains the value.

    Plural aliases ("toys") fold to their canonical form ("toy") first —
    otherwise an alias matches no YAML trigger and the caller silently gets
    an empty must-check list.
    """
    cat = normalize_category(category)
    out: list[dict] = []
    for payload in _load_all().values():
        cats = (payload.get("applies_if") or {}).get("category") or []
        if cat and cat in [c.lower() for c in cats]:
            out.append(_to_legacy_shape(payload))
    return out


def get_anchors_by_feature(feature: str) -> list[dict]:
    """Return legacy-shaped entries whose applies_if.features_any contains the value."""
    feat = (feature or "").strip().lower()
    out: list[dict] = []
    for payload in _load_all().values():
        features = (payload.get("applies_if") or {}).get("features_any") or []
        if feat and feat in [f.lower() for f in features]:
            out.append(_to_legacy_shape(payload))
    return out


__all__ = [
    "ALWAYS_INCLUDE_REGIONS",
    "get_anchors_by_category",
    "get_anchors_by_feature",
    "get_anchor_by_regulation_id",
    "get_anchors_dir",
    "invalidate_cache",
    "list_all_regulations",
    "set_anchors_dir",
]
