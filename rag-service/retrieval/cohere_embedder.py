#!/usr/bin/env python3
"""
cohere_embedder.py - Cohere embed-multilingual-v3 wrapper

Provides dense embedding via Cohere API.
"""
import os
import logging
from typing import Optional

import cohere

logger = logging.getLogger(__name__)

# Cache for already-embedded texts (file-based)
EMBED_CACHE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "embedding_cache")
os.makedirs(EMBED_CACHE_DIR, exist_ok=True)


class CohereEmbedder:
    """Wrapper for Cohere embed-multilingual-v3 API."""

    MODEL = "embed-multilingual-v3.0"
    DIM   = 1024  # embed-multilingual-v3 outputs 1024-dim vectors

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get("COHERE_API_KEY", "")
        self._client = None

    @property
    def client(self) -> cohere.ClientV2:
        if self._client is None:
            self._client = cohere.ClientV2(api_key=self.api_key)
        return self._client

    def embed_query(self, text: str) -> list[float]:
        """Embed a single query."""
        resp = self.client.embed(
            texts=[text],
            model=self.MODEL,
            input_type="search_query",
        )
        return resp.embeddings[0]

    def embed_batch(self, texts: list[str], batch_size: int = 96) -> list[list[float]]:
        """Embed a batch of texts (Cohere limit: 96 per request)."""
        results = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i+batch_size]
            try:
                resp = self.client.embed(
                    texts=batch,
                    model=self.MODEL,
                    input_type="search_document",
                )
                results.extend(resp.embeddings)
            except Exception as e:
                logger.error(f"Batch embed failed at {i}: {e}")
                # Return zeros as fallback
                results.extend([[0.0] * self.DIM for _ in batch])
        return results

    def embed_texts_with_prepend(
        self, texts: list[str], prepending: list[str]
    ) -> list[list[float]]:
        """Embed texts with contextual prepending (bilingual)."""
        prepared = []
        for text, prepend in zip(texts, prepending):
            if prepend:
                prepared.append(f"{prepend}\n{text}")
            else:
                prepared.append(text)
        return self.embed_batch(prepared)
