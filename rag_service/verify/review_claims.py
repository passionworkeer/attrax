"""Resolve model-authored review claims against the actual scan evidence.

Referential validity is not legal approval. Missing or unverifiable links keep
the claim unconfirmed; no links are inferred from product keywords.
"""
from __future__ import annotations


FACT_ONLY_CHECKS = {
    "toy.age_range.label", "toy.small_parts.visible",
    "common.product.overview", "common.nameplate.readability",
    "common.certification_marks.visible", "common.brand_model.visible",
    "common.warning_text.language", "common.packaging.info",
}
VISUAL_HAZARD_CHECKS = {
    "toy.magnets_cords.visible", "toy.sharp_edges.visible",
    "common.defects.visible",
}
NONLEGAL_OBSERVATION_CHECKS = FACT_ONLY_CHECKS | VISUAL_HAZARD_CHECKS
CHECK_ARTICLE_REQUIREMENTS = {
    ("US", "toy.warnings.text"): ["US-16-CFR-1263#guidance-product-requirements"],
    ("US", "toy.battery_compartment.closure"): ["US-16-CFR-1263#guidance-product-requirements"],
    ("US", "common.batch_traceability.fields"): ["US-CPSIA#section-2063-a5"],
}


def validate_review_claims(package: dict, markets: list[str]) -> list[dict]:
    observations = {o.get("observationId"): o for o in package.get("observations", []) if isinstance(o, dict)}
    checks = set(package.get("selectedCheckIds") or [])
    checks.update(f.get("checkId") for f in package.get("findings", []) if isinstance(f, dict))
    docs = {d.get("documentIndex"): d for d in (package.get("productEvidence") or {}).get("documents", [])}
    citations = {}
    for c in package.get("citations", []):
        key = f"{c.get('doc_id')}#{c.get('article_id')}"
        citations.setdefault(key, []).append(c)
    output = []
    seen = set()
    raw_claims = package.get("reviewClaims") or []
    if not isinstance(raw_claims, list):
        return []
    for raw in raw_claims[:100]:
        if not isinstance(raw, dict):
            continue
        market, check = raw.get("market"), raw.get("checkId")
        if not isinstance(market, str) or not isinstance(check, str) or market not in markets or check not in checks or (market, check) in seen:
            continue
        seen.add((market, check))
        reasons = []
        refs = raw.get("citationIds") if isinstance(raw.get("citationIds"), list) else []
        valid_refs = []
        verified_refs = []
        for ref in refs:
            if not isinstance(ref, str) or ref not in citations or ref.split("-")[0] not in {market, "UN", "IEC", "ISO"}:
                reasons.append("invalid_or_out_of_market_citation")
                continue
            valid_refs.append(ref)
            if any(c.get("match_status") == "matched" for c in citations[ref]):
                verified_refs.append(ref)
        # Stable check-to-article bindings repair a model that selected only a
        # scope paragraph while the exact substantive article is already in
        # this scan's verified source set. This is a fixed review contract,
        # not keyword inference from user content.
        for ref in CHECK_ARTICLE_REQUIREMENTS.get((market, check), []):
            if ref in citations and any(c.get("match_status") == "matched" for c in citations[ref]):
                if ref not in valid_refs:
                    valid_refs.append(ref)
                if ref not in verified_refs:
                    verified_refs.append(ref)
        obs_ids = raw.get("observationIds") if isinstance(raw.get("observationIds"), list) else []
        valid_obs = [key for key in obs_ids if isinstance(key, str) and key in observations and observations[key].get("checkId") == check]
        if len(valid_obs) != len(obs_ids):
            reasons.append("invalid_observation")
        document_refs = []
        for ref in raw.get("documentEvidence", []) if isinstance(raw.get("documentEvidence"), list) else []:
            if not isinstance(ref, dict):
                reasons.append("invalid_document_excerpt")
                continue
            index, quote = ref.get("documentIndex"), ref.get("quote")
            doc = docs.get(index) if isinstance(index, int) and not isinstance(index, bool) else None
            from rag_service.verify.quote_matcher import match_quote
            span, match = match_quote(doc.get("includedText", ""), quote) if doc and isinstance(quote, str) and len(quote.strip()) >= 8 else (None, "unmatched")
            if match != "matched" or not span or span[0] == span[1]:
                reasons.append("invalid_document_excerpt")
            else:
                document_refs.append({"documentIndex": index, "name": doc.get("name", ""), "quote": doc["includedText"][span[0]:span[1]]})
        legal_basis_required = check not in NONLEGAL_OBSERVATION_CHECKS
        if legal_basis_required and (not valid_refs or len(verified_refs) != len(valid_refs)):
            reasons.append("legal_quote_unverified")
        # A scope paragraph establishes applicability, not the substantive
        # battery warning/design requirements. An exact quote is not enough.
        if legal_basis_required and raw.get("status") in {"supported", "blocked"} and valid_refs and all(
            ref in {"US-16-CFR-1263#section-1263-1-a", "US-16-CFR-1263#section-1263-1-c"}
            for ref in valid_refs
        ):
            reasons.append("scope_only_legal_basis")
        check_observations = [o for o in observations.values() if o.get("checkId") == check]
        if check in FACT_ONLY_CHECKS:
            readable = [o for o in check_observations if o.get("visibility") == "present_readable"]
            if readable:
                valid_obs = list(dict.fromkeys(valid_obs + [str(o.get("observationId")) for o in readable if o.get("observationId")]))
                raw = {**raw, "status": "supported"}
        elif check in VISUAL_HAZARD_CHECKS:
            findings = [f for f in package.get("findings", []) if isinstance(f, dict) and f.get("checkId") == check]
            has_issue = any(f.get("assessment") == "suspected_issue" for f in findings)
            clear = [o for o in check_observations if o.get("visibility") == "absent_in_visible_scope"]
            if has_issue:
                raw = {**raw, "status": "blocked"}
            elif clear:
                valid_obs = list(dict.fromkeys(valid_obs + [str(o.get("observationId")) for o in clear if o.get("observationId")]))
                raw = {**raw, "status": "supported"}
        if not valid_obs and not document_refs:
            reasons.append("product_evidence_missing")
        # A report/test check cannot be closed using a photograph alone.
        if legal_basis_required and check not in set(package.get("selectedCheckIds") or []) and not document_refs:
            reasons.append("document_evidence_required")
        reason = str(raw.get("reason") or "")[:1600]
        applicability = str(raw.get("applicabilityReason") or "")[:1200]
        if not reason.strip() or not applicability.strip():
            reasons.append("reason_missing")
        proposed = raw.get("status")
        status = proposed if proposed in {"supported", "blocked", "not_applicable"} and not reasons else "unknown"
        output.append({"market": market, "checkId": check, "status": status,
            "reason": reason, "applicabilityReason": applicability,
            "citationIds": list(dict.fromkeys(valid_refs)) if legal_basis_required else [], "observationIds": valid_obs,
            "documentEvidence": document_refs, "verificationIssues": sorted(set(reasons)),
            "verificationVersion": "review-links/v1"})
    return output


def reconcile_evidence_findings(package: dict, markets: list[str]) -> None:
    """Close a generic evidence request only after every market supports it.

    Never closes a suspected defect. Deferred test/document checks must have
    an exact uploaded-file excerpt, already validated by validate_review_claims.
    """
    claims = {(c["market"], c["checkId"]): c for c in package.get("reviewClaims", [])}
    selected = set(package.get("selectedCheckIds") or [])
    retained = []
    resolved = []
    for finding in package.get("findings", []):
        check = finding.get("checkId")
        linked = [claims.get((market, check)) for market in markets]
        satisfied = bool(markets) and all(
            claim and claim.get("status") in {"supported", "not_applicable"}
            and not claim.get("verificationIssues")
            and (check in selected or claim.get("documentEvidence"))
            for claim in linked
        )
        if finding.get("assessment") == "evidence_needed" and satisfied:
            resolved.append({"findingId": finding.get("findingId"), "checkId": check,
                "reason": "validated_review_evidence", "markets": list(markets)})
        else:
            retained.append(finding)
    package["findings"] = retained
    package["resolvedEvidenceRequests"] = resolved
