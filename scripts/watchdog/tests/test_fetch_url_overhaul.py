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
    collect_source,
    NotModified,
    resolve_user_agents,
    _UA_TABLE,
    _CONDITIONAL_CACHE,
    _cache_key,
    _remember_conditional,
    invalidate_conditional_cache,
)
from scripts.watchdog.tests._http_mock import (  # noqa: E402
    _FakeHttpxResponse,
    client_with,
    disable_http_client,
)


def _use_fake_client(monkeypatch, client) -> None:
    """Route ``fetch_url`` through a stand-in httpx client (primary path)."""
    monkeypatch.setattr(collectors_base, "_get_http_client", lambda: client)


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
    """urlopen-shaped stand-in used by the urllib *fallback* tests."""
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

        def close(self):
            return None

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


def test_fetch_url_sends_accept_language_and_accept_encoding(monkeypatch):
    """Every attempt must include Accept-Language and Accept-Encoding so CDN
    WAFs see a normal browser header set, not a bare-UA bot fingerprint."""
    fake = client_with(_FakeHttpxResponse(b"x" * 200))
    _use_fake_client(monkeypatch, fake)

    body, _ = fetch_url("https://example.com/lang")

    headers = {k.lower(): v for k, v in fake.requests[0]["headers"].items()}
    assert headers.get("accept-language") == "en-US,en;q=0.9"
    assert "gzip" in headers.get("accept-encoding", "")
    assert "deflate" in headers.get("accept-encoding", "")
    assert "br" in headers.get("accept-encoding", "")
    assert body == b"x" * 200


def test_fetch_url_raises_not_modified_on_304(monkeypatch):
    """Second call against a URL that 304s raises NotModified.

    An empty-body return would be handed to the collector's RDF / JSON / RSS
    parser and read as a bogus failure, so the 304 travels as an exception up
    to the orchestrator instead.
    """
    etag = '"abc123"'
    last_mod = "Wed, 11 Sep 2026 03:00:00 GMT"

    # First call: server returns 200 with ETag + Last-Modified.
    first = _FakeHttpxResponse(b"x" * 200, last_modified=last_mod, etag=etag)
    # Second call: server returns 304.
    second = _FakeHttpxResponse(b"", last_modified=last_mod, etag=etag, status_code=304)
    fake = client_with([first, second])
    _use_fake_client(monkeypatch, fake)

    body1, _ = fetch_url("https://example.com/etag-doc")
    with pytest.raises(NotModified):
        fetch_url("https://example.com/etag-doc")

    assert body1 == b"x" * 200


def test_fetch_url_sends_if_none_match_on_second_call(monkeypatch):
    """The conditional revalidation headers ride along on the next request."""
    etag = '"v1"'

    def _get(url, *, headers, timeout):  # noqa: ARG001 — match client.get signature
        if headers.get("If-None-Match") == etag:
            return _FakeHttpxResponse(b"", etag=etag, status_code=304)
        return _FakeHttpxResponse(b"x" * 200, etag=etag)

    fake = client_with(_get)
    _use_fake_client(monkeypatch, fake)

    fetch_url("https://example.com/revalidate")
    with pytest.raises(NotModified):
        fetch_url("https://example.com/revalidate")

    assert len(fake.requests) == 2
    second = {k.lower(): v for k, v in fake.requests[1]["headers"].items()}
    assert second.get("if-none-match") == etag


def test_http_client_is_a_process_wide_singleton(monkeypatch):
    """H14: ``fetch_url`` must reuse one client so connections pool. A
    per-request client would open a fresh pool every call and defeat the
    whole point — assert identity across calls and the pool sizing that
    matches the orchestrator's 8 fetch workers."""
    httpx = pytest.importorskip("httpx")
    captured: dict = {}
    real_client = httpx.Client

    class _Recording(real_client):
        def __init__(self, **kwargs):
            captured.update(kwargs)
            super().__init__(**kwargs)

    collectors_base.reset_http_client()
    monkeypatch.setattr(collectors_base.httpx, "Client", _Recording)
    try:
        client = collectors_base._get_http_client()
        assert isinstance(client, real_client)
        assert collectors_base._get_http_client() is client
        limits = captured["limits"]
        assert limits.max_connections == 8
        assert limits.max_keepalive_connections == 8
        assert captured["follow_redirects"] is True
    finally:
        collectors_base.reset_http_client()


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


def test_fetch_url_threads_cookies_through_the_httpx_client(monkeypatch):
    """The CloudFront cf_clearance handshake: a Set-Cookie from attempt 1
    must ride back on the next request. On the primary path that is the real
    ``httpx.Client`` cookie jar — driven here through ``httpx.MockTransport``
    at the socket boundary, so the client itself is the production one."""
    httpx = pytest.importorskip("httpx")
    seen_cookies: list[str] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        seen_cookies.append(request.headers.get("cookie", ""))
        if len(seen_cookies) == 1:
            return httpx.Response(
                200,
                content=b"x" * 200,
                headers={"Set-Cookie": "cf_clearance=abc; Path=/"},
            )
        return httpx.Response(200, content=b"y" * 200)

    client = httpx.Client(
        transport=httpx.MockTransport(_handler), follow_redirects=True
    )
    monkeypatch.setattr(collectors_base, "_get_http_client", lambda: client)
    try:
        first, _ = fetch_url("https://example.com/cookies")
        second, _ = fetch_url("https://example.com/cookies")
    finally:
        client.close()

    assert first == b"x" * 200
    assert second == b"y" * 200
    assert seen_cookies[0] == ""
    assert "cf_clearance=abc" in seen_cookies[1]


def test_fetch_url_decompresses_gzip(monkeypatch):
    """The urllib fallback still decodes gzip itself (httpx auto-decodes on
    the primary path), so a stdlib-only deployment sees raw text too."""
    raw = b"hello gzip world " * 30
    gzipped = gzip.compress(raw)

    resp = _fake_response(gzipped, content_encoding="gzip")
    disable_http_client(monkeypatch)
    with patch.object(collectors_base.urllib.request, "urlopen", return_value=resp):
        body, _ = fetch_url("https://example.com/gzip-doc")

    assert body == raw


def test_fetch_url_handles_missing_content_encoding(monkeypatch):
    """No Content-Encoding header → body returned unchanged (fallback path)."""
    body = b"plain text body " * 20
    resp = _fake_response(body)
    disable_http_client(monkeypatch)
    with patch.object(collectors_base.urllib.request, "urlopen", return_value=resp):
        out, _ = fetch_url("https://example.com/plain")
    assert out == body


def test_fetch_url_lru_cache_is_bounded(monkeypatch):
    """The ETag/Last-Modified cache evicts oldest entries past 256."""
    # Pre-fill the cache with 256 entries so the next fetch trips the cap.
    # 2026-09-18 M19: keys are now f"{source_id}:{url}"; use the helper so
    # the test exercises the same namespace fetch_url uses at runtime.
    for i in range(256):
        _CONDITIONAL_CACHE[_cache_key(f"src-{i}", f"https://example.com/{i}")] = (None, None)
    assert len(_CONDITIONAL_CACHE) == 256

    fake = client_with(_FakeHttpxResponse(b"x" * 200, etag='"new"'))
    _use_fake_client(monkeypatch, fake)
    fetch_url("https://example.com/fresh")

    # After the insert: cache hit 256 → insert new → evict oldest → 256 entries.
    assert len(_CONDITIONAL_CACHE) == 256
    # Oldest entry was evicted; newest is present.
    assert _cache_key("src-0", "https://example.com/0") not in _CONDITIONAL_CACHE
    assert _cache_key("", "https://example.com/fresh") in _CONDITIONAL_CACHE


# ── M19: conditional cache namespacing reaches every collector ───────────


def test_modules_pass_source_id_to_fetch_url():
    """M19: the cache is keyed ``f"{source_id}:{url}"`` and
    ``invalidate_conditional_cache(source_id)`` matches on that prefix. A
    collector that fetches without its source_id drops out of both — its
    validators become URL-only and --ack / --revert invalidation miss it.
    Parse every collector module so a new source type cannot silently
    reintroduce that hole."""
    import ast

    collectors_dir = Path(collectors_base.__file__).resolve().parent
    offenders: list[str] = []
    for module_path in sorted(collectors_dir.glob("*.py")):
        tree = ast.parse(module_path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = func.id if isinstance(func, ast.Name) else getattr(func, "attr", "")
            if name != "fetch_url":
                continue
            if not any(kw.arg == "source_id" for kw in node.keywords):
                offenders.append(f"{module_path.name}:{node.lineno}")

    assert offenders == [], f"fetch_url calls missing source_id=: {offenders}"


def test_collector_replays_validators_under_its_source_id(monkeypatch):
    """A validator seeded under (source_id, url) must be replayed by the
    collector — proof the key matches at runtime, and therefore that
    invalidating by source_id can reach the entry."""
    entry = {
        "id": "uk-weee-regulations-guidance",
        "market": "UK",
        "source_type": "gov_html",
        "source_url": "https://example.com/uk-weee",
        "title": "WEEE Regulations",
    }
    _remember_conditional(entry["id"], entry["source_url"], '"E1"', None)

    fake = client_with(_FakeHttpxResponse(b"", status_code=304, etag='"E1"'))
    _use_fake_client(monkeypatch, fake)

    with pytest.raises(NotModified):
        collect_source(entry)

    assert fake.requests[0]["headers"]["If-None-Match"] == '"E1"'
    assert invalidate_conditional_cache(entry["id"]) == 1


# ── User-Agent quarterly rotation ────────────────────────────────────────


def test_ua_table_is_ordered_and_complete():
    """Each row carries a quarter plus a Windows and a macOS UA. The
    platform difference is the point of the retry rotation."""
    assert _UA_TABLE
    quarters = [row[0] for row in _UA_TABLE]
    assert quarters == sorted(quarters), "table must be oldest-first"
    for quarter, windows, macos in _UA_TABLE:
        assert quarter.count("-Q") == 1
        assert "Windows NT" in windows
        assert "Macintosh" in macos
        assert windows != macos


def test_resolve_user_agents_picks_the_current_quarter():
    from datetime import date

    quarter, primary, fallback = resolve_user_agents(date(2026, 9, 17))
    assert quarter == "2026-Q3"
    assert "Chrome/124" in primary
    assert "Chrome/120" in fallback


def test_resolve_user_agents_advances_at_the_quarter_boundary():
    from datetime import date

    assert resolve_user_agents(date(2026, 9, 30))[0] == "2026-Q3"
    assert resolve_user_agents(date(2026, 10, 1))[0] == "2026-Q4"


def test_resolve_user_agents_clamps_instead_of_failing():
    """A stale table must keep serving its newest known-good UA, and an
    early date must not fall off the front of the table."""
    from datetime import date

    newest = _UA_TABLE[-1][0]
    oldest = _UA_TABLE[0][0]
    # Far future: clamp to the newest row rather than raising.
    assert resolve_user_agents(date(2030, 1, 1))[0] == newest
    # Before the table starts: clamp to the earliest row.
    assert resolve_user_agents(date(2020, 1, 1))[0] == oldest


def test_module_level_user_agent_matches_the_resolver():
    """The constants fetch_url actually uses must agree with the resolver."""
    from datetime import date

    _, primary, fallback = resolve_user_agents(date.today())
    assert collectors_base.USER_AGENT == primary
    assert collectors_base._FALLBACK_USER_AGENT == fallback