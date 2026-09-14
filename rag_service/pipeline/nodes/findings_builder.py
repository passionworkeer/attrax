"""Deterministic findings builder — semantic-driven (plan 2026-09-14 §4.2,
problems J02 + J09).

Converts verified observations + the profile's deferred-evidence checks
into ``findings`` — entirely deterministically, no LLM roundtrip. The model
observes, the program judges the *evidence state*, and 待补拍/待补资料
lists come out of rules rather than prose.

J02 fix — visibility alone cannot decide good/bad; each profile check now
carries a ``semantic`` that tells this builder which direction to read the
observation in (plan §4.2 truth table):

- ``hazard_presence`` (缺陷/尖锐/鼓胀/绳带危险形态): the feature is BAD
  if present. ``present_readable`` (clearly seeing the crack) → suspected
  appearance issue + 原图区域, medium, NOT a direct regulatory non-pass;
  ``absent_in_visible_scope`` (region visible, no hazard seen) → NO
  finding — not seeing a crack is a good outcome, never an action item.

- ``record_only`` (小附件/端口形态/认证标志等记录类): morphology is
  recorded but a photo alone can neither pass nor fail the check.
  ``present_readable`` → NO finding (recorded as an observation, not
  judged); other visibilities → evidence_needed 补拍.

- ``required_presence`` (铭牌/标签/警告语/年龄标注等应存在元素):
  ``present_readable`` → no finding (clean ≠ compliant);
  ``absent_in_visible_scope`` (label area fully visible, field not found)
  → suspected_issue — 核对规则允许的其他标识位置，如确无需补充标注/认证
  (NOT confirmed missing);
  ``present_unreadable``/``occluded``/``not_in_view``/``not_assessed`` →
  evidence_needed (补拍该视角, never a fabricated box).

J09 minimal slice — ``build_findings()`` accepts optional ``declared_facts``
(user-stated product facts, e.g. ``{"battery": "absent"}``). When a check's
id or target_regions conflicts with a declared fact (e.g. the battery
compartment closure check when the user declared no battery), the check is
skipped — no 待补拍 finding demanding a photo of a part that does not exist.
The generator call site does not pass this yet (kept for compatibility);
the capability lives here.

Findings keep the ``observationIds`` / ``citationIds`` / ``requiredEvidence``
shape the downstream generator + result page depend on.
"""
from __future__ import annotations

from typing import Any

from rag_service.pipeline.nodes.visual_checks import (
    InspectionProfileCheck,
    deferred_evidence_checks,
    effective_checks,
)

# ---------------------------------------------------------------------------
# Per-(semantic, visibility) judgment rules. Keys that produce NO finding are
# absent by design: a missing entry means "no finding" (J02: absence of a
# hazard is a good outcome; record_only reads are just records).
# ---------------------------------------------------------------------------
_RULES: dict[tuple[str, str], dict[str, str]] = {
    # required_presence — the element SHOULD exist.
    ("required_presence", "present_unreadable"): {
        "assessment": "evidence_needed",
        "severity": "medium",
        "action_template": "补拍清晰的{views}照片（当前图像文字无法辨认）",
    },
    ("required_presence", "occluded"): {
        "assessment": "evidence_needed",
        "severity": "medium",
        "action_template": "补拍未被遮挡的{views}照片",
    },
    ("required_presence", "not_in_view"): {
        "assessment": "evidence_needed",
        "severity": "low",
        "action_template": "补拍{views}（本次照片未覆盖该区域）",
    },
    ("required_presence", "not_assessed"): {
        "assessment": "evidence_needed",
        "severity": "low",
        "action_template": "重新扫描或补拍以覆盖「{title}」",
    },
    ("required_presence", "absent_in_visible_scope"): {
        "assessment": "suspected_issue",
        "severity": "medium",
        "action_template": (
            "标签区域可见但未检出「{title}」：核对规则允许的其他标识位置；"
            "如确无需补充标注/认证"
        ),
    },
    # required_presence + present_readable → no finding (clean ≠ compliant).

    # hazard_presence — the feature is a DEFECT if present.
    ("hazard_presence", "present_readable"): {
        "assessment": "suspected_issue",
        "severity": "medium",
        # 外观疑点 + 原图区域;严重程度需结合品类,不能直接判法规不合格。
        "action_template": (
            "「{title}」外观疑点：照片中可见该特征，请核对原图标注区域并"
            "结合品类要求评估；仅凭照片不判定法规不合格"
        ),
    },
    ("hazard_presence", "present_unreadable"): {
        "assessment": "evidence_needed",
        "severity": "medium",
        "action_template": "补拍清晰的{views}照片（疑似{title}但无法辨认）",
    },
    ("hazard_presence", "occluded"): {
        "assessment": "evidence_needed",
        "severity": "medium",
        "action_template": "补拍未被遮挡的{views}照片",
    },
    ("hazard_presence", "not_in_view"): {
        "assessment": "evidence_needed",
        "severity": "low",
        "action_template": "补拍{views}（本次照片未覆盖该区域）",
    },
    ("hazard_presence", "not_assessed"): {
        "assessment": "evidence_needed",
        "severity": "low",
        "action_template": "重新扫描或补拍以覆盖「{title}」",
    },
    # hazard_presence + absent_in_visible_scope → NO finding:
    # 区域可见但未见该危险特征是好事,绝不生成“缺异常”整改项 (J02).

    # record_only — photos alone can neither pass nor fail the check.
    ("record_only", "present_unreadable"): {
        "assessment": "evidence_needed",
        "severity": "low",
        "action_template": "补拍清晰的{views}照片（当前无法辨认{title}形态）",
    },
    ("record_only", "occluded"): {
        "assessment": "evidence_needed",
        "severity": "low",
        "action_template": "补拍未被遮挡的{views}照片",
    },
    ("record_only", "not_in_view"): {
        "assessment": "evidence_needed",
        "severity": "low",
        "action_template": "补拍{views}（本次照片未覆盖该区域）",
    },
    ("record_only", "not_assessed"): {
        "assessment": "evidence_needed",
        "severity": "low",
        "action_template": "重新扫描或补拍以覆盖「{title}」",
    },
    # record_only + present_readable → NO finding: only the morphology is
    # recorded (an observation); whether it passes needs gauge/document/lab
    # evidence — 不因能看清就判绿,也不生成整改项 (plan §4.2 row 5).
    # record_only + absent_in_visible_scope → NO finding: nothing hazardous
    # is asserted by this semantic, so a visible area without the shape is
    # not actionable.
}

# Per-semantic display rank for picking the representative observation of a
# check across multiple images. IMPORTANT (J02): ``absent_in_visible_scope``
# is NOT globally the most severe state anymore — it only carries weight in
# the required_presence semantic, and even there it ranks BELOW
# present_readable: for required_presence any readable sighting satisfies
# presence (a photo that READ the field beats a different photo whose label
# area happened not to carry it). For hazard/record checks the "saw it
# clearly" observation must win so a present hazard is never short-circuited
# by other images, and a readable record suppresses reshoot noise.
_RANK_BY_SEMANTIC: dict[str, dict[str, int]] = {
    "required_presence": {
        # Any present_readable sighting satisfies the presence check (the
        # module docstring + the §4.2 truth table row "整个标签清晰" — the
        # field was READ, so a different photo showing a label area without
        # it must NOT override that read with an absent suspected_issue).
        # absent_in_visible_scope therefore ranks BELOW present_readable: it
        # only becomes the representative when NO image read the field.
        "present_readable": 5,      # the read itself satisfies presence
        "absent_in_visible_scope": 4,
        "present_unreadable": 3,
        "occluded": 2,
        "not_in_view": 1,
        "not_assessed": 0,
    },
    "hazard_presence": {
        "present_readable": 5,     # the hazard itself — always surfaces
        "absent_in_visible_scope": 0,  # good outcome; not representative
        "present_unreadable": 3,
        "occluded": 2,
        "not_in_view": 1,
        "not_assessed": 0,
    },
    "record_only": {
        "present_readable": 4,     # the record is captured; nothing to add
        "absent_in_visible_scope": 0,
        "present_unreadable": 3,
        "occluded": 2,
        "not_in_view": 1,
        "not_assessed": 0,
    },
}

# ---------------------------------------------------------------------------
# J09: check ids / target regions that only apply when the product HAS the
# declared fact. ``declared_facts`` maps a fact key to "absent" (user stated
# the product does not have it). A check whose id token or any target region
# implies the absent component is skipped entirely — no evidence_needed
# finding demanding a photo of a part that does not exist.
# ---------------------------------------------------------------------------
_ABSENT_FACT_KEYS: dict[str, set[str]] = {
    # fact key → id/region tokens that depend on that fact being PRESENT
    "battery": {"battery", "batteries", "battery_compartment", "charging_case"},
}


def _check_by_id(category: str) -> dict[str, InspectionProfileCheck]:
    return {check.id: check for check in effective_checks(category)}


def _semantic_of(check: InspectionProfileCheck | None) -> str:
    """Semantic of a check; unknown checks keep the legacy default."""
    return check.semantic if check is not None else "required_presence"


def _check_conflicts_with_declared_facts(
    check: InspectionProfileCheck | None,
    check_id: str,
    declared_facts: dict[str, str] | None,
) -> bool:
    """J09: does this check presuppose a component the user declared absent?

    Matches on check id segments and target_regions tokens (e.g.
    ``toy.battery_compartment.closure`` / region ``battery_compartment`` when
    the declared fact is ``{"battery": "absent"}``).
    """
    if not declared_facts:
        return False
    id_tokens = {token for token in check_id.replace("-", "_").split(".") if token}
    region_tokens: set[str] = set()
    if check is not None:
        for region in check.target_regions:
            region_tokens.update(
                token for token in region.replace("-", "_").split("_") if token
            )
    for fact_key, value in declared_facts.items():
        if str(value).strip().lower() not in {"absent", "none", "no", "false", "无"}:
            continue
        tokens = _ABSENT_FACT_KEYS.get(fact_key)
        if not tokens:
            continue
        if id_tokens & tokens or region_tokens & tokens:
            return True
    return False


def build_findings(
    *,
    session_id: str,
    category: str,
    observations: list[dict[str, Any]],
    declared_facts: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Build findings v2 from verified observations + profile metadata.

    ``observations`` are the grounded, annotate_verification-passed dicts
    already stored on the report package. The output is the plain-dict
    form of ``schemas.visual_inspection.Finding`` (kept as dicts to match
    the package's other payload fields).

    ``declared_facts`` (J09, optional): user-stated product facts such as
    ``{"battery": "absent"}``. Checks that presuppose an absent component
    are skipped instead of surfacing as 待补拍.
    """
    checks = _check_by_id(category)
    findings: list[dict[str, Any]] = []
    emitted_checks: set[str] = set()
    skipped_checks: set[str] = set()

    if declared_facts:
        for check_id, check in checks.items():
            if _check_conflicts_with_declared_facts(check, check_id, declared_facts):
                skipped_checks.add(check_id)

    # Best observation per check per the SEMANTIC-AWARE display rule (J02):
    # the most state that matters for that semantic wins. For
    # required_presence, any present_readable sighting satisfies the check;
    # for hazard_presence, present_readable is the finding itself and must
    # never be short-circuited by other images.
    best: dict[str, dict[str, Any]] = {}
    for obs in observations:
        check_id = str(obs.get("checkId") or "")
        if not check_id:
            continue
        semantic = _semantic_of(checks.get(check_id))
        rank = _RANK_BY_SEMANTIC.get(semantic, _RANK_BY_SEMANTIC["required_presence"])
        visibility = str(obs.get("visibility") or "not_assessed")
        current = best.get(check_id)
        if current is None or rank.get(visibility, 0) > rank.get(
            str(current.get("visibility")), 0
        ):
            best[check_id] = obs

    for check_id, obs in best.items():
        if check_id in skipped_checks:
            # J09: user-declared fact says the component does not exist —
            # do not demand a photo of it.
            continue
        check = checks.get(check_id)
        semantic = _semantic_of(check)
        visibility = str(obs.get("visibility") or "not_assessed")
        rule = _RULES.get((semantic, visibility))
        if rule is None:
            # (required_presence, present_readable) / hazard-absent /
            # record-readable → no finding by design.
            continue
        emitted_checks.add(check_id)
        title = (check.title if check else None) or check_id
        views = (
            "、".join(check.required_views)
            if check and check.required_views
            else "该区域"
        )
        findings.append(
            {
                "findingId": f"{session_id}-finding-{len(findings) + 1}",
                "checkId": check_id,
                "title": title,
                "assessment": rule["assessment"],
                "applicability": "applicable",
                "severity": rule["severity"],
                "observationIds": [str(obs.get("observationId") or "")],
                "citationIds": list(check.legal_anchor_refs) if check else [],
                "suggestedAction": rule["action_template"].format(views=views, title=title),
                "requiredEvidence": (
                    [f"补拍视角：{views}"] if views != "该区域" else []
                ),
            }
        )

    # Deferred checks — lab tests / documents / registrations. These can
    # never be satisfied by photos; they surface as 待补资料 findings with
    # the concrete material list (plan §10.3: 未提供成本输入时直接给出
    # 确定性的待补材料清单). Checks skipped via J09 declared facts stay out.
    for check in deferred_evidence_checks(category):
        if check.id in emitted_checks or check.id in skipped_checks:
            continue
        mode_label = {
            "lab_test": "检测报告",
            "document": "技术文档",
            "registration": "注册/备案凭证",
        }.get(check.evidence_mode, "资料")
        findings.append(
            {
                "findingId": f"{session_id}-finding-{len(findings) + 1}",
                "checkId": check.id,
                "title": check.title or check.id,
                "assessment": "evidence_needed",
                "applicability": "applicable",
                "severity": "low",
                "observationIds": [],
                "citationIds": list(check.legal_anchor_refs),
                "suggestedAction": f"提供{mode_label}：{check.title or check.id}",
                "requiredEvidence": [f"{mode_label}：{check.title or check.id}"],
            }
        )

    return findings
