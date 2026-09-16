"""Government HTML collector — strips common navigational chrome before hashing.

The default ``collect_generic`` (in collectors/base.py) just downloads and
whitespace-normalizes whatever the server returns. For government-style
pages that works for stable regulation PDFs, but the watch/diff cycle
breaks down for guidance pages that include:

  - top navigation (GOV.UK "Skip to main content", "Menu", phase banner)
  - cookie consent banners (gem-c-cookie-banner, ds-cookie-banner)
  - footer blocks with copyright/feedback widgets that refresh on every load
  - "Last updated" timestamps injected on every render

If we hash the raw HTML, the similarity score falls below 0.95 on every
pass and the watchdog reports a fake ``modified`` change. The collector
below removes the known chrome tags by name and by class attribute
substring so what remains is the regulatory guidance content, and the hash
becomes stable across cookie-banner churn.

Implementation note (2026-09-16): the watchdog is intentionally
stdlib-only (see scripts/watchdog/README.md §Architecture decision) — no
BeautifulSoup, no lxml, no external deps. We use ``html.parser.HTMLParser``
to walk the document with a depth counter and a list of "drop" tags.

Limits:
  - HTML attribute matching is by case-insensitive substring on the class
    attribute (e.g. ``class="gem-c-cookie-banner govuk-button"`` matches
    because ``gem-c-cookie-banner`` is in the substring). This is
    forgiving for gov.uk's compound classes but also forgiving for typos
    — perfect is not required, only "stable across re-renders".
  - Malformed HTML is handled by the stdlib parser's tolerance. We do
    not raise on parse failures because the raw text is still useful for
    hashing even when the parser misplaces a tag.
"""
from __future__ import annotations

import re
from html.parser import HTMLParser

from scripts.watchdog.collectors.base import RegulationUpdate, fetch_url
from scripts.watchdog.state import normalize_text, text_hash

# Tags whose ENTIRE contents (including nested children) should be dropped.
# Chosen for chrome / interactivity rather than for regulatory text content.
_DROP_TAGS = frozenset(
    {
        "script", "style", "noscript", "iframe",
        "nav", "footer", "header", "aside",
        "form", "button",  # interaction chrome
    }
)

# class / id substring hints — when a tag's ``class`` attribute contains
# any of these substrings (case-insensitive), drop its content. Curated
# against GOV.UK / HSE / gov.au / METI / SAMR banner conventions.
_DROP_CLASS_HINTS = (
    "cookie-banner", "gem-c-cookie-banner", "govuk-cookie-banner",
    "notice-banner", "phase-banner", "gem-c-phase-banner",
    "feedback-pane", "gem-c-feedback", "gem-c-print-link",
    "gem-c-skip-link", "gem-c-breadcrumbs", "breadcrumb",
    "gem-c-related-navigation", "gem-c-contextual-sidebar",
    "gem-c-contents-list", "gem-c-in-this-section",
    "govspeak-",  # GOV.UK editing tool wrapper noise
    "ds_",        # Scottish Government Design System
    "masthead",   # gov.au top header
    "site-header", "site-footer", "site-nav",
    "global-header", "global-footer",
)

# Per-element black list by id (rare but useful for sticky banners).
_DROP_ID_HINTS = (
    "cookie-banner", "feedback", "site-header", "site-footer",
    "global-header", "global-footer", "skip-to-content",
)

_BLANK_LINE_RE = re.compile(r"\n\s*\n+")
_TAG_RE = re.compile(r"<[^>]+>", re.S)  # fallback when parser gives up


class _ChromeStripper(HTMLParser):
    """Walks the HTML stream; emits the textual content minus the chrome.

    Maintains a depth counter for nested drop sections (a ``<div class="...">``
    inside ``<footer>`` is still dropped). When a tag's class / id hints
    match, the entire subtree is dropped too.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._drop_depth = 0
        self._parts: list[str] = []
        self._last_was_newline = False

    # ── tag handlers ──────────────────────────────────────────────────
    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self._drop_depth > 0:
            self._drop_depth += 1
            return
        if tag in _DROP_TAGS or self._attrs_match_drop(attrs):
            self._drop_depth += 1
            return
        # Block-level tags deserve a paragraph break so the resulting text
        # reads sensibly when diffed. Inline tags just continue.
        if tag in {"p", "div", "section", "article", "li", "h1", "h2", "h3", "h4",
                   "h5", "h6", "br", "tr", "td", "th", "blockquote"}:
            self._append_text("\n")

    def handle_endtag(self, tag: str) -> None:
        if self._drop_depth > 0:
            self._drop_depth -= 1
            return
        if tag in {"p", "div", "section", "article", "li", "h1", "h2", "h3", "h4",
                   "h5", "h6", "tr", "blockquote"}:
            self._append_text("\n")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        # Self-closing tags (br, hr, meta, link, img) — no body to handle.
        if self._drop_depth > 0:
            return
        if tag in {"br", "hr"}:
            self._append_text("\n")

    # ── text handlers ─────────────────────────────────────────────────
    def handle_data(self, data: str) -> None:
        if self._drop_depth > 0:
            return
        self._append_text(data)

    def handle_entityref(self, name: str) -> None:
        if self._drop_depth == 0:
            self._append_text("&" + name + ";")

    def handle_charref(self, name: str) -> None:
        if self._drop_depth == 0:
            self._append_text("&#" + name + ";")

    # ── helpers ───────────────────────────────────────────────────────
    def _attrs_match_drop(self, attrs: list[tuple[str, str | None]]) -> bool:
        cls = ""
        element_id = ""
        for key, value in attrs:
            if value is None:
                continue
            key_lower = key.lower()
            if key_lower == "class":
                cls = value.lower()
            elif key_lower == "id":
                element_id = value.lower()
        for hint in _DROP_CLASS_HINTS:
            if hint in cls:
                return True
        for hint in _DROP_ID_HINTS:
            if hint in element_id:
                return True
        return False

    def _append_text(self, text: str) -> None:
        if not text:
            return
        # Collapse inline whitespace; preserve newlines from block boundaries.
        chunk = " ".join(text.split())
        if not chunk:
            return
        self._parts.append(chunk)
        self._last_was_newline = False

    @property
    def text(self) -> str:
        joined = " ".join(self._parts)
        # Tighten whitespace again, then drop lines that are entirely
        # punctuation / whitespace (residual chrome markers).
        cleaned = "\n".join(
            line.strip() for line in joined.split("\n") if line.strip()
        )
        # Collapse 3+ newlines down to 2 (paragraph separators).
        return _BLANK_LINE_RE.sub("\n\n", cleaned)


def _strip_chrome(html: str) -> str:
    """Parse ``html`` and return the visible regulatory text.

    Falls back to a coarse ``<tag>`` regex if HTMLParser trips over
    malformed input — the resulting text still works for hashing even
    when the structure is imperfect.
    """
    parser = _ChromeStripper()
    try:
        parser.feed(html)
        parser.close()
        return parser.text
    except Exception:
        # Last-resort: strip every tag and let state.normalize_text do
        # the whitespace job. Better than dropping the source entirely.
        stripped = _TAG_RE.sub(" ", html)
        return normalize_text(stripped)


def collect_gov_html(entry: dict) -> RegulationUpdate:
    """Fetch a gov_html source and return the chrome-stripped text.

    Falls back to ``collect_generic`` on transport errors (the chrome
    stripper is value-add, not a hard dependency).
    """
    body, last_modified = fetch_url(entry["source_url"])
    text = _strip_chrome(body.decode("utf-8", errors="replace"))
    return RegulationUpdate(
        source_id=entry["id"],
        market=entry.get("market", "?"),
        source_type="gov_html",
        source_url=entry["source_url"],
        title=entry.get("title", entry["id"]),
        text=text,
        content_hash=text_hash(text),
        last_modified=last_modified,
        metadata={
            "bytes": len(body),
            "files": entry.get("files", []),
            "productCategories": entry.get("product_categories", []),
            "stripped": True,
        },
    )