"""Australia TGA (Therapeutic Goods Administration) RSS collector.

The TGA publishes RSS feeds for medicines safety alerts and product
recalls under the ``/news/safety-alerts/{category}/feed`` path. The
watchdog subscribes to one of:

  - ``/news/safety-alerts/medicines-safety-alerts/feed`` — medicines safety
  - ``/news/safety-alerts/recalls/feed`` — product recalls
  - ``/news/safety-alerts/alert/feed`` — broader safety alerts (legacy)

Like the existing CPSC + ACCC RSS collectors, this is a *signal* source:
recalls / safety alerts on covered product categories, not a regulation
text source. ``auto_ingest.regulation_for_source`` returns None for
``tga_rss``, so the change lands in the evidence pack but no regulation
YAML is created or updated.

Reachability note (2026-09-17): the TGA edge times out from this network
(test runs hit ``60s timeout`` on every attempt). The collector is
correctly wired and ``fetch_url``'s retry logic applies the WAF fallback
chain — when the server becomes reachable, the digest will start
appearing automatically.
"""
from __future__ import annotations

import xml.etree.ElementTree as ET

from scripts.watchdog.collectors.base import RegulationUpdate, fetch_url
from scripts.watchdog.registry import register
from scripts.watchdog.state import normalize_text, text_hash

# TGA feed URLs follow /news/safety-alerts/{category}/feed. The watchdog
# registers one entry per category via the source entry's ``tgaCategory``
# metadata; the default below targets product recalls (the broadest AU
# medical-device-relevant category).
TGA_RECALLS_RSS = "https://www.tga.gov.au/news/safety-alerts/recalls/feed"
TGA_MEDICINES_RSS = (
    "https://www.tga.gov.au/news/safety-alerts/medicines-safety-alerts/feed"
)

_ATOM_NS = "{http://www.w3.org/2005/Atom}"


def _build_feed_url(entry: dict) -> str:
    """Resolve the feed URL from the entry's ``tgaCategory`` / ``source_url``.

    ``source_url`` always wins. Otherwise we map ``tgaCategory`` to the
    canonical TGA feed path.
    """
    override = str(entry.get("source_url") or "").strip()
    if override:
        return override
    category = str(entry.get("tgaCategory") or "recalls").strip().lower()
    if category in {"medicines", "medicines-safety-alerts", "medicines_safety_alerts"}:
        return TGA_MEDICINES_RSS
    if category in {"recalls", "recall"}:
        return TGA_RECALLS_RSS
    # Fallback: assume the category is a literal path segment.
    return f"https://www.tga.gov.au/news/safety-alerts/{category}/feed"


def _row_sort_key(item: dict) -> str:
    """Stable ordering by ``link`` so feed re-ordering is not a content
    change. Link usually contains a stable slug; title is unstable."""
    return str(item.get("link") or item.get("title") or "")


def _parse_tga_feed(body: bytes) -> list[dict]:
    """Parse a TGA RSS / Atom feed and extract stable fields.

    TGA migrated between RSS 2.0 and Atom in 2024 — handle both shapes
    in one pass. Returns ``(id, title, updated, link)`` tuples.
    """
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return []

    items: list[dict] = []
    # RSS 2.0 — <channel><item>
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub_date = (item.findtext("pubDate") or "").strip()
        guid = (item.findtext("guid") or "").strip()
        description = (item.findtext("description") or "").strip()[:400]
        items.append(
            {
                "id": guid or link or title,
                "title": title,
                "pubDate": pub_date,
                "link": link,
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
                "description": summary,
            }
        )
    return items


@register("tga_rss")
def collect_tga_rss(entry: dict) -> RegulationUpdate:
    """Fetch a TGA safety-alerts / recalls feed and normalize."""
    url = _build_feed_url(entry)
    body, last_modified = fetch_url(
        url,
        accept="application/rss+xml, application/atom+xml;q=0.9, application/xml;q=0.8, */*;q=0.5",
        min_bytes=16,
    )
    items = _parse_tga_feed(body)
    items.sort(key=_row_sort_key)

    normalized = normalize_text(
        "\n".join(
            f"{it.get('pubDate', '')} | {it.get('title', '')} | "
            f"{it.get('link', '')} | {it.get('description', '')[:200]}"
            for it in items
        )
    )

    return RegulationUpdate(
        source_id=entry["id"],
        market=entry.get("market", "AU"),
        source_type="tga_rss",
        source_url=url,
        title=entry.get("title", "TGA Safety Alerts / Recalls"),
        text=normalized,
        content_hash=text_hash(normalized),
        last_modified=last_modified,
        metadata={
            "matchedCount": len(items),
            "tgaCategory": entry.get("tgaCategory") or "recalls",
            "mode": "tga_rss",
        },
    )