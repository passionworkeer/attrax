"""OpenFDA recall + adverse-event collector endpoints.

``openFDA`` is the FDA's open data API. No key required for the public
endpoints (rate-limited to 240 req/min per IP without a key). The
watchdog uses the device recall endpoint as a primary signal:

    GET https://api.fda.gov/device/recall.json
        ?search=product_classification:"Class+I"&limit=100

Optional secondary endpoint for adverse-event signals:

    GET https://api.fda.gov/drug/event.json?search=receivedate:[YYYYMMDD+TO+YYYYMMDD]&limit=20

Output is a stable list of (recall_number, initiation_date, product,
classification, reason) sorted by recall_number so API re-ordering does
not read as a content change. Each collector returns a ``RegulationUpdate``
whose ``text`` field is the digest string.

Note: this is a *signal* source (regulatory watch), not a regulation
text source. ``auto_ingest.regulation_for_source`` returns None for
``openfda_recalls``, so changed content lands in the evidence pack but
does not create / update any regulation YAML.

``min_bytes=16`` — an empty recall feed for a classification tier is a
valid response, not an error.
"""
from __future__ import annotations

import json
import urllib.parse

from scripts.watchdog.collectors.base import RegulationUpdate, fetch_url
from scripts.watchdog.registry import register
from scripts.watchdog.state import normalize_text, text_hash

OPENFDA_RECALLS_BASE = "https://api.fda.gov/device/recall.json"
OPENFDA_DRUG_EVENT_BASE = "https://api.fda.gov/drug/event.json"


def _row_sort_key(row: dict) -> str:
    """Stable ordering by recall_number (or safety_report_id for drug events)."""
    return str(row.get("id") or "")


def _normalize_recall(recall: dict) -> dict | None:
    """Pull the stable fields from one recall / enforcement record.

    The ``device/recall`` and ``food/enforcement`` endpoints describe the
    same concept with different field names — the identifier is
    ``product_res_number`` on one and ``recall_number`` on the other, and
    the classification sits under ``product_classification`` vs
    ``classification``. Both shapes are handled here so one source_type
    can back entries on either endpoint.
    """
    recall_number = str(
        recall.get("recall_number")
        or recall.get("product_res_number")
        or recall.get("cfres_id")
        or ""
    ).strip()
    if not recall_number:
        return None
    return {
        "id": recall_number,
        "date": str(
            recall.get("recall_initiation_date")
            or recall.get("event_date_initiated")
            or ""
        ).strip()[:10],
        "classification": str(
            recall.get("product_classification") or recall.get("classification") or ""
        ).strip(),
        "product": str(recall.get("product_description") or "").strip()[:160],
        "reason": str(recall.get("reason_for_recall") or "").strip()[:200],
    }


def _normalize_drug_event(event: dict) -> dict | None:
    """Pull the stable fields from one drug adverse-event record."""
    safety_id = str(
        event.get("safetyreportid") or event.get("safety_report_id") or ""
    ).strip()
    if not safety_id:
        return None
    return {
        "id": safety_id,
        "date": str(
            event.get("receivedate") or event.get("receiptdate") or ""
        ).strip()[:10],
        "classification": str(event.get("serious") or "").strip(),
        "product": ", ".join(
            str(drug.get("medicinalproduct") or "")
            for drug in (event.get("patient", {}).get("drug") or [])[:3]
        )[:160],
        "reason": ", ".join(
            str(reaction.get("reactionmeddrapt") or "")
            for reaction in (event.get("patient", {}).get("reaction") or [])[:3]
        )[:200],
    }


def _filter_by_window(rows: list[dict], window_days: int) -> list[dict]:
    """Keep only rows whose date is within the last ``window_days`` days.

    Rows with missing / unparseable dates are kept (conservative —
    better to keep an extra signal than to silently drop the only
    recent recall that lacks a structured date field).
    """
    if window_days <= 0 or not rows:
        return rows
    from datetime import date, datetime, timedelta

    today = date.today()
    cutoff = today - timedelta(days=window_days)
    kept: list[dict] = []
    for row in rows:
        date_str = row.get("date") or ""
        if not date_str:
            kept.append(row)
            continue
        try:
            parsed = datetime.strptime(date_str[:10], "%Y%m%d").date()
        except ValueError:
            kept.append(row)
            continue
        if parsed >= cutoff:
            kept.append(row)
    return kept


@register("openfda_recalls")
def collect_openfda_recalls(entry: dict) -> RegulationUpdate:
    """Fetch OpenFDA device recalls filtered by classification tier.

    Required entry fields (when ``source_url`` is absent):
        - ``product_classification``: e.g. ``"Class I"`` / ``"Class II"`` /
          ``"Class III"``. Defaults to ``"Class I"`` (highest-risk recalls
          only — usually a short list).
        - ``window_days`` (int): how far back to look. Defaults to 30.

    Optional: ``search`` overrides the query string entirely (advanced
    callers — power users only).
    """
    override_url = str(entry.get("source_url") or "").strip()
    if override_url:
        url = override_url
    else:
        classification = entry.get("product_classification") or "Class I"
        window_days = int(entry.get("window_days") or 30)
        search = str(entry.get("search") or "").strip()
        if not search:
            search = f'product_classification:"{classification}"'
        params = {
            "search": search,
            "limit": 100,
            # Without an explicit sort the API returns an arbitrary slice of
            # the archive — the default ordering surfaced 2016 records, which
            # the window filter then dropped, leaving an empty digest that
            # looked exactly like "no recalls happened". Newest-first makes
            # the window meaningful.
            "sort": "recall_initiation_date:desc",
        }
        url = f"{OPENFDA_RECALLS_BASE}?{urllib.parse.urlencode(params)}"

    body, last_modified = fetch_url(url, accept="application/json", min_bytes=16)
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"openfda_recalls JSON decode failed ({len(body)} bytes): {exc}"
        ) from exc

    results = payload.get("results")
    if not isinstance(results, list):
        raise ValueError(
            f"openfda_recalls response missing results[] ({len(body)} bytes)"
        )

    window_days = int(entry.get("window_days") or 30)
    rows = [r for r in (_normalize_recall(item) for item in results if isinstance(item, dict)) if r]
    rows = _filter_by_window(rows, window_days)
    rows.sort(key=_row_sort_key)

    normalized = normalize_text(
        "\n".join(
            f"{r['id']} | {r['date']} | {r['classification']} | "
            f"{r['product']} | {r['reason']}"
            for r in rows
        )
    )

    return RegulationUpdate(
        source_id=entry["id"],
        market=entry.get("market", "US"),
        source_type="openfda_recalls",
        source_url=url,
        title=entry.get("title", "OpenFDA Device Recalls"),
        text=normalized,
        content_hash=text_hash(normalized),
        last_modified=last_modified,
        metadata={
            "matchedCount": len(rows),
            "windowDays": window_days,
            "classification": entry.get("product_classification") or "Class I",
            "mode": "openfda_recalls",
        },
    )