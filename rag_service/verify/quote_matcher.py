#!/usr/bin/env python3
"""
quote_matcher.py — Deterministic post-LLM citation verifier.

Spec: docs/plans/2026-09-11-de-rag-evidence-spec.md §4.2 / §4.3 / §7.4.

Replaces the legacy `citation_verifier.py` (NLI/text-overlap) with a
pure-Python string-search verifier. The same algorithm produces both:

  - **Validation** — did the LLM faithfully quote the regulation?
  - **Highlighting** — `[start, end)` offsets for the document viewer's
    `<mark>` overlay (§4.4).

No LLM calls, no network, no embedding API — deterministic and CI-friendly.

Three-state match_status (spec §4.3):
  - ``matched``                — quote found verbatim (or whitespace-
                                 normalized). ``quote_span`` is set.
  - ``fallback_article_only``  — article exists but quote doesn't match.
                                 Chip navigates to article; no highlight.
  - ``unmatched``              — article id is unknown or quote empty.
                                 Chip is flagged ✗, no navigation.

J08 source-kind gate (plan 2026-09-14 §4.4 layer 3): a verbatim hit against
an ``source_kind: unverified`` regulation (a summary never checked against
the primary source) is downgraded from ``matched`` to
``fallback_article_only`` — summaries must not be presented as 已对照原文.

Performance: 50 citations × ~5KB article × 200-char quote < 50ms in pure
Python (string find + a couple of normalize passes).
"""
from __future__ import annotations

import logging
import re
import unicodedata
from typing import Any

from rag_service.retrieval import article_loader

logger = logging.getLogger(__name__)


# Soft cap on how much of an article we scan during normalization. The
# typical article is 1-5 KB; 64 KB covers everything we'll ever seed.
_NORMALIZE_SCAN_LIMIT = 64 * 1024


# ── normalize helpers ────────────────────────────────────────────────────


_WHITESPACE_RE = re.compile(r"\s+")
# Punctuation that is commonly remapped (fullwidth ↔ halfwidth, etc.)
_FULLWIDTH_PUNCT = "，。；：！？（）【】《》、"
_HALFWIDTH_PUNCT = ",.;:!?()[]<>,"
_PUNCT_TABLE = str.maketrans(
    {
        f: h
        for f, h in zip(_FULLWIDTH_PUNCT, _HALFWIDTH_PUNCT)
    }
)


def _normalize(text: str) -> str:
    """Aggressive whitespace + full-width fold for fallback matching.

    Steps applied:
      1. Unicode NFKC normalization (compatibility decomposition).
      2. Collapse all whitespace runs to a single space.
      3. Fold full-width Chinese punctuation to half-width equivalents
         (so ",", ";", ":", "!" etc. match their ASCII forms).

    The fold is asymmetric on purpose — quotes and quotes that change
    *meaning* are left alone. Only the punctuation that has a stable
    half-width counterpart is mapped.
    """
    if not text:
        return ""
    t = unicodedata.normalize("NFKC", text)
    t = _WHITESPACE_RE.sub(" ", t)
    t = t.translate(_PUNCT_TABLE)
    return t


def _build_position_map(original: str) -> tuple[str, list[int]]:
    """Return (normalized_text, original_index_per_norm_char).

    The map has the same length as `normalized_text`. The value at
    index `i` is the position in `original` whose character produced
    `normalized_text[i]`. Whitespace runs collapse to a single space,
    and the position map keeps the **first** whitespace index of each
    run; subsequent characters in the original beyond the map's end
    have no entry.

    Building this once per article gives O(n) denormalization; per
    match lookups are O(1) dict-list indexing.
    """
    if not original:
        return ("", [])
    norm_chars: list[str] = []
    orig_indices: list[int] = []
    prev_was_space = False
    for i, ch in enumerate(original):
        # Per-char fold: NFKC + punct table only. Whitespace collapsing
        # is handled explicitly below so we can control which original
        # index the single surviving space maps to.
        ch_norm = unicodedata.normalize("NFKC", ch).translate(_PUNCT_TABLE)
        if ch.isspace() or ch_norm.isspace():
            if not prev_was_space:
                norm_chars.append(" ")
                orig_indices.append(i)
                prev_was_space = True
            continue
        # Compatibility symbols can expand: ™ -> TM, ﬁ -> fi. Every
        # normalized character must retain an offset or later quotes drift.
        norm_chars.extend(ch_norm)
        orig_indices.extend([i] * len(ch_norm))
        prev_was_space = False
    return ("".join(norm_chars), orig_indices)


def _denormalize_span(
    norm_text: str,
    norm_index: int,
    norm_length: int,
    position_map: list[int] | None = None,
) -> tuple[int, int] | None:
    """Map a `[start, end)` span in `norm_text` back to offsets in the
    original article.

    Spec §4.4: the resulting `(start, end)` is what the document viewer
    uses to wrap `<mark>` around the quote. The mapping must be
    byte-exact against the original text the viewer is showing — even
    when the normalized match was discovered via whitespace
    collapse and punctuation folding.
    """
    if position_map is None or norm_length <= 0:
        return None
    if norm_index < 0 or norm_index + norm_length > len(position_map):
        return None
    start_orig = position_map[norm_index]
    # end_orig is exclusive — point to the start of the char *after* the
    # last matched norm char so slicing original[start:end] yields the
    # full quoted region.
    end_orig_index = norm_index + norm_length - 1
    end_orig = position_map[end_orig_index] + 1
    if end_orig <= start_orig:
        return None
    return (start_orig, end_orig)


# ── public API: per-quote matching ───────────────────────────────────────


def match_quote(
    article_text: str,
    quote: str,
) -> tuple[tuple[int, int] | None, str]:
    """Match `quote` against `article_text`. Returns `(span, status)`.

    Args:
        article_text: verbatim article body (from regulation library).
        quote: short excerpt the LLM produced (≤ 200 chars per spec).

    Returns:
        ((start, end), "matched") when quote is found verbatim.
        ((None), "matched")      when quote is empty — vacuous success;
                                 caller decides whether to count it
                                 (`fallback_article_only` if no text).
        ((None), "fallback_article_only") when article exists but the
                                 quote cannot be located in the article
                                 body (even after normalization).
        ((None), "unmatched")    when article_text is empty / falsy.

    The empty-quote → vacuous-matched branch is intentional: spec §4.1
    explicitly says "找不到合适原文引句时，引句留空字符串，引文仍保留
    (按条款级定位)". The caller (match_citations) wraps that with
    `fallback_article_only` semantics if no article text is available.
    """
    if not article_text:
        return (None, "unmatched")
    if not quote:
        # Empty quote → vacuous match at article start. The caller is
        # responsible for deciding whether this counts as
        # `matched` (article present) or `fallback_article_only`
        # (article present, quote empty by design).
        return ((0, 0), "matched")

    # Phase 1: verbatim substring search (fast path)
    idx = article_text.find(quote)
    if idx >= 0:
        return ((idx, idx + len(quote)), "matched")

    # An ellipsis at an excerpt boundary denotes omitted surrounding text,
    # not a change to the excerpt. Never join fragments across an internal
    # ellipsis: that could hide a qualification or exception in the law.
    excerpt = re.sub(r"^(?:\.{3}|…)+|(?:\.{3}|…)+$", "", quote.strip()).strip()
    if excerpt != quote.strip() and len(excerpt) >= 20 and "..." not in excerpt and "…" not in excerpt:
        return match_quote(article_text, excerpt)

    # Phase 2: whitespace + full-width normalized search
    norm_text, position_map = _build_position_map(article_text[:_NORMALIZE_SCAN_LIMIT])
    norm_quote = _normalize(quote)
    if not norm_quote:
        return ((0, 0), "matched")

    norm_idx = norm_text.find(norm_quote)
    if norm_idx >= 0:
        span = _denormalize_span(norm_text, norm_idx, len(norm_quote), position_map)
        if span is not None:
            return (span, "matched")

    return (None, "fallback_article_only")


# ── public API: per-citation matching ────────────────────────────────────


def match_citations(
    citations: list[dict] | None,
    *,
    cache: dict[tuple[str, str], str | None] | None = None,
    article_loader_module=None,
) -> list[dict]:
    """Resolve every citation in `citations` against the regulation library.

    Each citation is expected to have at minimum `{doc_id, article_id, quote}`
    (spec §3.3). This function:
      1. Looks up the regulation article via `article_loader.load_article_text`.
      2. Runs `match_quote` to compute the offset + status.
      3. Writes `quote_span` + `match_status` back into the citation dict
         (mutates in place; also returns the same list for chaining).

    Args:
        citations: list of CitationRef-shaped dicts. None/empty → [].
        cache: optional in-memory cache `(doc_id, article_id) -> article_text`
               to avoid re-loading the same article on every call. The
               caller owns the cache lifetime.
        article_loader_module: dependency injection seam for tests.

    Returns:
        The same list, with `quote_span` and `match_status` filled on each
        entry. Entries missing `doc_id`/`article_id` are left untouched
        and counted as `unmatched`.

    J08 source-kind gate (plan 2026-09-14 §4.4 layer 3): when the article's
    regulation carries ``source_kind: unverified`` (or the legacy missing
    value), the article body is a SUMMARY that was never checked against the
    primary source. A verbatim string hit against such text is NOT a
    verification against the official wording, so ``matched`` is downgraded
    to ``fallback_article_only`` (article located; quote not verbatim-
    verified). Verified sources (``official_verbatim`` /
    ``official_summary`` / ``curated_summary``) keep the full matched flow.

    The matched-status distribution is logged once per call so reviewers
    can spot regressions (target ≥ 70% matched per spec §7.4).
    """
    if not citations:
        return citations or []
    if article_loader_module is None:
        article_loader_module = article_loader

    cache = cache if cache is not None else {}

    # (doc_id) -> verbatim-allowed flag, cached per call alongside the
    # article-text cache so a 50-citation scan does not re-query governance
    # metadata per entry.
    verbatim_allowed: dict[str, bool] = {}

    def _allows_verbatim(doc_id: str) -> bool:
        if doc_id not in verbatim_allowed:
            verbatim_allowed[doc_id] = bool(
                article_loader_module.is_verbatim_allowed(doc_id)
            )
        return verbatim_allowed[doc_id]

    matched = fallback = unmatched = 0
    for entry in citations:
        if not isinstance(entry, dict):
            unmatched += 1
            continue
        doc_id = str(entry.get("doc_id") or "").strip()
        article_id = str(entry.get("article_id") or "").strip()
        quote = str(entry.get("quote") or "")
        if not doc_id or not article_id:
            entry["quote_span"] = None
            entry["match_status"] = "unmatched"
            unmatched += 1
            continue

        cache_key = (doc_id, article_id)
        if cache_key not in cache:
            cache[cache_key] = article_loader_module.load_article_text(
                doc_id, article_id
            )
        article_text = cache[cache_key]

        if not article_text:
            # Article doesn't exist (private standard, typo, or
            # placeholder). Spec §4.3 says chip is flagged ✗.
            entry["quote_span"] = None
            entry["match_status"] = "unmatched"
            unmatched += 1
            continue

        span, status = match_quote(article_text, quote)
        # Empty quote on a real article → per spec §4.1 the citation
        # is kept at the article level (no highlight possible). Map the
        # vacuous-match status from match_quote to the documented
        # `fallback_article_only` here so the front-end rendering is
        # consistent regardless of whether the LLM emitted `""`.
        if not quote and status == "matched":
            entry["quote_span"] = None
            entry["match_status"] = "fallback_article_only"
            fallback += 1
            continue

        # J08 source-kind gate: an unverified regulation's body is a
        # summary, not official text — a verbatim hit against it is article
        # location only, never "已对照原文".
        if status == "matched" and not _allows_verbatim(doc_id):
            entry["quote_span"] = None
            entry["match_status"] = "fallback_article_only"
            fallback += 1
            continue

        entry["quote_span"] = span
        entry["match_status"] = status
        if status == "matched":
            matched += 1
        elif status == "fallback_article_only":
            fallback += 1
        else:
            unmatched += 1

    total = matched + fallback + unmatched
    if total > 0:
        logger.info(
            "quote_matcher: %d citations — matched=%d (%.0f%%) "
            "fallback=%d (%.0f%%) unmatched=%d (%.0f%%)",
            total, matched, 100 * matched / total,
            fallback, 100 * fallback / total,
            unmatched, 100 * unmatched / total,
        )
    return citations


# ── evidence-pack dedup (spec §7.6 prep) ────────────────────────────────


def build_evidence_pack(citations: list[dict] | None) -> list[dict]:
    """De-duplicate citations to one entry per (doc_id, article_id).

    The evidence-pack export (§7.6) consumes this. When the LLM cites the
    same article multiple times, only one copy lands in the pack — but
    the longest / most informative `quote` wins (LLMs often paraphrase
    the same article several times).
    """
    if not citations:
        return []
    by_key: dict[tuple[str, str], dict] = {}
    order: list[tuple[str, str]] = []
    for entry in citations:
        if not isinstance(entry, dict):
            continue
        doc_id = str(entry.get("doc_id") or "").strip()
        article_id = str(entry.get("article_id") or "").strip()
        if not doc_id or not article_id:
            continue
        key = (doc_id, article_id)
        existing = by_key.get(key)
        if existing is None:
            by_key[key] = entry
            order.append(key)
            continue
        new_quote = str(entry.get("quote") or "")
        old_quote = str(existing.get("quote") or "")
        # Prefer the longer quote; ties broken by lexicographic order
        # for determinism.
        if len(new_quote) > len(old_quote) or (
            len(new_quote) == len(old_quote) and new_quote > old_quote
        ):
            by_key[key] = entry
    return [by_key[k] for k in order]


__all__ = [
    "build_evidence_pack",
    "match_citations",
    "match_quote",
]
