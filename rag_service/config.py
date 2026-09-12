"""Configuration management using Pydantic Settings.

The module intentionally does not mutate process-wide proxy variables. HTTP
clients that must bypass a proxy should opt out on that client instance rather
than changing networking behavior for every dependency in the process.
"""

from __future__ import annotations

import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


def _parse_trusted_proxies(raw: str) -> list[str]:
    return [proxy.strip().lower() for proxy in raw.split(",") if proxy.strip()]


def _parse_origins(raw: str) -> list[str]:
    return [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]


# ── 扫描入参常量（唯一来源，2026-09-10 审计 5.5 去重）─────────────────────────
# api/v1.py 与 application/scans.py 一律从这里 import，不得再各自定义。
ALLOWED_MARKETS: tuple[str, ...] = ("EU", "US", "UK", "CN", "AU", "SA", "AE", "JP")
MAX_MARKETS_PER_SCAN = 5


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    modelscope_api_key: str = ""

    minimax_api_key: str = ""
    minimax_base_url: str = "https://api.minimaxi.com/anthropic/v1"
    minimax_model: str = "MiniMax-M3"

    mimotalk_api_key: str = ""
    mimotalk_base_url: str = ""
    mimotalk_model: str = ""

    @property
    def effective_minimax_api_key(self) -> str:
        return self.minimax_api_key or self.mimotalk_api_key

    @property
    def effective_minimax_base_url(self) -> str:
        default = "https://api.minimaxi.com/anthropic/v1"
        if os.environ.get("MINIMAX_BASE_URL") or self.minimax_base_url != default:
            return self.minimax_base_url
        return self.mimotalk_base_url or default

    @property
    def effective_minimax_model(self) -> str:
        default = "MiniMax-M3"
        if os.environ.get("MINIMAX_MODEL") or self.minimax_model != default:
            return self.minimax_model
        return self.mimotalk_model or default

    demo_mode: bool = False

    runtime_data_dir: Path = Path(
        os.environ.get(
            "ATTRAX_RUNTIME_DIR",
            str(Path(__file__).parent.parent / "data" / "backend"),
        )
    )

    allowed_origins: list[str] = _parse_origins(
        os.environ.get(
            "RAG_ALLOWED_ORIGINS",
            "http://localhost:3000,http://127.0.0.1:3000",
        )
    )

    trusted_proxies: list[str] = _parse_trusted_proxies(
        os.environ.get("RAG_TRUSTED_PROXIES", "127.0.0.1,::1")
    )

    scan_worker_concurrency: int = int(
        os.environ.get("SCAN_WORKER_CONCURRENCY", "5")
    )

    rag_internal_secret: str = os.environ.get("RAG_INTERNAL_SECRET", "")

    app_env: str = os.environ.get(
        "ENV", os.environ.get("NODE_ENV", "")
    ).strip().lower()

    allow_insecure: bool = os.environ.get(
        "RAG_ALLOW_INSECURE", ""
    ).strip().lower() in ("1", "true", "yes", "on")

    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).parent / ".env"),
        extra="ignore",
    )


settings = Settings()


# De-RAG §7.7: the FAISS index-bundle validation is deleted together with
# the retrieval stack — there is no index to validate anymore.


# Legacy lower-level clients still read these names directly. setdefault only
# fills absent values and does not overwrite an operator's process environment.
os.environ.setdefault("MODELSCOPE_API_KEY", settings.modelscope_api_key)
os.environ.setdefault("MINIMAX_API_KEY", settings.effective_minimax_api_key)
os.environ.setdefault("MINIMAX_BASE_URL", settings.effective_minimax_base_url)
os.environ.setdefault("MINIMAX_MODEL", settings.effective_minimax_model)


def resolve_minimax_config(api_key: str | None = None) -> tuple[str, str, str]:
    """Resolve current process settings, preferring MINIMAX_* over aliases."""
    current = Settings(_env_file=None)
    return (
        # ``None`` means "use configured credentials". An explicit empty
        # string is a deliberate no-network override used by fallback paths
        # and tests; treating it as falsy silently reloaded the operator's
        # local key and could issue an unintended LLM request.
        current.effective_minimax_api_key if api_key is None else api_key,
        current.effective_minimax_base_url,
        current.effective_minimax_model,
    )
