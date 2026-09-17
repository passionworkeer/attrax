from copy import deepcopy

from rag_service.verify.document_excerpts import document_excerpts, resolve_document_excerpts
from rag_service.verify.review_claims import validate_review_claims


def test_selected_excerpt_keeps_pdf_spelling_and_is_accepted():
    text = "Product: Sorting Hat™\nThis item conforms to ASTM F963-17.\n"
    docs = [{"documentIndex": 1, "name": "certificate.pdf", "includedText": text}]
    package = {"selectedCheckIds": [], "findings": [{"checkId": "test"}],
        "productEvidence": {"documents": docs},
        "citations": [{"doc_id": "US-test", "article_id": "a1", "match_status": "matched"}],
        "reviewClaims": [{"market": "US", "checkId": "test", "status": "supported",
            "reason": "Certificate lists this standard", "applicabilityReason": "Same stated product",
            "citationIds": ["US-test#a1"], "documentEvidence": [{"documentIndex": 1, "excerptId": "e2"}]}]}
    original_docs = deepcopy(docs)
    resolve_document_excerpts(package, docs)
    claim = validate_review_claims(package, ["US"])[0]
    assert claim["status"] == "supported"
    assert claim["documentEvidence"][0]["quote"] == "This item conforms to ASTM F963-17."
    assert docs == original_docs


def test_unknown_excerpt_or_wrong_document_does_not_resolve():
    docs = [{"documentIndex": 0, "includedText": "This is the actual evidence."}]
    refs = [{"documentIndex": 0, "excerptId": "invented", "quote": "This is the actual evidence."},
        {"documentIndex": 8, "excerptId": "e1"}]
    package = {"reviewClaims": [{"documentEvidence": refs}]}
    resolve_document_excerpts(package, docs)
    assert all(ref["quote"] == "" for ref in refs)


def test_all_excerpts_are_contiguous_substrings_not_joined_sentences():
    text = "A" * 520 + "\nA condition applies only to this version.\n"
    excerpts = document_excerpts(text)
    assert len(excerpts) == 4
    assert all(quote in text for quote in excerpts.values())


def test_inaccurate_law_quote_is_audited_and_source_excerpt_is_labelled():
    from rag_service.pipeline.nodes.generator import _resolve_claim_citations
    package = {"citations": [{"doc_id": "US-test", "article_id": "a1", "quote": "must...always comply"}],
        "reviewClaims": [{"citationIds": ["US-test#a1"]}]}
    _resolve_claim_citations(package, {"US-test#a1": "A real condition applies except for exempt products."})
    citation = package["citations"][0]
    assert citation["model_quote"] == "must...always comply"
    assert citation["model_quote_status"] == "unverified"
    assert citation["quote_provenance"] == "canonical_article_excerpt"
    assert "except for exempt products" in citation["quote"]


def test_scope_paragraph_alone_cannot_prove_warning_compliance():
    package = {"selectedCheckIds": ["toy.warnings.text"],
        "observations": [{"observationId": "o1", "checkId": "toy.warnings.text"}],
        "citations": [{"doc_id": "US-16-CFR-1263", "article_id": "section-1263-1-a", "match_status": "matched"}],
        "reviewClaims": [{"market": "US", "checkId": "toy.warnings.text", "status": "supported",
            "reason": "English warning present", "applicabilityReason": "Battery product",
            "observationIds": ["o1"], "citationIds": ["US-16-CFR-1263#section-1263-1-a"]}]}
    claim = validate_review_claims(package, ["US"])[0]
    assert claim["status"] == "unknown"
    assert "scope_only_legal_basis" in claim["verificationIssues"]
