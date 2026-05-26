#!/usr/bin/env python3
"""Metadata normalization and strict filters for regulation retrieval chunks."""
from __future__ import annotations

from typing import Any, Iterable


CATEGORY_ALIASES = {
    "toy": "toys",
    "battery": "batteries",
    "chemical": "chemicals",
    "home": "home_goods",
    "appliance": "home_appliances",
    "general": "general_consumer_products",
}


def extract_chunk_metadata(chunk: dict[str, Any]) -> dict[str, Any]:
    """Return normalized metadata from top-level and nested chunk fields."""
    nested = chunk.get("metadata") if isinstance(chunk.get("metadata"), dict) else {}

    region = _first_text(
        chunk.get("region"),
        nested.get("region"),
        _first(_as_list(nested.get("detectedMarkets"))),
        chunk.get("market"),
    )
    source_id = _first_text(
        chunk.get("source_id"),
        chunk.get("supplement_id"),
        nested.get("supplement_id"),
        nested.get("source_id"),
        chunk.get("doc_id"),
    )
    source_file = _first_text(chunk.get("source_file"), nested.get("source_file"))
    official_channel = _first_text(chunk.get("official_channel"), nested.get("official_channel"))
    source_url = _first_text(chunk.get("source_url"), nested.get("source_url"))
    content_url = _first_text(chunk.get("content_url"), nested.get("content_url"))
    product_categories = _dedupe(
        _as_list(chunk.get("product_categories"))
        or _as_list(nested.get("product_categories"))
        or _as_list(nested.get("productCategories"))
    )
    regulatory_types = _dedupe(
        _as_list(chunk.get("regulatory_types"))
        or _as_list(nested.get("regulatory_types"))
        or _as_list(nested.get("regulatoryTypes"))
    )
    raw_files = _dedupe(_as_list(chunk.get("raw_files")) or _as_list(nested.get("raw_files")))
    is_official = bool(
        official_channel
        or nested.get("supplement_id")
        or chunk.get("supplement_id")
        or "_Official_" in source_file
    )

    return {
        "region": region,
        "source_id": source_id,
        "source_file": source_file,
        "source_url": source_url,
        "content_url": content_url,
        "official_channel": official_channel,
        "product_categories": product_categories,
        "regulatory_types": regulatory_types,
        "raw_files": raw_files,
        "is_official": is_official,
    }


def attach_metadata_fields(chunk: dict[str, Any]) -> dict[str, Any]:
    """Copy a chunk/result and attach normalized metadata fields."""
    normalized = extract_chunk_metadata(chunk)
    output = dict(chunk)
    output.update(normalized)
    existing_metadata = output.get("metadata") if isinstance(output.get("metadata"), dict) else {}
    output["metadata"] = {**existing_metadata, **normalized}
    return output


def chunk_matches(
    chunk: dict[str, Any],
    *,
    region: str = "",
    product_category: str = "",
    regulatory_types: Iterable[str] | None = None,
    source_ids: Iterable[str] | None = None,
    official_only: bool = False,
) -> bool:
    """Return whether a chunk satisfies strict metadata criteria."""
    metadata = extract_chunk_metadata(chunk)

    if region and metadata["region"].lower() != region.lower():
        return False

    if product_category:
        wanted = _normalize_category(product_category)
        categories = {_normalize_category(item) for item in metadata["product_categories"]}
        if wanted not in categories:
            return False

    wanted_types = {_normalize_value(item) for item in (regulatory_types or []) if item}
    if wanted_types:
        available_types = {_normalize_value(item) for item in metadata["regulatory_types"]}
        if not (wanted_types & available_types):
            return False

    wanted_source_ids = {str(item) for item in (source_ids or []) if item}
    if wanted_source_ids and metadata["source_id"] not in wanted_source_ids:
        return False

    if official_only and not metadata["is_official"]:
        return False

    return True


def filter_chunks(
    chunks: Iterable[dict[str, Any]],
    *,
    region: str = "",
    product_category: str = "",
    regulatory_types: Iterable[str] | None = None,
    source_ids: Iterable[str] | None = None,
    official_only: bool = False,
) -> list[dict[str, Any]]:
    """Return chunks that satisfy strict metadata criteria."""
    return [
        chunk
        for chunk in chunks
        if chunk_matches(
            chunk,
            region=region,
            product_category=product_category,
            regulatory_types=regulatory_types,
            source_ids=source_ids,
            official_only=official_only,
        )
    ]


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if item not in (None, "")]
    if isinstance(value, tuple | set):
        return [str(item) for item in value if item not in (None, "")]
    if isinstance(value, str):
        stripped = value.strip()
        return [stripped] if stripped else []
    return [str(value)]


def _dedupe(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for value in values:
        normalized = str(value).strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        output.append(normalized)
    return output


def _first(values: list[str]) -> str:
    return values[0] if values else ""


def _first_text(*values: Any) -> str:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def _normalize_category(value: str) -> str:
    normalized = _normalize_value(value)
    return CATEGORY_ALIASES.get(normalized, normalized)


def _normalize_value(value: str) -> str:
    return str(value).strip().lower().replace("-", "_").replace(" ", "_")
