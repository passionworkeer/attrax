#!/usr/bin/env python3
"""
ollama_embedder.py - Ollama local embedding via nomic-embed-text

轻量方案（~275MB）：
- nomic-embed-text：768 维，无需 GPU，CPU 可跑
- 自动探测 localhost:11434，模型不存在时抛出异常让 HybridRetriever 捕获并降级

安装方法：
  ollama pull nomic-embed-text

注意：Ollama nomic-embed-text 向量维度为 768，与 Qwen3-Embedding-0.6B（1024 维）不同。
如果两者混用，需要重建 Faiss 索引。
"""
import os
import json
import logging
import urllib.request
import urllib.error
import numpy as np

logger = logging.getLogger(__name__)

DIM = 768  # Ollama nomic-embed-text 输出 768 维
OLLAMA_MODEL = os.environ.get("OLLAMA_EMBED_MODEL", "nomic-embed-text")
OLLAMA_BASE = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")


def _is_ollama_available() -> bool:
    """Check if Ollama server is running."""
    try:
        req = urllib.request.Request(
            f"{OLLAMA_BASE}/api/tags",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=3):
            return True
    except Exception:
        return False


def _ollama_embed_single(text: str, model: str) -> list[float]:
    """
    Call Ollama /api/embeddings endpoint (single text).
    Raises urllib.error.HTTPError if model not found (→ caught by HybridRetriever).
    """
    body = json.dumps({
        "model": model,
        "prompt": text,
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{OLLAMA_BASE}/api/embeddings",
        data=body,
        headers={"Content-Type": "application/json"},
    )

    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read())

    embedding = data.get("embedding", [])
    if not embedding:
        raise ValueError(f"Ollama /api/embeddings returned empty: {data}")

    # L2 normalize
    vec = np.array(embedding, dtype=np.float32)
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm

    return vec.tolist()


def _ollama_embed_batch(texts: list[str], model: str, batch_size: int = 32) -> list[list[float]]:
    """
    Call Ollama /api/embed endpoint with batch prompts (single HTTP call for all texts).
    Falls back to serial _ollama_embed_single on failure.
    """
    if not texts:
        return []

    results = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        body = json.dumps({
            "model": model,
            "input": batch,
        }).encode("utf-8")

        req = urllib.request.Request(
            f"{OLLAMA_BASE}/api/embed",
            data=body,
            headers={"Content-Type": "application/json"},
        )

        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = json.loads(r.read())

            embeddings = data.get("embeddings", [])
            for emb in embeddings:
                vec = np.array(emb, dtype=np.float32)
                norm = np.linalg.norm(vec)
                if norm > 0:
                    vec = vec / norm
                results.append(vec.tolist())
        except Exception:
            # Fallback to serial on API error (e.g. older Ollama version without /api/embed)
            for text in batch:
                results.append(_ollama_embed_single(text, model))

    return results


class OllamaEmbedder:
    """
    Local embedding via Ollama nomic-embed-text.
    No API key，不依赖任何外部服务。
    模型不存在时 raise，触发 HybridRetriever 降级到本地 Qwen。
    """

    DIM = DIM

    def __init__(self, model: str | None = None):
        self.model = model or OLLAMA_MODEL
        if not _is_ollama_available():
            raise RuntimeError(
                f"Ollama not available at {OLLAMA_BASE}."
                " Run: ollama run nomic-embed-text"
            )
        # Probe the model exists by sending a minimal request
        try:
            _ollama_embed_single("hi", self.model)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise RuntimeError(
                    f"Model '{self.model}' not found in Ollama. "
                    "Run: ollama pull nomic-embed-text"
                )
            raise
        logger.info(f"OllamaEmbedder ready: model={self.model}, dim={self.DIM}")

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Embed a list of texts using batch API (one HTTP call per batch)."""
        if not texts:
            return []
        return _ollama_embed_batch(texts, self.model)

    def embed_query(self, text: str) -> list[float]:
        """Embed a single query string."""
        return _ollama_embed_single(text, self.model)

    def embed_batch(self, texts: list[str], batch_size: int = 32) -> list[list[float]]:
        """Embed a batch of texts using Ollama /api/embed (single call per batch)."""
        return _ollama_embed_batch(texts, self.model, batch_size)
