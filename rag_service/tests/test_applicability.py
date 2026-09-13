"""Tests for the applicability rules engine (plan 2026-09-13 §10.1).

The two documented counterexamples are the acceptance bars:
- an earbud charging case (portable battery) must NOT get Article 77
  battery-passport obligations
- "no UKCA" must not be treated as automatic non-compliance for GB radio
  equipment (CE acceptance + GB/NI split)
"""
from __future__ import annotations

import pytest

from rag_service.verify.applicability import (
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
