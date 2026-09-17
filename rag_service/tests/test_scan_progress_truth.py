from rag_service.pipeline import runner


def test_runner_reports_reuse_and_does_not_finish_applicability_before_work(monkeypatch):
    events = []
    monkeypatch.setattr(runner, "vision_analysis_node", lambda state: {"vision_result": {"cache_hits": 2}})
    def generate(state, on_generation_start):
        assert not any(stage == "applicability" and phase.startswith("done") for stage, phase, _ in events)
        on_generation_start()
        return {"generation": "report"}
    monkeypatch.setattr(runner, "generator_node", generate)
    monkeypatch.setattr(runner, "verifier_node", lambda state: {})
    runner.run_compliance_graph("test", progress_callback=lambda *event: events.append(event))
    assert ("generate", "running|cache_hits=2", 36) in events
    assert ("verify", "running|cache_hits=2", 83) in events


def test_cache_hit_is_observed_and_propagated_to_single_image_result(monkeypatch, tmp_path):
    import json
    from rag_service.pipeline.nodes import vision
    from rag_service.verify.vision_cache import VisionResponseCache
    analyzer = object.__new__(vision.VisionAnalyzer)
    analyzer.api_key = "test"
    analyzer.model = "test-model"
    monkeypatch.setattr(analyzer, "_looks_like_image", lambda *args: True)
    calls = []
    def respond(*args, **kwargs):
        calls.append(1)
        return json.dumps({"description": "label", "certifications": [], "observations": [{"checkId": "common.brand_model", "status": "present_readable", "observedText": "Model A"}]})
    monkeypatch.setattr(analyzer, "_call_llm", respond)
    monkeypatch.setattr(vision, "_vision_cache", VisionResponseCache(tmp_path))
    images = [{"buffer": b"image", "mime_type": "image/png"}]
    checks = [{"id": "common.brand_model", "title": "Model"}]
    first = analyzer.analyze_images_with_checks(images, checks)
    second = analyzer.analyze_images_with_checks(images, checks)
    assert first["cache_hits"] == 0
    assert second["cache_hits"] == 1
    assert len(calls) == 1
