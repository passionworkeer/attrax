"""CPSC recalls RSS collector.

The CPSC recalls feed is a monitoring signal (recent recall activity for
product categories we cover), not a regulation text source. The collector
normalizes the feed into a stable list of (title, link, pubDate, description)
items so the state store's diff shows newly-announced recalls without noise
from feed re-ordering: items are sorted before hashing.
"""
from __future__ import annotations

import xml.etree.ElementTree as ET

from scripts.watchdog.collectors.base import RegulationUpdate, fetch_url
from scripts.watchdog.state import normalize_text, text_hash

CPSC_RECALLS_RSS = "https://www.cpsc.gov/Newsroom/RSS/Recalls"
# RSS 2.0 / Atom namespace-tolerant element lookup.
_ATOM_NS = "{http://www.w3.org/2005/Atom}"


def collect_cpsc_rss(entry: dict) -> RegulationUpdate:
    url = entry.get("source_url") or CPSC_RECALLS_RSS
    body, last_modified = fetch_url(url, accept="application/rss+xml; q=1.0, application/xml; q=0.9, */*; q=0.5")

    items = _parse_rss_items(body)
    # Sort so feed re-ordering does not read as a content change.
    items.sort(key=lambda item: (item.get("link", ""), item.get("title", "")))
    normalized = normalize_text(
        "\n".join(
            f"{item.get('title', '')} | {item.get('link', '')} |"
            f" {item.get('pubDate', '')}"
            for item in items
        )
    )

    return RegulationUpdate(
        source_id=entry["id"],
        market=entry.get("market", "US"),
        source_type="cpsc_rss",
        source_url=url,
        title=entry.get("title", "CPSC Recalls RSS"),
        text=normalized,
        content_hash=text_hash(normalized),
        last_modified=last_modified,
        metadata={"itemCount": len(items), "recentTitles": [i.get("title", "") for i in items[:5]]},
    )


def _parse_rss_items(body: bytes) -> list[dict]:
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return []

    # RSS 2.0: <channel><item>…
    items = [
        {
            "title": (item.findtext("title") or "").strip(),
            "link": (item.findtext("link") or "").strip(),
            "pubDate": (item.findtext("pubDate") or "").strip(),
            "description": (item.findtext("description") or "").strip()[:400],
        }
        for item in root.iter("item")
    ]
    if items:
        return items

    # Atom fallback: <feed><entry>…
    return [
        {
            "title": (entry.findtext(f"{_ATOM_NS}title") or "").strip(),
            "link": next(
                (l.get("href") or "").strip()
                for l in entry.findall(f"{_ATOM_NS}link")
                if l.get("href")
            ),
            "pubDate": (entry.findtext(f"{_ATOM_NS}updated") or "").strip(),
            "description": (entry.findtext(f"{_ATOM_NS}summary") or "").strip()[:400],
        }
        for entry in root.iter(f"{_ATOM_NS}entry")
    ]
