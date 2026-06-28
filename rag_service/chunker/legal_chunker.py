#!/usr/bin/env python3
"""
legal_chunker.py - Legal document chunker with Parent-Child architecture

Splits legal documents by Article/Section boundaries (EU/CN/US patterns).
- Child chunks: 300-500 tokens, semantic retrieval units
- Parent chunks: full Article/Section, context expansion for LLM
- Bilingual contextual prepend for cross-lingual retrieval
- Metadata tree: full path inheritance per chunk
"""
import re
import uuid
import logging
from dataclasses import dataclass, field, asdict
from typing import Optional

logger = logging.getLogger(__name__)


# ─── Boundary detection regex ───────────────────────────────────────────────
EU_PATTERN  = re.compile(r"^(Article|Annex|Recital|Art\.)\s*(\d+[a-z]?)\b", re.IGNORECASE | re.MULTILINE)
CN_PATTERN  = re.compile(r"^第[一二三四五六七八九十百千零\d]+[条章节段款]", re.M)
US_PATTERN  = re.compile(r"^§\s*\d+(?:\.\d+)*\b|^Section\s+\d+", re.IGNORECASE | re.MULTILINE)


@dataclass
class Chunk:
    id: str
    content: str
    chunk_type: str          # "child" or "parent"
    parent_id: Optional[str] = None
    # Metadata
    doc_name: str = ""
    doc_id: str = ""
    region: str = ""
    article_no: Optional[str] = None
    section_path: list = field(default_factory=list)  # ["Title I", "Chapter 3", "Article 5"]
    page_start: int = 0
    page_end: int = 0
    total_chars: int = 0
    # Bilingual prepend
    prepend_en: str = ""     # e.g. "[REACH | Annex XVII | Entry 63]"
    prepend_zh: str = ""     # e.g. "[REACH法规 | 附件XVII | 条目63]"


def detect_boundary(text: str) -> Optional[dict]:
    """Detect if text starts a new legal section. Returns metadata or None."""
    line = text.strip().split("\n")[0]

    for match in EU_PATTERN.finditer(line):
        return {"type": "EU", "marker": match.group(1), "number": match.group(2)}

    for match in CN_PATTERN.finditer(line):
        return {"type": "CN", "marker": "条", "number": match.group(0)}

    for match in US_PATTERN.finditer(line):
        return {"type": "US", "marker": "§", "number": match.group(0)}

    return None


_EN_TO_ZH_TERMS = {
    "Article": "条",
    "Annex": "附件",
    "Recital": "序言",
    "Section": "节",
    "Chapter": "章",
    "Art.": "条",
}


def _translate_term(text: str) -> str:
    """Best-effort English→Chinese translation for common legal section terms."""
    result = text
    for en, zh in _EN_TO_ZH_TERMS.items():
        result = result.replace(en, zh)
    return result


def build_prepend(doc_name: str, section_path: list, article_no: Optional[str], lang: str = "en") -> tuple[str, str]:
    """Build bilingual contextual prepend tags.
    Returns (en, zh); zh is independently translated from common legal terms when lang="zh"."""
    parts = [doc_name] + section_path
    if article_no:
        parts.append(article_no)
    en = " | ".join(parts)
    if lang == "zh":
        zh = " | ".join([_translate_term(p) for p in parts])
        return en, zh
    return en, en


def estimate_tokens(text: str) -> int:
    """Rough token estimation: ~0.75 chars per token for Chinese, ~4 chars per token for English."""
    chinese = sum(1 for c in text if "一" <= c <= "鿿")
    non_chinese = len(text) - chinese
    return int(chinese / 0.75 + non_chinese / 4)


def split_by_boundaries(text: str) -> list[dict]:
    """
    Split text at legal section boundaries.
    Returns list of {"content": str, "boundary": dict|None, "start": int, "end": int}.
    """
    # Find all boundary positions
    boundaries = []
    for match in EU_PATTERN.finditer(text):
        boundaries.append({"pos": match.start(), "type": "EU", "number": match.group(2), "marker": match.group(1)})
    for match in CN_PATTERN.finditer(text):
        boundaries.append({"pos": match.start(), "type": "CN", "number": match.group(0)})
    for match in US_PATTERN.finditer(text):
        boundaries.append({"pos": match.start(), "type": "US", "number": match.group(0)})

    if not boundaries:
        return [{"content": text, "boundary": None, "start": 0, "end": len(text)}]

    # Sort by position
    boundaries.sort(key=lambda b: b["pos"])

    # Build segments
    segments = []
    for i, b in enumerate(boundaries):
        start = b["pos"]
        end = boundaries[i + 1]["pos"] if i + 1 < len(boundaries) else len(text)
        segments.append({
            "content": text[start:end].strip(),
            "boundary": b,
            "start": start,
            "end": end,
        })

    # Handle text before first boundary
    if boundaries[0]["pos"] > 0:
        segments.insert(0, {
            "content": text[:boundaries[0]["pos"]].strip(),
            "boundary": None,
            "start": 0,
            "end": boundaries[0]["pos"],
        })

    return [s for s in segments if s["content"]]


def chunk_document(raw_text: str, doc_name: str = "", doc_id: str = "",
                   region: str = "", page_map: Optional[list] = None) -> dict:
    """
    Main chunking function. Implements Parent-Child architecture.

    Args:
        raw_text: full document text
        doc_name: document name (e.g. "REACH (EC) 1907/2006")
        doc_id: unique identifier
        region: market region (e.g. "EU", "US", "CN")
        page_map: list of page start positions (optional)

    Returns:
        dict with keys:
            child_chunks: list[dict] - retrieval units (300-500 tokens)
            parent_chunks: list[dict] - full sections for context expansion
            total_children: int
            total_parents: int
    """
    page_map = page_map or []
    lang = "zh" if region == "CN" else "en"

    # Step 1: split at boundaries
    segments = split_by_boundaries(raw_text)

    # Step 2: build child chunks (merge short segments, split long ones)
    child_chunks = []
    parent_chunks = []

    for seg in segments:
        content = seg["content"].strip()
        if not content or len(content) < 50:
            continue

        tokens = estimate_tokens(content)
        boundary = seg["boundary"]
        article_no = boundary["number"] if boundary else None

        if tokens <= 600:
            # Single child chunk
            chunk_id = str(uuid.uuid4())[:8]
            prepend_en, prepend_zh = build_prepend(doc_name, [], article_no, lang)

            child = Chunk(
                id=chunk_id,
                content=content,
                chunk_type="child",
                parent_id=None,  # Will be set after parent creation
                doc_name=doc_name,
                doc_id=doc_id,
                region=region,
                article_no=article_no,
                section_path=[],
                page_start=0,
                page_end=0,
                total_chars=len(content),
                prepend_en=prepend_en,
                prepend_zh=prepend_zh,
            )
            # Parent = same content (short article = full article)
            parent = Chunk(
                id=str(uuid.uuid4())[:8],
                content=content,
                chunk_type="parent",
                parent_id=None,
                doc_name=doc_name,
                doc_id=doc_id,
                region=region,
                article_no=article_no,
                section_path=[],
                page_start=0,
                page_end=0,
                total_chars=len(content),
                prepend_en=prepend_en,
                prepend_zh=prepend_zh,
            )
            child.parent_id = parent.id
            child_chunks.append(asdict(child))
            parent_chunks.append(asdict(parent))

        else:
            # Long segment: split by paragraphs/sentences.
            # Create the parent FIRST so every child in this segment can be
            # linked precisely by parent_id (no [-10:] lookback that drops
            # early children when an Article fans out into >10 chunks).
            prepend_en, prepend_zh = build_prepend(doc_name, [], article_no, lang)
            parent_id = str(uuid.uuid4())[:8]
            parent = Chunk(
                id=parent_id,
                content=content,
                chunk_type="parent",
                parent_id=None,
                doc_name=doc_name,
                doc_id=doc_id,
                region=region,
                article_no=article_no,
                section_path=[],
                page_start=0,
                page_end=0,
                total_chars=len(content),
                prepend_en=prepend_en,
                prepend_zh=prepend_zh,
            )
            parent_chunks.append(asdict(parent))

            # Try sentence splitting, accumulating children for THIS segment.
            sentences = re.split(r"(?<=[。！？.!?])\s+", content)
            current = ""
            current_tokens = 0
            seg_children: list[Chunk] = []

            def _flush(buf: str) -> None:
                if not buf.strip():
                    return
                cid = str(uuid.uuid4())[:8]
                child = Chunk(
                    id=cid,
                    content=buf.strip(),
                    chunk_type="child",
                    parent_id=parent_id,
                    doc_name=doc_name,
                    doc_id=doc_id,
                    region=region,
                    article_no=article_no,
                    section_path=[],
                    page_start=0,
                    page_end=0,
                    total_chars=len(buf),
                    prepend_en=prepend_en,
                    prepend_zh=prepend_zh,
                )
                seg_children.append(child)

            for sent in sentences:
                sent_tokens = estimate_tokens(sent)
                if current_tokens + sent_tokens > 600 and current:
                    _flush(current)
                    current = sent
                    current_tokens = sent_tokens
                else:
                    current += " " + sent
                    current_tokens += sent_tokens

            _flush(current)

            # Persist every child of this segment with the correct parent link.
            for child in seg_children:
                child_chunks.append(asdict(child))

    return {
        "child_chunks": child_chunks,
        "parent_chunks": parent_chunks,
        "total_children": len(child_chunks),
        "total_parents": len(parent_chunks),
    }