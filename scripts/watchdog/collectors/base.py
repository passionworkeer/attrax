"""Shared collector plumbing: fetch helper, update record, dispatch table."""
from __future__ import annotations

import contextlib
import datetime as dt
import gzip
import http.cookiejar
import logging
import os
import random
import threading
import time
import urllib.error
import urllib.request
import zlib
from collections import OrderedDict
from dataclasses import dataclass, field

from scripts.watchdog.registry import register

# 2026-09-18 H14: prefer httpx (connection pooling + per-host keep-alive)
# over urllib.request, which opens a fresh socket per call. Falls back to
# the urllib path on systems where httpx is not installed so a minimum
# venv (stdlib only, as documented in scripts/watchdog/__init__.py) still
# works.
try:  # pragma: no cover — exercised on environments that ship httpx
    import httpx  # type: ignore

    _HAS_HTTPX = True
except ImportError:  # noqa: PERF203 — module-level optional import
    httpx = None  # type: ignore
    _HAS_HTTPX = False

logger = logging.getLogger("attrax.regwatch.collectors")

# ── User-Agent rotation ─────────────────────────────────────────────────
# An edge WAF that fingerprints on browser revision serves a different
# bucket once the advertised build looks stale, so a hardcoded UA quietly
# degrades the pass rate over time. This table is deliberately a *manual*
# quarterly chore rather than a scraper of the current Chrome version:
# fetching "what is the latest Chrome" adds a network dependency to every
# watchdog start, and a wrong-but-plausible UA is worse than a stale one.
#
# Add a row at the top of each quarter. ``resolve_user_agent`` picks the
# newest row whose quarter has arrived, so an un-updated table keeps using
# the last known-good UA instead of failing.
#
# Windows is the primary fingerprint and macOS the fallback: the two differ
# in platform as well as build, which is the property that makes the retry
# rotation useful (see fetch_url).
_UA_TABLE: tuple[tuple[str, str, str], ...] = (
    # (quarter, windows UA, macos UA)
    (
        "2026-Q3",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        " (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        " (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ),
    (
        "2026-Q4",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        " (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        " (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    ),
)


def _quarter_of(when: "dt.date") -> str:
    return f"{when.year}-Q{(when.month - 1) // 3 + 1}"


def resolve_user_agents(when: "dt.date | None" = None) -> tuple[str, str, str]:
    """Pick the (quarter, primary, fallback) UA set for ``when``.

    Returns the newest entry at or before the requested quarter. Before the
    earliest table row, the earliest row is used — a deployment running with
    a stale table should keep its known-good UA, not fall back to something
    untested.
    """
    target = when or dt.date.today()
    selected = _UA_TABLE[0]
    for entry in _UA_TABLE:
        if entry[0] <= _quarter_of(target):
            selected = entry
        else:
            break
    return selected


_resolved_quarter, USER_AGENT, _FALLBACK_USER_AGENT = resolve_user_agents()

# Operator override, used by tests and by an urgent rotation that should not
# wait for a code deploy. Set the full UA string.
_UA_OVERRIDE = os.environ.get("ATTRAX_REGWATCH_UA")
if _UA_OVERRIDE:
    USER_AGENT = _UA_OVERRIDE.strip()

DEFAULT_TIMEOUT = 30
DEFAULT_RETRIES = 3
RETRY_BACKOFF_SECONDS = 2.0
MIN_CONTENT_BYTES = 64  # smaller responses are treated as errors

# Chrome-like headers that raise the bar against naive UA-only blocking. We
# only attach these on the **fallback** UA so the primary path stays
# minimal (some CDNs treat unknown header combos as bot signatures).
_BROWSER_LIKE_HEADERS = {
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Dest": "document",
    "Sec-Ch-Ua": '"Chromium";v="120", "Not_A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"macOS"',
    "Upgrade-Insecure-Requests": "1",
}

# 2026-09-17 watchdog overhaul: Accept-Language + Accept-Encoding are sent on
# EVERY attempt (primary UA included). The Sec-Fetch-* / Sec-Ch-Ua-* set still
# only goes with the fallback UA — that combo on a bare UA can itself look
# bot-shaped to some CDNs.
_PRIMARY_BASE_HEADERS = {
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
}

# Optional brotli support: if `brotli` (or `brotlicffi`) is installed we use
# it for Content-Encoding: br; otherwise we leave the body as-is (the server
# usually does not actually send br without the client signalling it, so this
# only matters when a CDN insists).
try:  # pragma: no cover — exercised on environments that ship brotli
    import brotli  # type: ignore

    _HAS_BROTLI = True
except ImportError:  # noqa: PERF203 — module-level optional import
    _HAS_BROTLI = False

# 304 short-circuit cache. Keyed by ``f"{source_id}:{url}"`` so two
# distinct sources can never share a stale ETag even if a CDN reuses the
# same header pair for genuinely different URLs. Holds the last ETag /
# Last-Modified we saw so we can re-validate on the next pass; on a 304,
# fetch_url raises NotModified and the orchestrator records the source as
# unchanged (the stored baseline already holds the current bytes).
# LRU at 256 entries to bound memory across the 35+ source sweep.
_CONDITIONAL_CACHE_MAX = 256
_CONDITIONAL_CACHE: "OrderedDict[str, tuple[str | None, str | None]]" = OrderedDict()
_CONDITIONAL_CACHE_LOCK = threading.Lock()


def _cache_key(source_id: str | None, url: str) -> str:
    """Build a namespaced cache key for the conditional-revalidation cache.

    Two URLs that happen to share an ETag — a misconfigured CDN, a redirect
    loop that lands on the same content, a behind-the-scenes rewrite — must
    not be allowed to feed each other a 304: that would let a real change
    slip through as a no-op. Namespacing by ``source_id`` ensures each
    source's cache is independent.
    """
    return f"{source_id or ''}:{url}"


def _remember_conditional(source_id: str | None, url: str, etag: str | None, last_modified: str | None) -> None:
    key = _cache_key(source_id, url)
    with _CONDITIONAL_CACHE_LOCK:
        _CONDITIONAL_CACHE[key] = (etag, last_modified)
        _CONDITIONAL_CACHE.move_to_end(key)
        while len(_CONDITIONAL_CACHE) > _CONDITIONAL_CACHE_MAX:
            _CONDITIONAL_CACHE.popitem(last=False)


def _recall_conditional(source_id: str | None, url: str) -> tuple[str | None, str | None]:
    cached: tuple[str | None, str | None] | None
    with _CONDITIONAL_CACHE_LOCK:
        cached = _CONDITIONAL_CACHE.get(_cache_key(source_id, url))
    if cached is None:
        return None, None
    return cached


def invalidate_conditional_cache(source_id: str) -> int:
    """Drop every cached (ETag, Last-Modified) entry for ``source_id``.

    Called by the ``--ack`` and ``--revert`` paths (orchestrator.ack_sources,
    review.revert_change) and by ``run_pass`` for every source whose baseline
    did NOT advance (failed ingest, auto-ingest off, dry run). In each case
    the cached validators describe upstream bytes the local library does not
    hold, so replaying them as a 304 would silently retire the change.

    Returns the number of entries evicted so a test or log line can confirm
    the cache actually moved.
    """
    prefix = f"{source_id}:"
    with _CONDITIONAL_CACHE_LOCK:
        keys = [k for k in _CONDITIONAL_CACHE if k.startswith(prefix)]
        for key in keys:
            _CONDITIONAL_CACHE.pop(key, None)
    return len(keys)


def _decompress_body(body: bytes, encoding: str | None) -> bytes:
    """Reverse Content-Encoding: gzip / deflate / br.

    Falls through unchanged when no encoding is declared. gzip / deflate use
    the stdlib; brotli is best-effort (no-op when the optional dep is
    missing — those servers typically only emit br when the client signals
    Accept-Encoding: br, which we do, so a missing decoder is rare in
    practice).
    """
    if not encoding:
        return body
    enc = encoding.strip().lower()
    try:
        if enc == "gzip":
            return gzip.decompress(body)
        if enc == "deflate":
            return zlib.decompress(body)
        if enc == "br":
            if _HAS_BROTLI:
                return brotli.decompress(body)
            logger.debug("brotli-encoded body from server but no brotli decoder installed")
            return body
        # Unknown encoding — don't crash, just hand back the raw bytes so
        # the caller can still hash something. The orchestrator will treat
        # an empty / weird response as a per-source failure.
        return body
    except (OSError, ValueError, zlib.error) as exc:
        logger.debug("Content-Encoding %s decode failed (%s); returning raw bytes", enc, exc)
        return body


class WAFChallengeBlockedException(urllib.error.URLError):
    """Raised when a site returns a 200/403 with a Cloudflare/Akamai challenge page."""

    pass


class NotModified(Exception):
    """Raised by ``fetch_url`` when the server answers 304 Not Modified.

    Modelled as an exception rather than an empty-body return because every
    collector parses the body it gets back — an empty ``bytes`` would be fed
    to the RDF sanity check, the JSON decoder, or the RSS parser and surface
    as a bogus per-source failure. Raising instead lets the 304 travel
    untouched through the collector (none of them catch bare ``Exception``)
    up to the orchestrator, which records the source as unchanged.
    """

    def __init__(self, url: str) -> None:
        super().__init__(f"{url} returned 304 Not Modified")
        self.url = url


class FetchDeadlineExceeded(urllib.error.URLError):
    """Raised when a fetch runs past its ``fetch_deadline`` budget.

    Python cannot interrupt a thread blocked in a socket read, so the
    orchestrator's wall-clock cap is enforced *cooperatively*: the worker
    opens a ``fetch_deadline`` budget, and ``fetch_url`` checks it before
    every attempt / backoff sleep. Worst-case overshoot is therefore one
    socket timeout, not an unbounded wait on a hung CDN.
    """

    pass


# Per-thread fetch budget. The orchestrator's worker threads each open a
# budget around their ``collect_source`` call; collectors reach ``fetch_url``
# without threading a deadline parameter through every signature.
_DEADLINE = threading.local()


@contextlib.contextmanager
def fetch_deadline(seconds: float):
    """Bound the wall-clock time any ``fetch_url`` call in this thread may use.

    Nested calls inherit the tighter of the two budgets. Restores the previous
    budget on exit so a reused worker thread never leaks a stale deadline.
    """
    previous = getattr(_DEADLINE, "at", None)
    candidate = time.monotonic() + seconds
    _DEADLINE.at = candidate if previous is None else min(previous, candidate)
    try:
        yield
    finally:
        _DEADLINE.at = previous


def _remaining_budget() -> float | None:
    """Seconds left in this thread's fetch budget, or None when unbounded."""
    at = getattr(_DEADLINE, "at", None)
    if at is None:
        return None
    return at - time.monotonic()


@dataclass
class RegulationUpdate:
    """One fetched source, normalized for the state store."""

    source_id: str
    market: str
    source_type: str
    source_url: str
    title: str
    text: str  # normalized plain text used for hashing/diffing
    content_hash: str
    last_modified: str | None = None
    metadata: dict = field(default_factory=dict)


# CookieJar singleton: persists cookies (notably cf_clearance) across retries
# within a single fetch_url call so a CDN challenge handshake completed by
# attempt 1 carries into attempts 2 / 3. Cookie state is process-wide and
# deliberately shared across sources — most CDNs scope their cookies to a
# domain, so cross-source leakage is bounded and helps when several
# official_sources.json entries share an upstream host.
#
# 2026-09-18 H14: the httpx primary path uses the client-level
# ``httpx.Cookies`` object for the same round-tripping — Set-Cookie from
# a response is auto-merged into the client's cookie jar, and the next
# request to the same domain is auto-prefixed with ``Cookie: ...``. The
# ``_COOKIE_JAR`` below is now the *urllib fallback*'s source of truth;
# the default-opener wiring is kept so any code path still on urllib
# (notify.py, the urllib fallback branch) behaves identically.
_COOKIE_JAR = http.cookiejar.CookieJar()
_COOKIE_OPENER = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(_COOKIE_JAR)
)
urllib.request.install_opener(_COOKIE_OPENER)


# ── httpx client singleton ─────────────────────────────────────────────
# One process-wide httpx.Client so the 8 worker threads reuse the same
# connection pool. ``max_connections=8`` matches the orchestrator's
# ``MAX_FETCH_WORKERS`` — exceeding it would let one slow CDN pin all
# sockets; falling below it would leave fetch capacity on the table.
# ``max_keepalive_connections=8`` is set the same so the pool can keep
# warm sockets against the top-8 hosts (the most common pattern is the
# three CPSC / FDA / EUR-Lex CDNs handling the bulk of the sweep).
#
# Lazily created on first fetch so a unit-test that never touches the
# network still imports cleanly. Tests can call ``reset_http_client()``
# to drop the singleton between cases.
_HTTPX_CLIENT: "httpx.Client | None" = None
_HTTPX_CLIENT_LOCK = threading.Lock()


def _get_http_client():
    """Return the process-wide httpx.Client, creating it on first use.

    Returns ``None`` when httpx is not installed — the fetch loop then
    falls back to urllib.request. The client is created exactly once per
    process so 8 worker threads share the same connection pool.
    """
    global _HTTPX_CLIENT
    if not _HAS_HTTPX or httpx is None:
        return None
    if _HTTPX_CLIENT is not None:
        return _HTTPX_CLIENT
    with _HTTPX_CLIENT_LOCK:
        if _HTTPX_CLIENT is None:
            _HTTPX_CLIENT = httpx.Client(
                limits=httpx.Limits(
                    max_connections=8,
                    max_keepalive_connections=8,
                ),
                timeout=httpx.Timeout(DEFAULT_TIMEOUT),
                follow_redirects=True,
                headers={"Accept": "*/*"},
            )
    return _HTTPX_CLIENT


def reset_http_client() -> None:
    """Drop the cached client. Tests use this between cases to avoid
    leaking a previous-case mock into the next."""
    global _HTTPX_CLIENT
    with _HTTPX_CLIENT_LOCK:
        if _HTTPX_CLIENT is not None:
            with contextlib.suppress(Exception):
                _HTTPX_CLIENT.close()
            _HTTPX_CLIENT = None


def fetch_url(
    url: str,
    *,
    source_id: str | None = None,
    timeout: int = DEFAULT_TIMEOUT,
    retries: int = DEFAULT_RETRIES,
    accept: str = "*/*",
    min_bytes: int = MIN_CONTENT_BYTES,
) -> tuple[bytes, str | None]:
    """GET ``url`` with retry + full-jitter backoff. Returns (body, last_modified).

    ``source_id`` namespaces the conditional-revalidation cache (2026-09-18
    M19): two distinct sources sharing an ETag — a misconfigured CDN, a
    redirect loop — must not be allowed to feed each other a 304. Passing
    it is optional so existing callers that fetch by URL alone keep working;
    callers that have a source in hand should always pass it.

    2026-09-18 H14 transport swap: httpx.Client is the primary path now,
    with connection pooling (``max_connections=8``, matching the
    orchestrator's worker count) and per-host keep-alive. urllib.request
    is the fallback when httpx is not installed. Backoff is full-jitter
    ``random.uniform(0, RETRY_BACKOFF_SECONDS * attempt)`` so 8 workers
    retrying against a flaky CDN do not thunder into the same 2 s/4 s
    slots.

    WAF fallback chain (2026-09-16): the first attempt uses the standard
    User-Agent. If it gets blocked by a Cloudflare / Akamai challenge page
    (detected by ``WAFChallengeBlockedException``) or fails transiently,
    retries 2 and 3 rotate to ``_FALLBACK_USER_AGENT`` plus a Chrome-like
    Sec-Fetch-* / Sec-Ch-Ua-* header set — this lifts the pass rate against
    sites that fingerprint on User-Agent revision alone. See issue: gov.uk
    / gov.au guidance pages intermittently served challenge HTML to the
    primary UA before this change.

    2026-09-17 additions:
      1. ``Accept-Language`` + ``Accept-Encoding`` headers ride along on
         every attempt (they live in ``_PRIMARY_BASE_HEADERS`` and merge
         into both the primary and fallback UA request).
      2. A process-wide ``CookieJar`` is threaded through every request
         on the urllib fallback path; the httpx path uses the client's
         native ``httpx.Cookies`` object for the same round-tripping.
         Both paths preserve the CloudFront WAF's ``cf_clearance`` cookie
         ride-back on retries.
      3. Conditional revalidation (If-None-Match / If-Modified-Since): the
         URL's last-seen ``ETag`` and ``Last-Modified`` are remembered in an
         LRU. On the next call, those headers are sent up front; a ``304``
         reply short-circuits with empty body so the orchestrator can play
         back the cached hash instead of treating it as a change.
      4. ``Content-Encoding: gzip / deflate / br`` responses are
         transparently decoded so the orchestrator always sees raw text.
         httpx auto-decodes; urllib still needs ``_decompress_body``.

    Raises after exhausting retries so the caller can record a per-source
    failure: the transport error itself (``httpx.*`` on the pooling path,
    ``urllib.error.URLError`` on the fallback), or ``urllib.error.HTTPError``
    for a non-2xx status. A terminal 4xx (except 429) fails on the first
    attempt — retrying cannot fix a 404.
    """
    cached_etag, cached_last_modified = _recall_conditional(source_id, url)
    client = _get_http_client()
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        # Cooperative deadline: bail before spending another socket timeout
        # when the worker's budget is already gone, and shrink this attempt's
        # timeout so it cannot overshoot the remaining budget.
        remaining = _remaining_budget()
        if remaining is not None:
            if remaining <= 0:
                raise FetchDeadlineExceeded(
                    f"{url}: fetch deadline exceeded before attempt {attempt}"
                )
            effective_timeout: float = max(1.0, min(timeout, remaining))
        else:
            effective_timeout = timeout

        ua = USER_AGENT if attempt == 1 else _FALLBACK_USER_AGENT
        headers = {"User-Agent": ua, "Accept": accept}
        headers.update(_PRIMARY_BASE_HEADERS)
        if attempt > 1:
            headers.update(_BROWSER_LIKE_HEADERS)
        # Conditional revalidation: send the stored validators when we have
        # them. The first attempt on a brand-new URL still goes through —
        # there's nothing to re-validate yet.
        if cached_etag:
            headers["If-None-Match"] = cached_etag
        if cached_last_modified:
            headers["If-Modified-Since"] = cached_last_modified

        try:
            if client is not None:
                response = client.get(
                    url, headers=headers, timeout=effective_timeout
                )
                # httpx has already auto-decoded Content-Encoding: gzip /
                # deflate / br. ``response.content`` is the raw text.
                status = response.status_code
                response_etag = response.headers.get("ETag")
                response_last_modified = response.headers.get("Last-Modified")
            else:
                response = _urllib_request_once(
                    url, headers=headers, timeout=effective_timeout
                )
                status = getattr(response, "status", None)
                if status is None:
                    getcode = getattr(response, "getcode", None)
                    status = getcode() if callable(getcode) else 200
                response_etag = response.headers.get("ETag")
                response_last_modified = response.headers.get("Last-Modified")
        except Exception as exc:
            # Network / timeout / TLS / DNS — every flavour collapses to
            # "retry later" until we exhaust the budget, EXCEPT a terminal
            # client error: urlopen raises HTTPError for every non-2xx
            # status, and the old code fast-failed 4xx (except 429) instead
            # of replaying a 404 three times.
            last_error = _coerce_request_error(exc, url)
            response = None
            if _is_terminal_client_error(last_error):
                raise

        if response is not None:
            try:
                if status == 304:
                    # 304 short-circuit: the upstream text is byte-identical
                    # to what we last snapshotted, so there is nothing for
                    # the collector to parse and nothing for the orchestrator
                    # to diff. Raise rather than return an empty body —
                    # collectors would otherwise hand ``b""`` to their RDF /
                    # JSON / RSS parsers and record a bogus failure.
                    _remember_conditional(
                        source_id, url, cached_etag, cached_last_modified
                    )
                    raise NotModified(url)

                # Non-success statuses must never be hashed as content. The
                # httpx path *returns* the response for 4xx/5xx (urllib's
                # urlopen raises), so both paths funnel through this check:
                #   - 4xx (except 429): terminal — a retry replays the same
                #     404/403, and the body is an error page, not upstream
                #     text. Fast-fail.
                #   - 5xx / 429: transient — record the error and fall
                #     through to the backoff path. Without this, a CDN's
                #     502 HTML page (> min_bytes) would be returned as a
                #     "successful" fetch and hashed as a change.
                if status is not None and status >= 400:
                    error = urllib.error.HTTPError(
                        url, status, f"HTTP {status}", hdrs=None, fp=None
                    )
                    if status < 500 and status != 429:
                        raise error
                    last_error = error
                else:
                    if client is not None:
                        body = response.content
                    else:
                        content_encoding = response.headers.get("Content-Encoding")
                        raw_body = response.read()
                        body = _decompress_body(raw_body, content_encoding)

                    _remember_conditional(
                        source_id, url, response_etag, response_last_modified
                    )

                    if len(body) < min_bytes:
                        raise urllib.error.URLError(
                            f"suspiciously small response ({len(body)} bytes) from {url}"
                        )
                    lower_body = body[:2048].lower()
                    if (
                        b"challenge-platform" in lower_body
                        or b"<title>just a moment...</title>" in lower_body
                        or b"cf-browser-verification" in lower_body
                        or b"enable javascript and cookies to continue" in lower_body
                    ):
                        raise WAFChallengeBlockedException(
                            f"WAF challenge / anti-bot interstitial detected from {url}"
                        )
                    return body, response_last_modified
            finally:
                # Release the socket back to the pool (httpx) / close it
                # (urllib). httpx.Response.close() and HTTPResponse.close()
                # are both idempotent, so an explicit early close is safe.
                _close_response(response)

        if attempt < retries:
            # Full-jitter backoff (H14, 2026-09-18): uniform over the
            # full window so 8 concurrent workers retrying against a
            # flaky CDN do not all land in the same 2 s / 4 s slots.
            delay = random.uniform(0, RETRY_BACKOFF_SECONDS * attempt)
            remaining = _remaining_budget()
            if remaining is not None and remaining <= delay:
                # Sleeping through the backoff would spend the whole budget
                # without a request in flight — fail now so the worker can
                # move on and the source lands in errors.json.
                raise FetchDeadlineExceeded(
                    f"{url}: fetch deadline exceeded before retry {attempt + 1}"
                )
            logger.debug(
                "fetch %s failed (%s); retry %d/%d in %.2fs",
                url[:90],
                last_error,
                attempt,
                retries,
                delay,
            )
            time.sleep(delay)

    assert last_error is not None
    raise last_error


def _urllib_request_once(url: str, *, headers: dict, timeout: float):
    """One urllib.request.urlopen call. Used by the fallback path only.

    Hoisted into its own function so tests that patch
    ``urllib.request.urlopen`` continue to intercept the fallback. httpx
    is the primary path on any modern venv (the aliyun-sz production
    host ships httpx 0.27 / 0.28 via rag_service/.venv).
    """
    request = urllib.request.Request(url, headers=headers)
    return urllib.request.urlopen(request, timeout=timeout)


def _coerce_request_error(exc: Exception, url: str) -> Exception:
    """Map httpx's error hierarchy onto urllib's so callers don't have to.

    The orchestrator catches ``Exception`` per-source so the precise type
    does not matter for correctness, but for parity with the previous
    behaviour (and the existing 4xx branch) we surface HTTP status codes
    where httpx actually carries them.
    """
    if _HAS_HTTPX and httpx is not None:
        # ``response.raise_for_status()`` is not called — we surface a
        # plain HTTPError here with the status code in exc.code so the
        # 4xx terminal branch matches the urllib shape. httpx.TimeoutException
        # and httpx.RequestError both bubble through unchanged.
        from httpx import HTTPStatusError  # type: ignore
        if isinstance(exc, HTTPStatusError):
            try:
                status = exc.response.status_code
            except Exception:
                status = 0
            return urllib.error.HTTPError(url, status, str(exc), hdrs=None, fp=None)
    return exc


def _is_terminal_client_error(exc: Exception) -> bool:
    """Whether a transport error is a 4xx (except 429) that a retry cannot fix.

    ``urllib.request.urlopen`` raises ``HTTPError`` for every non-2xx
    status; the original fetch loop fast-failed 4xx instead of burning the
    retry budget on a 404. httpx returns the response object instead of
    raising, so on that path the same decision is made on the response —
    this helper keeps the fallback path (and anything that does raise)
    honest.
    """
    return (
        isinstance(exc, urllib.error.HTTPError)
        and 400 <= exc.code < 500
        and exc.code != 429
    )


def _close_response(response) -> None:
    """Release the underlying connection without ever masking the real error.

    httpx.Response.close() and http.client.HTTPResponse.close() are both
    idempotent, so a ``finally`` after an explicit early close is safe.
    ``suppress`` guards the test doubles / exotic transports that never
    grew a ``close``.
    """
    with contextlib.suppress(Exception):
        response.close()


# ── per-source-type handlers ────────────────────────────────────────────
# Each handler receives one official_sources.json entry and returns a
# RegulationUpdate, or raises on fetch failure.


def collect_generic(entry: dict) -> RegulationUpdate:
    """Fallback handler: fetch the raw source_url and hash the body.

    Used directly by the plain-document source types (``direct_url``,
    ``canada_justice_xml`` — see the registrations below) and as the safety
    net for a source_type no collector claims. ``gov_html`` has its own
    handler (``collect_gov_html``) which strips navigational chrome before
    hashing — see collectors/gov_html.py for why. For change *detection*
    purposes the raw bytes are enough; parsing into structured YAML only
    happens after a change is confirmed (via auto_ingest).
    """
    from scripts.watchdog.state import normalize_text, text_hash

    body, last_modified = fetch_url(
        entry["source_url"], source_id=entry.get("id")
    )
    text = normalize_text(body)
    return RegulationUpdate(
        source_id=entry["id"],
        market=entry.get("market", "?"),
        source_type=entry.get("source_type", "direct_url"),
        source_url=entry["source_url"],
        title=entry.get("title", entry["id"]),
        text=text,
        content_hash=text_hash(text),
        last_modified=last_modified,
        metadata={
            "bytes": len(body),
            "files": entry.get("files", []),
            "productCategories": entry.get("product_categories", []),
        },
    )


# The plain-document source types claim collect_generic explicitly rather
# than relying on the dispatcher's fallback. Registering them keeps
# REGISTRY the complete answer to "which source types exist", so a typo in
# official_sources.json surfaces as an unknown type instead of silently
# behaving like a working source.
register("canada_justice_xml")(collect_generic)
register("direct_url")(collect_generic)


def collect_source(entry: dict) -> RegulationUpdate:
    """Dispatch one official_sources.json entry to its registered collector.

    Implementation moved to ``scripts.watchdog.registry`` on 2026-09-17
    (plugin-pattern refactor). Existing source types are registered when
    ``scripts/watchdog/collectors/__init__.py`` is imported — same trigger
    point the orchestrator already pulls. Old behaviour preserved: any
    unmapped source type falls back to ``collect_generic`` (raw bytes).
    """
    from scripts.watchdog.registry import collect_source as _dispatch

    return _dispatch(entry)
