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


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # ModelScope (embedding — Qwen3-Embedding-0.6B via API)
    modelscope_api_key: str = ""

    # mimoTalk (primary LLM — required)
    mimotalk_api_key: str = ""
    mimotalk_base_url: str = "https://token-plan-sgp.xiaomimimo.com/anthropic/v1"
    mimotalk_model: str = "mimo-v2.5"

    demo_mode: bool = False

    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).parent / ".env"),
        extra="ignore",
    )


settings = Settings()
