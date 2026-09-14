"""Adversarial (red-team) tests for the J02 semantic truth table in
findings_builder (plan 2026-09-14 §4.2).

Enumerates EVERY (semantic, visibility) cell — 3 semantics x 6 visibilities =
18 — and asserts the plan's expected outcome per cell. These tests are the
contract: if someone adds or flips a rule the grid pins the intent.
"""
from __future__ import annotations

import pytest

from rag_service.pipeline.nodes import findings_builder as fb
from rag_service.pipeline.nodes.findings_builder import build_findings

SEMANTICS = ("required_presence", "hazard_presence", "record_only")
VISIBILITIES = (
    "present_readable",
    "present_unreadable",
    "not_in_view",
    "occluded",
    "absent_in_visible_scope",
    "not_assessed",
)

# Expected outcome per (semantic, visibility) — a name is emitted only when
# a finding is produced; None means the grid cell must stay silent.
# (plan §4.2 truth table):
#   required_presence + present_readable        → no finding (clean ≠ compliant)
#   required_presence + absent_in_visible_scope  → suspected_issue
#   hazard_presence + present_readable           → suspected_issue (crack!)
#   hazard_presence + absent_in_visible_scope   → NO finding (no crack is good)
#   record_only + present_readable              → no finding (record only)
#   record_only + absent_in_visible_scope       → no finding
#   all *unreadable/occluded/not_in_view/not_assessed → evidence_needed
EXPECTED: dict[tuple[str, str], str | None] = {
    # required_presence
    ("required_presence", "present_readable"): None,
    ("required_presence", "present_unreadable"): "evidence_needed",
    ("required_presence", "not_in_view"): "evidence_needed",
    ("required_presence", "occluded"): "evidence_needed",
    ("required_presence", "absent_in_visible_scope"): "suspected_issue",
    ("required_presence", "not_assessed"): "evidence_needed",
    # hazard_presence
    ("hazard_presence", "present_readable"): "suspected_issue",
    ("hazard_presence", "present_unreadable"): "evidence_needed",
    ("hazard_presence", "not_in_view"): "evidence_needed",
    ("hazard_presence", "occluded"): "evidence_needed",
    ("hazard_presence", "absent_in_visible_scope"): None,  # J02 core
    ("hazard_presence", "not_assessed"): "evidence_needed",
    # record_only
    ("record_only", "present_readable"): None,
    ("record_only", "present_unreadable"): "evidence_needed",
    ("record_only", "not_in_view"): "evidence_needed",
    ("record_only", "occluded"): "evidence_needed",
    ("record_only", "absent_in_visible_scope"): None,
    ("record_only", "not_assessed"): "evidence_needed",
}


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


# Profile check ids that carry each semantic (verified against
# data/inspection_profiles/*.yaml):
#   required_presence → toy.age_range.label
#   hazard_presence    → toy.sharp_edges.visible
#   record_only       → toy.small_parts.visible
CHECK_BY_SEMANTIC = {
    "required_presence": ("toy", "toy.age_range.label"),
    "hazard_presence": ("toy", "toy.sharp_edges.visible"),
    "record_only": ("toy", "toy.small_parts.visible"),
}


class TestTruthTableGrid:
    def test_every_semantic_visibility_combination_is_covered_by_rules_or_silence(self):
        # Grid sanity first: _RULES keys are exactly the cells that EMIT a
        # finding; every other cell must be silent. No cell may be missing
        # from EXPECTED and no stray rule may exist outside it.
        rule_keys = set(fb._RULES.keys())
        expected_emitting = {k for k, v in EXPECTED.items() if v is not None}
        expected_silent = {k for k, v in EXPECTED.items() if v is None}
        assert rule_keys == expected_emitting, (
            f"_RULES keys diverge from expected emitting cells: "
            f"extra={rule_keys - expected_emitting}, missing={expected_emitting - rule_keys}"
        )
        # Silent cells must NOT have a rule entry.
        assert not (rule_keys & expected_silent)
        # And the whole 3x6 grid is enumerated exactly.
        assert len(EXPECTED) == 18

    @pytest.mark.parametrize("semantic", SEMANTICS)
    @pytest.mark.parametrize("visibility", VISIBILITIES)
    def test_cell(self, semantic: str, visibility: str):
        category, check_id = CHECK_BY_SEMANTIC[semantic]
        findings = build_findings(
            session_id="scan_grid",
            category=category,
            observations=[obs(check_id, visibility)],
        )
        matching = [f for f in findings if f["checkId"] == check_id]
        expected = EXPECTED[(semantic, visibility)]
        if expected is None:
            assert matching == [], (
                f"({semantic}, {visibility}) must produce NO finding, got "
                f"{[f['assessment'] for f in matching]}"
            )
        else:
            assert len(matching) == 1, (
                f"({semantic}, {visibility}) must produce exactly one finding"
            )
            assert matching[0]["assessment"] == expected

    def test_hazard_absent_never_says_label_missing(self):
        # The specific J02 wording regression: the absent template
        # (标签区域可见但未检出…) must never fire for hazard checks.
        findings = build_findings(
            session_id="scan_grid",
            category="toy",
            observations=[obs("toy.sharp_edges.visible", "absent_in_visible_scope")],
        )
        joined = " ".join(f["suggestedAction"] for f in findings)
        assert "未检出" not in joined
        assert "其他标识位置" not in joined

    def test_hazard_readable_finding_cites_the_crack_observation_only(self):
        findings = build_findings(
            session_id="scan_grid",
            category="toy",
            observations=[
                obs("toy.sharp_edges.visible", "present_readable", "o-crack"),
            ],
        )
        finding = next(f for f in findings if f["checkId"] == "toy.sharp_edges.visible")
        assert finding["observationIds"] == ["o-crack"]
        assert finding["severity"] == "medium"


class TestMultiImageRanking:
    """b. Multi-image: a clean read on image 1 must not short-circuit a clear
    crack on image 2 (and vice versa: a readable record wins for record_only,
    any readable sighting satisfies required_presence)."""

    def test_crack_survives_clean_image(self):
        findings = build_findings(
            session_id="scan_grid",
            category="toy",
            observations=[
                obs("toy.sharp_edges.visible", "present_readable", "o-crack"),
                obs("toy.sharp_edges.visible", "absent_in_visible_scope", "o-clean"),
            ],
        )
        finding = next(
            f for f in findings if f["checkId"] == "toy.sharp_edges.visible"
        )
        assert finding["assessment"] == "suspected_issue"
        assert finding["observationIds"] == ["o-crack"]

    def test_crack_survives_clean_image_order_flipped(self):
        # Order independence: clean first must not win either.
        findings = build_findings(
            session_id="scan_grid",
            category="toy",
            observations=[
                obs("toy.sharp_edges.visible", "absent_in_visible_scope", "o-clean"),
                obs("toy.sharp_edges.visible", "present_readable", "o-crack"),
            ],
        )
        finding = next(
            f for f in findings if f["checkId"] == "toy.sharp_edges.visible"
        )
        assert finding["observationIds"] == ["o-crack"]

    def test_clean_and_unreadable_hazard_stays_evidence_needed_not_absent(self):
        # A clean image + an unreadable suspect region → the representative
        # must be the unreadable one (rank 3 > absent rank 0), producing
        # evidence_needed — NOT the silent absent branch, and NOT a
        # suspected_issue claim the clean image contradicts.
        findings = build_findings(
            session_id="scan_grid",
            category="toy",
            observations=[
                obs("toy.sharp_edges.visible", "absent_in_visible_scope", "o-clean"),
                obs("toy.sharp_edges.visible", "present_unreadable", "o-blur"),
            ],
        )
        finding = next(
            f for f in findings if f["checkId"] == "toy.sharp_edges.visible"
        )
        assert finding["assessment"] == "evidence_needed"
        assert finding["observationIds"] == ["o-blur"]

    def test_required_presence_readable_anywhere_beats_absent_elsewhere(self):
        # Label read on image 2 satisfies the presence check even when image 1
        # showed a fully-visible label area WITHOUT the field.
        findings = build_findings(
            session_id="scan_grid",
            category="toy",
            observations=[
                obs("toy.age_range.label", "absent_in_visible_scope", "o-no-age"),
                obs("toy.age_range.label", "present_readable", "o-age-ok"),
            ],
        )
        assert [
            f for f in findings if f["checkId"] == "toy.age_range.label"
        ] == []

    def test_record_only_readable_read_beats_unreadable(self):
        findings = build_findings(
            session_id="scan_grid",
            category="toy",
            observations=[
                obs("toy.small_parts.visible", "present_unreadable", "o-blur"),
                obs("toy.small_parts.visible", "present_readable", "o-clear"),
            ],
        )
        assert [
            f for f in findings if f["checkId"] == "toy.small_parts.visible"
        ] == []


class TestDeclaredFactsBoundaries:
    """c. How wide is the declared_facts key match? battery=absent must close
    battery-presupposing checks (battery compartment, charging-case battery
    marking) but must NEVER close unrelated checks — including checks whose
    id merely contains 'label', textile/home/cosmetic checks, and even
    battery-ANCHORED lab tests that presuppose presence differently."""

    def test_battery_absent_closes_3c_battery_marking_check(self):
        # The 3c profile's 3c.battery.marking presupposes a battery marking
        # exists to read; declaring battery=absent must close it.
        findings = build_findings(
            session_id="scan_grid",
            category="3c",
            observations=[obs("3c.battery.marking", "not_in_view", "o-batt")],
            declared_facts={"battery": "absent"},
        )
        assert [f for f in findings if f["checkId"] == "3c.battery.marking"] == []

    def test_battery_absent_closes_deferred_battery_spec_sheet_check(self):
        # The deferred 3c.battery.spec_sheet (document-mode) also
        # presupposes a battery — skip it too.
        findings = build_findings(
            session_id="scan_grid",
            category="3c",
            observations=[],
            declared_facts={"battery": "absent"},
        )
        check_ids = {f["checkId"] for f in findings}
        assert "3c.battery.spec_sheet" not in check_ids

    def test_battery_absent_does_not_close_unrelated_label_checks(self):
        # charging-case identity check reads a case LABEL (not a battery fact)
        # — battery=absent must not close it.
        findings = build_findings(
            session_id="scan_grid",
            category="3c",
            observations=[obs("3c.case.identity", "not_in_view", "o-case")],
            declared_facts={"battery": "absent"},
        )
        assert any(f["checkId"] == "3c.case.identity" for f in findings)

    def test_battery_absent_does_not_close_textile_checks(self):
        # Textile profile checks (care labels, drawstrings…) share nothing
        # with the battery fact; a toy-style battery declaration must be a
        # no-op there.
        findings = build_findings(
            session_id="scan_grid",
            category="textile",
            observations=[
                obs("textile.fiber_content.label", "not_in_view", "o-fiber"),
                obs("textile.care_instructions.label", "not_in_view", "o-care"),
            ],
            declared_facts={"battery": "absent"},
        )
        check_ids = {f["checkId"] for f in findings}
        assert "textile.fiber_content.label" in check_ids
        assert "textile.care_instructions.label" in check_ids

    def test_battery_absent_does_not_close_home_or_common_checks(self):
        findings = build_findings(
            session_id="scan_grid",
            category="home",
            observations=[
                obs("common.nameplate.readability", "not_in_view", "o-nameplate"),
                obs("home.warning_label.text", "not_in_view", "o-warn"),
            ],
            declared_facts={"battery": "absent"},
        )
        check_ids = {f["checkId"] for f in findings}
        assert "common.nameplate.readability" in check_ids
        assert "home.warning_label.text" in check_ids

    def test_unknown_fact_keys_are_ignored(self):
        # A fact key that has no token mapping (e.g. "color": "red") must be
        # ignored entirely — never a KeyError, never a blanket skip.
        findings = build_findings(
            session_id="scan_grid",
            category="toy",
            observations=[obs("toy.battery_compartment.closure", "not_in_view", "o-batt")],
            declared_facts={"color": "absent"},
        )
        assert any(
            f["checkId"] == "toy.battery_compartment.closure" for f in findings
        )

    def test_only_absent_like_values_close_checks(self):
        # battery: "present" (or any non-absent answer) must NOT close the
        # battery compartment check — only explicit absence does.
        for value in ("present", "yes", "内置", " "):
            findings = build_findings(
                session_id="scan_grid",
                category="toy",
                observations=[obs("toy.battery_compartment.closure", "not_in_view", "o-batt")],
                declared_facts={"battery": value},
            )
            assert any(
                f["checkId"] == "toy.battery_compartment.closure" for f in findings
            ), f"value={value!r} must not close the check"
        # And the recognized absent-like spellings DO close it.
        for value in ("absent", "none", "no", "false", "无", " Absent "):
            findings = build_findings(
                session_id="scan_grid",
                category="toy",
                observations=[obs("toy.battery_compartment.closure", "not_in_view", "o-batt")],
                declared_facts={"battery": value},
            )
            assert [
                f for f in findings if f["checkId"] == "toy.battery_compartment.closure"
            ] == [], f"value={value!r} should close the check"

    def test_hyphenated_and_region_tokens_match(self):
        # id segment and region token spellings: hyphens fold to underscores.
        from rag_service.pipeline.nodes.findings_builder import (
            _check_conflicts_with_declared_facts,
        )

        class FakeCheck:
            def __init__(self, regions):
                self.target_regions = regions

        # check id with a hyphenated battery segment
        assert _check_conflicts_with_declared_facts(
            FakeCheck(["product_body"]), "toy.battery-compartment.closure", {"battery": "absent"}
        )
        # region token with a hyphen
        assert _check_conflicts_with_declared_facts(
            FakeCheck(["battery-compartment"]), "toy.some.other", {"battery": "absent"}
        )
        # an id whose segments merely CONTAIN 'batteries' as a token
        assert _check_conflicts_with_declared_facts(
            FakeCheck([]), "x.batteries.present", {"battery": "absent"}
        )
        # …but a non-matching id/region stays open
        assert not _check_conflicts_with_declared_facts(
            FakeCheck(["care_label"]), "textile.fiber_content.label", {"battery": "absent"}
        )
