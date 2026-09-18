"""US CFR collector — via the Federal Register API.

Two prior attempts failed from the Seoul server (2026-09-13 postmortem):
- eCFR versioner API (``/api/versioner/v1/full/…``): HTTP 406 for every
  header/UA combination — rejected at the edge.
- eCFR human pages (``ecfr.gov/current/title-N/part-P``): intermittently
  serve a ``Federal Register :: Request Access`` anti-bot interstitial with
  HTTP 200, alternating with the real page — snapshots flip between garbage
  and real content, producing a false "modified" on every pass.

The Federal Register open API works reliably (200, JSON, no key) and is a
*better* watchdog signal: it lists new Federal Register documents (final
rules, proposed rules, corrections) that reference the CFR part, i.e. the
amendments themselves rather than a re-render of the codified text.
"""
from __future__ import annotations

import json
import urllib.parse

from scripts.watchdog.collectors.base import RegulationUpdate, fetch_url
from scripts.watchdog.registry import register
from scripts.watchdog.state import normalize_text, text_hash

FR_API = "https://www.federalregister.gov/api/v1/documents.json"


@register("ecfr_part")
def collect_ecfr_part(entry: dict) -> RegulationUpdate:
    title = entry.get("ecfr_title")
    part = entry.get("ecfr_part")
    if not title:
        # Missing title metadata — degrade to the generic raw fetch of the
        # recorded source_url (still detects content changes).
        from scripts.watchdog.collectors.base import collect_generic

        return collect_generic(entry)

    phrase = f"{int(title)} CFR Part {int(part)}" if part else f"Title {int(title)} CFR"
    query = urllib.parse.urlencode(
        {
            "conditions[term]": f'"{phrase}"',
            "per_page": 20,
            "order": "newest",
        }
    )
    url = f"{FR_API}?{query}"

    body, last_modified = fetch_url(
        url, source_id=entry.get("id"), accept="application/json"
    )
    payload = json.loads(body)
    results = payload.get("results")
    if not isinstance(results, list):
        raise ValueError(
            f"federalregister response missing results[] ({len(body)} bytes)"
        )

    # Stable digest of the newest 20 referencing documents. Only fields that
    # never mutate after publication are included (document_number is the
    # permanent FR identifier; abstracts/URLs are stable). Sorted by
    # document_number so API ordering changes don't read as content changes.
    docs = sorted(
        (
            {
                "number": str(doc.get("document_number", "")),
                "date": str(doc.get("publication_date", "")),
                "title": str(doc.get("title", "")),
                "type": str(doc.get("type", "")),
            }
            for doc in results
            if isinstance(doc, dict)
        ),
        key=lambda d: d["number"],
    )
    normalized = normalize_text(
        "\n".join(f"{d['number']} | {d['date']} | {d['type']} | {d['title']}" for d in docs)
    )

    return RegulationUpdate(
        source_id=entry["id"],
        market=entry.get("market", "US"),
        source_type="ecfr_part",
        source_url=url,
        title=entry.get("title", phrase),
        text=normalized,
        content_hash=text_hash(normalized),
        last_modified=last_modified,
        metadata={
            "ecfrTitle": title,
            "ecfrPart": part,
            "mode": "federalregister_api",
            "matchedCount": payload.get("count", len(docs)),
        },
    )
