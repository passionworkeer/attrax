import pytest
from unittest.mock import patch

from scripts.watchdog.collectors import base as watchdog_base
from scripts.watchdog.collectors.base import WAFChallengeBlockedException, fetch_url
from scripts.watchdog.collectors.us_cpsc_api import collect_cpsc_recall_api
from scripts.watchdog.state import SourceStateStore, Change, normalize_text, text_hash
from scripts.watchdog.tests._http_mock import _FakeHttpxResponse, client_with


def test_fetch_url_detects_waf_challenge():
    """A Cloudflare interstitial served with HTTP 200 must raise, not be
    digested as content. 2026-09-18 H14: the transport is httpx.Client now,
    so the fetch is driven through the shared fake client (the previous
    urllib.request.urlopen patch no longer intercepts the hot path)."""
    cf_challenge_html = b"""
    <html>
      <head><title>Just a moment...</title></head>
      <body>
        <div id="cf-challenge-running">Please wait while we verify you are human. Cloudflare</div>
      </body>
    </html>
    """

    fake_client = client_with(_FakeHttpxResponse(cf_challenge_html))
    with patch.object(watchdog_base, "_get_http_client", return_value=fake_client):
        with pytest.raises(WAFChallengeBlockedException) as exc_info:
            fetch_url("https://example.com/cf-protected", retries=1)

    assert "WAF challenge / anti-bot interstitial detected" in str(exc_info.value)
    # The challenge came back over the wire — the detection must be based on
    # the fetched body, not on a request that never happened.
    assert len(fake_client.requests) == 1


def test_cpsc_collector_raises_when_the_api_does_not_return_an_array():
    """A non-array payload (an error envelope, a schema change) must be an
    explicit failure — silently digesting it would freeze the source.

    2026-09-18 H14: driven through the fake httpx client, which is the
    primary transport now (urllib is only the no-httpx fallback).
    """
    envelope = b'{"error": {"code": "NOT_FOUND", "message": "no matches"}}'

    fake_client = client_with(_FakeHttpxResponse(envelope))
    with patch.object(watchdog_base, "_get_http_client", return_value=fake_client):
        with pytest.raises(ValueError) as exc_info:
            collect_cpsc_recall_api(
                {"id": "test_cpsc", "source_url": "https://example.com/cpsc"}
            )

    assert "expected a JSON array" in str(exc_info.value)
    assert len(fake_client.requests) == 1


def test_watchdog_source_state_store_bulk_snapshot_and_diff(tmp_path):
    store = SourceStateStore(base_dir=tmp_path, db_name="test_state.db")

    updates = [
        ("SRC-01", "Regulation clause A text", text_hash("Regulation clause A text")),
        ("SRC-02", "Regulation clause B text", text_hash("Regulation clause B text")),
    ]

    store.bulk_snapshot(updates)

    # Verify rows persisted
    row1 = store.get("SRC-01")
    assert row1 is not None
    assert row1["last_hash"] == text_hash("Regulation clause A text")
    assert row1["check_count"] == 1

    row2 = store.get("SRC-02")
    assert row2 is not None
    assert row2["last_hash"] == text_hash("Regulation clause B text")

    # Detect no changes for identical text
    assert store.detect_changes("SRC-01", "Regulation clause A text") == []

    # Detect modification
    changes = store.detect_changes("SRC-01", "Regulation clause A modified drastically for consumer safety.")
    assert len(changes) == 1
    assert changes[0].kind == "modified"
    assert changes[0].source_id == "SRC-01"
    assert changes[0].similarity < 0.95
    assert len(changes[0].unified_diff) > 0

    store.close()
