"""Australia ACCC Product Safety recall RSS collector.

The ACCC Product Safety website publishes a per-topic RSS feed under:

    https://www.productsafety.gov.au/rss/feed.xml/psa_recall

Where ``psa_recall`` is the recall topic (the broadest AU consumer-
product relevant category). Other topic slugs include ``psa_consumer``
(consumer products) and ``psa_baby`` (baby products).

The watchdog reads the recall topic by default and surfaces every item
as a stable digest. Items are sorted by ``link`` so feed re-ordering
does not read as a content change.

Reachability verified 2026-09-17 — the ACCC RSS endpoint responds with
HTTP 200 and a valid RSS 2.0 document.

Like the existing CPSC and EU Safety Gate collectors, this is a *signal*
source. ``auto_ingest.regulation_for_source`` returns None for
``accc_recalls_rss``, so the change lands in the evidence pack but no
regulation YAML is created or updated.
"""
from __future__ import annotations

import xml.etree.ElementTree as ET

from scripts.watchdog.collectors.base import RegulationUpdate, fetch_url
from scripts.watchdog.registry import register
from scripts.watchdog.state import normalize_text, text_hash

ACCC_RECALLS_RSS = "https://www.productsafety.gov.au/rss/feed.xml/psa_recall"
_ATOM_NS = "{http://www.w3.org/2005/Atom}"


def _build_feed_url(entry: dict) -> str:
    """Resolve the feed URL from the entry's ``acccTopic`` / ``source_url``.

    ``source_url`` always wins. ``acccTopic`` overrides the default
    recall topic (``psa_recall``); the URL pattern is::

        https://www.productsafety.gov.au/rss/feed.xml/{topic}
    """
    override = str(entry.get("source_url") or "").strip()
    if override:
        return override
    topic = str(entry.get("acccTopic") or "psa_recall").strip().lower()
    return f"https://www.productsafety.gov.au/rss/feed.xml/{topic}"


def _row_sort_key(item: dict) -> str:
    return str(item.get("link") or item.get("guid") or item.get("title") or "")


def _parse_accc_feed(body: bytes) -> list[dict]:
    """Parse the ACCC RSS 2.0 feed and extract stable fields.

    ACCC historically uses RSS 2.0 with a few Dublin Core fields for
    ``dc:creator`` and ``dc:date``. We tolerate Atom as well.
    """
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return []

    items: list[dict] = []
    # RSS 2.0 path — <channel><item>
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub_date = (item.findtext("pubDate") or "").strip()
        guid = (item.findtext("guid") or "").strip()
        category = (item.findtext("category") or "").strip()
        description = (item.findtext("description") or "").strip()[:400]
        items.append(
            {
                "id": guid or link or title,
                "title": title,
                "pubDate": pub_date,
                "link": link,
                "category": category,
                "description": description,
            }
        )
    if items:
        return items

    # Atom fallback — <feed><entry>
    for entry in root.iter(f"{_ATOM_NS}entry"):
        title = (entry.findtext(f"{_ATOM_NS}title") or "").strip()
        updated = (entry.findtext(f"{_ATOM_NS}updated") or "").strip()
        entry_id = (entry.findtext(f"{_ATOM_NS}id") or "").strip()
        link = ""
        for link_el in entry.findall(f"{_ATOM_NS}link"):
            href = (link_el.get("href") or "").strip()
            if href:
                link = href
                break
        summary = (entry.findtext(f"{_ATOM_NS}summary") or "").strip()[:400]
        items.append(
            {
                "id": entry_id or link or title,
                "title": title,
                "pubDate": updated,
                "link": link,
                "category": "",
                "description": summary,
            }
        )
    return items


@register("accc_recalls_rss")
def collect_accc_recalls_rss(entry: dict) -> RegulationUpdate:
    """Fetch an ACCC Product Safety RSS feed and produce a stable digest."""
    url = _build_feed_url(entry)
    body, last_modified = fetch_url(
        url,
        accept="application/rss+xml, application/atom+xml;q=0.9, application/xml;q=0.8, */*;q=0.5",
        min_bytes=16,
    )
    items = _parse_accc_feed(body)
    items.sort(key=_row_sort_key)

    normalized = normalize_text(
        "\n".join(
            f"{it.get('pubDate', '')} | {it.get('category', '')} | "
            f"{it.get('title', '')} | {it.get('link', '')} | "
            f"{it.get('description', '')[:200]}"
            for it in items
        )
    )

    return RegulationUpdate(
        source_id=entry["id"],
        market=entry.get("market", "AU"),
        source_type="accc_recalls_rss",
        source_url=url,
        title=entry.get("title", "ACCC Product Safety Recalls"),
        text=normalized,
        content_hash=text_hash(normalized),
        last_modified=last_modified,
        metadata={
            "matchedCount": len(items),
            "acccTopic": entry.get("acccTopic") or "psa_recall",
            "mode": "accc_recalls_rss",
        },
    )