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

Cache staleness guard (plan 2026-09-14 J08 / §4.4 layer 3): the library is
NOT read-only at runtime during development/redeploys — a regulation YAML
edited on disk must not keep serving stale text for the rest of the process.
Every entry point consults ``_library_stamp()`` (one cheap
``glob + stat`` over the library); if any file's (mtime_ns, size) changed or
the file set itself changed, the cache is dropped and rebuilt. A monotonically
increasing ``cache_generation()`` counter ticks when a rebuild reflects a real
on-disk change (and on an explicit ``invalidate_cache()``), so downstream
caches (verifier ``_ARTICLE_TEXT_CACHE``) can invalidate their own entries
keyed on it. Read paths must never call ``invalidate_cache()`` themselves —
see that function's docstring.

License discipline: the loader returns whatever is in the YAML — it does NOT
enforce license restrictions. The `schema_validator` (§7.2 phase 3) enforces
the "private license ⇒ no article body" rule at write time; read paths trust
the files.
"""
from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)


_DEFAULT_REGULATIONS_ROOT = Path(__file__).resolve().parents[2] / "data" / "regulations"


# Module-level cache: reg_id -> full YAML payload
_cache: dict[str, dict] | None = None
_regulations_root: Path = _DEFAULT_REGULATIONS_ROOT
# Stamp of the files the current cache was built from:
# {path_str: (mtime_ns, size)}. None until the first load.
_cache_stamp: dict[str, tuple[int, int]] | None = None
# Ticks when the article text may have changed: a rebuild that saw a real
# on-disk change, or an explicit invalidate_cache(). Downstream caches key on
# it to drop their own stale entries.
_cache_generation: int = 0
# Serializes rebuilds: without it, concurrent scans that both miss the cache
# would each re-parse every YAML, and the second one would also claim the
# library "changed on disk" (see the stamp check in ``_load_all``).
_cache_lock = threading.Lock()


def get_regulations_root() -> Path:
    """Return the root directory holding regulation YAML files."""
    return _regulations_root


def set_regulations_root(path: Path | str) -> None:
    """Override the regulations root (tests / alternative layouts)."""
    global _regulations_root
    _regulations_root = Path(path)
    invalidate_cache()


def invalidate_cache() -> None:
    """Drop the cache and declare the library possibly-changed. Tests / dev only.

    This is an *explicit* signal, so it ticks ``cache_generation()``
    unconditionally — downstream caches (the verifier's article-text cache)
    read a tick as "re-match against the files again", which is the safe
    direction when a caller says the cache is stale.

    Read paths must NOT call this. Doing so turns a read-only probe into a
    mutation that (a) forces a full re-parse of every YAML and (b) ticks the
    generation, discarding the verifier's cache. ``_readiness_snapshot()`` in
    main.py used to do exactly that on every /ready request; since the uptime
    monitor polls /ready every 5 minutes, that wiped the caches ~288x/day.
    Read paths get freshness from the on-disk stamp in ``_load_all`` instead.
    """
    global _cache, _cache_stamp
    _cache = None
    # Forget the stamp as well: "no cache, no baseline". Keeping the previous
    # stamp would make the next rebuild look like an on-disk change even when
    # the caller merely switched roots (or invalidated with nothing edited),
    # which would tick the generation for a no-op.
    _cache_stamp = None
    _rebuild_generation()


def cache_generation() -> int:
    """Return the current cache generation (see module docstring)."""
    return _cache_generation


def _rebuild_generation() -> None:
    global _cache_generation
    _cache_generation += 1


def _library_stamp() -> dict[str, tuple[int, int]]:
    """Snapshot {(path): (mtime_ns, size)} for every library YAML.

    Cheap: one directory glob plus a stat per file (~44 entries). Used to
    detect on-disk edits between entry-point calls so a running process
    never keeps serving regulation text that was replaced.
    """
    stamp: dict[str, tuple[int, int]] = {}
    root = get_regulations_root()
    if not root.exists():
        return stamp
    for path in root.glob("*/*.yaml"):
        try:
            stat = path.stat()
        except OSError:
            # File vanished between glob and stat — treat as "changed" by
            # leaving it out of the stamp, which forces a rebuild against
            # the previous stamp.
            continue
        stamp[str(path)] = (stat.st_mtime_ns, stat.st_size)
    return stamp


def _load_all() -> dict[str, dict]:
    """Walk data/regulations/{region}/*.yaml once and cache by regulation id.

    Self-invalidating: the on-disk stamp is recomputed on every call and the
    cache is dropped when it moved, so an edited / added / removed YAML is
    picked up without a process restart. Serialized by ``_cache_lock`` so
    concurrent scans cannot double-rebuild.
    """
    global _cache, _cache_stamp
    with _cache_lock:
        stamp = _library_stamp()
        if _cache is not None and _cache_stamp == stamp:
            return _cache

        # Whether this rebuild is a *real* library change decides both the log
        # line and the generation tick. Keying that off `_cache is not None`
        # (as this used to) reported "changed on disk" for any rebuild that
        # followed an invalidate_cache() call, even with an untouched library.
        previous_stamp = _cache_stamp

        loaded: dict[str, dict] = {}
        root = get_regulations_root()
        if not root.exists():
            logger.warning("Regulations root does not exist: %s", root)
        else:
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
        _cache_stamp = stamp
        if previous_stamp is not None and stamp != previous_stamp:
            logger.info(
                "regulation library changed on disk — cache rebuilt (%d regulations)",
                len(loaded),
            )
            _rebuild_generation()
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


# ── source-kind governance (plan 2026-09-14 J08 / §4.4 layer 3) ─────────────

# Kinds whose article text may participate in verbatim (exact-quote)
# matching. ``unverified`` (and the legacy missing value) are summaries that
# were never checked against the primary source — quoting them verbatim is
# NOT "checked against the official text".
VERBATIM_ALLOWED_SOURCE_KINDS = frozenset(
    {"official_verbatim", "official_summary", "curated_summary"}
)


def load_source_kind(reg_id: str) -> str:
    """Return the regulation's ``source_kind`` governance label.

    Values: ``official_verbatim`` / ``official_summary`` /
    ``curated_summary`` / ``unverified``. Legacy files that predate the
    field return ``""`` — callers must treat that as NOT verbatim-allowed
    (absent metadata cannot be trusted as official).
    """
    reg = load_regulation(reg_id)
    if reg is None:
        return ""
    return str(reg.get("source_kind") or "").strip()


def is_verbatim_allowed(reg_id: str) -> bool:
    """True when the regulation's article text may enter the exact-quote flow."""
    return load_source_kind(reg_id) in VERBATIM_ALLOWED_SOURCE_KINDS


def load_articles_for_anchor(anchor: dict) -> dict[str, str]:
    """Resolve all `key_articles` of a KB anchor to their article texts.

    Input shape: any of the following (we coerce defensively):
      - Legacy wrapper from `kb_loader.get_anchors_by_category/feature`:
          {doc_name, region, reason, kb_entry: {regulation_id, key_articles, ...}}
      - Bare payload from `kb_loader.get_anchor_by_regulation_id`:
          {regulation_id, key_articles, ...}
      - Already-flat dict (only `regulation_id` + `key_articles` keys).

    Output: {article_id: text} — only articles that exist AND have non-empty
    text are included. The caller (generator) decides what to do with
    missing slots (typically: keep the anchor in the report and rely on
    `key_points` instead of the verbatim text).
    """
    if not isinstance(anchor, dict):
        return {}
    kb_entry = anchor.get("kb_entry")
    payload = kb_entry if isinstance(kb_entry, dict) else anchor
    reg_id = payload.get("regulation_id")
    key_articles = payload.get("key_articles") or []
    if not reg_id or not key_articles:
        return {}

    out: dict[str, str] = {}
    for article_id in key_articles:
        text = load_article_text(reg_id, article_id)
        if text:
            out[article_id] = text
    return out


def build_article_texts_for_anchors(
    anchors: list[dict],
    kb_loader_module=None,
) -> dict[str, str]:
    """Resolve `mandatory_regulations` to `{doc_id}#{article_id} -> text`.

    Spec: docs/plans/2026-09-11-de-rag-evidence-spec.md §7.3.

    The generator pipeline produces a list of "must-cover" anchor entries
    (shape: {doc_name, region, reason, source}). Those entries do NOT
    carry the full KB payload — `regulation_id` and `key_articles` live
    in the YAML anchor under `kb_entry`. This helper looks each entry
    up in `data/kb/anchors/*.yaml`, pulls its `key_articles`, then loads
    the corresponding article text from the regulation library.

    Output keys are the canonical `{doc_id}#{article_id}` strings used
    by the citation contract (`CitationRef.doc_id` + `.article_id`,
    spec §3.3) and the document viewer route (§7.5). Missing articles
    (private standards with empty articles[]) are silently skipped —
    the caller's anchor list still drives coverage via `key_points`.

    Args:
        anchors: the output of `must_check.build_anchor_list`.
        kb_loader_module: dependency injection seam for tests; defaults
            to `rag_service.retrieval.kb_loader`.
    """
    if not anchors:
        return {}
    if kb_loader_module is None:
        from rag_service.retrieval import kb_loader
        kb_loader_module = kb_loader

    # Build (region_upper, doc_name) → full KB payload index.
    by_key: dict[tuple[str, str], dict] = {}
    for payload in kb_loader_module._load_all().values():
        if not isinstance(payload, dict):
            continue
        markets = (payload.get("applies_if") or {}).get("markets", []) or []
        region = markets[0] if markets and markets[0] != "GLOBAL" else ""
        doc_name = str(payload.get("doc_name", "")).strip()
        by_key[(region.upper(), doc_name)] = payload

    out: dict[str, str] = {}
    for entry in anchors:
        if not isinstance(entry, dict):
            continue
        region = str(entry.get("region", "")).strip().upper()
        doc_name = str(entry.get("doc_name", "")).strip()
        payload = by_key.get((region, doc_name))
        if not payload:
            continue
        reg_id = payload.get("regulation_id")
        key_articles = payload.get("key_articles") or []
        if not reg_id or not key_articles:
            continue
        for art_id in key_articles:
            text = load_article_text(reg_id, art_id)
            if text:
                out[f"{reg_id}#{art_id}"] = text
    return out


__all__ = [
    "build_article_texts_for_anchors",
    "cache_generation",
    "get_regulations_root",
    "invalidate_cache",
    "is_verbatim_allowed",
    "list_regulation_ids",
    "load_article_text",
    "load_articles_for_anchor",
    "load_regulation",
    "load_source_kind",
    "set_regulations_root",
    "VERBATIM_ALLOWED_SOURCE_KINDS",
]