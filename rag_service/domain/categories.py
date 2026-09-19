"""Canonical product-category vocabulary (single source of truth).

``lib/types.ts:PRODUCT_CATEGORIES`` defines the 10 canonical (singular)
categories the upload wizard sends. Older clients, replay fixtures and the
BFF's own allow-list also carry plural aliases (``toys`` / ``batteries`` /
``textiles`` / ``cosmetics``). Every lookup keyed by category — must-check
anchors, inspection profiles, feature detection — resolves through
:func:`normalize_category`, so an alias reaches the same anchors as its
canonical form instead of silently returning an empty result set.
"""

from __future__ import annotations

CANONICAL_CATEGORIES: frozenset[str] = frozenset({
    "electronics",
    "appliance",
    "3c",
    "toy",
    "home",
    "battery",
    "cosmetic",
    "textile",
    "food_contact",
    "other",
})

# Plural (and other accepted) spellings → canonical singular form.
CATEGORY_ALIASES: dict[str, str] = {
    "toys": "toy",
    "batteries": "battery",
    "textiles": "textile",
    "cosmetics": "cosmetic",
}


def normalize_category(category: str | None) -> str:
    """Trim, lower-case and fold known plural aliases.

    Unknown values pass through unchanged so each caller keeps its own
    fallback (an inspection profile falls back to ``other``; an anchor
    lookup simply finds nothing).
    """
    value = (category or "").strip().lower()
    return CATEGORY_ALIASES.get(value, value)


def normalize_category_or_other(category: str | None) -> str:
    """:func:`normalize_category`, with unknown values mapped to ``other``."""
    value = normalize_category(category)
    return value if value in CANONICAL_CATEGORIES else "other"
