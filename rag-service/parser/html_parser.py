#!/usr/bin/env python3
"""
html_parser.py - HTML document parser for compliance corpus

Extracts clean text + tables from HTML files using BeautifulSoup + lxml.
Handles encoding fallbacks, removes noise, preserves table structure.
"""
import re
import logging
from pathlib import Path
from typing import Optional

from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# Noise selectors to remove
NOISE_TAGS = ["script", "style", "nav", "noscript", "iframe", "svg", "select"]
NOISE_CLASSES = [
    "nav", "sidebar", "footer", "header", "menu", "advertisement",
    "ad-", "breadcrumb", "pagination", "comments", "social",
]


def read_html_file(file_path: str) -> Optional[str]:
    """Read HTML file with encoding fallback. Returns None on failure."""
    encodings = ["utf-8", "gbk", "gb2312", "gb18030", "latin-1"]
    for enc in encodings:
        try:
            with open(file_path, "r", encoding=enc) as f:
                return f.read()
        except (UnicodeDecodeError, LookupError):
            continue
    return None


def clean_html(content: str) -> str:
    """Remove noise elements from HTML."""
    soup = BeautifulSoup(content, "lxml")

    # Remove noise tags
    for tag in soup.find_all(NOISE_TAGS):
        tag.decompose()

    # Remove noise classes
    for elem in soup.find_all(
        class_=lambda c: c and any(nc in c for nc in NOISE_CLASSES)
    ):
        elem.decompose()

    return str(soup)


def extract_tables(soup: BeautifulSoup) -> list[list[list[str]]]:
    """Extract tables as list of list of list of cell strings."""
    tables = []
    for table in soup.find_all("table"):
        table_data = []
        for row in table.find_all("tr"):
            cells = row.find_all(["td", "th"])
            if cells:
                row_data = []
                for cell in cells:
                    cell_text = cell.get_text(separator=" ", strip=True)
                    if cell_text:
                        row_data.append(cell_text)
                if row_data:
                    table_data.append(row_data)
        if table_data:
            tables.append(table_data)
    return tables


def extract_main_content(soup: BeautifulSoup) -> str:
    """Extract main content from HTML using semantic selectors."""
    # Try semantic containers first
    for selector in [
        "main", "article", "[role='main']", ".content", ".article-body",
        ".post-content", ".entry-content",
    ]:
        elem = soup.select_one(selector)
        if elem and len(elem.get_text(strip=True)) > 200:
            return str(elem)

    # Fallback to body
    body = soup.find("body")
    if body:
        return str(body)

    return str(soup)


def html_to_text(content: str) -> str:
    """Convert HTML to plain text."""
    soup = BeautifulSoup(content, "lxml")
    text = soup.get_text(separator=" ")
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


def parse_html(file_path: str) -> dict:
    """
    Parse HTML file and return structured data.

    Args:
        file_path: Path to HTML file

    Returns:
        dict with keys: rawText (str), tables (list), totalChars (int),
        encoding (str), pageCount (int=1), metadata (dict)
    """
    raw_html = read_html_file(file_path)
    if raw_html is None:
        return {
            "rawText": "",
            "tables": [],
            "totalChars": 0,
            "encoding": "failed",
            "pageCount": 1,
            "metadata": {"error": "Could not read file with any encoding"},
        }

    # Detect encoding
    encoding = "utf-8"
    for enc in ["utf-8", "gbk", "gb2312"]:
        try:
            raw_html.encode(enc)
            encoding = enc
            break
        except UnicodeEncodeError:
            continue

    # Clean and extract
    cleaned = clean_html(raw_html)
    main_content = extract_main_content(BeautifulSoup(cleaned, "lxml"))
    raw_text = html_to_text(main_content)

    # Extract tables
    soup = BeautifulSoup(cleaned, "lxml")
    tables = extract_tables(soup)

    # Truncate
    MAX_CHARS = 100_000
    if len(raw_text) > MAX_CHARS:
        raw_text = raw_text[:MAX_CHARS]

    return {
        "rawText": raw_text,
        "tables": tables,
        "totalChars": len(raw_text),
        "encoding": encoding,
        "pageCount": 1,
        "metadata": {
            "file_path": file_path,
            "tables_count": len(tables),
        },
    }
