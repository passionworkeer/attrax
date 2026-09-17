"""Configuration management using Pydantic Settings.

The module intentionally does not mutate process-wide proxy variables. HTTP
clients that must bypass a proxy should opt out on that client instance rather
than changing networking behavior for every dependency in the process.
"""

from __future__ import annotations

import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


# ── DeepSeek 降级供应商（2026-09-16）────────────────────────────────────────
# MiniMax 偶发不可用（超时 / 5xx / 401），单供应商会让整条扫描在第一步就失去
# 视觉证据、在第二步退回 mock 包。DeepSeek 承接两个降级通道：
#   - vision：OpenAI 兼容端点（/chat/completions），带图片块
#   - generate：Anthropic 兼容端点（/messages），prompt 本来就是 Anthropic 形状
DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com"
# 注意结尾的 /v1：生成器把 base 拼成 f"{base}/messages"（report_generator.py
# `_generate_mimotalk`），漏掉 /v1 会打到 /anthropic/messages 这个不存在的路径。
DEFAULT_DEEPSEEK_ANTHROPIC_BASE_URL = "https://api.deepseek.com/anthropic/v1"
DEFAULT_DEEPSEEK_MODEL = "deepseek-flash"
# deepseek-flash is a reasoning model: ``reasoning_content`` and the answer
# share one completion budget, and the reasoning spend swings with input size
# (measured 1.2k–4.9k tokens on a single nameplate photo; a full report package
# prompt needs ~20s at 4096 vs ~38s at 16384). Too small a budget returns
# HTTP 200 with EMPTY content — a silent "no answer" that looks like a provider
# outage. 16384 leaves room for reasoning + the JSON answer.
DEFAULT_DEEPSEEK_MAX_TOKENS = 16384


def _parse_trusted_proxies(raw: str) -> list[str]:
    return [proxy.strip().lower() for proxy in raw.split(",") if proxy.strip()]


def _parse_origins(raw: str) -> list[str]:
    return [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]


# ── 扫描入参常量（唯一来源，2026-09-10 审计 5.5 去重）─────────────────────────
# api/v1.py 与 application/scans.py 一律从这里 import，不得再各自定义。
# 2026-09-13 audit P0: the upload page exposes 16 markets
# (KR/CA/SG/MX/BR/DE/FR/IT in addition to the 8 in the legacy list). The
# BFF was silently filtering the extras and falling back to EU/US when
# the user picked only unsupported markets — that turned a deliberate
# "I want to sell in Korea" choice into "EU only" without telling them.
# Sync the backend allow-list with the frontend so the request survives
# validation; the scanner's KB still uses the original 8 as primary
# sources, the new 8 will fall through to "no applicable anchor found"
# (UNKNOWN, not REJECTED — surfaced honestly per spec §7.7).
ALLOWED_MARKETS: tuple[str, ...] = (
    "EU", "US", "UK", "CN", "AU", "SA", "AE", "JP",
    "KR", "CA", "SG", "MX", "BR", "DE", "FR", "IT",
)
MAX_MARKETS_PER_SCAN = 5


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    modelscope_api_key: str = ""

    # Provider-neutral primary LLM configuration. Legacy MiniMax/MimoTalk
    # names remain accepted below for existing deployments.
    llm_provider: str = ""
    llm_api_key: str = ""
    llm_base_url: str = ""
    llm_model: str = ""
    llm_thinking: str = ""
    llm_timeout_seconds: float = 240.0

    minimax_api_key: str = ""
    minimax_base_url: str = "https://api.minimaxi.com/anthropic/v1"
    minimax_model: str = "MiniMax-M3"

    mimotalk_api_key: str = ""
    mimotalk_base_url: str = ""
    mimotalk_model: str = ""

    # 降级通道（OpenAI 兼容 + Anthropic 兼容）。空 key = 未配置，降级关闭。
    deepseek_api_key: str = ""
    deepseek_base_url: str = DEFAULT_DEEPSEEK_BASE_URL
    deepseek_anthropic_base_url: str = DEFAULT_DEEPSEEK_ANTHROPIC_BASE_URL
    deepseek_model: str = DEFAULT_DEEPSEEK_MODEL
    deepseek_max_tokens: int = DEFAULT_DEEPSEEK_MAX_TOKENS

    @property
    def effective_llm_provider(self) -> str:
        if self.llm_provider.strip():
            return self.llm_provider.strip().lower()
        return "qwen" if self.effective_llm_model.lower().startswith("qwen") else "minimax"

    @property
    def effective_llm_api_key(self) -> str:
        return self.llm_api_key or self.minimax_api_key or self.mimotalk_api_key

    @property
    def effective_llm_base_url(self) -> str:
        if self.llm_base_url:
            return self.llm_base_url
        default = "https://api.minimaxi.com/anthropic/v1"
        if os.environ.get("MINIMAX_BASE_URL") or self.minimax_base_url != default:
            return self.minimax_base_url
        return self.mimotalk_base_url or default

    @property
    def effective_llm_model(self) -> str:
        if self.llm_model:
            return self.llm_model
        default = "MiniMax-M3"
        if os.environ.get("MINIMAX_MODEL") or self.minimax_model != default:
            return self.minimax_model
        return self.mimotalk_model or default

    # Compatibility properties for integrations importing the old names.
    @property
    def effective_minimax_api_key(self) -> str:
        return self.effective_llm_api_key

    @property
    def effective_minimax_base_url(self) -> str:
        return self.effective_llm_base_url

    @property
    def effective_minimax_model(self) -> str:
        return self.effective_llm_model

    @property
    def effective_deepseek_base_url(self) -> str:
        # An operator who writes ``DEEPSEEK_BASE_URL=`` (blank) means "unset",
        # not "relative URL" — an empty base would build "/chat/completions".
        return self.deepseek_base_url.strip().rstrip("/") or DEFAULT_DEEPSEEK_BASE_URL

    @property
    def effective_deepseek_anthropic_base_url(self) -> str:
        return (
            self.deepseek_anthropic_base_url.strip().rstrip("/")
            or DEFAULT_DEEPSEEK_ANTHROPIC_BASE_URL
        )

    @property
    def effective_deepseek_model(self) -> str:
        return self.deepseek_model.strip() or DEFAULT_DEEPSEEK_MODEL

    @property
    def effective_deepseek_max_tokens(self) -> int:
        return self.deepseek_max_tokens if self.deepseek_max_tokens > 0 else DEFAULT_DEEPSEEK_MAX_TOKENS

    @property
    def vision_fallback_configured(self) -> bool:
        return bool(self.deepseek_api_key.strip())

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

    # Plan 2026-09-13 §10.4: 发布写入 ATTRAX_BUILD_SHA。pydantic-settings
    # reads it from rag_service/.env (deployed) or the process env — either
    # path works, so `pm2 restart` (which preserves env) is enough and the
    # delete&&start env dance is not required just to stamp the version.
    build_sha: str = os.environ.get("ATTRAX_BUILD_SHA", "")

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
os.environ.setdefault("LLM_PROVIDER", settings.effective_llm_provider)
os.environ.setdefault("LLM_API_KEY", settings.effective_llm_api_key)
os.environ.setdefault("LLM_BASE_URL", settings.effective_llm_base_url)
os.environ.setdefault("LLM_MODEL", settings.effective_llm_model)
os.environ.setdefault("LLM_THINKING", settings.llm_thinking)
os.environ.setdefault("LLM_TIMEOUT_SECONDS", str(settings.llm_timeout_seconds))
os.environ.setdefault("MINIMAX_API_KEY", settings.effective_minimax_api_key)
os.environ.setdefault("MINIMAX_BASE_URL", settings.effective_minimax_base_url)
os.environ.setdefault("MINIMAX_MODEL", settings.effective_minimax_model)
# Same bridge for the vision fallback provider: ``resolve_deepseek_config``
# re-reads the process env only, so the .env-file values must land there.
os.environ.setdefault("DEEPSEEK_API_KEY", settings.deepseek_api_key)
os.environ.setdefault("DEEPSEEK_BASE_URL", settings.effective_deepseek_base_url)
os.environ.setdefault(
    "DEEPSEEK_ANTHROPIC_BASE_URL", settings.effective_deepseek_anthropic_base_url
)
os.environ.setdefault("DEEPSEEK_MODEL", settings.effective_deepseek_model)
os.environ.setdefault(
    "DEEPSEEK_MAX_TOKENS", str(settings.effective_deepseek_max_tokens)
)


def resolve_deepseek_config(api_key: str | None = None) -> tuple[str, str, str, int, str]:
    """Resolve the DeepSeek fallback provider (both compatible endpoints).

    Returns ``(api_key, openai_base_url, model, max_tokens, anthropic_base_url)``.
    ``None`` means "use configured credentials"; an explicit empty string is a
    deliberate no-network override (same contract as ``resolve_minimax_config``).
    The budget is larger than the primary provider's because reasoning tokens
    share the completion budget (see ``DEFAULT_DEEPSEEK_MAX_TOKENS``).
    """
    current = Settings(_env_file=None)
    return (
        current.deepseek_api_key if api_key is None else api_key,
        current.effective_deepseek_base_url,
        current.effective_deepseek_model,
        current.effective_deepseek_max_tokens,
        current.effective_deepseek_anthropic_base_url,
    )


def resolve_llm_config(api_key: str | None = None) -> tuple[str, str, str]:
    """Resolve provider-neutral primary config with legacy aliases."""
    current = Settings(_env_file=None)
    return (
        current.effective_llm_api_key if api_key is None else api_key,
        current.effective_llm_base_url,
        current.effective_llm_model,
    )


def resolve_llm_provider() -> str:
    return Settings(_env_file=None).effective_llm_provider


def resolve_llm_thinking() -> str:
    return Settings(_env_file=None).llm_thinking.strip().lower()


def resolve_llm_timeout_seconds() -> float:
    return min(600.0, max(10.0, Settings(_env_file=None).llm_timeout_seconds))


def resolve_minimax_config(api_key: str | None = None) -> tuple[str, str, str]:
    """Deprecated compatibility alias for external imports."""
    return resolve_llm_config(api_key)
