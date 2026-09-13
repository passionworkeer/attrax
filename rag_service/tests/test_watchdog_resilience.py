import io
import pytest
import sqlite3
from unittest.mock import patch, MagicMock
from scripts.watchdog.collectors.base import WAFChallengeBlockedException, fetch_url
from scripts.watchdog.collectors.us_cpsc import collect_cpsc_rss, _parse_rss_items
from scripts.watchdog.state import SourceStateStore, Change, normalize_text, text_hash


def test_fetch_url_detects_waf_challenge():
    cf_challenge_html = b"""
    <html>
      <head><title>Just a moment...</title></head>
      <body>
        <div id="cf-challenge-running">Please wait while we verify you are human. Cloudflare</div>
      </body>
    </html>
    """

    mock_response = MagicMock()
    mock_response.read.return_value = cf_challenge_html
    mock_response.headers.get.return_value = None
    mock_response.__enter__.return_value = mock_response

    with patch("urllib.request.urlopen", return_value=mock_response):
        with pytest.raises(WAFChallengeBlockedException) as exc_info:
            fetch_url("https://example.com/cf-protected", retries=1)

    assert "WAF challenge / anti-bot interstitial detected" in str(exc_info.value)


def test_cpsc_collector_raises_on_empty_parse_of_non_rss_page():
    dummy_html = b"<html><body><h1>No articles here</h1><p>Generic page content</p></body></html>"

    items = _parse_rss_items(dummy_html)
    assert items == []

    mock_response = MagicMock()
    mock_response.read.return_value = dummy_html
    mock_response.headers.get.return_value = None
    mock_response.__enter__.return_value = mock_response

    with patch("urllib.request.urlopen", return_value=mock_response):
        with pytest.raises(ValueError) as exc_info:
            collect_cpsc_rss({"id": "test_cpsc", "source_url": "https://example.com/cpsc"})

    assert "CPSC RSS feed returned 0 parsed items" in str(exc_info.value)


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
