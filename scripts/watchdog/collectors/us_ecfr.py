"""eCFR (US Code of Federal Regulations) collector.

Uses the official eCFR API — no scraping. The versioner endpoint returns the
full XML of one title/part for a given date; when the part number is known we
fetch the narrow document, otherwise the whole title (still small enough for
hashing purposes).
"""
from __future__ import annotations

import datetime as _dt

from scripts.watchdog.collectors.base import RegulationUpdate, fetch_url
from scripts.watchdog.state import normalize_text, text_hash

ECFR_BASE = "https://www.ecfr.gov/api/versioner/v1/full"


def collect_ecfr_part(entry: dict) -> RegulationUpdate:
    title = entry.get("ecfr_title")
    part = entry.get("ecfr_part")
    if not title:
        # Missing title metadata — degrade to the generic raw fetch of the
        # human-facing page (still detects content changes).
        from scripts.watchdog.collectors.base import collect_generic

        return collect_generic(entry)

    # "current" keeps the API simple; the response embeds the issue-date so
    # the state store's hash still changes when a new amendment lands.
    if part:
        url = f"{ECFR_BASE}/current/title-{int(title)}.xml?part={int(part)}"
    else:
        url = f"{ECFR_BASE}/current/title-{int(title)}.xml"

    body, last_modified = fetch_url(url, accept="application/xml")
    return RegulationUpdate(
        source_id=entry["id"],
        market=entry.get("market", "US"),
        source_type="ecfr_part",
        source_url=url,
        title=entry.get("title", f"{int(title)} CFR"),
        text=normalize_text(body),
        content_hash=text_hash(normalize_text(body)),
        last_modified=last_modified,
        metadata={
            "ecfrTitle": title,
            "ecfrPart": part,
            "fetchedOn": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        },
    )
