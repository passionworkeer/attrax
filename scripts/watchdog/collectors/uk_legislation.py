"""UK legislation.gov.uk Statutory Instrument + Public General Act collector.

``legislation.gov.uk`` exposes Atom / RSS feeds for each legislative
session per type, plus a JSON metadata endpoint for individual items. The
canonical feed URLs follow the pattern::

    https://www.legislation.gov.uk/data/feed/{year}/{type}
    https://www.legislation.gov.uk/{type}/{year}/{number}/data.{xml,json}

Known types:
    ``uksi``  — UK Statutory Instruments
    ``ukpga`` — UK Public General Acts
    ``ssi``   — Scottish Statutory Instruments
    ``asp``   — Acts of the Scottish Parliament (etc.)

This collector handles ``uksi``, ``ukpga``, and ``ssi``; the watchdog
configures one feed entry per year per type via the registry entry's
``ukType`` / ``year`` metadata.

Feed reachability note (2026-09-17): the legislation.gov.uk edge sits
behind an Akamai bot-detection layer that returns HTTP 202 Accepted with
an empty HTML body for non-browser User-Agents. ``fetch_url`` will retry
once with the fallback UA + Sec-Fetch-* headers; if both attempts get
the 202, the source is recorded as failed for the day (and the failure
streak eventually marks the entry ``stale``). The collector itself
doesn't need to special-case the WAF — it's the same path every other
gov_html source uses.

``min_bytes=16`` — a year with no new SIs (common) returns an empty feed;
an empty Atom body that gets normalised to a single newline is still
considered success, so the watchdog doesn't spam failures over a quiet
year.
"""
from __future__ import annotations

import urllib.parse
import xml.etree.ElementTree as ET

from scripts.watchdog.collectors.base import RegulationUpdate, fetch_url
from scripts.watchdog.registry import register
from scripts.watchdog.state import normalize_text, text_hash

# Namespace mapping for Atom (legislation.gov.uk feeds use Atom, not RSS).
_ATOM_NS = "{http://www.w3.org/2005/Atom}"
_LEG_NS = "{http://www.legislation.gov.uk/legislation/data}"
_VALID_UK_TYPES = frozenset({"uksi", "ukpga", "ssi"})


def _build_feed_url(entry: dict) -> str:
    """Construct the feed URL from the entry's ukType / year metadata.

    ``entry["source_url"]`` always wins (operator override). Otherwise we
    build ``https://www.legislation.gov.uk/data/feed/{year}/{ukType}``.
    """
    override = str(entry.get("source_url") or "").strip()
    if override:
        return override
    uk_type = str(entry.get("ukType") or "uksi").strip().lower()
    year = str(entry.get("year") or "").strip()
    if not year.isdigit() or len(year) != 4:
        raise ValueError(
            f"uk_legislation_xml: 'year' must be 4-digit (got {year!r})"
        )
    if uk_type not in _VALID_UK_TYPES:
        raise ValueError(
            f"uk_legislation_xml: ukType must be one of {sorted(_VALID_UK_TYPES)} (got {uk_type!r})"
        )
    return f"https://www.legislation.gov.uk/data/feed/{year}/{uk_type}"


def _parse_atom_entries(body: bytes) -> list[dict]:
    """Extract (id, title, updated, link) tuples from an Atom feed.

    The feed element is ``<feed xmlns="http://www.w3.org/2005/Atom">``;
    legislation.gov.uk also publishes a ``leg:`` namespace on the same
    elements for the per-legislation type. We tolerate either.
    """
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return []

    entries: list[dict] = []
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
        # legislation.gov.uk exposes the year+number under a custom
        # element <leg:year> + <leg:number>. Fall back to URL parsing
        # when those are absent.
        year = (entry.findtext(f"{_LEG_NS}year") or "").strip()
        number = (entry.findtext(f"{_LEG_NS}number") or "").strip()
        if not year or not number:
            # Try deriving from link like /uksi/2024/123 or /uksi/2024/123/title
            match = urllib.parse._RE_PATH.match(link)
            if match:
                pass  # noqa: PYUnused — link parsing lives below
            path_parts = [p for p in link.split("?")[0].split("/") if p]
            # Look for the year + number pair as the last two path parts.
            for i in range(len(path_parts) - 1):
                if path_parts[i].isdigit() and len(path_parts[i]) == 4:
                    year = year or path_parts[i]
                    number = number or path_parts[i + 1]
                    break
        entries.append(
            {
                "id": entry_id,
                "title": title,
                "updated": updated,
                "link": link,
                "year": year,
                "number": number,
            }
        )
    return entries


def _row_sort_key(entry_dict: dict) -> tuple[str, str]:
    """Stable ordering by (year, number) so feed re-ordering is not a
    content change."""
    year = entry_dict.get("year") or "0"
    number = entry_dict.get("number") or "0"
    # year is always 4 digits; number may be any width — zero-pad for
    # lexical sort to behave numerically on the common case.
    return (year, number.zfill(8) if number.isdigit() else number)


@register("uk_legislation_xml")
def collect_uk_legislation_xml(entry: dict) -> RegulationUpdate:
    """Fetch the Atom feed for one (ukType, year) bucket and normalize.

    Required entry fields (when ``source_url`` is absent):
        - ``ukType`` (``uksi`` | ``ukpga`` | ``ssi``)
        - ``year``   (four-digit year string)

    If ``source_url`` is set, it is used verbatim (e.g. an operator
    pointing the watchdog at a different mirror or a custom JSON endpoint).
    """
    url = _build_feed_url(entry)
    body, last_modified = fetch_url(
        url,
        accept="application/atom+xml,application/xml;q=0.9,*/*;q=0.5",
        min_bytes=16,
    )

    items = _parse_atom_entries(body)
    items.sort(key=_row_sort_key)

    normalized = normalize_text(
        "\n".join(
            f"{item.get('year', '')} | {item.get('number', '')} | "
            f"{item.get('updated', '')} | {item.get('title', '')} | "
            f"{item.get('link', '')}"
            for item in items
        )
    )

    return RegulationUpdate(
        source_id=entry["id"],
        market=entry.get("market", "UK"),
        source_type="uk_legislation_xml",
        source_url=url,
        title=entry.get("title", f"UK {entry.get('ukType', '').upper()} {entry.get('year', '')}"),
        text=normalized,
        content_hash=text_hash(normalized),
        last_modified=last_modified,
        metadata={
            "ukType": entry.get("ukType"),
            "year": entry.get("year"),
            "itemCount": len(items),
            "mode": "legislation_atom_feed",
        },
    )