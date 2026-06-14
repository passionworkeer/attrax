#!/usr/bin/env python3
"""
docx_parser.py - DOCX document parser for compliance corpus

Extracts paragraphs and tables from .docx files using python-docx.
"""
import logging
from pathlib import Path
from typing import Optional

import docx
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.table import Table
from docx.text.paragraph import Paragraph

logger = logging.getLogger(__name__)


def _escape_prompt_injection(text: str) -> str:
    """
    Escape prompt-injection patterns in extracted document text.

    Defends against attempts to break out of <user_document> / <user_image>
    XML wrappers used by the generator node. Conservative: only escapes
    closing-tag-shaped fragments, leaving normal content untouched.
    """
    if not text:
        return text
    # Neutralize common prompt-injection / tag-break tokens.
    text = text.replace("</user_document>", "&lt;/user_document&gt;")
    text = text.replace("</user_image>", "&lt;/user_image&gt;")
    text = text.replace("<|im_start|>", "&lt;|im_start|&gt;")
    text = text.replace("<|im_end|>", "&lt;|im_end|&gt;")
    text = text.replace("<|system|>", "&lt;|system|&gt;")
    text = text.replace("<|user|>", "&lt;|user|&gt;")
    text = text.replace("<|assistant|>", "&lt;|assistant|&gt;")
    return text


def parse_docx(file_path: str) -> dict:
    """
    Parse DOCX file and return structured data.

    Args:
        file_path: Path to .docx file

    Returns:
        dict with keys:
            rawText (str): all paragraphs joined with double newlines
            tables (list[list[list[str]]]): table data
            paragraphCount (int): number of non-empty paragraphs
            totalChars (int): total character count
    """
    try:
        doc = docx.Document(file_path)
    except Exception as e:
        return {
            "rawText": "",
            "tables": [],
            "paragraphCount": 0,
            "totalChars": 0,
            "error": str(e),
        }

    paragraphs = []
    tables = []

    # Iterate through all block-level elements in document order
    body = doc.element.body
    for child in body:
        if isinstance(child, CT_P):
            # Paragraph
            para = Paragraph(child, doc)
            text = para.text.strip()
            if text:
                paragraphs.append(text)
        elif isinstance(child, CT_Tbl):
            # Table
            table = Table(child, doc)
            table_data = []
            for row in table.rows:
                cells = [cell.text.strip() for cell in row.cells]
                if any(cells):
                    table_data.append(cells)
            if table_data:
                tables.append(table_data)

    raw_text = "\n\n".join(paragraphs)
    # Escape prompt-injection patterns before returning to upstream consumers.
    raw_text = _escape_prompt_injection(raw_text)

    return {
        "rawText": raw_text[:100_000],  # Truncate to 100k chars
        "tables": tables,
        "paragraphCount": len(paragraphs),
        "totalChars": len(raw_text),
    }


def get_document_properties(file_path: str) -> dict:
    """Extract document metadata (title, author, etc.)."""
    try:
        doc = docx.Document(file_path)
        core_props = doc.core_properties
        return {
            "title": core_props.title or "",
            "author": core_props.author or "",
            "subject": core_props.subject or "",
            "created": str(core_props.created) if core_props.created else "",
            "modified": str(core_props.modified) if core_props.modified else "",
        }
    except Exception as e:
        return {"error": str(e)}