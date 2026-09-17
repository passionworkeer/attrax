"""Applicability rules engine (plan 2026-09-13 §10.1).

The KB anchors say *when a regulation may apply* (category / features_any /
markets). This module answers the harder question the audit session got
wrong: *does it actually apply to THIS product, given what we actually
know* — with the unknowns kept unknown.

Two documented counterexamples pin the behavior:

1. EU Battery Regulation 2023/1542 Article 77 (battery passport) applies
   to LMT batteries, EV batteries, and industrial batteries > 2 kWh,
   from 2027-02-18. A consumer earbud charging case contains a portable
   battery — the passport does NOT apply. The audit session's report
   claimed it did.
   Source: EC guidance 2026-08-21 (single-market-economy.ec.europa.eu)
   — "guidance to support preparations for digital batteries passport":
   the passport obligation for EV/LMT batteries and industrial batteries
   > 2 kWh starts on 2027-02-18. (Earlier drafts of this module quoted
   2028-08-18 for LMT — corrected 2026-09-14 per that guidance.)

2. GB radio equipment: the official RER 2017 guidance allows CE marking
   (under conditions) as an alternative to UKCA for Great Britain;
   Northern Ireland is a separate regime. "No UKCA → non-compliant" is
   not a valid conclusion.
   Source: gov.uk RER 2017 great-britain guidance.

Design rule (plan §5.1 / §10.1): features detected from names/keywords
(``detect_features``) are CANDIDATES, not confirmed hardware facts. An
anchor pulled in by a keyword-derived feature is ``needs_confirmation``
until corroborated by an observation (visible battery marking, declared
radio module, …) or user-confirmed input.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal

# What the caller knows about one product fact. ``confirmed`` means a
# human selected it or an observation read it off the product (visible
# battery marking, wireless declaration on packaging). ``candidate``
# means a keyword hit — vision text or product name said "无线".
FactConfidence = Literal["confirmed", "candidate", "absent"]

ApplicabilityState = Literal["applicable", "not_applicable", "needs_confirmation"]

RULES_VERSION = "applicability-rules/v1"

# Earliest date the battery passport obligation bites. Per the European
# Commission guidance of 2026-08-21 (single-market-economy.ec.europa.eu,
# "guidance to support preparations for digital batteries passport"), the
# passport requirement for LMT batteries, EV batteries, and industrial
# batteries > 2 kWh starts on 2027-02-18 (both constants below).
# (2026-09-14 J08: LMT was previously quoted as 2028-08-18 — corrected.)
BATTERY_PASSPORT_INDUSTRIAL_FROM = date(2027, 2, 18)
BATTERY_PASSPORT_LMT_FROM = date(2027, 2, 18)

# Categories whose batteries are portable-class (no passport at any size
# relevant to these products).
_PORTABLE_BATTERY_CATEGORIES = {
    "electronics", "3c", "toy", "home", "appliance",
    "cosmetic", "textile", "food_contact", "other", "battery",
}
# The battery CATEGORY itself may be any class — capacity decides.


@dataclass
class ApplicabilityDecision:
    regulation_id: str
    market: str
    state: ApplicabilityState
    reason: str
    effective_from: date | None = None
    product_conditions: list[str] = field(default_factory=list)
    facts_basis: dict[str, FactConfidence] = field(default_factory=dict)
    rules_version: str = RULES_VERSION

    def to_audit_dict(self) -> dict[str, Any]:
        return {
            "regulationId": self.regulation_id,
            "market": self.market,
            "state": self.state,
            "reason": self.reason,
            "effectiveFrom": self.effective_from.isoformat() if self.effective_from else None,
            "productConditions": list(self.product_conditions),
            "rulesVersion": self.rules_version,
        }


@dataclass
class ProductFacts:
    """What we actually know about the product, split by confidence."""

    category: str
    markets: list[str]
    battery: FactConfidence = "absent"
    wireless: FactConfidence = "absent"
    mains: FactConfidence = "absent"
    children: FactConfidence = "absent"
    # Battery capacity in Wh when a legible marking or spec declares it.
    battery_wh: float | None = None
    assessment_date: date = field(default_factory=date.today)

    @classmethod
    def from_scan(
        cls,
        category: str,
        markets: list[str],
        detected_features: list[str],
        *,
        observed_text: str = "",
        battery_wh: float | None = None,
        assessment_date: date | None = None,
    ) -> "ProductFacts":
        """Build facts from a scan's inputs.

        ``detected_features`` are keyword candidates (detect_features).
        ``observed_text`` is the joined, legible observation text from the
        vision pass — a visible "3.8V 520mAh 1.98Wh" marking upgrades the
        battery fact to confirmed.
        """
        text = (observed_text or "").lower()
        confirmed: set[str] = set()
        if battery_wh is not None and battery_wh > 0:
            confirmed.add("battery")
        if any(token in text for token in ("wh", "mah", "锂电池", "li-ion", "lithium")):
            confirmed.add("battery")
        if any(token in text for token in ("蓝牙", "bluetooth", "2.4g", "wi-fi", "wifi", "无线发射")):
            confirmed.add("wireless")

        def conf(feature: str) -> FactConfidence:
            if feature in confirmed:
                return "confirmed"
            if feature in detected_features:
                return "candidate"
            return "absent"

        return cls(
            category=category,
            markets=[str(m).strip().upper() for m in markets],
            battery=conf("battery"),
            wireless=conf("wireless"),
            mains=conf("mains"),
            children=conf("children"),
            battery_wh=battery_wh,
            assessment_date=assessment_date or date.today(),
        )


def _battery_regulation_decision(facts: ProductFacts, market: str) -> ApplicabilityDecision | None:
    """EU 2023/1542 — split passport obligations from the base regime."""
    if market != "EU":
        return None
    if facts.battery == "absent":
        return None

    conditions: list[str] = []
    if facts.battery == "candidate":
        conditions.append("battery presence inferred from keywords — needs visible marking or spec sheet")

    base_state: ApplicabilityState
    if facts.battery == "confirmed":
        base_state = "applicable"
        reason = "battery confirmed (visible marking / declared spec)"
    else:
        base_state = "needs_confirmation"
        reason = "battery only a keyword candidate; confirm with label photo or spec sheet"

    # Battery-passport scoping (Art. 77): portable batteries in consumer
    # products NEVER need a passport. Only LMT / EV / industrial > 2 kWh do,
    # and only from their effective date (2027-02-18, EC guidance
    # 2026-08-21).
    passport_note = (
        "电池护照 (Art. 77) 不适用于便携式电池（如耳机充电盒/普通消费电子）："
        "仅 LMT、电动车电池及 >2 kWh 工业电池需要，均自 2027-02-18 起"
    )
    portable = facts.category in _PORTABLE_BATTERY_CATEGORIES or (
        facts.category == "battery" and (facts.battery_wh or 0) <= 2
    )
    if portable:
        conditions.append(passport_note)
    elif facts.battery_wh is None and facts.category == "battery":
        conditions.append(
            "电池容量未知：>2 kWh 工业电池自 2027-02-18 起需要电池护照，容量需确认"
        )

    return ApplicabilityDecision(
        regulation_id="EU-2023-1542",
        market=market,
        state=base_state,
        reason=reason,
        effective_from=None,
        product_conditions=conditions,
        facts_basis={"battery": facts.battery},
    )


def _uk_radio_decision(facts: ProductFacts, market: str) -> ApplicabilityDecision | None:
    """UK RER 2017 — CE acceptance + GB/NI split."""
    if market != "UK" or facts.wireless == "absent":
        return None

    conditions = [
        "GB 与北爱尔兰 (NI) 分开评估：NI 走 EU 规则",
        "GB 市场特定条件下接受 CE 标志（等效性条件满足时），无 UKCA 不等于不合规",
    ]
    state: ApplicabilityState
    if facts.wireless == "confirmed":
        state = "applicable"
        reason = "wireless/radio capability confirmed (declaration or visible marking)"
    else:
        state = "needs_confirmation"
        reason = (
            "wireless capability inferred from name/keywords（如“无线耳机”）——"
            "名称含“无线”不证明充电盒含发射模块；需规格书或拆机确认"
        )
        conditions.insert(
            0,
            "区分设备本体与充电盒的无线属性：仅含发射模块的主体受无线设备法规约束",
        )

    return ApplicabilityDecision(
        regulation_id="UK-UKCA-Radio",
        market=market,
        state=state,
        reason=reason,
        product_conditions=conditions,
        facts_basis={"wireless": facts.wireless},
    )


def _un38_3_decision(facts: ProductFacts, market: str) -> ApplicabilityDecision | None:
    """UN 38.3 — transport regime, applies once a battery is present."""
    if facts.battery == "absent":
        return None
    if facts.battery == "confirmed":
        state: ApplicabilityState = "applicable"
        reason = "battery confirmed — UN 38.3 transport test summary required for shipping"
    else:
        state = "needs_confirmation"
        reason = "battery only a keyword candidate; UN 38.3 applies once presence is confirmed"
    return ApplicabilityDecision(
        regulation_id="UN-38-3",
        market=market,
        state=state,
        reason=reason,
        facts_basis={"battery": facts.battery},
    )


_SPECIAL_RULES = [
    _battery_regulation_decision,
    _uk_radio_decision,
    _un38_3_decision,
]


def evaluate_anchor(
    anchor: dict[str, Any],
    facts: ProductFacts,
) -> ApplicabilityDecision:
    """Evaluate one KB anchor against the product facts.

    Special rules (battery passport scoping, UK radio CE acceptance, UN
    38.3) run first — they encode regime-level conditions the YAML
    ``applies_if`` cannot express. Everything else follows the generic
    ladder:

    - category-sourced anchor for the user-selected category → applicable
    - feature-sourced anchor with a candidate (keyword) feature →
      needs_confirmation (keyword hits are not hardware facts)
    - feature-sourced anchor with a confirmed feature → applicable
    """
    regulation_id = str(
        anchor.get("regulation_id") or anchor.get("regulationId") or ""
    ).strip()
    market = str(anchor.get("region") or anchor.get("market") or "").strip().upper()
    source = str(anchor.get("source") or "").strip().lower()

    for rule in _SPECIAL_RULES:
        decision = rule(facts, market) if market else None
        if decision and decision.regulation_id == regulation_id:
            return decision

    # Feature-sourced anchors hinge on feature confidence.
    if source == "feature":
        trigger_features = set(anchor.get("trigger_features") or [])
        if not trigger_features:
            # Older callers may omit routing metadata; resolve it by id.
            from rag_service.retrieval import kb_loader
            entry = kb_loader.get_anchor_by_regulation_id(regulation_id) or {}
            trigger_features = set((entry.get("applies_if") or {}).get("features_any") or [])
        for feature, confidence in (
            ("battery", facts.battery),
            ("wireless", facts.wireless),
            ("mains", facts.mains),
            ("children", facts.children),
        ):
            if feature not in trigger_features:
                continue
            if confidence == "confirmed":
                return ApplicabilityDecision(
                    regulation_id=regulation_id,
                    market=market,
                    state="applicable",
                    reason=f"trigger feature '{feature}' confirmed by observation",
                    facts_basis={feature: confidence},
                )
            if confidence == "candidate":
                return ApplicabilityDecision(
                    regulation_id=regulation_id,
                    market=market,
                    state="needs_confirmation",
                    reason=(
                        f"trigger feature '{feature}' is a keyword candidate — "
                        "confirm with label photo / spec sheet before treating as applicable"
                    ),
                    facts_basis={feature: confidence},
                )
        return ApplicabilityDecision(
            regulation_id=regulation_id,
            market=market,
            state="needs_confirmation",
            reason="feature-sourced anchor with unresolved feature confidence",
        )

    # Category-sourced (user-selected category is a confirmed fact).
    return ApplicabilityDecision(
        regulation_id=regulation_id,
        market=market,
        state="applicable",
        reason="category selected by the user",
    )


def evaluate_anchors(
    anchors: list[dict[str, Any]],
    facts: ProductFacts,
) -> list[ApplicabilityDecision]:
    return [evaluate_anchor(anchor, facts) for anchor in anchors]


def prompt_context_lines(decisions: list[ApplicabilityDecision]) -> list[str]:
    """Render the non-trivial decisions as prompt guardrails for the LLM.

    Only conditions that change what the report may claim are included;
    plain "applicable, category selected" noise stays out.
    """
    lines: list[str] = []
    for decision in decisions:
        if decision.state == "applicable" and not decision.product_conditions:
            continue
        label = {
            "applicable": "适用",
            "not_applicable": "不适用",
            "needs_confirmation": "待确认",
        }[decision.state]
        line = f"- {decision.regulation_id}（{decision.market}）: {label}。{decision.reason}"
        for condition in decision.product_conditions:
            line += f"；{condition}"
        lines.append(line)
    return lines
