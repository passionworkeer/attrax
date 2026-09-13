"""Tests for the deterministic findings builder (plan §3 / §10.3)."""
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
        assert "ports_closeup" in action or "plug_closeup" in action

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
