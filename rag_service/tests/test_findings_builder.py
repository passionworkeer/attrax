"""Tests for the deterministic findings builder (plan §3 / §10.3, and the
2026-09-14 §4.2 semantic split — problems J02 + J09).

J02: visibility alone cannot decide good/bad; each profile check's
``semantic`` (required_presence / hazard_presence / record_only) decides
which direction an observation reads in.
J09: user-declared facts (e.g. battery=absent) make presupposing checks
inapplicable instead of demanding photos of nonexistent parts.
"""
from __future__ import annotations

from rag_service.pipeline.nodes.findings_builder import build_findings


def obs(check_id: str, visibility: str, obs_id: str | None = None) -> dict:
    return {
        "observationId": obs_id or f"o-{check_id}-{visibility}",
        "checkId": check_id,
        "imageId": "vision-image-0",
        "visibility": visibility,
        "observedText": None,
        "description": "",
        "region": None,
    }


class TestBuildFindings:
    def test_unreadable_becomes_evidence_needed_with_reshoot(self):
        findings = build_findings(
            session_id="scan_x",
            category="electronics",
            observations=[obs("common.nameplate.readability", "present_unreadable")],
        )
        nameplate = [f for f in findings if f["checkId"] == "common.nameplate.readability"]
        assert len(nameplate) == 1
        finding = nameplate[0]
        assert finding["assessment"] == "evidence_needed"
        assert "补拍" in finding["suggestedAction"]
        assert finding["observationIds"]
        # The electronics deferred lab tests surface alongside as 待补资料.
        assert any(f["checkId"] == "electronics.emc.test_report" for f in findings)

    def test_not_in_view_uses_profile_required_views(self):
        findings = build_findings(
            session_id="scan_x",
            category="electronics",
            observations=[obs("electronics.interface.plug_pins", "not_in_view")],
        )
        assert findings
        action = findings[0]["suggestedAction"]
        # The electronics profile asks for ports_closeup / plug_closeup
        assert (
            "ports_closeup" in action
            or "plug_closeup" in action
            or "接口近照" in action
            or "插头近照" in action
        )

    def test_absent_in_visible_scope_is_suspected_not_confirmed(self):
        findings = build_findings(
            session_id="scan_x",
            category="electronics",
            observations=[obs("common.brand_model.visible", "absent_in_visible_scope")],
        )
        assert findings[0]["assessment"] == "suspected_issue"
        assert "其他标识位置" in findings[0]["suggestedAction"]

    def test_present_readable_anywhere_suppresses_finding(self):
        findings = build_findings(
            session_id="scan_x",
            category="electronics",
            observations=[
                obs("common.nameplate.readability", "not_in_view"),
                obs("common.nameplate.readability", "present_readable", "o-read"),
            ],
        )
        nameplate = [f for f in findings if f["checkId"] == "common.nameplate.readability"]
        assert nameplate == []

    def test_deferred_lab_tests_become_material_findings(self):
        findings = build_findings(
            session_id="scan_x",
            category="toy",
            observations=[],
        )
        check_ids = {f["checkId"] for f in findings}
        assert "toy.mechanical_physical.test" in check_ids
        assert "toy.chemical_migration.test" in check_ids
        material = next(f for f in findings if f["checkId"] == "toy.mechanical_physical.test")
        assert material["assessment"] == "evidence_needed"
        assert material["requiredEvidence"]
        assert any("CPSIA" in cid or "F963" in cid or "2009-48" in cid
                   for cid in material["citationIds"])

    def test_finding_ids_are_session_scoped_and_unique(self):
        findings = build_findings(
            session_id="scan_abc",
            category="electronics",
            observations=[obs("common.warning_text.language", "not_in_view")],
        )
        ids = [f["findingId"] for f in findings]
        assert all(fid.startswith("scan_abc-finding-") for fid in ids)
        assert len(ids) == len(set(ids))

    def test_worst_visibility_wins_per_check(self):
        findings = build_findings(
            session_id="scan_x",
            category="electronics",
            observations=[
                obs("common.packaging.info", "not_in_view"),
                obs("common.packaging.info", "present_unreadable"),
            ],
        )
        packaging = next(f for f in findings if f["checkId"] == "common.packaging.info")
        # unreadable ranks above not_in_view
        assert "无法辨认" in packaging["suggestedAction"]

    def test_not_assessed_produces_finding(self):
        findings = build_findings(
            session_id="scan_x",
            category="electronics",
            observations=[obs("common.batch_traceability.fields", "not_assessed")],
        )
        assert any(f["checkId"] == "common.batch_traceability.fields" for f in findings)


class TestHazardPresenceSemantics:
    """J02: hazard checks read PRESENCE as the problem, ABSENCE as good."""

    def test_absent_hazard_in_visible_scope_generates_no_finding(self):
        # toy.sharp_edges.visible is hazard_presence: the region is visible
        # and no sharp/damaged spot was seen — that is a GOOD outcome, never
        # a "请补认证/标注" action item (J02 方向反了的负例).
        findings = build_findings(
            session_id="scan_x",
            category="toy",
            observations=[
                obs("toy.sharp_edges.visible", "absent_in_visible_scope", "o-no-sharp"),
            ],
        )
        assert [f for f in findings if f["checkId"] == "toy.sharp_edges.visible"] == []

    def test_readable_hazard_becomes_suspected_appearance_issue(self):
        # A clearly seen crack/scratch MUST become a finding — the old
        # builder dropped every present_readable (J02 漏报正例).
        findings = build_findings(
            session_id="scan_x",
            category="toy",
            observations=[
                obs("toy.sharp_edges.visible", "present_readable", "o-crack"),
            ],
        )
        finding = next(
            f for f in findings if f["checkId"] == "toy.sharp_edges.visible"
        )
        assert finding["assessment"] == "suspected_issue"
        assert finding["severity"] == "medium"
        # action cites the 原图区域 + appearance context and must NOT claim
        # a direct regulatory non-pass
        assert "原图标注区域" in finding["suggestedAction"]
        assert "不判定法规不合格" in finding["suggestedAction"]
        assert finding["observationIds"] == ["o-crack"]

    def test_readable_hazard_not_short_circuited_by_other_images(self):
        # Multi-image: one photo shows the crack, another shows a clean
        # region (absent_in_visible_scope). The crack must still surface —
        # a hazard seen anywhere cannot be erased by a clean view elsewhere
        # (plan §4.2 last row, applied to hazard semantics).
        findings = build_findings(
            session_id="scan_x",
            category="toy",
            observations=[
                obs("toy.sharp_edges.visible", "absent_in_visible_scope", "o-clean"),
                obs("toy.sharp_edges.visible", "present_readable", "o-crack"),
            ],
        )
        finding = next(
            f for f in findings if f["checkId"] == "toy.sharp_edges.visible"
        )
        assert finding["assessment"] == "suspected_issue"
        assert finding["observationIds"] == ["o-crack"]

    def test_hazard_unreadable_becomes_evidence_needed(self):
        findings = build_findings(
            session_id="scan_x",
            category="toy",
            observations=[
                obs("toy.sharp_edges.visible", "present_unreadable", "o-blurry"),
            ],
        )
        finding = next(
            f for f in findings if f["checkId"] == "toy.sharp_edges.visible"
        )
        assert finding["assessment"] == "evidence_needed"
        assert "补拍" in finding["suggestedAction"]

    def test_hazard_not_in_view_becomes_evidence_needed(self):
        findings = build_findings(
            session_id="scan_x",
            category="toy",
            observations=[
                obs("toy.sharp_edges.visible", "not_in_view", "o-missing"),
            ],
        )
        finding = next(
            f for f in findings if f["checkId"] == "toy.sharp_edges.visible"
        )
        assert finding["assessment"] == "evidence_needed"


class TestRecordOnlySemantics:
    """J02: record_only checks record morphology; one photo neither passes
    nor fails them."""

    def test_readable_small_parts_generates_no_finding(self):
        # Seeing the small accessory clearly is just a record — the gauge/
        # age-risk call needs quantitative evidence. NOT a pass, NOT an item.
        findings = build_findings(
            session_id="scan_x",
            category="toy",
            observations=[
                obs("toy.small_parts.visible", "present_readable", "o-parts"),
            ],
        )
        assert [f for f in findings if f["checkId"] == "toy.small_parts.visible"] == []

    def test_record_only_not_in_view_becomes_evidence_needed(self):
        findings = build_findings(
            session_id="scan_x",
            category="toy",
            observations=[
                obs("toy.small_parts.visible", "not_in_view", "o-none"),
            ],
        )
        finding = next(
            f for f in findings if f["checkId"] == "toy.small_parts.visible"
        )
        assert finding["assessment"] == "evidence_needed"
        assert "补拍" in finding["suggestedAction"]

    def test_record_only_absent_in_visible_scope_generates_no_finding(self):
        # Nothing hazardous is asserted; a visible area without the shape
        # is not actionable for a record_only check.
        findings = build_findings(
            session_id="scan_x",
            category="toy",
            observations=[
                obs("toy.small_parts.visible", "absent_in_visible_scope", "o-no-parts"),
            ],
        )
        assert [f for f in findings if f["checkId"] == "toy.small_parts.visible"] == []


class TestRequiredPresenceSemantics:
    """required_presence keeps the correct pre-J02 behavior; the absent
    branch no longer fires for hazard checks."""

    def test_label_visible_field_missing_is_suspected_issue(self):
        # The label area is fully visible but the required field was not
        # found on it — suspected (other label locations may carry it),
        # with the revised action wording.
        findings = build_findings(
            session_id="scan_x",
            category="toy",
            observations=[
                obs("toy.age_range.label", "absent_in_visible_scope", "o-no-age"),
            ],
        )
        finding = next(f for f in findings if f["checkId"] == "toy.age_range.label")
        assert finding["assessment"] == "suspected_issue"
        assert "其他标识位置" in finding["suggestedAction"]
        # J02 revised wording: 标注/认证 is a fallback for a confirmed miss,
        # phrased as 如确无需补充标注/认证 rather than 补认证/标注.
        assert "补充标注/认证" in finding["suggestedAction"]

    def test_readable_label_generates_no_finding(self):
        findings = build_findings(
            session_id="scan_x",
            category="toy",
            observations=[
                obs("toy.age_range.label", "present_readable", "o-age-ok"),
            ],
        )
        assert [f for f in findings if f["checkId"] == "toy.age_range.label"] == []

    def test_absent_branch_not_used_for_hazard_checks(self):
        # J02 negative guarantee: the "标签区域可见但未检出" template must
        # never be applied to a hazard check via any visibility state.
        findings = build_findings(
            session_id="scan_x",
            category="toy",
            observations=[
                obs("toy.sharp_edges.visible", "absent_in_visible_scope", "o-no-sharp"),
                obs("toy.magnets_cords.visible", "absent_in_visible_scope", "o-no-cords"),
            ],
        )
        for finding in findings:
            assert finding["checkId"] not in {
                "toy.sharp_edges.visible",
                "toy.magnets_cords.visible",
            }


class TestDeclaredFactsApplicability:
    """J09: user-declared product facts close conditionally-applicable
    checks instead of demanding photos of nonexistent parts."""

    def test_declared_battery_absent_skips_battery_compartment_check(self):
        # C-case regression: the spec TXT said no battery, yet the checklist
        # still demanded a 电池仓 photo. With declared_facts the check is
        # skipped — no finding, no reshoot.
        findings = build_findings(
            session_id="scan_x",
            category="toy",
            observations=[
                obs("toy.battery_compartment.closure", "not_in_view", "o-batt"),
            ],
            declared_facts={"battery": "absent"},
        )
        assert [
            f for f in findings if f["checkId"] == "toy.battery_compartment.closure"
        ] == []

    def test_declared_battery_absent_uses_not_applicable_reasoning_path(self):
        # The skip is by inapplicability, not by pretending the check
        # passed: nothing in the output claims the closure was verified.
        findings = build_findings(
            session_id="scan_x",
            category="toy",
            observations=[
                obs("toy.battery_compartment.closure", "present_unreadable", "o-batt"),
            ],
            declared_facts={"battery": "absent"},
        )
        for finding in findings:
            assert finding["checkId"] != "toy.battery_compartment.closure"

    def test_without_declared_facts_battery_check_still_demands_evidence(self):
        # No user fact → keep the old behavior (evidence_needed), the
        # generator call site stays compatible.
        findings = build_findings(
            session_id="scan_x",
            category="toy",
            observations=[
                obs("toy.battery_compartment.closure", "not_in_view", "o-batt"),
            ],
        )
        finding = next(
            f for f in findings if f["checkId"] == "toy.battery_compartment.closure"
        )
        assert finding["assessment"] == "evidence_needed"

    def test_declared_facts_do_not_suppress_unrelated_checks(self):
        # A battery=absent declaration must not leak into unrelated checks
        # (labels, warnings, sharp edges…).
        findings = build_findings(
            session_id="scan_x",
            category="toy",
            observations=[
                obs("toy.age_range.label", "not_in_view", "o-age"),
                obs("toy.sharp_edges.visible", "not_in_view", "o-sharp"),
            ],
            declared_facts={"battery": "absent"},
        )
        check_ids = {f["checkId"] for f in findings}
        assert "toy.age_range.label" in check_ids
        assert "toy.sharp_edges.visible" in check_ids

    def test_hazard_with_negative_description_generates_no_finding(self):
        # When the vision model marks present_readable (readable surface) but
        # explicitly writes that no defects were seen, it must NOT generate a defect finding.
        findings = build_findings(
            session_id="scan_x",
            category="electronics",
            observations=[
                {
                    "observationId": "o-defects",
                    "checkId": "common.defects.visible",
                    "imageId": "vision-image-0",
                    "visibility": "present_readable",
                    "observedText": None,
                    "description": "外壳平整，无可见裂纹、变形、鼓胀或明显污渍",
                    "region": None,
                }
            ],
        )
        assert [f for f in findings if f["checkId"] == "common.defects.visible"] == []

    def test_declared_absent_cords_skips_compound_check(self):
        # Compound check IDs like toy.magnets_cords.visible match coords_ropes=否
        findings = build_findings(
            session_id="scan_x",
            category="toy",
            observations=[
                obs("toy.magnets_cords.visible", "not_in_view", "o-cords"),
            ],
            declared_facts={"cords_ropes": "否"},
        )
        assert [f for f in findings if f["checkId"] == "toy.magnets_cords.visible"] == []
