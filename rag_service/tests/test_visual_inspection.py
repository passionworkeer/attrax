"""Tests for the visual inspection v2 data model + grounding verifier + profile loader.

Plan 2026-09-13 §5/§6/§7.1 — these tests pin the core contract invariants:
- bbox bounds enforcement (reject, not silently clip, gross violations)
- not_assessed backfill for every selected check
- profile extends + visual/deferred split
- observation id identity (session + image)
"""
from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from rag_service.schemas.visual_inspection import (
    BboxRegion,
    Finding,
    InspectionCheckResult,
    Observation,
    backfill_not_assessed,
)
from rag_service.verify.grounding import (
    annotate_verification,
    validate_bbox_values,
    verify_observations,
)
from rag_service.pipeline.nodes.visual_checks import (
    effective_checks,
    visual_check_ids,
    deferred_evidence_checks,
    load_profile,
)
from rag_service.pipeline.nodes.vision import VisionAnalyzer


def test_multi_image_checklist_retries_only_empty_image_once():
    analyzer = object.__new__(VisionAnalyzer)
    analyzer.api_key = "test-key"
    calls: dict[bytes, int] = {}

    def fake_analyze(image_data, _mime_type, _checks):
        calls[image_data] = calls.get(image_data, 0) + 1
        if image_data == b"nameplate" and calls[image_data] == 1:
            return {"description": "", "certifications": [], "observations": []}
        return {
            "description": image_data.decode("ascii"),
            "certifications": [],
            "observations": [
                {
                    "check_id": "common.product.overview",
                    "visibility": "present_readable",
                    "description": image_data.decode("ascii"),
                    "bbox": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2},
                }
            ],
        }

    analyzer.analyze_single_image_with_checks = fake_analyze
    result = analyzer.analyze_images_with_checks(
        [
            {"buffer": b"overall", "mimeType": "image/jpeg"},
            {"buffer": b"nameplate", "mimeType": "image/jpeg"},
            {"buffer": b"ports", "mimeType": "image/jpeg"},
        ],
        [{"id": "common.product.overview", "title": "产品整体"}],
        session_id="scan_retry",
    )

    assert calls == {b"overall": 1, b"nameplate": 2, b"ports": 1}
    assert [item["imageIndex"] for item in result["observations"]] == [0, 1, 2]


class TestBboxRegion:
    def test_valid_bbox(self):
        region = BboxRegion(x=0.1, y=0.2, w=0.3, h=0.4)
        assert region.x + region.w <= 1.0
        assert region.y + region.h <= 1.0

    def test_rejects_x_plus_w_overflow(self):
        with pytest.raises(ValidationError):
            BboxRegion(x=0.8, y=0.1, w=0.5, h=0.2)

    def test_rejects_y_plus_h_overflow(self):
        with pytest.raises(ValidationError):
            BboxRegion(x=0.1, y=0.8, w=0.2, h=0.5)

    def test_rejects_zero_or_negative_extent(self):
        with pytest.raises(ValidationError):
            BboxRegion(x=0.1, y=0.1, w=0, h=0.2)
        with pytest.raises(ValidationError):
            BboxRegion(x=0.1, y=0.1, w=0.2, h=-0.1)

    def test_rejects_out_of_range_origin(self):
        with pytest.raises(ValidationError):
            BboxRegion(x=-0.1, y=0.1, w=0.2, h=0.2)

    def test_rounding_tolerance_ok(self):
        # 1e-9-level float noise must not raise (model emits 0.30000000000000004)
        region = BboxRegion(x=0.7, y=0.1, w=0.3000000000000001, h=0.2)
        assert region.w > 0


class TestValidateBboxValues:
    def test_accepts_and_normalizes(self):
        normalized, reason = validate_bbox_values({"x": 0.1, "y": 0.1, "w": 0.5, "h": 0.3})
        assert reason is None
        assert normalized == {"x": 0.1, "y": 0.1, "w": 0.5, "h": 0.3}

    def test_clamps_rounding_overshoot(self):
        normalized, reason = validate_bbox_values({"x": 0.7, "y": 0.0, "w": 0.30000000000000004, "h": 0.2})
        assert reason is None
        assert normalized["x"] + normalized["w"] <= 1.0

    def test_rejects_gross_overflow(self):
        normalized, reason = validate_bbox_values({"x": 0.9, "y": 0.1, "w": 0.5, "h": 0.2})
        assert normalized is None
        assert "exceeds" in (reason or "")

    def test_rejects_non_numeric(self):
        normalized, reason = validate_bbox_values({"x": "abc", "y": 0.1, "w": 0.2, "h": 0.2})
        assert normalized is None
        assert reason

    def test_accepts_width_height_keys(self):
        normalized, reason = validate_bbox_values({"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.2})
        assert reason is None
        assert normalized["w"] == 0.2


class TestVerifyObservations:
    def test_accepts_regionless_observation(self):
        report = verify_observations(
            [
                {
                    "observationId": "o1",
                    "checkId": "common.nameplate.readability",
                    "imageId": "vision-image-0",
                    "visibility": "not_in_view",
                    "region": None,
                }
            ],
            known_image_ids={"vision-image-0"},
        )
        assert report.accepted == ["o1"]
        assert report.rejected == []

    def test_rejects_unknown_image_id(self):
        report = verify_observations(
            [
                {
                    "observationId": "o1",
                    "checkId": "c",
                    "imageId": "vision-image-9",
                    "region": None,
                }
            ],
            known_image_ids={"vision-image-0"},
        )
        assert report.accepted == []
        assert report.rejected[0].reason.startswith("unknown imageId")

    def test_rejects_bad_bbox(self):
        report = verify_observations(
            [
                {
                    "observationId": "o1",
                    "checkId": "c",
                    "imageId": "vision-image-0",
                    "region": {"kind": "bbox", "bbox": {"x": 0.9, "y": 0.9, "w": 0.5, "h": 0.5}},
                }
            ],
            known_image_ids={"vision-image-0"},
        )
        assert report.accepted == []
        assert report.rejected[0].reason

    def test_deduplicates_same_check_and_image(self):
        report = verify_observations(
            [
                {
                    "observationId": "o1",
                    "checkId": "c",
                    "imageId": "vision-image-0",
                    "region": {"kind": "bbox", "bbox": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2}},
                },
                {
                    "observationId": "o2",
                    "checkId": "c",
                    "imageId": "vision-image-0",
                    "region": {"kind": "bbox", "bbox": {"x": 0.5, "y": 0.5, "w": 0.2, "h": 0.2}},
                },
            ],
            known_image_ids={"vision-image-0"},
        )
        assert report.accepted == ["o1"]
        assert report.deduplicated == ["o2"]

    def test_keeps_distinct_visible_marks_for_same_check_and_image(self):
        report = verify_observations(
            [
                {
                    "observationId": "mark-ce",
                    "checkId": "common.certification_marks.visible",
                    "imageId": "vision-image-0",
                    "observedText": "CE",
                    "region": {"kind": "bbox", "bbox": {"x": 0.1, "y": 0.1, "w": 0.1, "h": 0.1}},
                },
                {
                    "observationId": "mark-fcc",
                    "checkId": "common.certification_marks.visible",
                    "imageId": "vision-image-0",
                    "observedText": "FCC",
                    "region": {"kind": "bbox", "bbox": {"x": 0.3, "y": 0.1, "w": 0.1, "h": 0.1}},
                },
                {
                    "observationId": "mark-ukca",
                    "checkId": "common.certification_marks.visible",
                    "imageId": "vision-image-0",
                    "observedText": "UKCA",
                    "region": {"kind": "bbox", "bbox": {"x": 0.5, "y": 0.1, "w": 0.1, "h": 0.1}},
                },
            ],
            known_image_ids={"vision-image-0"},
        )

        assert report.accepted == ["mark-ce", "mark-fcc", "mark-ukca"]
        assert report.deduplicated == []

    def test_annotate_verification_normalizes_bbox(self):
        observations = [
            {
                "observationId": "o1",
                "checkId": "c",
                "imageId": "vision-image-0",
                "region": {
                    "kind": "bbox",
                    "bbox": {"x": 0.7, "y": 0.1, "w": 0.30000000000000004, "h": 0.2},
                },
            },
            {
                "observationId": "o2",
                "checkId": "c2",
                "imageId": "vision-image-0",
                "region": {"kind": "bbox", "bbox": {"x": 0.9, "y": 0.1, "w": 0.5, "h": 0.2}},
            },
        ]
        report = verify_observations(observations, known_image_ids={"vision-image-0"})
        annotated = annotate_verification(observations, report)
        assert [o["observationId"] for o in annotated] == ["o1"]
        assert annotated[0]["region"]["verified"] is True
        assert annotated[0]["region"]["bbox"]["x"] + annotated[0]["region"]["bbox"]["w"] <= 1.0


class TestBackfillNotAssessed:
    def test_backfills_missing_checks(self):
        results = [
            InspectionCheckResult(check_id="a", visibility="present_readable"),
        ]
        backfilled = backfill_not_assessed(results, ["a", "b", "c"])
        assert {r.check_id for r in backfilled} == {"a", "b", "c"}
        missing = [r for r in backfilled if r.check_id in {"b", "c"}]
        assert all(r.visibility == "not_assessed" for r in missing)
        assert all(r.applicability == "needs_confirmation" for r in missing)

    def test_no_duplicates_when_all_returned(self):
        results = [
            InspectionCheckResult(check_id="a"),
            InspectionCheckResult(check_id="b"),
        ]
        assert len(backfill_not_assessed(results, ["a", "b"])) == 2


class TestProfiles:
    def test_common_profile_loads(self):
        profile = load_profile("common")
        assert profile.profile_id == "common"
        assert len(profile.checks) >= 5

    def test_category_extends_common(self):
        electronics = effective_checks("electronics")
        ids = [check.id for check in electronics]
        assert any(check_id.startswith("electronics.") for check_id in ids)
        assert "common.nameplate.readability" in ids

    def test_common_profile_includes_individually_grounded_certification_marks(self):
        common = effective_checks("other")
        check = next(
            item for item in common
            if item.id == "common.certification_marks.visible"
        )
        assert check.semantic == "record_only"
        assert {"vision", "ocr"} <= set(check.methods)

    def test_aliases_map(self):
        assert load_profile("toys").profile_id == "toy"
        assert {c.id for c in effective_checks("batteries")} >= {
            "battery.label.parameters"
        }

    def test_visual_deferred_split(self):
        visual = visual_check_ids("toy")
        deferred = deferred_evidence_checks("toy")
        # lab tests are never visual
        assert all("test" not in check_id or check_id in visual for check_id in visual)
        assert {c.id for c in deferred} >= {
            "toy.mechanical_physical.test",
            "toy.chemical_migration.test",
        }
        assert not ({c.id for c in deferred} & set(visual))

    def test_unknown_category_falls_back_to_other(self):
        checks = effective_checks("nonexistent-category")
        assert all(check.id.startswith(("common.", "other.")) for check in checks)

    def test_all_ten_categories_have_profiles(self):
        for category in [
            "electronics", "appliance", "3c", "toy", "home",
            "battery", "cosmetic", "textile", "food_contact", "other",
        ]:
            checks = effective_checks(category)
            assert len(checks) > 0, f"{category} has no checks"
            # every category must see the common baseline
            assert "common.nameplate.readability" in {c.id for c in checks}


class TestObservationModel:
    def test_region_none_is_valid(self):
        obs = Observation(
            observation_id="o1",
            check_id="c",
            image_id="vision-image-0",
            visibility="not_in_view",
        )
        assert obs.region is None

    def test_finding_requires_assessment(self):
        finding = Finding(
            finding_id="f1",
            check_id="c",
            title="缺 CE 标识",
            assessment="evidence_needed",
        )
        assert finding.assessment == "evidence_needed"
        with pytest.raises(ValidationError):
            Finding(
                finding_id="f2",
                check_id="c",
                title="x",
                assessment="no_issue_observed",  # findings are never clean
            )


class TestVisionTextObservationsPassthrough:
    """Production regression (scan_20685100..., 2026-09-13): the model
    returned a perfect per-check observations array, but
    _parse_vision_text's structured branch dropped the key — every check
    then backfilled to not_assessed and the result page showed an empty
    checklist. The observations array must pass through raw."""

    def test_structured_parse_keeps_observations(self):
        from rag_service.pipeline.nodes.vision import _parse_vision_text

        raw = json.dumps(
            {
                "product_type": "65W GaN USB 充电器",
                "identity_confidence": "high",
                "core_features": ["白色外壳"],
                "visible_certification_marks": [],
                "questions_needed": [],
                "observations": [
                    {
                        "check_id": "electronics.interface.plug_pins",
                        "visibility": "present_readable",
                        "observed_text": "USB-C1 / USB-C2 / USB-A",
                        "description": "端面可见三个接口",
                        "bbox": {"x": 0.3, "y": 0.4, "w": 0.2, "h": 0.15},
                    },
                    {
                        "check_id": "common.nameplate.readability",
                        "visibility": "not_in_view",
                        "observed_text": None,
                        "description": "铭牌可能在未拍摄面",
                        "bbox": None,
                    },
                ],
            },
            ensure_ascii=False,
        )
        parsed = _parse_vision_text(raw, raw)
        assert isinstance(parsed.get("observations"), list)
        assert len(parsed["observations"]) == 2

    def test_checklist_observations_parse_real_model_shape(self):
        from rag_service.pipeline.nodes.vision import _parse_checklist_observations

        model_result = {
            "observations": [
                {
                    "check_id": "electronics.interface.plug_pins",
                    "visibility": "present_readable",
                    "observed_text": "USB-C1 / USB-C2 / USB-A",
                    "description": "端面可见三个接口",
                    "bbox": {"x": 0.3, "y": 0.4, "w": 0.2, "h": 0.15},
                },
                {
                    "check_id": "common.nameplate.readability",
                    "visibility": "not_in_view",
                    "observed_text": None,
                    "description": "铭牌可能在未拍摄面",
                    "bbox": None,
                },
            ]
        }
        parsed = _parse_checklist_observations(
            model_result,
            image_index=0,
            session_id="scan_test",
            selected_check_ids=[
                "electronics.interface.plug_pins",
                "common.nameplate.readability",
                "common.brand_model.visible",
            ],
        )
        by_check = {entry["checkId"]: entry for entry in parsed}
        assert by_check["electronics.interface.plug_pins"]["visibility"] == "present_readable"
        assert by_check["electronics.interface.plug_pins"]["region"]["bbox"] == {
            "x": 0.3, "y": 0.4, "w": 0.2, "h": 0.15,
        }
        assert by_check["common.nameplate.readability"]["region"] is None
        # The check the model skipped is backfilled, not dropped.
        assert by_check["common.brand_model.visible"]["visibility"] == "not_assessed"

    def test_visible_marks_expand_to_individual_grounded_observations(self):
        from rag_service.pipeline.nodes.vision import (
            _parse_checklist_observations,
            _parse_vision_text,
        )

        raw = json.dumps(
            {
                "product_type": "移动电源",
                "identity_confidence": "high",
                "visible_certification_marks": ["CE", "FCC", "UKCA"],
                "visible_marks": [
                    {
                        "mark": "CE",
                        "description": "铭牌右侧的 CE 图形",
                        "bbox": {"x": 0.55, "y": 0.56, "w": 0.07, "h": 0.08},
                    },
                    {
                        "mark": "FCC",
                        "description": "CE 下方的 FCC 字样",
                        "bbox": {"x": 0.55, "y": 0.67, "w": 0.09, "h": 0.06},
                    },
                    {
                        "mark": "UKCA",
                        "description": "铭牌右下角的 UKCA 图形",
                        "bbox": {"x": 0.67, "y": 0.66, "w": 0.1, "h": 0.08},
                    },
                ],
                "observations": [
                    {
                        "check_id": "common.certification_marks.visible",
                        "visibility": "present_readable",
                        "observed_text": "CE/FCC/UKCA",
                        "description": "铭牌上可见多个标志",
                        "bbox": {"x": 0.5, "y": 0.5, "w": 0.3, "h": 0.3},
                    }
                ],
            },
            ensure_ascii=False,
        )

        structured = _parse_vision_text(raw, raw)
        parsed = _parse_checklist_observations(
            structured,
            image_index=0,
            session_id="scan_marks",
            selected_check_ids=["common.certification_marks.visible"],
        )

        assert [entry["observedText"] for entry in parsed] == ["CE", "FCC", "UKCA"]
        assert len({entry["observationId"] for entry in parsed}) == 3
        assert all(entry["region"]["kind"] == "bbox" for entry in parsed)
        assert parsed[1]["region"]["bbox"] == {
            "x": 0.55, "y": 0.67, "w": 0.09, "h": 0.06,
        }
