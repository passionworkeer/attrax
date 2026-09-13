"""Content-hash observation cache (plan 2026-09-13 §10.3 缓存分层).

Caches the RAW vision-model text response for a single image, keyed by:

    sha256(image bytes) + model + prompt_version (+ checklist hash when
    the checklist prompt is used)

The cached value is the model's raw text, never a parsed structure —
parsing embeds session ids (observation ids carry scan identity), so it
must re-run per session. On a hit the pipeline skips the LLM roundtrip
and re-parses; identical image + identical model + identical prompt
yields the identical raw text, so the parse is deterministic.

Storage: one JSON file per key under ``<runtime_data_dir>/cache/vision``.
Bound: max ``MAX_ENTRIES`` files, evicted oldest-mtime-first. Cross-
session reuse stores only the analysis text keyed by content hash — no
image bytes, no session linkage — so a cache hit cannot expose a user's
photo or metadata to another session.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

MAX_ENTRIES = 500
_SUBDIR = "cache/vision"


class VisionResponseCache:
    def __init__(self, base_dir: Path | str | None = None):
        if base_dir is None:
            from rag_service.config import settings

            base_dir = settings.runtime_data_dir
        self.dir = Path(base_dir) / "cache" / "vision"
        try:
            self.dir.mkdir(parents=True, exist_ok=True)
        except OSError:
            self.dir = None  # cache disabled on unwritable storage

    # ── keys ────────────────────────────────────────────────────────────

    @staticmethod
    def cache_key(
        image_bytes: bytes,
        model: str,
        prompt_version: str,
        checklist: list[dict[str, Any]] | None = None,
    ) -> str:
        digest = hashlib.sha256()
        digest.update(image_bytes)
        digest.update(f"\x00model={model}".encode("utf-8"))
        digest.update(f"\x00prompt={prompt_version}".encode("utf-8"))
        if checklist:
            # Checklist identity: ids + titles, order-stable.
            payload = json.dumps(
                [{"id": c.get("id"), "title": c.get("title")} for c in checklist],
                ensure_ascii=False,
                sort_keys=True,
            )
            digest.update(f"\x00checks={payload}".encode("utf-8"))
        return digest.hexdigest()

    # ── io ──────────────────────────────────────────────────────────────

    def _path(self, key: str) -> Path | None:
        return (self.dir / f"{key}.json") if self.dir else None

    def get(self, key: str) -> str | None:
        path = self._path(key)
        if path is None or not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            text = payload.get("text")
            if isinstance(text, str):
                # Bump mtime for LRU eviction.
                os.utime(path, None)
                return text
        except (OSError, ValueError):
            return None
        return None

    def put(self, key: str, text: str) -> None:
        path = self._path(key)
        if path is None or not text:
            return
        try:
            tmp = path.with_suffix(".tmp")
            tmp.write_text(
                json.dumps({"text": text}, ensure_ascii=False), encoding="utf-8"
            )
            tmp.replace(path)  # atomic on POSIX
        except OSError as exc:
            logger.debug("vision cache write failed: %s", exc)
            return
        self._evict_if_needed()

    def _evict_if_needed(self) -> None:
        if self.dir is None:
            return
        try:
            entries = [p for p in self.dir.glob("*.json") if p.is_file()]
            if len(entries) <= MAX_ENTRIES:
                return
            entries.sort(key=lambda p: p.stat().st_mtime)
            for stale in entries[: len(entries) - MAX_ENTRIES]:
                stale.unlink(missing_ok=True)
        except OSError:
            return
