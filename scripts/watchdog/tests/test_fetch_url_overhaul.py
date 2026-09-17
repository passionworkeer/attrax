"""Tests for the 2026-09-17 fetch_url overhaul: cookie jar, 304 short-circuit,
Accept-Language / Accept-Encoding, gzip decoding."""
from __future__ import annotations

import gzip
import http.cookiejar
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
    fetch_url,
    _CONDITIONAL_CACHE,
)


def _fake_response(
    body: bytes,
    *,
    last_modified: str | None = None,
    etag: str | None = None,
    content_encoding: str | None = None,
    status: int = 200,
    cookies: list[http.cookiejar.Cookie] | None = None,
    captured_requests: list | None = None,
):
    class _Resp:
        def __init__(self):
            self.headers = {}
            if last_modified:
                self.headers["Last-Modified"] = last_modified
            if etag:
                self.headers["ETag"] = etag
            if content_encoding:
                self.headers["Content-Encoding"] = content_encoding
            self._cookies = cookies or []
            self._urlopen_call = len(captured_requests) if captured_requests is not None else None

        def read(self):
            return body

        def getcode(self):
            return status

        def info(self):  # pragma: no cover — unused but harmless
            return self.headers

        def __enter__(self):
            if captured_requests is not None:
                captured_requests.append(self)
            return self

        def __exit__(self, *args):
            return False

    return _Resp()


@pytest.fixture(autouse=True)
def _reset_conditional_cache():
    _CONDITIONAL_CACHE.clear()
    yield
    _CONDITIONAL_CACHE.clear()


def test_fetch_url_sends_accept_language_and_accept_encoding():
    """Every attempt must include Accept-Language and Accept-Encoding so CDN
    WAFs see a normal browser header set, not a bare-UA bot fingerprint."""
    captured: dict = {}

    def _fake_urlopen(request, timeout=30):  # noqa: ARG001 — match urllib signature
        captured["headers"] = dict(request.header_items())
        return _fake_response(b"x" * 200)

    with patch.object(collectors_base.urllib.request, "urlopen", side_effect=_fake_urlopen):
        body, _ = fetch_url("https://example.com/lang")

    headers = {k.lower(): v for k, v in captured["headers"].items()}
    assert headers.get("accept-language") == "en-US,en;q=0.9"
    assert "gzip" in headers.get("accept-encoding", "")
    assert "deflate" in headers.get("accept-encoding", "")
    assert "br" in headers.get("accept-encoding", "")
    assert body == b"x" * 200


def test_fetch_url_short_circuits_on_304_with_empty_response():
    """Second call against a URL that 304s returns empty body so the
    orchestrator plays back the cached hash instead of treating it as a change."""
    etag = '"abc123"'
    last_mod = "Wed, 11 Sep 2026 03:00:00 GMT"

    # First call: server returns 200 with ETag + Last-Modified.
    first = _fake_response(
        b"x" * 200, last_modified=last_mod, etag=etag
    )
    # Second call: server returns 304.
    second = _fake_response(b"", last_modified=last_mod, etag=etag, status=304)

    with patch.object(
        collectors_base.urllib.request, "urlopen", side_effect=[first, second]
    ), patch.object(collectors_base.time, "sleep"):
        body1, _ = fetch_url("https://example.com/etag-doc")
        body2, _ = fetch_url("https://example.com/etag-doc")

    assert body1 == b"x" * 200
    assert body2 == b""


def test_fetch_url_sends_if_none_match_on_second_call():
    """The conditional revalidation headers ride along on the next request."""
    etag = '"v1"'
    requests: list = []

    def _fake_urlopen(request, timeout=30):  # noqa: ARG001
        requests.append(dict(request.header_items()))
        if len(requests) == 1:
            return _fake_response(b"x" * 200, etag=etag)
        return _fake_response(b"", etag=etag, status=304)

    with patch.object(collectors_base.urllib.request, "urlopen", side_effect=_fake_urlopen), \
         patch.object(collectors_base.time, "sleep"):
        fetch_url("https://example.com/revalidate")
        fetch_url("https://example.com/revalidate")

    assert len(requests) == 2
    second = {k.lower(): v for k, v in requests[1].items()}
    assert second.get("if-none-match") == etag


def test_fetch_url_cookies_ride_back_on_retry():
    """The shared CookieJar is wired into the default opener at import time
    so cookies (notably ``cf_clearance``) flow into subsequent requests.

    Patching ``urllib.request.urlopen`` directly bypasses the opener chain,
    which is the wrong place to test this — the cookie handling runs inside
    ``HTTPCookieProcessor.http_request`` and ``.https_response``. Instead we
    assert on the wiring: the default opener has a cookie handler, and
    calling its ``http_request`` on a populated jar adds a Cookie header.
    """
    collectors_base._COOKIE_JAR.clear()
    cookie = http.cookiejar.Cookie(
        version=0, name="cf_clearance", value="abc",
        port=None, port_specified=False,
        domain="example.com", domain_specified=True, domain_initial_dot=False,
        path="/", path_specified=True,
        secure=False, expires=None, discard=True,
        comment=None, comment_url=None,
        rest={}, rfc2109=False,
    )
    collectors_base._COOKIE_JAR.set_cookie(cookie)

    # Confirm the global default opener is the cookie-aware one we built at
    # import time. urllib.request stores it under ``_opener``; it is None
    # before install_opener runs.
    default_opener = getattr(collectors_base.urllib.request, "_opener", None)
    assert default_opener is not None, "fetch_url must install a default opener"
    handler_classes = [type(h).__name__ for h in default_opener.handlers]
    assert "HTTPCookieProcessor" in handler_classes

    # Drive the cookie processor's add_cookie_header directly with a request
    # the way the opener chain would — proves the jar is wired through.
    import urllib.request as urllib_request
    request = urllib_request.Request("https://example.com/cookies")
    cookie_handlers = [
        h for h in default_opener.handlers
        if type(h).__name__ == "HTTPCookieProcessor"
    ]
    assert cookie_handlers, "no HTTPCookieProcessor in opener handlers"
    cookie_handlers[0].cookiejar.add_cookie_header(request)
    cookie_value = request.get_header("Cookie") or ""
    assert "cf_clearance=abc" in cookie_value


def test_fetch_url_decompresses_gzip():
    """A gzip-encoded body is decoded before being returned, so the orchestrator
    sees raw text."""
    raw = b"hello gzip world " * 30
    gzipped = gzip.compress(raw)

    resp = _fake_response(gzipped, content_encoding="gzip")
    with patch.object(collectors_base.urllib.request, "urlopen", return_value=resp):
        body, _ = fetch_url("https://example.com/gzip-doc")

    assert body == raw


def test_fetch_url_handles_missing_content_encoding():
    """No Content-Encoding header → body returned unchanged."""
    body = b"plain text body " * 20
    resp = _fake_response(body)
    with patch.object(collectors_base.urllib.request, "urlopen", return_value=resp):
        out, _ = fetch_url("https://example.com/plain")
    assert out == body


def test_fetch_url_lru_cache_is_bounded():
    """The ETag/Last-Modified cache evicts oldest entries past 256."""
    # Pre-fill the cache with 256 entries so the next fetch trips the cap.
    for i in range(256):
        _CONDITIONAL_CACHE[f"https://example.com/{i}"] = (None, None)
    assert len(_CONDITIONAL_CACHE) == 256

    resp = _fake_response(b"x" * 200, etag='"new"')
    with patch.object(collectors_base.urllib.request, "urlopen", return_value=resp):
        fetch_url("https://example.com/fresh")

    # After the insert: cache hit 256 → insert new → evict oldest → 256 entries.
    assert len(_CONDITIONAL_CACHE) == 256
    # Oldest entry was evicted; newest is present.
    assert "https://example.com/0" not in _CONDITIONAL_CACHE
    assert "https://example.com/fresh" in _CONDITIONAL_CACHE