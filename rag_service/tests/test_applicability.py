"""Tests for the applicability rules engine (plan 2026-09-13 §10.1).

The two documented counterexamples are the acceptance bars:
- an earbud charging case (portable battery) must NOT get Article 77
  battery-passport obligations
- "no UKCA" must not be treated as automatic non-compliance for GB radio
  equipment (CE acceptance + GB/NI split)

J08 (2026-09-14): the LMT battery-passport date is 2027-02-18 per the
European Commission guidance of 2026-08-21 — asserted below so the old
2028-08-18 value cannot silently return.
"""
from __future__ import annotations

from datetime import date

import pytest

from rag_service.verify.applicability import (
    BATTERY_PASSPORT_LMT_FROM,
    ProductFacts,
    evaluate_anchor,
    evaluate_anchors,
    prompt_context_lines,
)


def anchor(regulation_id: str, region: str, source: str) -> dict:
    return {
        "doc_name": f"doc-{regulation_id}",
        "region": region,
        "reason": "",
        "source": source,
        "regulation_id": regulation_id,
    }


class TestBatteryRegulation:
    def test_portable_battery_in_earbuds_not_passport(self):
        """The audit session's exact failure: earbuds + battery keyword →
        the report claimed battery-passport (Art. 77) obligations."""
        facts = ProductFacts(
            category="3c",
            markets=["EU", "UK"],
            battery="confirmed",  # visible "3.8V 520mAh" marking
            wireless="candidate",
        )
        decision = evaluate_anchor(
            anchor("EU-2023-1542", "EU", "feature"), facts
        )
        assert decision.state == "applicable"  # base regime applies
        reasons = " ".join(decision.product_conditions)
        assert "Art. 77" in reasons or "电池护照" in reasons
        assert "不适用" in reasons or "便携式" in reasons

    def test_battery_keyword_only_is_needs_confirmation(self):
        facts = ProductFacts(
            category="3c",
            markets=["EU"],
            battery="candidate",  # name said "无线耳机充电盒" — no marking read
        )
        decision = evaluate_anchor(anchor("EU-2023-1542", "EU", "feature"), facts)
        assert decision.state == "needs_confirmation"
        assert "keyword" in decision.reason or "candidate" in decision.reason

    def test_unknown_industrial_capacity_flags_passport_condition(self):
        facts = ProductFacts(
            category="battery",
            markets=["EU"],
            battery="confirmed",
            battery_wh=None,
        )
        decision = evaluate_anchor(anchor("EU-2023-1542", "EU", "category"), facts)
        assert decision.state == "applicable"
        assert any("2 kWh" in c or "容量" in c for c in decision.product_conditions)

    def test_lmt_passport_date_is_2027_02_18(self):
        """J08 regression: EC guidance 2026-08-21 says the battery passport
        obligation for LMT (and EV / >2 kWh industrial) batteries starts
        2027-02-18 — not 2028-08-18 as previously quoted."""
        assert BATTERY_PASSPORT_LMT_FROM == date(2027, 2, 18)

    def test_passport_note_text_uses_2027_date(self):
        facts = ProductFacts(
            category="3c",
            markets=["EU"],
            battery="confirmed",
        )
        decision = evaluate_anchor(anchor("EU-2023-1542", "EU", "feature"), facts)
        conditions = " ".join(decision.product_conditions)
        assert "2027-02-18" in conditions
        assert "2028" not in conditions

    def test_no_battery_no_decision(self):
        facts = ProductFacts(category="textile", markets=["EU"], battery="absent")
        decision = evaluate_anchor(anchor("EU-2023-1542", "EU", "feature"), facts)
        # No special rule fired → generic feature ladder → unresolved
        assert decision.state == "needs_confirmation"


class TestUkRadio:
    def test_ce_acceptance_and_gb_ni_split_recorded(self):
        facts = ProductFacts(
            category="3c",
            markets=["UK"],
            wireless="confirmed",
        )
        decision = evaluate_anchor(anchor("UK-UKCA-Radio", "UK", "feature"), facts)
        assert decision.state == "applicable"
        conditions = " ".join(decision.product_conditions)
        assert "CE" in conditions
        assert "北爱尔兰" in conditions or "NI" in conditions

    def test_prompt_lines_never_claim_ukca_is_mandatory(self):
        """J08 regression: the report must not tell users UKCA is required
        to enter GB — the official guidance accepts CE under conditions,
        and NI follows EU rules. The rendered guardrail lines must say
        exactly that and never「必须 UKCA」."""
        facts = ProductFacts(
            category="3c",
            markets=["UK"],
            wireless="confirmed",
        )
        anchors = [
            anchor("UK-UKCA-Radio", "UK", "feature"),
            anchor("EU-2023-1542", "EU", "feature"),
        ]
        lines = prompt_context_lines(evaluate_anchors(anchors, facts))
        joined = "\n".join(lines)
        assert "UK-UKCA-Radio" in joined
        assert "CE" in joined
        assert "NI 走 EU 规则" in joined
        # No formulation that presents UKCA as mandatory or CE as invalid.
        for banned in ("必须 UKCA", "必须UKCA", "UKCA 必须", "无 UKCA 不合规"):
            assert banned not in joined

    def test_wireless_keyword_only_is_needs_confirmation(self):
        """名称含"无线"不证明充电盒含发射模块 (plan §9)."""
        facts = ProductFacts(
            category="3c",
            markets=["UK"],
            wireless="candidate",
        )
        decision = evaluate_anchor(anchor("UK-UKCA-Radio", "UK", "feature"), facts)
        assert decision.state == "needs_confirmation"
        assert "发射模块" in decision.reason or "keyword" in decision.reason


class TestUn38:
    def test_confirmed_battery_applicable(self):
        facts = ProductFacts(category="3c", markets=["EU"], battery="confirmed")
        decision = evaluate_anchor(anchor("UN-38-3", "UN", "feature"), facts)
        assert decision.state == "applicable"

    def test_candidate_battery_needs_confirmation(self):
        facts = ProductFacts(category="toy", markets=["US"], battery="candidate")
        decision = evaluate_anchor(anchor("UN-38-3", "UN", "feature"), facts)
        assert decision.state == "needs_confirmation"


class TestGenericLadder:
    def test_category_source_is_applicable(self):
        facts = ProductFacts(category="toy", markets=["EU"])
        decision = evaluate_anchor(anchor("EU-2009-48", "EU", "category"), facts)
        assert decision.state == "applicable"

    def test_prompt_lines_skip_plain_applicable(self):
        facts = ProductFacts(
            category="toy",
            markets=["EU"],
            battery="candidate",
        )
        anchors = [
            anchor("EU-2009-48", "EU", "category"),  # plain applicable
            anchor("UN-38-3", "UN", "feature"),      # needs_confirmation
        ]
        lines = prompt_context_lines(evaluate_anchors(anchors, facts))
        assert len(lines) == 1
        assert "UN-38-3" in lines[0]


class TestProductFacts:
    def test_observed_marking_upgrades_battery_to_confirmed(self):
        facts = ProductFacts.from_scan(
            category="3c",
            markets=["EU"],
            detected_features=["battery"],  # keyword candidate
            observed_text="电池仓标注 3.8V 520mAh 1.98Wh",
        )
        assert facts.battery == "confirmed"

    def test_keyword_only_stays_candidate(self):
        facts = ProductFacts.from_scan(
            category="3c",
            markets=["EU"],
            detected_features=["wireless"],
            observed_text="",
        )
        assert facts.wireless == "candidate"

    def test_declared_wh_confirms_battery(self):
        facts = ProductFacts.from_scan(
            category="battery",
            markets=["EU"],
            detected_features=[],
            battery_wh=1.98,
        )
        assert facts.battery == "confirmed"


class TestBatteryAnchorKeyPoints:
    """J08 red-team residual: the battery-passport KB anchor's key_points
    ALSO feeds the LLM prompt (unlike the applicability module, which is
    code). The 2028-08-18 LMT date survived there after the rules-engine
    fix — this test pins the anchor YAML to the corrected 2027-02-18 date
    so it cannot silently return."""

    def test_battery_anchor_key_points_use_2027_date(self):
        import yaml
        from pathlib import Path

        anchor_path = (
            Path(__file__).resolve().parents[2]
            / "data"
            / "kb"
            / "anchors"
            / "EU-2023-1542-battery.yaml"
        )
        entry = yaml.safe_load(anchor_path.read_text(encoding="utf-8"))
        joined = " ".join(str(point) for point in entry.get("key_points", []))
        assert "2027-02-18" in joined
        assert "2028" not in joined

    def test_all_kb_anchor_files_free_of_2028_passport_dates(self):
        import yaml
        from pathlib import Path

        anchors_root = (
            Path(__file__).resolve().parents[2] / "data" / "kb" / "anchors"
        )
        for path in anchors_root.glob("*.yaml"):
            entry = yaml.safe_load(path.read_text(encoding="utf-8"))
            points = entry.get("key_points") or []
            joined = " ".join(str(point) for point in points)
            # The old wrong LMT date must not reappear in any anchor.
            assert "2028-08-18" not in joined, f"{path.name} still quotes 2028-08-18"
