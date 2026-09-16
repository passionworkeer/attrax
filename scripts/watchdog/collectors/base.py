"""Shared collector plumbing: fetch helper, update record, dispatch table."""
from __future__ import annotations

import logging
import time
import urllib.error
import urllib.request
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

    Raises ``urllib.error.URLError`` (or HTTPError subclass) after exhausting
    retries so the caller can record a per-source failure.
    """
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        ua = USER_AGENT if attempt == 1 else _FALLBACK_USER_AGENT
        headers = {"User-Agent": ua, "Accept": accept}
        if attempt > 1:
            headers.update(_BROWSER_LIKE_HEADERS)
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read()
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
                return body, response.headers.get("Last-Modified")
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
