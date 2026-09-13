"""Deterministic findings builder (plan 2026-09-13 §3 + §10.3).

Converts verified observations + the profile's deferred-evidence checks
into ``findings`` — entirely deterministically, no LLM roundtrip. This is
the "精简生成" first slice: the model observes, the program judges the
*evidence state*, and 待补拍/待补资料 lists come out of rules rather
than prose.

Rules (plan §5.1 / §5.2):
- present_unreadable / occluded       → evidence_needed (补拍该视角)
- not_in_view                         → evidence_needed (所需视角来自
                                         profile check.requiredViews)
- absent_in_visible_scope             → suspected_issue — the field is
                                         missing in a fully visible label
                                         area; NOT confirmed missing
                                         (other label locations may carry it)
- not_assessed                        → evidence_needed (model skipped)
- deferred checks (lab_test/document/
  registration)                       → evidence_needed with the material
                                         list as required_evidence
- present_readable                    → no finding (clean ≠ compliant)

Every finding cites the observations it rests on and the legal anchors
the profile attached to the check.
"""
from __future__ import annotations

from typing import Any

from rag_service.pipeline.nodes.visual_checks import (
    InspectionProfileCheck,
    deferred_evidence_checks,
    effective_checks,
)

# Visibility → default finding shape. present_readable produces nothing.
_VISIBILITY_RULES: dict[str, dict[str, str]] = {
    "present_unreadable": {
        "assessment": "evidence_needed",
        "severity": "medium",
        "action_template": "补拍清晰的{views}照片（当前图像文字无法辨认）",
    },
    "occluded": {
        "assessment": "evidence_needed",
        "severity": "medium",
        "action_template": "补拍未被遮挡的{views}照片",
    },
    "not_in_view": {
        "assessment": "evidence_needed",
        "severity": "low",
        "action_template": "补拍{views}（本次照片未覆盖该区域）",
    },
    "not_assessed": {
        "assessment": "evidence_needed",
        "severity": "low",
        "action_template": "重新扫描或补拍以覆盖「{title}」",
    },
    "absent_in_visible_scope": {
        "assessment": "suspected_issue",
        "severity": "medium",
        "action_template": (
            "标签区域可见但未检出「{title}」：核对规则允许的其他标识位置；"
            "如确无，需补认证/标注"
        ),
    },
}


def _check_by_id(category: str) -> dict[str, InspectionProfileCheck]:
    return {check.id: check for check in effective_checks(category)}


def build_findings(
    *,
    session_id: str,
    category: str,
    observations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Build findings v2 from verified observations + profile metadata.

    ``observations`` are the grounded, annotate_verification-passed dicts
    already stored on the report package. The output is the plain-dict
    form of ``schemas.visual_inspection.Finding`` (kept as dicts to match
    the package's other payload fields).
    """
    checks = _check_by_id(category)
    findings: list[dict[str, Any]] = []
    emitted_checks: set[str] = set()

    # Best observation per check per the display rule: the most severe
    # visibility wins (absent_in_visible_scope > unreadable > occluded >
    # not_in_view > not_assessed). present_readable on ANY image means
    # the check is satisfied visually — no finding.
    rank = {
        "absent_in_visible_scope": 4,
        "present_unreadable": 3,
        "occluded": 2,
        "not_in_view": 1,
        "not_assessed": 0,
    }
    readable: set[str] = set()
    best: dict[str, dict[str, Any]] = {}
    for obs in observations:
        check_id = str(obs.get("checkId") or "")
        visibility = str(obs.get("visibility") or "not_assessed")
        if visibility == "present_readable":
            readable.add(check_id)
            continue
        current = best.get(check_id)
        if current is None or rank.get(visibility, 0) > rank.get(
            str(current.get("visibility")), 0
        ):
            best[check_id] = obs

    for check_id, obs in best.items():
        if check_id in readable:
            continue
        emitted_checks.add(check_id)
        check = checks.get(check_id)
        title = (check.title if check else None) or check_id
        rule = _VISIBILITY_RULES.get(
            str(obs.get("visibility")), _VISIBILITY_RULES["not_assessed"]
        )
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
    # 确定性的待补材料清单).
    for check in deferred_evidence_checks(category):
        if check.id in emitted_checks:
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
