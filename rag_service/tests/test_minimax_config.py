from rag_service.config import Settings


def _clear_provider_env(monkeypatch):
    for name in (
        "LLM_PROVIDER",
        "LLM_API_KEY",
        "LLM_BASE_URL",
        "LLM_MODEL",
        "LLM_THINKING",
        "LLM_TIMEOUT_SECONDS",
        "MINIMAX_API_KEY",
        "MINIMAX_BASE_URL",
        "MINIMAX_MODEL",
        "MIMOTALK_API_KEY",
        "MIMOTALK_BASE_URL",
        "MIMOTALK_MODEL",
    ):
        monkeypatch.delenv(name, raising=False)


def test_minimax_defaults(monkeypatch):
    _clear_provider_env(monkeypatch)

    settings = Settings(_env_file=None)

    assert settings.minimax_base_url == "https://api.minimaxi.com/anthropic/v1"
    assert settings.minimax_model == "MiniMax-M3"
    assert settings.effective_llm_provider == "minimax"
    assert settings.effective_llm_base_url == "https://api.minimaxi.com/anthropic/v1"
    assert settings.effective_llm_model == "MiniMax-M3"


def test_provider_neutral_variables_take_priority(monkeypatch):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "qwen")
    monkeypatch.setenv("LLM_API_KEY", "qwen-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://dashscope.example/anthropic/v1")
    monkeypatch.setenv("LLM_MODEL", "qwen3.8-flash")
    monkeypatch.setenv("LLM_THINKING", "disabled")
    monkeypatch.setenv("LLM_TIMEOUT_SECONDS", "180")
    monkeypatch.setenv("MINIMAX_API_KEY", "minimax-key")

    settings = Settings(_env_file=None)

    assert settings.effective_llm_provider == "qwen"
    assert settings.effective_llm_api_key == "qwen-key"
    assert settings.effective_llm_base_url == "https://dashscope.example/anthropic/v1"
    assert settings.effective_llm_model == "qwen3.8-flash"
    assert settings.llm_thinking == "disabled"
    assert settings.llm_timeout_seconds == 180


def test_llm_timeout_is_bounded(monkeypatch):
    _clear_provider_env(monkeypatch)
    from rag_service.config import resolve_llm_timeout_seconds

    monkeypatch.setenv("LLM_TIMEOUT_SECONDS", "2")
    assert resolve_llm_timeout_seconds() == 10
    monkeypatch.setenv("LLM_TIMEOUT_SECONDS", "999")
    assert resolve_llm_timeout_seconds() == 600


def test_new_minimax_variables_take_priority(monkeypatch):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("MINIMAX_API_KEY", "new-key")
    monkeypatch.setenv("MIMOTALK_API_KEY", "legacy-key")
    monkeypatch.setenv("MINIMAX_BASE_URL", "https://new.example/v1")
    monkeypatch.setenv("MIMOTALK_BASE_URL", "https://legacy.example/v1")
    monkeypatch.setenv("MINIMAX_MODEL", "MiniMax-New")
    monkeypatch.setenv("MIMOTALK_MODEL", "legacy-model")

    settings = Settings(_env_file=None)

    assert settings.effective_minimax_api_key == "new-key"
    assert settings.effective_minimax_base_url == "https://new.example/v1"
    assert settings.effective_minimax_model == "MiniMax-New"
    assert settings.effective_llm_api_key == "new-key"


def test_legacy_mimotalk_variables_are_supported(monkeypatch):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("MIMOTALK_API_KEY", "legacy-key")
    monkeypatch.setenv("MIMOTALK_BASE_URL", "https://legacy.example/v1")
    monkeypatch.setenv("MIMOTALK_MODEL", "legacy-model")

    settings = Settings(_env_file=None)

    assert settings.effective_minimax_api_key == "legacy-key"
    assert settings.effective_minimax_base_url == "https://legacy.example/v1"
    assert settings.effective_minimax_model == "legacy-model"


def test_vision_and_report_generator_share_minimax_defaults(monkeypatch):
    _clear_provider_env(monkeypatch)
    from rag_service.generate.report_generator import ReportGenerator
    from rag_service.pipeline.nodes.vision import VisionAnalyzer

    vision = VisionAnalyzer(api_key="test-key")
    generator = ReportGenerator(api_key="test-key")

    assert vision.base_url == "https://api.minimaxi.com/anthropic/v1"
    assert generator.base_url == vision.base_url
    assert vision.model == "MiniMax-M3"
    assert generator.model == vision.model
    assert vision.provider == "minimax"
    assert generator.provider == "minimax"


def test_vision_and_report_generator_share_qwen_config(monkeypatch):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "qwen")
    monkeypatch.setenv("LLM_BASE_URL", "https://dashscope.example/anthropic/v1")
    monkeypatch.setenv("LLM_MODEL", "qwen3.8-flash")
    from rag_service.generate.report_generator import ReportGenerator
    from rag_service.pipeline.nodes.vision import VisionAnalyzer

    vision = VisionAnalyzer(api_key="test-key")
    generator = ReportGenerator(api_key="test-key")

    assert vision.base_url == "https://dashscope.example/anthropic/v1"
    assert generator.base_url == vision.base_url
    assert vision.model == "qwen3.8-flash"
    assert generator.provider == "qwen"
