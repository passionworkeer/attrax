"""Shared collector plumbing: fetch helper, update record, dispatch table."""
from __future__ import annotations

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
            with urllib.request.urlopen(request, timeout=timeout) as response:
                status = getattr(response, "status", None)
                if status is None:
                    getcode = getattr(response, "getcode", None)
                    status = getcode() if callable(getcode) else 200
                response_etag = response.headers.get("ETag")
                response_last_modified = response.headers.get("Last-Modified")
                content_encoding = response.headers.get("Content-Encoding")

                if status == 304:
                    # 304 short-circuit: body is empty by definition; the
                    # orchestrator's text_hash + state.py replay the prior
                    # cached hash so no false change is recorded.
                    _remember_conditional(url, cached_etag, cached_last_modified)
                    return b"", response_last_modified

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
    """Dispatch one official_sources.json entry to its collector.

    Dispatch table (newest additions at the bottom):
      - ``eu_celex``        → Cellar RDF (eu.py)
      - ``ecfr_part``       → Federal Register API (us_ecfr.py)
      - ``cpsc_rss``        → CPSC Recalls RSS (us_cpsc.py)
      - ``gov_html``        → chrome-stripped HTML (gov_html.py) — added 2026-09-16
      - ``safety_gate``     → RAPEX JSON API (safety_gate.py) — added 2026-09-16
      - everything else     → ``collect_generic`` (raw bytes; safe default)
    """
    source_type = entry.get("source_type", "")
    if source_type == "eu_celex":
        from scripts.watchdog.collectors.eu import collect_eu_celex

        return collect_eu_celex(entry)
    if source_type == "ecfr_part":
        from scripts.watchdog.collectors.us_ecfr import collect_ecfr_part

        return collect_ecfr_part(entry)
    if source_type == "cpsc_rss":
        from scripts.watchdog.collectors.us_cpsc import collect_cpsc_rss

        return collect_cpsc_rss(entry)
    if source_type == "gov_html":
        from scripts.watchdog.collectors.gov_html import collect_gov_html

        return collect_gov_html(entry)
    if source_type == "safety_gate":
        from scripts.watchdog.collectors.safety_gate import collect_safety_gate

        return collect_safety_gate(entry)
    # direct_url / canada_justice_xml / anything new
    return collect_generic(entry)
