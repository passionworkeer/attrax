"""Shared collector plumbing: fetch helper, update record, dispatch table."""
from __future__ import annotations

import contextlib
import gzip
import http.cookiejar
import logging
import threading
import time
import urllib.error
import urllib.request
import zlib
from collections import OrderedDict
from dataclasses import dataclass, field

logger = logging.getLogger("attrax.regwatch.collectors")

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
# Fallback User-Agent — a slightly older Chrome build, used when the primary
# UA trips an edge WAF (some CDNs fingerprint on User-Agent revision rather
# than block outright, and rotating to a slightly older build sometimes
# gets a different bucket). See collect_source() / fetch_url() retry logic.
_FALLBACK_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    " (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
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

# 304 short-circuit cache. Keyed by URL (the only thing the orchestrator has
# to tell us about freshness). Holds the last ETag / Last-Modified we saw so
# we can re-validate on the next pass; on a 304, fetch_url returns empty
# bytes and the orchestrator plays back the cached hash. LRU at 256 entries
# to bound memory across the 35+ source sweep.
_CONDITIONAL_CACHE_MAX = 256
_CONDITIONAL_CACHE: "OrderedDict[str, tuple[str | None, str | None]]" = OrderedDict()
_CONDITIONAL_CACHE_LOCK = threading.Lock()


def _remember_conditional(url: str, etag: str | None, last_modified: str | None) -> None:
    with _CONDITIONAL_CACHE_LOCK:
        _CONDITIONAL_CACHE[url] = (etag, last_modified)
        _CONDITIONAL_CACHE.move_to_end(url)
        while len(_CONDITIONAL_CACHE) > _CONDITIONAL_CACHE_MAX:
            _CONDITIONAL_CACHE.popitem(last=False)


def _recall_conditional(url: str) -> tuple[str | None, str | None]:
    with _CONDITIONAL_CACHE_LOCK:
        cached = _CONDITIONAL_CACHE.get(url)
    if cached is None:
        return None, None
    return cached


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
# We install the cookie-aware opener globally so existing test code that
# patches ``urllib.request.urlopen`` keeps intercepting the fetch (the
# cookie processor is wired through the default opener, not a side channel).
_COOKIE_JAR = http.cookiejar.CookieJar()
_COOKIE_OPENER = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(_COOKIE_JAR)
)
urllib.request.install_opener(_COOKIE_OPENER)


def fetch_url(
    url: str,
    *,
    timeout: int = DEFAULT_TIMEOUT,
    retries: int = DEFAULT_RETRIES,
    accept: str = "*/*",
    min_bytes: int = MIN_CONTENT_BYTES,
) -> tuple[bytes, str | None]:
    """GET ``url`` with retry + exponential backoff. Returns (body, last_modified).

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
      2. A process-wide ``CookieJar`` is threaded through every request:
         after each ``urlopen`` we ``.extract_cookies(response, request)``,
         and before each new request we ``.add_cookie_header(request)``.
         This lets the CloudFront WAF's ``cf_clearance`` cookie ride back
         to the origin on retries.
      3. Conditional revalidation (If-None-Match / If-Modified-Since): the
         URL's last-seen ``ETag`` and ``Last-Modified`` are remembered in an
         LRU. On the next call, those headers are sent up front; a ``304``
         reply short-circuits with empty body so the orchestrator can play
         back the cached hash instead of treating it as a change.
      4. ``Content-Encoding: gzip / deflate / br`` responses are
         transparently decoded so the orchestrator always sees raw text.

    Raises ``urllib.error.URLError`` (or HTTPError subclass) after exhausting
    retries so the caller can record a per-source failure.
    """
    cached_etag, cached_last_modified = _recall_conditional(url)
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

        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=effective_timeout) as response:
                status = getattr(response, "status", None)
                if status is None:
                    getcode = getattr(response, "getcode", None)
                    status = getcode() if callable(getcode) else 200
                response_etag = response.headers.get("ETag")
                response_last_modified = response.headers.get("Last-Modified")
                content_encoding = response.headers.get("Content-Encoding")

                if status == 304:
                    # 304 short-circuit: the upstream text is byte-identical
                    # to what we last snapshotted, so there is nothing for
                    # the collector to parse and nothing for the orchestrator
                    # to diff. Raise rather than return an empty body —
                    # collectors would otherwise hand ``b""`` to their RDF /
                    # JSON / RSS parsers and record a bogus failure.
                    _remember_conditional(url, cached_etag, cached_last_modified)
                    raise NotModified(url)

                raw_body = response.read()
                body = _decompress_body(raw_body, content_encoding)

                _remember_conditional(url, response_etag, response_last_modified)

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
        except urllib.error.HTTPError as exc:
            # 4xx (except 429) will not get better by retrying.
            if 400 <= exc.code < 500 and exc.code != 429:
                raise
            last_error = exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc

        if attempt < retries:
            delay = RETRY_BACKOFF_SECONDS * attempt
            remaining = _remaining_budget()
            if remaining is not None and remaining <= delay:
                # Sleeping through the backoff would spend the whole budget
                # without a request in flight — fail now so the worker can
                # move on and the source lands in errors.json.
                raise FetchDeadlineExceeded(
                    f"{url}: fetch deadline exceeded before retry {attempt + 1}"
                )
            logger.debug(
                "fetch %s failed (%s); retry %d/%d in %.1fs",
                url[:90],
                last_error,
                attempt,
                retries,
                delay,
            )
            time.sleep(delay)

    assert last_error is not None
    raise last_error


# ── per-source-type handlers ────────────────────────────────────────────
# Each handler receives one official_sources.json entry and returns a
# RegulationUpdate, or raises on fetch failure.


def collect_generic(entry: dict) -> RegulationUpdate:
    """Fallback handler: fetch the raw source_url and hash the body.

    Covers ``direct_url``, ``canada_justice_xml``, and any future source
    types that serve plain documents. ``gov_html`` has its own handler
    (``collect_gov_html``) which strips navigational chrome before hashing —
    see collectors/gov_html.py for why. For change *detection* purposes
    the raw bytes are enough; parsing into structured YAML only happens
    after a change is confirmed (via auto_ingest).
    """
    from scripts.watchdog.state import normalize_text, text_hash

    body, last_modified = fetch_url(entry["source_url"])
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


def collect_source(entry: dict) -> RegulationUpdate:
    """Dispatch one official_sources.json entry to its registered collector.

    Implementation moved to ``scripts.watchdog.registry`` on 2026-09-17
    (plugin-pattern refactor). Existing source types (eu_celex / ecfr_part /
    cpsc_rss / gov_html / safety_gate) are registered when
    ``scripts/watchdog/collectors/__init__.py`` is imported — same trigger
    point the orchestrator already pulls. Old behaviour preserved: any
    unmapped source type falls back to ``collect_generic`` (raw bytes).
    """
    from scripts.watchdog.registry import collect_source as _dispatch

    return _dispatch(entry)
