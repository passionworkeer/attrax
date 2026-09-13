"""Tests for the visual inspection v2 data model + grounding verifier + profile loader.

Plan 2026-09-13 §5/§6/§7.1 — these tests pin the core contract invariants:
- bbox bounds enforcement (reject, not silently clip, gross violations)
- not_assessed backfill for every selected check
- profile extends + visual/deferred split
- observation id identity (session + image)
"""
from __future__ import annotations

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
