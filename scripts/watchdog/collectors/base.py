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
DEFAULT_TIMEOUT = 30
DEFAULT_RETRIES = 3
RETRY_BACKOFF_SECONDS = 2.0
MIN_CONTENT_BYTES = 64  # smaller responses are treated as errors


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
) -> tuple[bytes, str | None]:
    """GET ``url`` with retry + exponential backoff. Returns (body, last_modified).

    Raises ``urllib.error.URLError`` (or HTTPError subclass) after exhausting
    retries so the caller can record a per-source failure.
    """
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        request = urllib.request.Request(
            url, headers={"User-Agent": USER_AGENT, "Accept": accept}
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read()
                if len(body) < MIN_CONTENT_BYTES:
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

    Covers ``gov_html``, ``direct_url``, ``canada_justice_xml``, and any
    future source types that serve plain documents — for change *detection*
    purposes the raw bytes are enough; parsing into structured YAML only
    happens after a change is confirmed (via build_regulation_library).
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
    """Dispatch one official_sources.json entry to its collector."""
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
    # gov_html / canada_justice_xml / direct_url / anything new
    return collect_generic(entry)
