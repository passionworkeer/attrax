"""Tests for the watchdog collectors — dispatch + parsing, with mocked HTTP."""
from __future__ import annotations

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
)
from scripts.watchdog.collectors.us_cpsc import _parse_rss_items  # noqa: E402
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
    resp = _fake_response(b"<html>phthalates rules page</html>" * 5)
    with patch.object(collectors_base.urllib.request, "urlopen", return_value=resp):
        update = collect_source(entry)
    assert update.source_type == "ecfr_part"
    # 2026-09-12 postmortem: the versioner API 406s from Seoul — the
    # collector now hashes the human-facing eCFR page instead.
    assert "ecfr.gov/current/title-16/part-1307" in update.source_url
    assert update.metadata["ecfrPart"] == 1307


# ── CPSC RSS parsing ─────────────────────────────────────────────────────


def test_parse_rss_items_extracts_sorted_fields():
    rss = b"""<?xml version="1.0"?>
    <rss version="2.0"><channel>
      <item><title>B Recall</title><link>u2</link><pubDate>Sep 10</pubDate></item>
      <item><title>A Recall</title><link>u1</link><pubDate>Sep 11</pubDate></item>
    </channel></rss>"""
    items = _parse_rss_items(rss)
    assert len(items) == 2
    assert items[0]["title"] == "B Recall"
    assert items[1]["link"] == "u1"


def test_parse_rss_items_handles_atom_feeds():
    atom = b"""<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>Atom Recall</title>
        <link href="https://example.com/a1"/>
        <updated>2026-09-12T00:00:00Z</updated>
      </entry>
    </feed>"""
    items = _parse_rss_items(atom)
    assert len(items) == 1
    assert items[0]["title"] == "Atom Recall"
    assert items[0]["link"] == "https://example.com/a1"


def test_parse_rss_items_returns_empty_on_garbage():
    assert _parse_rss_items(b"not xml at all") == []
