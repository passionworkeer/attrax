#!/usr/bin/env python3
"""
local_embedder.py - Local Qwen3-Embedding-0.6B inference

Uses downloaded ModelScope Qwen3-Embedding-0.6B weights directly.
- Dynamic batching (adapts to GPU memory)
- Mean pooling over attention mask
- Empty cache after each batch
- Falls back to CPU if CUDA unavailable
"""
import gc
import os
import re
import torch
import logging
import numpy as np
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DIM = 1024
MODEL_PATH = Path(os.path.expanduser("~/.cache/modelscope/hub/models/Qwen/Qwen3-Embedding-0___6B"))


def _normalize_path(path: Path) -> str:
    """Fix Windows mixed separators in paths."""
    return str(Path(path)).replace("/", "\\") if os.name == "nt" else str(path)


class LocalEmbedder:
    """
    Local inference for Qwen/Qwen3-Embedding-0.6B.
    Loads model from local cache; no API key needed.
    """

    DIM = DIM
    MODEL = "Qwen/Qwen3-Embedding-0.6B"

    def __init__(self, device: Optional[str] = None, max_batch: int = 16):
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.max_batch = max_batch
        self._tokenizer = None
        self._model = None
        logger.info(f"LocalEmbedder device={self.device}, max_batch={max_batch}")

    def _load(self):
        if self._model is not None:
            return
        model_path = _normalize_path(MODEL_PATH)
        logger.info(f"Loading model from {model_path} ...")

        from transformers import AutoTokenizer, AutoModel

        self._tokenizer = AutoTokenizer.from_pretrained(
            model_path, trust_remote_code=True
        )
        kwargs = {"trust_remote_code": True}
        if self.device == "cuda":
            kwargs["torch_dtype"] = torch.bfloat16
        self._model = AutoModel.from_pretrained(model_path, **kwargs)
        self._model.to(self.device)
        self._model.eval()
        logger.info(f"Model loaded on {self.device}")

    @property
    def model(self):
        self._load()
        return self._model

    @property
    def tokenizer(self):
        self._load()
        return self._tokenizer

    def _mean_pooling(self, last_hidden_state: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
        """Mean pool over non-padding tokens."""
        mask_expanded = attention_mask.unsqueeze(-1).expand(last_hidden_state.size()).float()
        sum_embeddings = torch.sum(last_hidden_state * mask_expanded, dim=1)
        sum_mask = mask_expanded.sum(dim=1).clamp(min=1e-9)
        return sum_embeddings / sum_mask

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Embed a list of texts using dynamic batching."""
        if not texts:
            return []

        model = self.model
        tokenizer = self.tokenizer
        device = self.device

        results = []
        for i in range(0, len(texts), self.max_batch):
            batch = texts[i : i + self.max_batch]

            inputs = tokenizer(
                batch,
                padding=True,
                truncation=True,
                max_length=512,
                return_tensors="pt",
            )
            inputs = {k: v.to(device) for k, v in inputs.items()}

            with torch.no_grad():
                outputs = model(**inputs)
                embeddings = self._mean_pooling(outputs.last_hidden_state, inputs["attention_mask"])
                embeddings = torch.nn.functional.normalize(embeddings, dim=1)

            results.extend(embeddings.cpu().tolist())

            # Free memory
            del outputs, embeddings, inputs
            if device == "cuda":
                torch.cuda.empty_cache()
            gc.collect()

        return results

    def embed_query(self, text: str) -> list[float]:
        return self.embed_texts([text])[0]

    def embed_batch(self, texts: list[str], batch_size: int = None) -> list[list[float]]:
        """
        Embed a batch of texts.
        batch_size parameter kept for API compat; actual batching controlled by self.max_batch.
        """
        max_b = batch_size or self.max_batch
        results = []
        for i in range(0, len(texts), max_b):
            results.extend(self.embed_texts(texts[i : i + max_b]))
        return results
