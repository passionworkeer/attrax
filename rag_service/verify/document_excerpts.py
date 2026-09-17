"""Stable, exact excerpts from the actual bounded document input."""
import re


def document_excerpts(text: str) -> dict[str, str]:
    # Keep PDF line breaks and spelling in the stored value. A model selects
    # an ID rather than retyping names, punctuation or trademark symbols.
    spans = []
    for match in re.finditer(r"[^\n]+(?:\n|$)", text):
        line = match.group().strip()
        if not line:
            continue
        for start in range(0, len(line), 240):
            quote = line[start:start + 240]
            if len(quote) >= 8:
                spans.append(quote)
    return {f"e{i + 1}": quote for i, quote in enumerate(spans)}


def annotated_document(text: str) -> str:
    parts, cursor = [], 0
    for key, quote in document_excerpts(text).items():
        start = text.find(quote, cursor)
        parts.extend([text[cursor:start], f"[{key}] ", quote])
        cursor = start + len(quote)
    parts.append(text[cursor:])
    return "".join(parts)


def resolve_document_excerpts(package: dict, documents: list[dict]) -> None:
    indexes = {d["documentIndex"]: document_excerpts(d["includedText"]) for d in documents}
    for claim in package.get("reviewClaims") or []:
        if not isinstance(claim, dict):
            continue
        refs = claim.get("documentEvidence")
        if not isinstance(refs, list):
            continue
        for ref in refs:
            if not isinstance(ref, dict) or not isinstance(ref.get("documentIndex"), int) or isinstance(ref.get("documentIndex"), bool):
                continue
            excerpt_id = ref.get("excerptId")
            if not isinstance(excerpt_id, str):
                continue
            quote = indexes.get(ref["documentIndex"], {}).get(excerpt_id)
            if quote is not None:
                ref["quote"] = quote
                ref["quoteProvenance"] = "selected_document_excerpt"
            else:
                # A fabricated ID must not fall back to a coincidentally
                # valid quote and appear as a verified selected excerpt.
                ref["quote"] = ""
