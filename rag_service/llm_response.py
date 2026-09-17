"""Provider-neutral helpers for Anthropic-compatible response payloads."""
from __future__ import annotations

from typing import Any


def extract_text_blocks(payload: dict[str, Any]) -> str:
    """Join text blocks while ignoring thinking and other content blocks."""
    blocks = payload.get("content")
    if not isinstance(blocks, list):
        return ""
    return "".join(
        block.get("text", "")
        for block in blocks
        if isinstance(block, dict)
        and block.get("type", "text") == "text"
        and isinstance(block.get("text"), str)
    )
