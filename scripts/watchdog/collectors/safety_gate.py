"""EU Safety Gate (RAPEX) weekly notifications collector.

Safety Gate is the EU's rapid alert system for dangerous non-food products.
It is *signal* data — a feed of weekly notifications about specific product
recalls and enforcement actions — not a regulation text source. The collector
normalizes the JSON API response into a stable digest (alerts sorted by
alert_id, filtered to product categories we cover) so the state store's
diff highlights new dangerous-product activity without noise from API
re-ordering.

Endpoint:
    GET https://ec.europa.eu/safety-gate-alerts/api/v1/notifs/
        ?format=json&language=en

The API is documented at
https://ec.europa.eu/safety-gate-alerts/api/v1/ — note the trailing slash
(many endpoints 301 to it without one). ``Accept: application/json`` is
required; HTML returns 200 with the API explorer page and would otherwise
parse as garbage.
"""
from __future__ import annotations

import json
from datetime import datetime

from scripts.watchdog.collectors.base import RegulationUpdate, fetch_url
from scripts.watchdog.state import normalize_text, text_hash

SAFETY_GATE_API = (
    "https://ec.europa.eu/safety-gate-alerts/api/v1/notifs/?format=json&language=en"
)

# Categories we cover (mirrors official_sources.json product_categories
# vocab). If a notification's category matches any of these (case-folded
# substring), it gets included. This keeps the watchdog from picking up
# unrelated industrial-equipment alerts that aren't useful for cross-border
# e-commerce.
_COVERED_CATEGORY_HINTS = (
    "toys",
    "children",
    "electronics",
    "electrical",
    "lighting",
    "battery",
    "cosmetic",
    "chemical",
    "appliance",
    "kitchenware",
    "clothing",
    "textile",
    "furniture",
    "jewellery",
    "motor",
    "gas",
)


def _alert_categories(alert: dict) -> list[str]:
    """Extract a flat category list from one alert's nested body.

    The API shape varies by version (some have ``category`` as a string,
    others as a list of objects with ``name``); we tolerate both.
    """
    out: list[str] = []
    raw_category = alert.get("category") or alert.get("categories")
    if isinstance(raw_category, str):
        out.append(raw_category)
    elif isinstance(raw_category, list):
        for entry in raw_category:
            if isinstance(entry, str):
                out.append(entry)
            elif isinstance(entry, dict):
                name = entry.get("name") or entry.get("category")
                if isinstance(name, str):
                    out.append(name)
    return out


def _is_relevant(alert: dict) -> bool:
    cats = " ".join(_alert_categories(alert)).lower()
    if not cats:
        # No category metadata — include conservatively so the watchdog at
        # least sees the alert; human review can filter out irrelevant ones.
        return True
    return any(hint in cats for hint in _COVERED_CATEGORY_HINTS)


def collect_safety_gate(entry: dict) -> RegulationUpdate:
    url = entry.get("source_url") or SAFETY_GATE_API
    # Safety Gate API responses can be small on light weeks; don't apply the
    # default 64-byte minimum that gates "this looks like a challenge page"
    # for full HTML sites.
    body, last_modified = fetch_url(url, accept="application/json", min_bytes=16)
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"safety_gate JSON decode failed ({len(body):} bytes): {exc}"
        ) from exc

    # The API surface has used both ``results`` and a top-level list across
    # versions. Tolerate either.
    if isinstance(payload, dict):
        alerts = payload.get("results") or payload.get("alerts") or payload.get("items")
    else:
        alerts = payload
    if not isinstance(alerts, list):
        raise ValueError(
            f"safety_gate response missing list (got {type(alerts).__name__})"
        )

    relevant = [a for a in alerts if isinstance(a, dict) and _is_relevant(a)]

    # Stable digest: sort by alert id so API re-ordering never reads as a
    # content change. Pulled-by-hand fields (id, week, category, country,
    # product, risk) are the most stable across API versions.
    def _key(alert: dict) -> tuple[str, str]:
        return (
            str(alert.get("id") or alert.get("alert_id") or ""),
            str(alert.get("week") or alert.get("publication_date") or ""),
        )

    relevant.sort(key=_key)
    normalized = normalize_text(
        "\n".join(
            f"{a.get('id', '')} | {a.get('week', '')} | "
            f"{','.join(_alert_categories(a))} | "
            f"{a.get('country', '')} | {a.get('product', '')[:120]}"
            for a in relevant
        )
    )
    recent_titles = [
        str(a.get("product") or "")[:120] for a in relevant[:5]
    ]

    return RegulationUpdate(
        source_id=entry["id"],
        market=entry.get("market", "EU"),
        source_type="safety_gate",
        source_url=url,
        title=entry.get("title", "EU Safety Gate"),
        text=normalized,
        content_hash=text_hash(normalized),
        last_modified=last_modified,
        metadata={
            "alertCount": len(relevant),
            "totalCount": len(alerts),
            "recentProducts": recent_titles,
            "fetchedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        },
    )