"""Regression coverage for selectively integrated upstream fixes."""
from threading import Event
from unittest.mock import patch
import pytest
from rag_service.pipeline.nodes.vision import VisionAnalyzer
from rag_service.pipeline.nodes.findings_builder import build_findings

@pytest.mark.parametrize("reverse", [False, True])
def test_clean_description_cannot_hide_another_images_real_defect(reverse):
    clean = dict(observationId="clean", checkId="common.defects.visible", visibility="present_readable", description="No visible cracks or damage")
    defect = dict(observationId="crack", checkId="common.defects.visible", visibility="present_readable", description="A deep crack crosses the casing")
    observations = [clean, defect] if not reverse else [defect, clean]
    findings = build_findings(session_id="regression", category="electronics", observations=observations)
    assert any(f["assessment"] == "suspected_issue" and f["observationIds"] == ["crack"] for f in findings)
    assert clean["visibility"] == "present_readable"

def test_legacy_parallel_results_keep_upload_order():
    analyzer = VisionAnalyzer(api_key="test-only")
    second_done = Event()
    def analyze(buf, mime):
        if buf == b"first":
            assert second_done.wait(2)
        else:
            second_done.set()
        return {"description": buf.decode(), "issues": [{"title": buf.decode()}], "certifications": []}
    with patch.object(analyzer, "analyze_single_image", side_effect=analyze):
        result = analyzer.analyze_images([{"buffer": b"first"}, {"buffer": b"second"}])
    assert result["descriptions"] == ["first", "second"]
    assert [(v["title"], v["image_index"]) for v in result["issues"]] == [("first", 0), ("second", 1)]
