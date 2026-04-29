"""Configuration management using Pydantic Settings."""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    cohere_api_key: str = ""
    anthropic_api_key: str = ""
    qdrant_host: str = "localhost"
    qdrant_port: int = 6333
    demo_mode: bool = False

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()