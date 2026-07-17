"""Configuration management using Pydantic Settings."""
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# CRITICAL: Disable system proxy BEFORE any HTTP calls (avoids WinError 10060)
import os as _os
_os.environ.pop("HTTP_PROXY", None)
_os.environ.pop("HTTPS_PROXY", None)
_os.environ.pop("http_proxy", None)
_os.environ.pop("https_proxy", None)
_os.environ["NO_PROXY"] = "*"


def _parse_trusted_proxies(raw: str) -> list[str]:
    """Parse comma-separated trusted proxy list into a normalized set."""
    return [p.strip().lower() for p in raw.split(",") if p.strip()]


def _parse_origins(raw: str) -> list[str]:
    """Parse an explicit comma-separated browser origin allowlist."""
    return [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # ModelScope (embedding — Qwen3-Embedding-0.6B via API)
    modelscope_api_key: str = ""

    # mimoTalk (primary LLM — required)
    # MiniMax-M3 via its Anthropic-compatible endpoint. MIMOTALK_* remains a
    # read-only compatibility alias for existing deployments.
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
        if _os.environ.get("MINIMAX_BASE_URL") or self.minimax_base_url != default:
            return self.minimax_base_url
        return self.mimotalk_base_url or default

    @property
    def effective_minimax_model(self) -> str:
        default = "MiniMax-M3"
        if _os.environ.get("MINIMAX_MODEL") or self.minimax_model != default:
            return self.minimax_model
        return self.mimotalk_model or default

    demo_mode: bool = False

    # Persistent state owned by the standalone API (sessions/jobs/uploads).
    runtime_data_dir: Path = Path(
        _os.environ.get(
            "ATTRAX_RUNTIME_DIR",
            str(Path(__file__).parent.parent / "data" / "backend"),
        )
    )

    # Browser clients call FastAPI directly after frontend replacement.
    allowed_origins: list[str] = _parse_origins(
        _os.environ.get(
            "RAG_ALLOWED_ORIGINS",
            "http://localhost:3000,http://127.0.0.1:3000",
        )
    )

    # Trusted reverse-proxy IPs allowed to set X-Forwarded-For.
    # Only requests whose socket peer is in this list will have XFF honored
    # for client-IP extraction (rate limiting). Defaults to loopback only.
    trusted_proxies: list[str] = _parse_trusted_proxies(
        _os.environ.get("RAG_TRUSTED_PROXIES", "127.0.0.1,::1")
    )

    # Number of worker threads for the scan executor. Default 8 so the
    # 8-market fan-out (EU/US/UK/CN/AU/SA/AE/JP/...) does not serialize
    # behind a single in-flight scan; overridden via SCAN_WORKER_CONCURRENCY.
    scan_worker_concurrency: int = int(
        _os.environ.get("SCAN_WORKER_CONCURRENCY", "8")
    )

    # Optional shared secret for internal write endpoints (/scan,
    # /scan-multipart, /profit-report). When set, requests must carry the
    # header `X-Internal-Secret` with a matching value or receive 401.
    #
    # FAIL-CLOSED policy (enforced at startup in main.lifespan):
    #   - demo_mode=True            → lenient, open (dev/demo).
    #   - non-demo + secret set     → gated (correct production posture).
    #   - non-demo + secret empty   → service refuses to start when
    #     app_env is production, otherwise an ephemeral secret is generated
    #     so endpoints fail closed (401) instead of fail open. Setting
    #     RAG_ALLOW_INSECURE=true is the only explicit opt-out to fail open.
    rag_internal_secret: str = _os.environ.get("RAG_INTERNAL_SECRET", "")

    # Deployment environment marker. "production"/"prod" makes the missing
    # internal-secret check fatal (the service refuses to start) instead of
    # auto-generating an ephemeral secret. Reads ENV first, then NODE_ENV.
    app_env: str = _os.environ.get(
        "ENV", _os.environ.get("NODE_ENV", "")
    ).strip().lower()

    # Explicit opt-out of the fail-closed internal-secret policy. Only honor
    # truthy string values. Leaves write endpoints OPEN with a loud warning.
    allow_insecure: bool = _os.environ.get(
        "RAG_ALLOW_INSECURE", ""
    ).strip().lower() in ("1", "true", "yes", "on")

    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).parent / ".env"),
        extra="ignore",
    )


settings = Settings()

# ─── Bridge: settings → os.environ ───────────────────────────────────────────
# ModelScopeEmbedder / mimoTalk clients read os.environ directly.
# When .env is the only source (local builds, tests), Settings is populated
# but os.environ is empty, so the embedder raises "MODELSCOPE_API_KEY is not
# configured". In Docker, env vars are pre-set, so setdefault is a no-op.
import os as _bridge
_bridge.environ.setdefault("MODELSCOPE_API_KEY", settings.modelscope_api_key)
_bridge.environ.setdefault("MINIMAX_API_KEY", settings.effective_minimax_api_key)
_bridge.environ.setdefault("MINIMAX_BASE_URL", settings.effective_minimax_base_url)
_bridge.environ.setdefault("MINIMAX_MODEL", settings.effective_minimax_model)


def resolve_minimax_config(api_key: str | None = None) -> tuple[str, str, str]:
    """Resolve current process settings, preferring MINIMAX_* over aliases."""
    current = Settings(_env_file=None)
    return (
        api_key or current.effective_minimax_api_key,
        current.effective_minimax_base_url,
        current.effective_minimax_model,
    )
