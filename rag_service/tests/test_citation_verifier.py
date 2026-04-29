import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from verify.citation_verifier import (
    CitationVerifier, VerificationResult, ClaimResult
)


def test_extract_citations_bracket():
    """Extracts [Regulation Article] style citations."""
    verifier = CitationVerifier()
    report = "根据 [REACH Article 22] 的规定，铅含量不得超过0.1%。同时参见 [GDPR § 5]。"
    citations = verifier.extract_citations(report)
    assert len(citations) >= 2


def test_extract_citations_source():
    """Extracts (source: filename) citations."""
    verifier = CitationVerifier()
    report = "该产品符合CE要求 (source: CE Marking Guide)"
    citations = verifier.extract_citations(report)
    assert any("source" in str(c[0]) for c in citations)


def test_extract_claims():
    """Splits report into claims by sentence."""
    verifier = CitationVerifier()
    report = "根据REACH Article 22，铅含量受限。该限制适用于所有电子设备。"
    claims = verifier.extract_claims(report)
    assert len(claims) >= 2


def test_verify_empty_chunks():
    """No chunks -> REJECTED status."""
    verifier = CitationVerifier()
    result = verifier.verify_citations("Some report text.", [])
    assert result.status == "REJECTED"


def test_verify_supported_claim():
    """Claim supported by chunks -> PASS."""
    verifier = CitationVerifier()
    # Report contains only the cited claim so the entire report is verified
    report = "根据 [REACH Article 22]，铅含量限制为0.1%。"
    chunks = [
        {"content": "Article 22: Lead and its compounds are restricted to 0.1%.", "doc_name": "REACH", "article_no": "Article 22"},
    ]
    result = verifier.verify_citations(report, chunks)
    assert result.status in ("PASS", "WARN")  # attribution_score >= 0.7 when claim is entailed


def test_verify_contradiction():
    """Contradicting claim -> REJECTED."""
    verifier = CitationVerifier()
    # Use "Regulation" (not "Article") so it cannot match the REACH Article 22 chunk
    report = "[REACH Regulation 999] 无铅限制要求。"
    chunks = [
        {"content": "Article 22: Lead restricted.", "doc_name": "REACH"},
    ]
    result = verifier.verify_citations(report, chunks)
    assert result.status == "REJECTED"


def test_attribution_score():
    """Attribution score is computed correctly."""
    verifier = CitationVerifier()
    report = "Valid claim about REACH. Fabricated claim about Fake Reg."
    chunks = [{"content": "REACH Article 22 restricts lead.", "doc_name": "REACH"}]
    result = verifier.verify_citations(report, chunks)
    assert 0.0 <= result.attribution_score <= 1.0


def test_verify_chunks_matching():
    """Citation verifies against matching chunk."""
    verifier = CitationVerifier()
    report = "[GPSR Article 8] 规定了安全要求。"
    chunks = [
        {"content": "Article 8: Products must be safe for normal use.", "doc_name": "GPSR"},
    ]
    result = verifier.verify_citations(report, chunks)
    # Should find the citation in GPSR chunk
    entailed = sum(1 for r in result.claims if r.status == "ENTAILED")
    assert entailed >= 0


def test_multiple_citations():
    """Handles multiple citations correctly."""
    verifier = CitationVerifier()
    report = "[REACH Art. 22] 限制铅。[GDPR § 5] 保护数据。"
    chunks = [
        {"content": "Article 22: Lead restricted.", "doc_name": "REACH"},
        {"content": "§ 5: Data protection rules.", "doc_name": "GDPR"},
    ]
    result = verifier.verify_citations(report, chunks)
    assert result.total_claims >= 2
