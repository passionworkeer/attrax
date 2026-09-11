#!/usr/bin/env python3
"""
article_loader.py — Load regulation article texts for the LLM prompt.

Spec: docs/plans/2026-09-11-de-rag-evidence-spec.md §3.1 + §7.2

Reads data/regulations/{region}/{reg_id}.yaml (one file per regulation; each
holds an `articles[]` tree) and exposes a small API for the generator
pipeline (spec §7.3) and the document viewer (spec §7.5).

Public API:

    load_regulation(reg_id: str) -> dict | None
        Returns the full regulation YAML payload, or None if unknown.

    load_article_text(reg_id: str, article_id: str) -> str | None
        Returns the verbatim text of one article, or None if not present
        (placeholder regulation with no body yet, or unknown id).

    load_articles_for_anchor(anchor: dict) -> dict[str, str]
        Given a KB anchor entry (whose `kb_entry.key_articles` lists article
        IDs), returns {article_id: text}. Missing articles are silently
        skipped — the caller should fall back to KB `key_points` for the
        empty slots.

    list_regulation_ids() -> list[str]
        All regulation ids present in data/regulations/{region}/.

    invalidate_cache() -> None
        Clear the cache (tests / hot-reload).

Caching: loaded once per process on first call. YAML files are small (<200 KB
typically), so the memory cost is bounded; the cache lifetime is the process
lifetime.

License discipline: the loader returns whatever is in the YAML — it does NOT
enforce license restrictions. The `schema_validator` (§7.2 phase 3) enforces
the "private license ⇒ no article body" rule at write time; read paths trust
the files.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)


_DEFAULT_REGULATIONS_ROOT = Path(__file__).resolve().parents[2] / "data" / "regulations"


# Module-level cache: reg_id -> full YAML payload
_cache: dict[str, dict] | None = None
_regulations_root: Path = _DEFAULT_REGULATIONS_ROOT


def get_regulations_root() -> Path:
    """Return the root directory holding regulation YAML files."""
    return _regulations_root


def set_regulations_root(path: Path | str) -> None:
    """Override the regulations root (tests / alternative layouts)."""
    global _regulations_root
    _regulations_root = Path(path)
    invalidate_cache()


def invalidate_cache() -> None:
    """Clear the regulation cache. Tests / dev use this for hot-reload."""
    global _cache
    _cache = None


def _load_all() -> dict[str, dict]:
    """Walk data/regulations/{region}/*.yaml once and cache by regulation id."""
    global _cache
    if _cache is not None:
        return _cache

    root = get_regulations_root()
    if not root.exists():
        logger.warning("Regulations root does not exist: %s", root)
        _cache = {}
        return _cache

    loaded: dict[str, dict] = {}
    for path in sorted(root.glob("*/*.yaml")):
        try:
            data = yaml.safe_load(path.read_text())
        except Exception as exc:
            logger.error("Failed to load regulation YAML %s: %r", path, exc)
            continue
        if not isinstance(data, dict):
            logger.error("Regulation YAML %s did not parse to a dict", path)
            continue
        reg_id = data.get("id")
        if not reg_id:
            logger.error("Regulation YAML %s missing id", path)
            continue
        if reg_id in loaded:
            logger.error(
                "Duplicate regulation id %s in %s (already in %s); skipping",
                reg_id, path, loaded[reg_id].get("_path"),
            )
            continue
        data["_path"] = str(path)
        loaded[reg_id] = data
    _cache = loaded
    return _cache


# ── public API ──────────────────────────────────────────────────────────────


def list_regulation_ids() -> list[str]:
    """Return all regulation ids present in the library."""
    return list(_load_all().keys())


def load_regulation(reg_id: str) -> dict | None:
    """Return the full regulation payload, or None if unknown."""
    return _load_all().get(reg_id)


def load_article_text(reg_id: str, article_id: str) -> str | None:
    """Return the text of one article, or None if not present.

    A return of None means either:
      - the regulation id is unknown (typo, missing library entry)
      - the article id is not in this regulation
      - the article exists but has empty `text` (placeholder; needs curation)
    Callers should fall back to KB `key_points` for missing articles.
    """
    reg = load_regulation(reg_id)
    if reg is None:
        return None
    for art in reg.get("articles", []) or []:
        if art.get("id") == article_id:
            text = (art.get("text") or "").strip()
            return text or None
    return None


def load_articles_for_anchor(anchor: dict) -> dict[str, str]:
    """Resolve all `key_articles` of a KB anchor to their article texts.

    Input shape: a KB anchor entry as returned by
    `kb_loader.get_anchors_by_*()` (the legacy shape with `kb_entry`).

    Output: {article_id: text} — only articles that exist AND have non-empty
    text are included. The caller (generator) decides what to do with
    missing slots (typically: keep the anchor in the report and rely on
    `key_points` instead of the verbatim text).
    """
    kb_entry = anchor.get("kb_entry") if isinstance(anchor, dict) else None
    reg_id = (kb_entry or anchor or {}).get("regulation_id")
    key_articles = (kb_entry or {}).get("key_articles") or []
    if not reg_id or not key_articles:
        return {}

    out: dict[str, str] = {}
    for article_id in key_articles:
        text = load_article_text(reg_id, article_id)
        if text:
            out[article_id] = text
    return out


__all__ = [
    "get_regulations_root",
    "invalidate_cache",
    "list_regulation_ids",
    "load_article_text",
    "load_articles_for_anchor",
    "load_regulation",
    "set_regulations_root",
]