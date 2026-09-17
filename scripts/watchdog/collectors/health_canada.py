"""Health Canada recall + safety alert collector.

The Canada Recalls and Safety Alerts dataset (managed by Health Canada +
CFIA + Transport Canada) is available as:

  - Open Data JSON (whole dataset, refreshed daily, ~10MB+):

        https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json

  - Healthy Canadians RSS (English, all categories):

        https://www.healthycanadians.gc.ca/recall-alert-rappel-avis/rss/feed-99-eng.xml

We use the RSS feed by default — it's small, fast, and lets the watchdog
filter to product categories we cover. The Open Data JSON is supported
via ``source_url`` override for callers that want the full structured
dataset; the collector auto-detects JSON shape.

Categories we cover (mirrors official_sources.json product_categories
vocab, with recall_type aliases from the source data):

    health_products    → medical devices, drugs, natural health products
    consumer_products  → children's products, household items, electronics
    cosmetics          → cosmetic products
    food               → food recalls (only filtered for relevance)

Note: Health Canada recall feeds occasionally serve a Cloudflare
interstitial under heavy load. ``fetch_url``'s WAF fallback chain
(Sec-Fetch-* + older Chrome UA) handles this in the same way as the
existing safety_gate collector.
"""
from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET

from scripts.watchdog.collectors.base import RegulationUpdate, fetch_url
from scripts.watchdog.registry import register
from scripts.watchdog.state import normalize_text, text_hash

HEALTH_CANADA_RSS = (
    "https://www.healthycanadians.gc.ca/recall-alert-rappel-avis/rss/feed-99-eng.xml"
)
HEALTH_CANADA_OPEN_DATA = (
    "https://recalls-rappels.canada.ca/sites/default/files/"
    "opendata-donneesouvertes/HCRSAMOpenData.json"
)

# Map recall categories we cover onto Health Canada's category strings
# (case-insensitive substring match). Mirrors the existing safety_gate
# filtering in spirit; the watchdog only surfaces recalls that affect
# product categories we track.
_COVERED_CATEGORY_HINTS = (
    "health_products",
    "consumer_products",
    "cosmetics",
    "food",
    "children",
    "toys",
    "electronics",
    "electrical",
    "battery",
    "cosmetic",
    "medical device",
    "drug",
    "natural health",
)


def _row_sort_key(row: dict) -> str:
    """Stable ordering by ``id`` so API / feed re-ordering is not a
    content change."""
    return str(row.get("id") or "")


def _is_relevant(recall: dict) -> bool:
    """Filter using both category hint and recall_type when present."""
    blob_parts: list[str] = []
    for key in ("category", "recall_type", "department", "product_type"):
        value = recall.get(key)
        if isinstance(value, list):
            blob_parts.extend(str(v) for v in value)
        elif isinstance(value, str):
            blob_parts.append(value)
    blob = " ".join(blob_parts).lower()
    if not blob:
        # No category metadata — include conservatively so the watchdog at
        # least sees the alert; human review can filter out irrelevant ones.
        return True
    return any(hint in blob for hint in _COVERED_CATEGORY_HINTS)


def _parse_rss(body: bytes) -> list[dict]:
    """Extract (id, title, pubDate, link, category, description) tuples
    from the Healthy Canadians RSS feed."""
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return []
    out: list[dict] = []
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub_date = (item.findtext("pubDate") or "").strip()
        guid = (item.findtext("guid") or "").strip()
        category = (item.findtext("category") or "").strip()
        description = (item.findtext("description") or "").strip()[:400]
        out.append(
            {
                "id": guid or link,
                "title": title,
                "pubDate": pub_date,
                "link": link,
                "category": category,
                "description": description,
            }
        )
    return out


def _parse_open_data_json(body: bytes) -> list[dict]:
    """Extract records from the Open Data JSON dump.

    The published schema uses ``recall_id`` / ``title`` / ``category`` /
    ``recall_type`` / ``department`` fields; older exports used snake_case
    variants. We try a couple of candidate keys for compatibility.
    """
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return []
    records: list[object]
    if isinstance(payload, dict):
        records = payload.get("RECALLS") or payload.get("records") or payload.get("data") or []
    elif isinstance(payload, list):
        records = payload
    else:
        records = []
    out: list[dict] = []
    for rec in records:
        if not isinstance(rec, dict):
            continue
        rid = str(
            rec.get("recall_id") or rec.get("id") or rec.get("RECALL_ID") or ""
        ).strip()
        if not rid:
            continue
        out.append(
            {
                "id": rid,
                "title": str(rec.get("title") or rec.get("TITLE") or "").strip(),
                "pubDate": str(
                    rec.get("date_published") or rec.get("DATE_PUBLISHED") or ""
                ).strip(),
                "link": str(
                    rec.get("url") or rec.get("URL") or rec.get("link") or ""
                ).strip(),
                "category": str(
                    rec.get("category") or rec.get("CATEGORY") or ""
                ).strip(),
                "description": str(
                    rec.get("description") or rec.get("DESCRIPTION") or ""
                ).strip()[:400],
            }
        )
    return out


@register("health_canada_recalls")
def collect_health_canada_recalls(entry: dict) -> RegulationUpdate:
    """Fetch Health Canada recall feed and produce a stable digest.

    ``source_url`` override supported — set to the Open Data JSON URL
    for full structured coverage, or to a per-category RSS feed URL.
    Defaults to the Healthy Canadians all-categories RSS.
    """
    url = str(entry.get("source_url") or "").strip() or HEALTH_CANADA_RSS
    is_json = url.endswith(".json") or "OpenData" in url
    accept = "application/json" if is_json else "application/rss+xml,application/xml;q=0.9,*/*;q=0.5"

    body, last_modified = fetch_url(url, accept=accept, min_bytes=16)
    if is_json:
        items = _parse_open_data_json(body)
    else:
        items = _parse_rss(body)

    # Apply category filter when configured (default: enabled). Set
    # ``filter_categories: false`` to disable and capture every recall.
    if entry.get("filter_categories", True):
        items = [it for it in items if _is_relevant(it)]
    items.sort(key=_row_sort_key)

    normalized = normalize_text(
        "\n".join(
            f"{it.get('id', '')} | {it.get('pubDate', '')} | "
            f"{it.get('category', '')} | {it.get('title', '')} | "
            f"{it.get('link', '')}"
            for it in items
        )
    )

    return RegulationUpdate(
        source_id=entry["id"],
        market=entry.get("market", "CA"),
        source_type="health_canada_recalls",
        source_url=url,
        title=entry.get("title", "Health Canada Recalls"),
        text=normalized,
        content_hash=text_hash(normalized),
        last_modified=last_modified,
        metadata={
            "matchedCount": len(items),
            "mode": "health_canada_rss" if not is_json else "health_canada_open_data",
            "feedFormat": "json" if is_json else "rss",
        },
    )