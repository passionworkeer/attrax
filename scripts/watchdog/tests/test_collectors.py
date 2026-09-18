"""Tests for the watchdog collectors — dispatch + parsing, with mocked HTTP."""
from __future__ import annotations

import json
import sys
import urllib.error
from pathlib import Path
from unittest.mock import patch

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.watchdog.collectors import base as collectors_base  # noqa: E402
from scripts.watchdog.collectors.base import (  # noqa: E402
    collect_generic,
    collect_source,
    fetch_url,
    _BROWSER_LIKE_HEADERS,
    _FALLBACK_USER_AGENT,
    USER_AGENT,
    WAFChallengeBlockedException,
)
from scripts.watchdog.collectors.us_cpsc_api import (  # noqa: E402
    collect_cpsc_recall_api,
    _build_url,
    _normalize_recall,
)
from scripts.watchdog.collectors.gov_html import _strip_chrome  # noqa: E402
from scripts.watchdog.collectors.safety_gate import (  # noqa: E402
    collect_safety_gate,
    _is_relevant,
    _alert_categories,
)
from scripts.watchdog.state import text_hash  # noqa: E402
from scripts.watchdog.tests._http_mock import (  # noqa: E402
    _FakeHttpxClient,
    _FakeHttpxResponse,
    client_with,
    disable_http_client,
)


def _patch_client(monkeypatch, client: _FakeHttpxClient) -> None:
    """Swap the process-wide httpx client for ``client`` within this test.

    2026-09-18 H14: the primary transport switched from urllib to httpx.
    Tests no longer patch ``urllib.request.urlopen`` — they hand the
    fetch loop a stand-in client and inspect the headers / body it sent.
    """

    monkeypatch.setattr(collectors_base, "_get_http_client", lambda: client)


# ── fetch_url ────────────────────────────────────────────────────────────


def test_fetch_url_returns_body_and_last_modified(monkeypatch):
    resp = _FakeHttpxResponse(
        b"x" * 200, last_modified="Wed, 11 Sep 2026 03:00:00 GMT"
    )
    fake = client_with(resp)
    _patch_client(monkeypatch, fake)
    body, lm = fetch_url("https://example.com/doc")
    assert body == b"x" * 200
    assert lm == "Wed, 11 Sep 2026 03:00:00 GMT"
    # One request went out; the headers carried the standard UA.
    assert fake.requests[0]["headers"]["User-Agent"] == USER_AGENT


def test_fetch_url_retries_transient_errors_then_succeeds(monkeypatch):
    """A 5xx is retried; the second, healthy response is what comes back.

    The 5xx body is deliberately larger than MIN_CONTENT_BYTES — an error
    page must never be mistaken for upstream content (2026-09-18 H14
    regression: a 502 HTML page was hashed as a real change).
    """
    error_page = _FakeHttpxResponse(
        b"<html><body>502 Bad Gateway</body></html>" * 10, status_code=502
    )
    success = _FakeHttpxResponse(b"y" * 200)
    fake = client_with([error_page, success])
    _patch_client(monkeypatch, fake)
    with patch.object(collectors_base.time, "sleep"):
        body, _ = fetch_url("https://example.com/doc", retries=2)
    assert body == b"y" * 200
    # Two attempts: first 5xx, second 200.
    assert len(fake.requests) == 2


def test_fetch_url_never_returns_an_error_page_as_content(monkeypatch):
    """Every attempt 5xx → the source fails; the error page is never the body."""
    fake = client_with(
        _FakeHttpxResponse(b"<html>502 Bad Gateway</html>" * 10, status_code=502)
    )
    _patch_client(monkeypatch, fake)
    with patch.object(collectors_base.time, "sleep"):
        with pytest.raises(urllib.error.HTTPError):
            fetch_url("https://example.com/doc", retries=3)
    assert len(fake.requests) == 3


def test_fetch_url_retries_429_with_a_body(monkeypatch):
    """429 is the one 4xx worth retrying (rate limit, not a wrong address)."""
    limited = _FakeHttpxResponse(b"too many requests, slow down" * 5, status_code=429)
    success = _FakeHttpxResponse(b"y" * 200)
    fake = client_with([limited, success])
    _patch_client(monkeypatch, fake)
    with patch.object(collectors_base.time, "sleep"):
        body, _ = fetch_url("https://example.com/doc", retries=2)
    assert body == b"y" * 200
    assert len(fake.requests) == 2


def test_fetch_url_does_not_retry_client_4xx(monkeypatch):
    fake = client_with(_FakeHttpxResponse(b"<html>404</html>" * 10, status_code=404))
    _patch_client(monkeypatch, fake)
    with pytest.raises(urllib.error.HTTPError):
        fetch_url("https://example.com/missing", retries=3)
    # A 4xx terminates — only one attempt was made.
    assert len(fake.requests) == 1


def test_fetch_url_falls_back_to_urllib_when_httpx_is_unavailable(monkeypatch):
    """The stdlib-only interpretation of the deployment (no httpx): the
    fetch loop must use ``urllib.request.urlopen`` and return its body."""
    body = b"plain urllib body " * 20
    calls: list = []

    class _Resp:
        headers = {"Last-Modified": "Wed, 11 Sep 2026 03:00:00 GMT"}

        def read(self):
            return body

        def getcode(self):
            return 200

        def close(self):
            pass

    def _open(request, timeout=30):  # noqa: ARG001 — match urllib signature
        calls.append(request)
        return _Resp()

    disable_http_client(monkeypatch)
    with patch.object(collectors_base.urllib.request, "urlopen", side_effect=_open):
        out, lm = fetch_url("https://example.com/fallback")

    assert out == body
    assert lm == "Wed, 11 Sep 2026 03:00:00 GMT"
    assert len(calls) == 1


def test_fetch_url_rejects_suspiciously_small_body(monkeypatch):
    fake = client_with(_FakeHttpxResponse(b"tiny"))
    _patch_client(monkeypatch, fake)
    with patch.object(collectors_base.time, "sleep"):
        with pytest.raises(urllib.error.URLError):
            fetch_url("https://example.com/doc", retries=1)


def test_fetch_url_fallback_fast_fails_on_4xx(monkeypatch):
    """urllib's urlopen raises HTTPError for 4xx; the fallback path must
    still treat it as terminal instead of burning the retry budget."""
    attempts: list = []

    def _open(request, timeout=30):  # noqa: ARG001
        attempts.append(request)
        raise urllib.error.HTTPError(
            "https://example.com/missing", 404, "Not Found", hdrs=None, fp=None
        )

    disable_http_client(monkeypatch)
    with patch.object(collectors_base.urllib.request, "urlopen", side_effect=_open), \
         patch.object(collectors_base.time, "sleep"):
        with pytest.raises(urllib.error.HTTPError):
            fetch_url("https://example.com/missing", retries=3)

    assert len(attempts) == 1


# ── collect_generic + dispatch ───────────────────────────────────────────


def test_collect_generic_hashes_normalized_text(monkeypatch):
    entry = {
        "id": "uk-toys",
        "market": "UK",
        "source_type": "gov_html",
        "source_url": "https://example.com/uk-toys",
        "title": "UK Toys Regs",
    }
    resp = _FakeHttpxResponse(b"<html><body>  content  \n\n here </body></html>" * 5)
    _patch_client(monkeypatch, client_with(resp))
    update = collect_generic(entry)
    assert update.source_id == "uk-toys"
    assert update.source_type == "gov_html"
    assert update.content_hash == text_hash(update.text)
    assert "content" in update.text and "here" in update.text


def test_collect_source_dispatches_by_source_type(monkeypatch):
    entry = {
        "id": "us-part",
        "market": "US",
        "source_type": "ecfr_part",
        "source_url": "https://www.ecfr.gov/current/title-16/part-1307",
        "ecfr_title": 16,
        "ecfr_part": 1307,
        "title": "16 CFR 1307",
    }
    fr_json = json.dumps(
        {
            "count": 38,
            "results": [
                {
                    "document_number": "2024-12345",
                    "publication_date": "2024-05-01",
                    "title": "Safety Standard for Toddler Beds",
                    "type": "Rule",
                },
                {
                    "document_number": "2019-99999",
                    "publication_date": "2019-10-02",
                    "title": "Toddler Beds Update",
                    "type": "Proposed Rule",
                },
            ],
        }
    ).encode("utf-8")
    _patch_client(monkeypatch, client_with(_FakeHttpxResponse(fr_json)))
    update = collect_source(entry)
    assert update.source_type == "ecfr_part"
    # 2026-09-13 postmortem: eCFR pages/API are unusable from Seoul — the
    # collector now monitors the Federal Register API instead.
    assert "federalregister.gov/api/v1/documents" in update.source_url
    assert update.metadata["ecfrPart"] == 1307
    assert update.metadata["mode"] == "federalregister_api"
    # Sorted by document_number, so order churn in the API is not a change.
    assert "2019-99999" in update.text.splitlines()[0]


# ── CPSC recall API ──────────────────────────────────────────────────────

# Fixture shape mirrors saferproducts.gov/RestWebServices/Recall. The RSS
# feed this replaced answered 403 to every automated client from the
# production host, so the JSON service is now the US recall channel.
CPSC_API_PAYLOAD = [
    {
        "RecallID": 10967,
        "RecallNumber": "26761",
        "RecallDate": "2026-09-10T00:00:00",
        "Title": "Finger Light Toys Recalled Due to Battery Ingestion Hazard",
        "URL": "https://www.cpsc.gov/Recalls/2026/example",
        "Products": [{"Name": "Electronic Finger Lights"}, {"Name": "Finger Flashlights"}],
    },
    {
        "RecallID": 10965,
        "RecallNumber": "26759",
        "RecallDate": "2026-09-03T00:00:00",
        "Title": "Children's Sleepwear Recalled Due to Violation of Flammability Standard",
        "URL": "https://www.cpsc.gov/Recalls/2026/example-2",
        "Products": [{"Name": "Cotton sleepwear"}],
    },
]


def test_cpsc_recall_api_builds_a_windowed_url():
    """The default URL asks only for the recent window — the full history
    would be pulled on every daily pass for no benefit."""
    url = _build_url({"id": "us-cpsc", "window_days": 7})
    assert url.startswith("https://www.saferproducts.gov/RestWebServices/Recall?")
    assert "RecallDateStart=" in url
    assert "format=json" in url


def test_cpsc_recall_api_override_keeps_the_window():
    """An operator override replaces the base, not the query — otherwise
    pointing at the bare service would fetch the whole archive."""
    url = _build_url({"id": "us-cpsc", "source_url": "https://example.com/Recall"})
    assert url.startswith("https://example.com/Recall?")
    assert "RecallDateStart=" in url


def test_cpsc_recall_api_override_with_explicit_window_is_respected():
    """An override that already carries a date filter is used verbatim."""
    explicit = "https://example.com/Recall?format=json&RecallDateStart=2026-01-01"
    assert _build_url({"id": "us-cpsc", "source_url": explicit}) == explicit


def test_normalize_recall_extracts_the_stable_fields():
    row = _normalize_recall(CPSC_API_PAYLOAD[0])
    assert row["id"] == "26761"
    assert row["date"] == "2026-09-10"
    assert row["title"].startswith("Finger Light Toys")
    assert "Electronic Finger Lights" in row["products"]


def test_normalize_recall_drops_records_without_a_number():
    assert _normalize_recall({"Title": "no number"}) is None


def test_collect_cpsc_recall_api_builds_a_stable_sorted_digest(monkeypatch):
    entry = {
        "id": "us-cpsc-recalls-api",
        "market": "US",
        "source_type": "cpsc_recall_api",
        "title": "CPSC Recalls",
    }
    body = json.dumps(CPSC_API_PAYLOAD).encode("utf-8")
    _patch_client(
        monkeypatch,
        client_with(_FakeHttpxResponse(body, last_modified="Wed, 17 Sep 2026 03:00:00 GMT")),
    )
    update = collect_cpsc_recall_api(entry)

    assert update.source_type == "cpsc_recall_api"
    assert update.metadata["recallCount"] == 2
    # sorted by (date, number) — API ordering is not a content change
    lines = update.text.splitlines()
    assert lines[0].startswith("2026-09-03")
    assert lines[1].startswith("2026-09-10")
    assert update.content_hash == text_hash(update.text)


def test_collect_cpsc_recall_api_rejects_non_array(monkeypatch):
    entry = {"id": "us-cpsc", "market": "US", "source_type": "cpsc_recall_api"}
    body = b'{"unexpected": "envelope but big enough to clear the small-body guard"}'
    _patch_client(monkeypatch, client_with(_FakeHttpxResponse(body)))
    with pytest.raises(ValueError, match="expected a JSON array"):
        collect_cpsc_recall_api(entry)


# ── WAF fallback chain (fetch_url rotation) ──────────────────────────────


def test_fetch_url_rotates_user_agent_on_retry(monkeypatch):
    """First attempt: primary UA. Retries: fallback UA + Sec-Fetch-* headers."""
    seen_ua: list[str] = []
    seen_sec_fetch: list[bool] = []

    def _get(url, *, headers, timeout):  # noqa: ARG001 — match client.get signature
        seen_ua.append(headers.get("User-Agent") or "")
        seen_sec_fetch.append("Sec-Fetch-Site" in headers)
        if len(seen_ua) == 1:
            raise WAFChallengeBlockedException("blocked")
        return _FakeHttpxResponse(b"x" * 200)

    _patch_client(monkeypatch, client_with(_get))
    with patch.object(collectors_base.time, "sleep"):
        body, _ = fetch_url("https://example.com/doc", retries=2)

    assert body == b"x" * 200
    assert seen_ua[0] == USER_AGENT
    assert seen_ua[1] == _FALLBACK_USER_AGENT
    assert seen_sec_fetch[0] is False  # first attempt: no Sec-Fetch
    assert seen_sec_fetch[1] is True   # retry: Sec-Fetch-* present


def test_fetch_url_does_not_retry_on_waf_after_first_attempt(monkeypatch):
    """If retries=1, no UA rotation happens."""
    fake = client_with(_FakeHttpxResponse(b"x" * 200))
    _patch_client(monkeypatch, fake)
    body, _ = fetch_url("https://example.com/doc", retries=1)
    assert body == b"x" * 200
    assert len(fake.requests) == 1
    assert fake.requests[0]["headers"]["User-Agent"] == USER_AGENT


# ── gov_html chrome stripping ───────────────────────────────────────────


GOV_UK_FIXTURE = b"""
<!doctype html>
<html lang="en">
<head>
  <title>WEEE Regulations - GOV.UK</title>
  <script>var ga = function() {};</script>
  <style>.foo { color: red; }</style>
  <link rel="stylesheet" href="app.css">
</head>
<body class="gem-c-layout--flush">
  <a href="#main" class="gem-c-skip-link">Skip to main content</a>
  <header class="gem-c-header">
    <div class="gem-c-cookie-banner">
      <p>Cookies on GOV.UK</p>
    </div>
    <nav class="gem-c-breadcrumbs">
      <ol><li><a href="/">Home</a></li><li>WEEE</li></ol>
    </nav>
  </header>
  <main id="main" role="main">
    <h1>WEEE Regulations</h1>
    <div class="phase-banner">
      <p>This is a beta service</p>
    </div>
    <p>Producers of electrical and electronic equipment must comply with WEEE.</p>
    <ul>
      <li>Register as a producer</li>
      <li>Provide take-back facilities</li>
    </ul>
  </main>
  <footer class="gem-c-footer">
    <div class="copyright">Crown copyright</div>
  </footer>
</body>
</html>
"""


def test_gov_html_strips_known_chrome():
    text = _strip_chrome(GOV_UK_FIXTURE.decode("utf-8"))
    # Real content kept
    assert "WEEE Regulations" in text
    assert "Producers of electrical and electronic equipment" in text
    assert "Register as a producer" in text
    # Chrome dropped
    assert "Cookies on GOV.UK" not in text
    assert "Skip to main content" not in text
    assert "Crown copyright" not in text
    assert "gem-c-breadcrumbs" not in text
    assert "beta service" not in text
    # script/style contents dropped too
    assert "var ga" not in text
    assert "color: red" not in text


def test_gov_html_is_stable_across_cookie_banner_replacement():
    """Two renders that differ only in chrome text produce the same hash."""
    alt = GOV_UK_FIXTURE.decode("utf-8").replace(
        "Cookies on GOV.UK", "Cookie preferences — accept all"
    ).replace("Crown copyright", "© Crown copyright 2026")
    text_a = _strip_chrome(GOV_UK_FIXTURE.decode("utf-8"))
    text_b = _strip_chrome(alt)
    assert text_a == text_b


def test_gov_html_handles_malformed_html():
    """Parser must not raise on broken tags — fall back to coarse strip."""
    garbage = "<div>content<p>no closing tag<div class='cookie-banner'>ad"
    # Should not raise — even if it does, callers wrap in try/except already.
    text = _strip_chrome(garbage)
    # "content" survives even when the structure is malformed
    assert "content" in text


def test_collect_source_dispatches_gov_html(monkeypatch):
    """collect_source routes gov_html to the chrome-stripping collector."""
    entry = {
        "id": "uk-weee-regulations-guidance",
        "market": "UK",
        "source_type": "gov_html",
        "source_url": "https://example.com/uk-weee",
        "title": "WEEE Regulations",
    }
    _patch_client(monkeypatch, client_with(_FakeHttpxResponse(GOV_UK_FIXTURE)))
    update = collect_source(entry)
    assert update.source_type == "gov_html"
    assert "WEEE Regulations" in update.text
    assert "Cookies on GOV.UK" not in update.text


# ── Safety Gate collector ────────────────────────────────────────────────


SAFETY_GATE_PAYLOAD = {
    "count": 3,
    "results": [
        {
            "id": "2026-1234",
            "week": "2026-W37",
            "category": "Toys",
            "country": "Germany",
            "product": "Plastic doll with phthalates",
        },
        {
            "id": "2026-1235",
            "week": "2026-W37",
            "category": "Lighting equipment",
            "country": "France",
            "product": "Desk lamp (electric shock risk)",
        },
        {
            "id": "2026-1236",
            "week": "2026-W37",
            "category": "Industrial machinery",
            "country": "Italy",
            "product": "CNC lathe",
        },
    ],
}


def test_safety_gate_filters_relevant_categories():
    out = []
    for alert in SAFETY_GATE_PAYLOAD["results"]:
        out.append((alert["id"], _is_relevant(alert)))
    # Toys + electrical → relevant; industrial → not (we don't cover it)
    assert out == [
        ("2026-1234", True),
        ("2026-1235", True),
        ("2026-1236", False),
    ]


def test_safety_gate_alert_categories_handles_both_shapes():
    flat = {"category": "Toys"}
    nested = {"category": [{"name": "Toys"}, {"name": "Children"}]}
    assert _alert_categories(flat) == ["Toys"]
    assert "Toys" in _alert_categories(nested)


def test_collect_safety_gate_builds_stable_digest(monkeypatch):
    entry = {
        "id": "eu-safety-gate-alerts",
        "market": "EU",
        "source_type": "safety_gate",
        "source_url": "https://ec.europa.eu/safety-gate-alerts/api/v1/notifs/?format=json&language=en",
        "title": "Safety Gate",
    }
    body = json.dumps(SAFETY_GATE_PAYLOAD).encode("utf-8")
    _patch_client(
        monkeypatch,
        client_with(
            _FakeHttpxResponse(body, last_modified="Wed, 16 Sep 2026 03:00:00 GMT")
        ),
    )
    update = collect_safety_gate(entry)
    assert update.source_type == "safety_gate"
    # only the 2 relevant alerts feed the digest
    assert update.metadata["alertCount"] == 2
    assert update.metadata["totalCount"] == 3
    # sorted by id (alert 1234 before 1235)
    lines = update.text.splitlines()
    assert lines[0].startswith("2026-1234")
    # stable hash
    assert update.content_hash == text_hash(update.text)


def test_safety_gate_raises_on_non_json(monkeypatch):
    entry = {
        "id": "eu-safety-gate-alerts",
        "market": "EU",
        "source_type": "safety_gate",
        "source_url": "https://ec.europa.eu/safety-gate-alerts/api/v1/notifs/",
        "title": "Safety Gate",
    }
    # Body must exceed MIN_CONTENT_BYTES (64) for fetch_url to forward it
    # to the JSON parser — otherwise the small-body guard rejects first.
    body = b"<html>not json but big enough to make it past the small-body guard</html>" * 2
    _patch_client(monkeypatch, client_with(_FakeHttpxResponse(body)))
    with pytest.raises(ValueError, match="JSON decode failed"):
        collect_safety_gate(entry)


# ── OpenFDA URL building ─────────────────────────────────────────────────

# Each OpenFDA endpoint names its date field differently, and asking for a
# field the endpoint does not have is a hard HTTP 500 — not an empty result.
# So the sort is declared per registry entry rather than assumed.


def test_openfda_default_sort_suits_the_device_endpoint():
    from scripts.watchdog.collectors.openfda import _build_openfda_url

    url = _build_openfda_url({"id": "x"})
    assert url.startswith("https://api.fda.gov/device/recall.json?")
    assert "sort=event_date_initiated" in url
    assert "limit=100" in url
    # No filter by default: the device endpoint has no risk-class field.
    assert "search=" not in url


def test_openfda_entry_declares_its_own_sort_field():
    """Food enforcement orders by recall_initiation_date; the device field
    would 500 there."""
    from scripts.watchdog.collectors.openfda import _build_openfda_url

    url = _build_openfda_url(
        {
            "id": "x",
            "source_url": "https://api.fda.gov/food/enforcement.json",
            "sort": "recall_initiation_date:desc",
        }
    )
    assert url.startswith("https://api.fda.gov/food/enforcement.json?")
    assert "sort=recall_initiation_date" in url


def test_openfda_search_is_optional_and_passed_through():
    from scripts.watchdog.collectors.openfda import _build_openfda_url

    filtered = _build_openfda_url({"id": "x", "search": 'product_code:"IZL"'})
    assert "search=" in filtered
    # An explicitly empty search is the same as omitting it.
    assert "search=" not in _build_openfda_url({"id": "x", "search": ""})


def test_openfda_normalize_handles_both_endpoint_shapes():
    """The device and food endpoints name the same fields differently."""
    from scripts.watchdog.collectors.openfda import _normalize_recall

    device = _normalize_recall(
        {
            "product_res_number": "Z-0001-04",
            "event_date_initiated": "20031027",
            "recall_status": "Open, Classified",
            "product_description": "X-Ray",
        }
    )
    assert device["id"] == "Z-0001-04"
    assert device["date"] == "20031027"

    food = _normalize_recall(
        {
            "recall_number": "F-0276-2017",
            "recall_initiation_date": "20160808",
            "classification": "Class II",
            "product_description": "Hydrolyzed fragments",
        }
    )
    assert food["id"] == "F-0276-2017"
    assert food["classification"] == "Class II"
