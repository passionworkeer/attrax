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


def _fake_response(body: bytes, last_modified: str | None = None):
    class _Resp:
        def __init__(self):
            self.headers = {"Last-Modified": last_modified} if last_modified else {}

        def read(self):
            return body

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    return _Resp()


# ── fetch_url ────────────────────────────────────────────────────────────


def test_fetch_url_returns_body_and_last_modified():
    resp = _fake_response(b"x" * 200, last_modified="Wed, 11 Sep 2026 03:00:00 GMT")
    with patch.object(collectors_base.urllib.request, "urlopen", return_value=resp):
        body, lm = fetch_url("https://example.com/doc")
    assert body == b"x" * 200
    assert lm == "Wed, 11 Sep 2026 03:00:00 GMT"


def test_fetch_url_retries_transient_errors_then_succeeds():
    resp = _fake_response(b"y" * 200)
    with patch.object(
        collectors_base.urllib.request,
        "urlopen",
        side_effect=[urllib.error.URLError("boom"), resp],
    ), patch.object(collectors_base.time, "sleep"):
        body, _ = fetch_url("https://example.com/doc", retries=2)
    assert body == b"y" * 200


def test_fetch_url_does_not_retry_client_4xx():
    err = urllib.error.HTTPError(
        "url", 404, "Not Found", hdrs=None, fp=None
    )
    with patch.object(collectors_base.urllib.request, "urlopen", side_effect=err):
        with pytest.raises(urllib.error.HTTPError):
            fetch_url("https://example.com/missing", retries=3)


def test_fetch_url_rejects_suspiciously_small_body():
    resp = _fake_response(b"tiny")
    with patch.object(collectors_base.urllib.request, "urlopen", return_value=resp), \
         patch.object(collectors_base.time, "sleep"):
        with pytest.raises(urllib.error.URLError):
            fetch_url("https://example.com/doc", retries=1)


# ── collect_generic + dispatch ───────────────────────────────────────────


def test_collect_generic_hashes_normalized_text():
    entry = {
        "id": "uk-toys",
        "market": "UK",
        "source_type": "gov_html",
        "source_url": "https://example.com/uk-toys",
        "title": "UK Toys Regs",
    }
    resp = _fake_response(b"<html><body>  content  \n\n here </body></html>" * 5)
    with patch.object(collectors_base.urllib.request, "urlopen", return_value=resp):
        update = collect_generic(entry)
    assert update.source_id == "uk-toys"
    assert update.source_type == "gov_html"
    assert update.content_hash == text_hash(update.text)
    assert "content" in update.text and "here" in update.text


def test_collect_source_dispatches_by_source_type():
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
    resp = _fake_response(fr_json)
    with patch.object(collectors_base.urllib.request, "urlopen", return_value=resp):
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


def test_collect_cpsc_recall_api_builds_a_stable_sorted_digest():
    entry = {
        "id": "us-cpsc-recalls-api",
        "market": "US",
        "source_type": "cpsc_recall_api",
        "title": "CPSC Recalls",
    }
    body = json.dumps(CPSC_API_PAYLOAD).encode("utf-8")
    resp = _fake_response(body, last_modified="Wed, 17 Sep 2026 03:00:00 GMT")
    with patch.object(collectors_base.urllib.request, "urlopen", return_value=resp):
        update = collect_cpsc_recall_api(entry)

    assert update.source_type == "cpsc_recall_api"
    assert update.metadata["recallCount"] == 2
    # sorted by (date, number) — API ordering is not a content change
    lines = update.text.splitlines()
    assert lines[0].startswith("2026-09-03")
    assert lines[1].startswith("2026-09-10")
    assert update.content_hash == text_hash(update.text)


def test_collect_cpsc_recall_api_rejects_non_array():
    entry = {"id": "us-cpsc", "market": "US", "source_type": "cpsc_recall_api"}
    body = b'{"unexpected": "envelope but big enough to clear the small-body guard"}'
    resp = _fake_response(body)
    with patch.object(collectors_base.urllib.request, "urlopen", return_value=resp), \
         patch.object(collectors_base.time, "sleep"):
        with pytest.raises(ValueError, match="expected a JSON array"):
            collect_cpsc_recall_api(entry)


# ── WAF fallback chain (fetch_url rotation) ──────────────────────────────


def test_fetch_url_rotates_user_agent_on_retry():
    """First attempt: primary UA. Retries: fallback UA + Sec-Fetch-* headers."""
    import urllib.request as ur
    seen_ua: list[str] = []
    seen_sec_fetch: list[bool] = []

    resp = _fake_response(b"x" * 200)
    # First call raises WAFChallengeBlockedException; second succeeds.
    def _open(req, *args, **kwargs):
        seen_ua.append(req.get_header("User-agent") or "")
        # urllib normalises header names to lowercase; compare lowercased.
        seen_sec_fetch.append(
            any(k.lower() == "sec-fetch-site" for k, _ in req.header_items())
        )
        if len(seen_ua) == 1:
            raise WAFChallengeBlockedException("blocked")
        return resp

    with patch.object(collectors_base.urllib.request, "urlopen", side_effect=_open), \
         patch.object(collectors_base.time, "sleep"):
        body, _ = fetch_url("https://example.com/doc", retries=2)
    assert body == b"x" * 200
    assert seen_ua[0] == USER_AGENT
    assert seen_ua[1] == _FALLBACK_USER_AGENT
    assert seen_sec_fetch[0] is False  # first attempt: no Sec-Fetch
    assert seen_sec_fetch[1] is True   # retry: Sec-Fetch-* present


def test_fetch_url_does_not_retry_on_waf_after_first_attempt():
    """If retries=1, no UA rotation happens."""
    resp = _fake_response(b"x" * 200)
    with patch.object(
        collectors_base.urllib.request, "urlopen", return_value=resp
    ):
        body, _ = fetch_url("https://example.com/doc", retries=1)
    assert body == b"x" * 200


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


def test_collect_source_dispatches_gov_html():
    """collect_source routes gov_html to the chrome-stripping collector."""
    entry = {
        "id": "uk-weee-regulations-guidance",
        "market": "UK",
        "source_type": "gov_html",
        "source_url": "https://example.com/uk-weee",
        "title": "WEEE Regulations",
    }
    resp = _fake_response(GOV_UK_FIXTURE)
    with patch.object(collectors_base.urllib.request, "urlopen", return_value=resp):
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


def test_collect_safety_gate_builds_stable_digest():
    entry = {
        "id": "eu-safety-gate-alerts",
        "market": "EU",
        "source_type": "safety_gate",
        "source_url": "https://ec.europa.eu/safety-gate-alerts/api/v1/notifs/?format=json&language=en",
        "title": "Safety Gate",
    }
    body = json.dumps(SAFETY_GATE_PAYLOAD).encode("utf-8")
    resp = _fake_response(body, last_modified="Wed, 16 Sep 2026 03:00:00 GMT")
    with patch.object(collectors_base.urllib.request, "urlopen", return_value=resp):
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


def test_safety_gate_raises_on_non_json():
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
    resp = _fake_response(body)
    with patch.object(collectors_base.urllib.request, "urlopen", return_value=resp), \
         patch.object(collectors_base.time, "sleep"):
        with pytest.raises(ValueError, match="JSON decode failed"):
            collect_safety_gate(entry)
