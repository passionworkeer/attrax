#!/usr/bin/env python3
"""
bm25_retriever.py - jieba BM25 sparse retriever

Builds BM25 index from chunk content and supports Chinese+English mixed queries.
"""
import os
import json
import logging
from typing import Optional

import jieba
from rank_bm25 import BM25Okapi

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


class BM25Retriever:
    """BM25 sparse retriever with jieba tokenization."""

    def __init__(self):
        self.chunks: list[dict] = []
        self.bm25: Optional[BM25Okapi] = None
        self.chunk_id_to_doc: dict[str, dict] = {}

    def build_index(self, chunks: list[dict]):
        """Build BM25 index from chunks. Each chunk needs 'content' and 'id'."""
        self.chunks = chunks
        self.chunk_id_to_doc = {c["id"]: c for c in chunks}

        # Tokenize content
        tokenized = []
        for chunk in chunks:
            tokens = jieba.lcut(chunk.get("content", ""))
            tokenized.append(tokens)

        self.bm25 = BM25Okapi(tokenized)
        logger.info(f"BM25 index built with {len(chunks)} chunks")

    def search(self, query: str, top_k: int = 50) -> list[dict]:
        """Search BM25 index."""
        if self.bm25 is None:
            logger.warning("BM25 index not built")
            return []

        query_tokens = jieba.lcut(query)
        scores = self.bm25.get_scores(query_tokens)

        # Get top-k indices sorted by score
        top_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:top_k]

        results = []
        for idx in top_indices:
            chunk = self.chunks[idx]
            results.append({
                "id": chunk["id"],
                "score": float(scores[idx]),
                "content": chunk.get("content", ""),
                "doc_name": chunk.get("doc_name", ""),
                "article_no": chunk.get("article_no", ""),
                "region": chunk.get("region", ""),
            })

        return results

    def save_index(self, path: str):
        """Save index state to disk."""
        with open(path, "w", encoding="utf-8") as f:
            json.dump({
                "chunk_ids": [c["id"] for c in self.chunks],
                "scores_sum": float(sum(
                    max(self.bm25.get_scores(jieba.lcut(c.get("content", ""))))
                    for c in self.chunks
                )) if self.bm25 else 0,
            }, f)

    @classmethod
    def from_chunks(cls, chunks: list[dict]) -> "BM25Retriever":
        """Build BM25 retriever from chunks."""
        retriever = cls()
        retriever.build_index(chunks)
        return retriever
