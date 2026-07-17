from rag_service.config import Settings


def _clear_provider_env(monkeypatch):
    for name in (
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
    from rag_service.orchestrator.nodes.vision import VisionAnalyzer

    vision = VisionAnalyzer(api_key="test-key")
    generator = ReportGenerator(api_key="test-key")

    assert vision.base_url == "https://api.minimaxi.com/anthropic/v1"
    assert generator.base_url == vision.base_url
    assert vision.model == "MiniMax-M3"
    assert generator.model == vision.model
