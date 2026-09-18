"""CPSC recalls via the SaferProducts.gov REST API.

Replaces ``us_cpsc.collect_cpsc_rss`` as the US recall signal. The RSS feed
at ``cpsc.gov/Newsroom/RSS/Recalls`` answers every automated client with
HTTP 403 — verified from the production host on 2026-09-17, with a Chrome
User-Agent, the watchdog's full fallback header set, and plain curl alike.
The REST service on ``saferproducts.gov`` serves the same recall data as
JSON with no key and no bot challenge (HTTP 200, ~1.3 MB for a six-week
window), so this is both reachable and better structured than the feed was.

The endpoint takes a ``RecallDateStart`` filter, which we set from the
entry's ``window_days`` — asking for the whole history would pull the
entire recall archive on every daily pass for no benefit, since change
detection only cares about what is new.

Like the RSS collector, this is a *signal* source: ``regulation_for_source``
returns None for ``cpsc_recall_api``, so a change lands in the evidence pack
without creating or updating a regulation YAML.
"""
from __future__ import annotations

import json
import urllib.parse
from datetime import date, timedelta

from scripts.watchdog.collectors.base import RegulationUpdate, fetch_url
from scripts.watchdog.registry import register
from scripts.watchdog.state import normalize_text, text_hash

CPSC_RECALL_API = "https://www.saferproducts.gov/RestWebServices/Recall"
DEFAULT_WINDOW_DAYS = 45

#: Fields kept in the digest. All are set once at publication and never
#: revised, so an unchanged recall cannot read as a content change.
_DIGEST_FIELDS = ("RecallNumber", "RecallDate", "Title", "URL")


def _build_url(entry: dict) -> str:
    """Resolve the API URL, honouring a ``source_url`` operator override.

    An override replaces the *base* endpoint, not the query string: the
    recall window is still appended when the override does not already
    carry a ``RecallDateStart``. Without that, an override pointing at the
    bare service would pull the entire recall archive on every daily pass.
    """
    override = str(entry.get("source_url") or "").strip()
    if override and "RecallDateStart" in override:
        return override

    window_days = int(entry.get("window_days") or DEFAULT_WINDOW_DAYS)
    start = (date.today() - timedelta(days=window_days)).isoformat()
    params = {"format": "json", "RecallDateStart": start}
    base = override or CPSC_RECALL_API
    separator = "&" if "?" in base else "?"
    return f"{base}{separator}{urllib.parse.urlencode(params)}"


def _normalize_recall(recall: dict) -> dict | None:
    """Pull the stable identity fields off one recall record."""
    number = str(recall.get("RecallNumber") or "").strip()
    if not number:
        return None
    products = recall.get("Products") or []
    names: list[str] = []
    if isinstance(products, list):
        for product in products[:3]:
            if isinstance(product, dict):
                name = str(product.get("Name") or "").strip()
                if name:
                    names.append(name)
    return {
        "id": number,
        "date": str(recall.get("RecallDate") or "")[:10],
        "title": str(recall.get("Title") or "").strip(),
        "url": str(recall.get("URL") or "").strip(),
        "products": "; ".join(names)[:200],
    }


def _row_sort_key(row: dict) -> tuple[str, str]:
    """Sort by (date, recall number) so API ordering is not a change."""
    return (row.get("date", ""), row.get("id", ""))


@register("cpsc_recall_api")
def collect_cpsc_recall_api(entry: dict) -> RegulationUpdate:
    """Fetch recent CPSC recalls and normalize them into a stable digest."""
    url = _build_url(entry)
    body, last_modified = fetch_url(
        url, source_id=entry.get("id"), accept="application/json", min_bytes=16
    )
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"cpsc_recall_api JSON decode failed ({len(body)} bytes): {exc}"
        ) from exc

    # The service returns a bare JSON array; tolerate a wrapped shape in case
    # the API grows an envelope later.
    if isinstance(payload, dict):
        records = payload.get("results") or payload.get("Results")
    else:
        records = payload
    if not isinstance(records, list):
        raise ValueError(
            f"cpsc_recall_api expected a JSON array (got {type(records).__name__})"
        )

    rows = [
        normalized
        for normalized in (
            _normalize_recall(item) for item in records if isinstance(item, dict)
        )
        if normalized is not None
    ]
    rows.sort(key=_row_sort_key)

    normalized_text = normalize_text(
        "\n".join(
            f"{row['date']} | {row['id']} | {row['title']} | {row['products']}"
            for row in rows
        )
    )

    return RegulationUpdate(
        source_id=entry["id"],
        market=entry.get("market", "US"),
        source_type="cpsc_recall_api",
        source_url=url,
        title=entry.get("title", "CPSC Recalls (SaferProducts.gov API)"),
        text=normalized_text,
        content_hash=text_hash(normalized_text),
        last_modified=last_modified,
        metadata={
            "recallCount": len(rows),
            "windowDays": int(entry.get("window_days") or DEFAULT_WINDOW_DAYS),
            "recentTitles": [row["title"][:120] for row in rows[-5:]],
            "mode": "saferproducts_rest",
        },
    )
