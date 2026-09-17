from copy import deepcopy
from rag_service.verify.review_claims import validate_review_claims


def package():
    return {"selectedCheckIds": ["nameplate"], "observations": [{"observationId": "photo-1", "checkId": "nameplate"}],
        "citations": [{"doc_id": "EU-test", "article_id": "art-1", "match_status": "matched"}],
        "reviewClaims": [{"market": "EU", "checkId": "nameplate", "status": "supported", "reason": "Label identifies model",
            "applicabilityReason": "Model falls within this requirement", "citationIds": ["EU-test#art-1"], "observationIds": ["photo-1"]}]}


def test_keeps_valid_links_but_not_out_of_market_or_unknown_observations():
    data = package()
    assert validate_review_claims(data, ["EU"])[0]["status"] == "supported"
    data["reviewClaims"][0]["observationIds"] = ["invented"]
    assert validate_review_claims(data, ["EU"])[0]["status"] == "unknown"
    data = package()
    data["reviewClaims"][0]["market"] = "US"
    claim = validate_review_claims(data, ["US"])[0]
    assert claim["status"] == "unknown"
    assert claim["citationIds"] == []


def test_unverified_quote_cannot_support_conclusion():
    data = package()
    data["citations"][0]["match_status"] = "fallback_article_only"
    assert validate_review_claims(data, ["EU"])[0]["status"] == "unknown"


def test_readable_identity_is_recorded_without_irrelevant_law():
    data = {"selectedCheckIds": ["common.brand_model.visible"],
        "observations": [{"observationId": "o1", "checkId": "common.brand_model.visible", "visibility": "present_readable", "observedText": "LEGO 76429"}],
        "citations": [], "reviewClaims": [{"market": "US", "checkId": "common.brand_model.visible", "status": "unknown",
            "reason": "LEGO 76429 is readable", "applicabilityReason": "Identity record", "citationIds": [], "observationIds": []}]}
    claim = validate_review_claims(data, ["US"])[0]
    assert claim["status"] == "supported"
    assert claim["observationIds"] == ["o1"]
    assert claim["verificationIssues"] == []


def test_clear_visual_hazard_scope_becomes_limited_supported_judgment():
    data = {"selectedCheckIds": ["toy.sharp_edges.visible"],
        "observations": [{"observationId": "o1", "checkId": "toy.sharp_edges.visible", "visibility": "absent_in_visible_scope"}],
        "findings": [], "citations": [], "reviewClaims": [{"market": "US", "checkId": "toy.sharp_edges.visible", "status": "unknown",
            "reason": "No visible sharp damage", "applicabilityReason": "Visual screen", "citationIds": [], "observationIds": []}]}
    claim = validate_review_claims(data, ["US"])[0]
    assert claim["status"] == "supported"
    assert claim["verificationIssues"] == []


def test_known_warning_check_binds_verified_substantive_article():
    data = {"selectedCheckIds": ["toy.warnings.text"],
        "observations": [{"observationId": "o1", "checkId": "toy.warnings.text", "visibility": "present_readable"}],
        "citations": [
            {"doc_id": "US-16-CFR-1263", "article_id": "section-1263-1-a", "match_status": "matched"},
            {"doc_id": "US-16-CFR-1263", "article_id": "guidance-product-requirements", "match_status": "matched"},
        ],
        "reviewClaims": [{"market": "US", "checkId": "toy.warnings.text", "status": "supported",
            "reason": "Warning is visible", "applicabilityReason": "Product contains coin batteries",
            "citationIds": ["US-16-CFR-1263#section-1263-1-a"], "observationIds": ["o1"]}]}
    claim = validate_review_claims(data, ["US"])[0]
    assert claim["status"] == "supported"
    assert "US-16-CFR-1263#guidance-product-requirements" in claim["citationIds"]
    assert "scope_only_legal_basis" not in claim["verificationIssues"]


def test_document_claim_requires_exact_excerpt_from_actual_input():
    data = package()
    data["selectedCheckIds"] = []
    data["findings"] = [{"checkId": "nameplate"}]
    data["productEvidence"] = {"documents": [{"documentIndex": 0, "name": "spec.txt", "includedText": "Model X safety report passed"}]}
    raw = data["reviewClaims"][0]
    raw["observationIds"] = []
    raw["documentEvidence"] = [{"documentIndex": 0, "quote": "Model X safety report passed"}]
    original = deepcopy(data)
    assert validate_review_claims(data, ["EU"])[0]["status"] == "supported"
    assert data == original
    raw["documentEvidence"][0]["quote"] = "Fabricated report"
    assert validate_review_claims(data, ["EU"])[0]["status"] == "unknown"


def test_unknown_check_and_duplicate_are_not_counted_as_coverage():
    data = package()
    data["reviewClaims"].append(deepcopy(data["reviewClaims"][0]))
    data["reviewClaims"].append({"market": "EU", "checkId": "invented"})
    assert len(validate_review_claims(data, ["EU"])) == 1


def test_legal_excerpt_ellipsis_does_not_join_omitted_qualifications():
    from rag_service.verify.quote_matcher import match_quote
    article = "Each consumer product shall comply with the standard except exempt products."
    quote = "Each consumer product shall comply with the standard..."
    span, status = match_quote(article, quote)
    assert status == "matched"
    assert article[slice(*span)] == quote[:-3]
    assert match_quote(article, "Each consumer product...the standard")[1] == "fallback_article_only"
    assert match_quote(article, "fabricated product shall comply with the standard...")[1] == "fallback_article_only"


def test_document_evidence_closes_request_only_for_all_markets():
    from rag_service.verify.review_claims import reconcile_evidence_findings
    data = {"selectedCheckIds": [], "findings": [
        {"findingId": "f1", "checkId": "test", "assessment": "evidence_needed"},
        {"findingId": "f2", "checkId": "test", "assessment": "suspected_issue"}],
        "reviewClaims": [{"market": "EU", "checkId": "test", "status": "supported", "verificationIssues": [], "documentEvidence": [{"quote": "exact evidence"}]}]}
    original = deepcopy(data)
    reconcile_evidence_findings(data, ["EU", "US"])
    assert len(data["findings"]) == 2
    reconcile_evidence_findings(data, ["EU"])
    assert [f["findingId"] for f in data["findings"]] == ["f2"]
    assert data["resolvedEvidenceRequests"][0]["checkId"] == "test"
    original["reviewClaims"][0]["documentEvidence"] = []
    reconcile_evidence_findings(original, ["EU"])
    assert len(original["findings"]) == 2
