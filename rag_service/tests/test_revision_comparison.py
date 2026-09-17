from rag_service.application.revision_comparison import compare_revisions


def test_revision_comparison_joins_by_check_not_volatile_finding_id():
    old = {"revision": 1, "reportPackage": {"findings": [
        {"findingId": "a", "checkId": "label", "assessment": "evidence_needed"},
        {"checkId": "power", "assessment": "suspected_issue"}]}}
    new = {"revision": 2, "reportPackage": {"findings": [
        {"findingId": "b", "checkId": "label", "assessment": "confirmed_issue"},
        {"checkId": "wireless", "assessment": "evidence_needed"}]}}
    result = compare_revisions(old, new)
    assert result == {"previousRevision": 1, "added": ["wireless"], "removed": ["power"], "changed": ["label"], "remaining": 2}


def test_original_scan_has_no_comparison():
    assert compare_revisions({}, {"revision": 1}) is None


def test_market_claim_changes_keep_previous_and_current_reasons():
    old = {"revision": 1, "reportPackage": {"reviewClaims": [{"market": "EU", "checkId": "label", "status": "unknown", "reason": "Missing label", "citationIds": []}]}}
    new = {"revision": 2, "reportPackage": {"reviewClaims": [{"market": "EU", "checkId": "label", "status": "unknown", "reason": "Label received; source unverified", "citationIds": ["EU-test#art-1"]}]}}
    changes = compare_revisions(old, new)["marketChanges"]
    assert changes[0]["beforeReason"] == "Missing label"
    assert changes[0]["afterReason"] == "Label received; source unverified"
    assert changes[0]["evidenceChanged"]
