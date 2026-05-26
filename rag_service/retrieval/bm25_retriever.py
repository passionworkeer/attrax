#!/usr/bin/env python3
"""
bm25_retriever.py - jieba BM25 sparse retriever

Builds BM25 index from chunk content and supports Chinese+English mixed queries.
"""
import os
import json
import logging
import re
from typing import Optional

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


_CJK_RE = re.compile(r"[\u4e00-\u9fff]+")
_TOKEN_RE = re.compile(r"[a-z0-9\u4e00-\u9fff]+", re.IGNORECASE)
_STOP_TOKENS = {"the", "and", "or", "of", "in", "to", "for", "a", "an"}
_CJK_STOP_CHARS = set("\u7684\u4e86\u548c\u4e0e\u53ca\u6216\u5728\u5bf9\u4e2d")


def _tokenize(text: str) -> list[str]:
    """Tokenize mixed Chinese/English text with stable CJK fallback tokens."""
    text = text or ""
    tokens: list[str] = []

    for raw in jieba.lcut(text):
        token = raw.strip().lower()
        if not token or token in _STOP_TOKENS:
            continue
        if not _TOKEN_RE.search(token):
            continue
        tokens.append(token)

    # Jieba can segment Chinese query/doc text differently. Add CJK unigrams
    # and bigrams so exact character overlaps still rank relevant docs first.
    for match in _CJK_RE.finditer(text):
        run = match.group(0)
        tokens.extend(ch for ch in run if ch not in _CJK_STOP_CHARS)
        tokens.extend(run[i:i + 2] for i in range(len(run) - 1))

    return tokens


class BM25Retriever:
    """
    BM25 sparse retriever with jieba tokenization.

    Performance: corpus is tokenized once at build_index() and cached.
    Only the query is tokenized per search call.
    """

    def __init__(self):
        self.chunks: list[dict] = []
        self.bm25: Optional[BM25Okapi] = None
        self.chunk_id_to_doc: dict[str, dict] = {}
        self._tokenized_chunks: list[list[str]] = []

    def build_index(self, chunks: list[dict]):
        """Build BM25 index from chunks. Each chunk needs 'content' and 'id'."""
        self.chunks = chunks
        self.chunk_id_to_doc = {c["id"]: c for c in chunks}

        # Tokenize corpus ONCE and cache — avoids re-tokenizing thousands of
        # chunks on every search call (was ~50ms overhead per search before).
        tokenized = [_tokenize(_chunk_search_text(chunk)) for chunk in chunks]
        self._tokenized_chunks = tokenized

        self.bm25 = BM25Okapi(tokenized)
        logger.info(f"BM25 index built with {len(chunks)} chunks")

    def search(self, query: str, top_k: int = 50) -> list[dict]:
        """Search BM25 index."""
        if self.bm25 is None:
            logger.warning("BM25 index not built")
            return []

        query_tokens = _tokenize(query)
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
        """Save index state to disk."""
        with open(path, "w", encoding="utf-8") as f:
            json.dump({
                "chunk_ids": [c["id"] for c in self.chunks],
                "scores_sum": float(sum(
                    max(self.bm25.get_scores(_tokenize(c.get("content", ""))))
                    for c in self.chunks
                )) if self.bm25 else 0,
            }, f)

    @classmethod
    def from_chunks(cls, chunks: list[dict]) -> "BM25Retriever":
        """Build BM25 retriever from chunks."""
        retriever = cls()
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
