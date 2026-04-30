"""Configuration management using Pydantic Settings."""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    cohere_api_key: str = ""
    modelscope_api_key: str = ""
    anthropic_api_key: str = ""
    demo_mode: bool = False

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()