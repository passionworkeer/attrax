"""eCFR (US Code of Federal Regulations) collector.

First-pass incident postmortem (2026-09-12 deploy): the eCFR versioner API
(``/api/versioner/v1/full/…``) returns HTTP 406 for every variant tried
from the Seoul server — plain curl with a browser UA, dated paths, and
``Accept: */*`` all rejected. The human-facing page
(``https://www.ecfr.gov/current/title-{t}/part-{p}``) responds 200, so the
watchdog hashes that instead. The page embeds the current-amendment date
and the rendered part text; a real amendment moves the hash. Structured
XML remains available via govinfo.gov content packages if a future need
requires machine-readable diffs.
"""
from __future__ import annotations

import datetime as _dt

from scripts.watchdog.collectors.base import RegulationUpdate, fetch_url
from scripts.watchdog.state import normalize_text, text_hash

ECFR_PAGE_URL = "https://www.ecfr.gov/current/title-{title}/part-{part}"


def collect_ecfr_part(entry: dict) -> RegulationUpdate:
    title = entry.get("ecfr_title")
    part = entry.get("ecfr_part")
    if not title:
        # Missing title metadata — degrade to the generic raw fetch of the
        # recorded source_url (still detects content changes).
        from scripts.watchdog.collectors.base import collect_generic

        return collect_generic(entry)

    if part:
        url = ECFR_PAGE_URL.format(title=int(title), part=int(part))
    else:
        url = f"https://www.ecfr.gov/current/title-{int(title)}"

    body, last_modified = fetch_url(url, accept="text/html")
    text = normalize_text(body)
    return RegulationUpdate(
        source_id=entry["id"],
        market=entry.get("market", "US"),
        source_type="ecfr_part",
        source_url=url,
        title=entry.get("title", f"{int(title)} CFR"),
        text=text,
        content_hash=text_hash(text),
        last_modified=last_modified,
        metadata={
            "ecfrTitle": title,
            "ecfrPart": part,
            "fetchedOn": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        },
    )
