#!/usr/bin/env python3
"""
legal_parser.py — Convert raw EUR-Lex / eCFR / govinfo / SAMR / UN documents
into the regulation-library article schema.

Spec: docs/plans/2026-09-11-de-rag-evidence-spec.md §5.4 + §7.2.

Status: structural stub (Phase 1 of §7.2). The five region-specific
recognizers are implemented as regex-based parsers that produce the
canonical `articles[]` shape consumed by `retrieval/article_loader.py`.
Real EUR-Lex / eCFR / gov.uk / SAMR / UN fetching is deferred to a
follow-up pass; the recognizers are deliberately tolerant so the same
code path will work once raw documents are wired in.

The public surface is small on purpose:

    parse_text(text: str, region: str) -> list[dict]
        Returns a list of {"id", "title", "text"} articles.

    detect_region(text: str) -> str | None
        Sniffs which region's official-document patterns match.

    normalize_article_id(raw_id: str, region: str) -> str
        Coerces region-specific markers ("Article 5", "§ 173.185",
        "regulation 8", "第 12 条") into canonical id form.
"""
from __future__ import annotations

import re
from typing import Any


# ── region-specific article-id normalizers ────────────────────────────────

_ART_RE = {
    "EU": re.compile(
        r"(?:\b(?:Article|Art\.?)\s+([0-9IVXLC]+(?:\s*\([0-9a-zA-Z]+\))?(?:[./][0-9]+)*)"
        r"|\b(?:ANNEX|Annex)\s+([0-9IVXLC]+))"
    ),
    "US": re.compile(
        r"§+\s*([0-9]+\.[0-9]+(?:\.[0-9]+)?)"
    ),
    "UK": re.compile(
        r"\b(?:regulation|section|Regulation|Section)\s+\(([0-9]+)\)|"
        r"\b(?:regulation|section|Regulation|Section)\s+([0-9]+)\b|"
        r"\b([0-9]+)\s*\(([0-9]+)\)"
    ),
    "CN": re.compile(
        r"第\s*([一二三四五六七八九十百零〇0-9]+)\s*[条款章]"
    ),
    "UN": re.compile(
        r"\b(?:section|Section|SECTION)\s+([0-9]+(?:\.[0-9]+)*)"
    ),
}


def normalize_article_id(raw_id: str, region: str) -> str:
    """Coerce a region-specific article marker into the canonical id form.

    Examples:
      EU: "Article 77"  → "art-77"
           "ANNEX IV"   → "annex-iv"
      US: "§ 173.185"   → "section-173-185"
      UK: "regulation (8)" → "regulation-8"
          "Regulation 8"   → "regulation-8"
      CN: "第十二条"    → "第12条" (kept in CN form)
      UN: "Section 38.3" → "section-38-3"
    """
    s = raw_id.strip()
    if region == "EU":
        if re.match(r"(?i)^(?:annex|ANNEX)\b", s):
            m = re.match(r"(?i)^(?:annex)\s+([0-9IVXLC]+)\b", s)
            if m:
                return "annex-" + _to_ascii_numeral(m.group(1)).lower()
            return s.lower().replace(" ", "-")
        m = re.match(r"(?i)^(?:article|art\.?)\s+([0-9IVXLC]+)\b", s)
        if m:
            return "art-" + _to_ascii_numeral(m.group(1)).lower()
    if region == "US":
        m = re.match(r"§\s*([0-9.]+)", s)
        if m:
            return "section-" + m.group(1).replace(".", "-")
    if region == "UK":
        m = re.match(r"(?i)(?:regulation|section)\s*\(([0-9]+)\)", s)
        if m:
            return "regulation-" + m.group(1)
        m = re.match(r"(?i)(?:regulation|section)\s+([0-9]+)\b", s)
        if m:
            return "regulation-" + m.group(1)
    if region == "CN":
        return s  # preserve Chinese form
    if region == "UN":
        m = re.match(r"(?i)section\s+([0-9.]+)", s)
        if m:
            return "section-" + m.group(1).replace(".", "-")
    return s.lower().replace(" ", "-")


def _to_ascii_numeral(s: str) -> str:
    """Convert short Roman/Arabic numerals to ASCII digits."""
    roman_map = {
        "I": "1", "II": "2", "III": "3", "IV": "4", "V": "5",
        "VI": "6", "VII": "7", "VIII": "8", "IX": "9", "X": "10",
        "XI": "11", "XII": "12", "XIII": "13", "XIV": "14", "XV": "15",
        "XVI": "16", "XVII": "17", "XVIII": "18", "XIX": "19", "XX": "20",
        "XXI": "21", "XXII": "22", "XXIII": "23", "XXIV": "24", "XXV": "25",
        "XXVI": "26", "XXVII": "27", "XXVIII": "28", "XXIX": "29", "XXX": "30",
        "XXXI": "31", "XXXII": "32", "XXXIII": "33",
    }
    up = s.upper()
    if up in roman_map:
        return roman_map[up]
    if s.isdigit():
        return s
    # Best-effort: return original so the caller can flag the failure
    return s


# ── region detection (cheap heuristic) ──────────────────────────────────

_REGION_HINTS = [
    ("EU", re.compile(r"\b(?:Directive|Regulation|ELI|EUR-Lex)\b")),
    ("US", re.compile(r"(?:§|CFR|U\.S\.C\.|Public Law|eCFR|Federal Register)")),
    ("UK", re.compile(r"\b(?:legislation\.gov\.uk|UK Statutory Instrument|HC|Bill)\b")),
    ("CN", re.compile(r"(?:第\s*[一二三四五六七八九十百零〇0-9]+\s*[条款章]|国家市场监督管理总局|工信部|SAMR)")),
    ("UN", re.compile(r"\b(?:UN Recommendations|UN Manual|IATA DGR|UN\s*\d{2,4}\.\d)\b")),
]


def detect_region(text: str) -> str | None:
    """Return the region whose marker density is highest in `text`."""
    counts = {r: 0 for r, _ in _REGION_HINTS}
    for region, pattern in _REGION_HINTS:
        counts[region] = len(pattern.findall(text))
    best = max(counts, key=counts.get)
    return best if counts[best] > 0 else None


# ── main entry point ────────────────────────────────────────────────────

def parse_text(text: str, region: str | None = None) -> list[dict[str, Any]]:
    """Parse `text` and return a list of canonical articles.

    Each article dict has {id, title, text}. Title is extracted from the
    same line as the article marker (everything after the marker until
    the next blank line). Text is the body following the title until
    the next article marker.
    """
    region = region or detect_region(text) or "EU"
    pattern = _ART_RE.get(region)
    if pattern is None:
        return []

    matches = list(pattern.finditer(text))
    if not matches:
        return []

    out: list[dict[str, Any]] = []
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        # First line is the title (if short); remainder is the body
        lines = body.splitlines()
        title = lines[0].strip() if lines else ""
        body_text = "\n".join(lines[1:]).strip() if len(lines) > 1 else ""
        # If the first line is very long, treat the whole body as text
        if len(title) > 200:
            body_text = body
            title = ""
        canonical_id = normalize_article_id(m.group(0), region)
        out.append({
            "id": canonical_id,
            "title": title,
            "text": body_text or body,
        })
    return out


__all__ = [
    "detect_region",
    "normalize_article_id",
    "parse_text",
]