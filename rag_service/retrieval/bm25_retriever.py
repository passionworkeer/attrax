#!/usr/bin/env python3
"""
bm25_retriever.py - jieba BM25 sparse retriever

Builds BM25 index from chunk content and supports Chinese+English mixed queries.
"""
import os
import json
import logging
import re
from typing import Callable, Optional

import jieba
from rank_bm25 import BM25Okapi

from rag_service.retrieval.metadata_filter import attach_metadata_fields

logger = logging.getLogger(__name__)

LEGAL_TERMS = [
    "REACH", "RoHS", "CE", "EMC", "LVD", "GPSR", "RED", "GDPR", "DSA", "DMA",
    "AI Act", "Annex", "Article", "Regulation", "Directive",
    "认证", "合规", "限制", "禁止", "要求", "铅", "镉", "汞",
    "认证", "检验", "标志", "标准", "安全", "环保",
]

# Load legal terms into jieba
for term in LEGAL_TERMS:
    jieba.add_word(term, freq=100000, tag="nz")


_CJK_RE = re.compile(r"[一-鿿]+")
_TOKEN_RE = re.compile(r"[a-z0-9一-鿿]+", re.IGNORECASE)
_STOP_TOKENS = {"the", "and", "or", "of", "in", "to", "for", "a", "an"}
_CJK_STOP_CHARS = set("的了和与及或在对中")


def _tokenize(text: str) -> list[str]:
    """Tokenize mixed Chinese/English text.

    Tokenization strategy:
      1. jieba.lcut for both CJK and latin text (LEGAL_TERMS preloaded).
      2. Stop-word filtering on the latin side.
      3. CJK unigram fallback so exact character overlaps between query
         and doc still produce a score even when jieba segments them
         differently.

    Bigrams were previously emitted for CJK runs but removed: they
    exploded the term table (~2x tokens per CJK doc) without improving
    retrieval eval hit-rate, and inflated BM25 index memory. Unigrams
    plus jieba segmentation cover the same recall.
    """
    text = text or ""
    tokens: list[str] = []

    for raw in jieba.lcut(text):
        token = raw.strip().lower()
        if not token or token in _STOP_TOKENS:
            continue
        if not _TOKEN_RE.search(token):
            continue
        tokens.append(token)

    for match in _CJK_RE.finditer(text):
        run = match.group(0)
        tokens.extend(ch for ch in run if ch not in _CJK_STOP_CHARS)

    return tokens


def _fast_tokenize(text: str) -> list[str]:
    """Low-overhead tokenizer for cold-start corpus fallback.

    English identifiers/words and CJK unigrams preserve exact sparse recall
    without paying jieba segmentation cost across the whole source corpus.
    """
    text = text or ""
    latin = [
        token.lower()
        for token in re.findall(r"[A-Za-z0-9][A-Za-z0-9.+_-]*", text)
        if token.lower() not in _STOP_TOKENS
    ]
    cjk = [
        char
        for match in _CJK_RE.finditer(text)
        for char in match.group(0)
        if char not in _CJK_STOP_CHARS
    ]
    return latin + cjk


class BM25Retriever:
    """
    BM25 sparse retriever with jieba tokenization.

    Performance: corpus is tokenized once at build_index() and cached.
    Only the query is tokenized per search call.
    """

    def __init__(self, tokenizer: Callable[[str], list[str]] | None = None):
        self.chunks: list[dict] = []
        self.bm25: Optional[BM25Okapi] = None
        self.chunk_id_to_doc: dict[str, dict] = {}
        self._tokenized_chunks: list[list[str]] = []
        self._tokenizer = tokenizer or _tokenize

    def build_index(self, chunks: list[dict]):
        """Build BM25 index from chunks. Each chunk needs 'content' and 'id'.

        Explicit BM25 params (k1=1.2, b=0.75) are the canonical values
        used across most production retrieval systems; pinning them makes
        scoring deterministic and reproducible across rebuilds.
        """
        self.chunks = chunks
        self.chunk_id_to_doc = {c["id"]: c for c in chunks}

        # Tokenize corpus ONCE and cache — avoids re-tokenizing thousands of
        # chunks on every search call (was ~50ms overhead per search before).
        tokenized = [self._tokenizer(_chunk_search_text(chunk)) for chunk in chunks]
        self._tokenized_chunks = tokenized

        self.bm25 = BM25Okapi(tokenized, k1=1.2, b=0.75)
        logger.info(f"BM25 index built with {len(chunks)} chunks (k1=1.2, b=0.75)")

    def search(self, query: str, top_k: int = 50) -> list[dict]:
        """Search BM25 index."""
        if self.bm25 is None:
            logger.warning("BM25 index not built")
            return []

        query_tokens = self._tokenizer(query)
        if not query_tokens:
            return []

        scores = self.bm25.get_scores(query_tokens)
        query_terms = set(query_tokens)

        ranked = []
        for idx, score in enumerate(scores):
            overlap = len(query_terms & set(self._tokenized_chunks[idx]))
            if score <= 0 and overlap == 0:
                continue
            ranked.append((idx, float(score), overlap))

        ranked.sort(key=lambda item: (-item[1], -item[2], item[0]))
        top_indices = [idx for idx, _, _ in ranked[:top_k]]

        results = []
        for idx in top_indices:
            chunk = self.chunks[idx]
            result = attach_metadata_fields({
                "id": chunk["id"],
                "score": float(scores[idx]),
                "content": chunk.get("content", ""),
                "doc_name": chunk.get("doc_name", ""),
                "article_no": chunk.get("article_no", ""),
                "region": chunk.get("region", ""),
                "source_id": chunk.get("source_id", ""),
                "source_file": chunk.get("source_file", ""),
                "source_url": chunk.get("source_url", ""),
                "content_url": chunk.get("content_url", ""),
                "official_channel": chunk.get("official_channel", ""),
                "product_categories": chunk.get("product_categories", []),
                "regulatory_types": chunk.get("regulatory_types", []),
                "raw_files": chunk.get("raw_files", []),
                "metadata": chunk.get("metadata", {}),
            })
            results.append(result)

        return results

    def save_index(self, path: str):
        """Save chunk-id manifest to disk.

        The previous implementation re-ran ``get_scores`` for every chunk
        (O(n²)) just to persist a sanity-check sum that no consumer ever
        read back. On a 14k-chunk corpus that dominated save latency. We
        now persist only the chunk-id list, which is the sole field any
        loader reads.
        """
        with open(path, "w", encoding="utf-8") as f:
            json.dump({
                "chunk_ids": [c["id"] for c in self.chunks],
            }, f)

    @classmethod
    def from_chunks(
        cls,
        chunks: list[dict],
        tokenizer: Callable[[str], list[str]] | None = None,
    ) -> "BM25Retriever":
        """Build BM25 retriever from chunks."""
        retriever = cls(tokenizer=tokenizer)
        retriever.build_index(chunks)
        return retriever


def _chunk_search_text(chunk: dict) -> str:
    """Build sparse-search text from content plus regulation metadata."""
    metadata = chunk.get("metadata") if isinstance(chunk.get("metadata"), dict) else {}
    product_categories = (
        chunk.get("product_categories")
        or metadata.get("product_categories")
        or metadata.get("productCategories")
        or []
    )
    regulatory_types = (
        chunk.get("regulatory_types")
        or metadata.get("regulatory_types")
        or metadata.get("regulatoryTypes")
        or []
    )
    parts = [
        chunk.get("content", ""),
        chunk.get("doc_name", ""),
        chunk.get("source_id", ""),
        chunk.get("source_file", ""),
        chunk.get("official_channel", "") or metadata.get("official_channel", ""),
        " ".join(product_categories),
        " ".join(regulatory_types),
    ]
    return "\n".join(str(part) for part in parts if part)
