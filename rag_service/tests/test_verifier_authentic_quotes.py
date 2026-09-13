import pytest
from rag_service.pipeline.nodes.verifier import verifier_node, _attach_canonical_excerpts, _ARTICLE_TEXT_CACHE
from rag_service.pipeline.state import GraphState


def test_attach_canonical_excerpts_preserves_authentic_quotes():
    # Pre-populate cache
    _ARTICLE_TEXT_CACHE[("EU-2023-1542", "art-13")] = (
        "From 18 August 2024, batteries shall be marked with the CE symbol and the QR code."
    )

    citations = [
        {
            "doc_id": "EU-2023-1542",
            "article_id": "art-13",
            "quote": "Batteries must have CE mark.",
            "match_status": "fallback_article_only",
        }
    ]

    attached = _attach_canonical_excerpts(citations)
    assert attached == 1
    assert citations[0]["match_status"] == "fallback_article_only"
    # Authentic LLM quote must NOT be overwritten!
    assert citations[0]["quote"] == "Batteries must have CE mark."
    # Canonical excerpt attached
    assert "From 18 August 2024" in citations[0]["canonical_excerpt"]
    assert citations[0]["quote_provenance"] == "llm_paraphrase_unverified"


def test_attach_canonical_excerpts_skips_matched_or_unmatched():
    citations = [
        {
            "doc_id": "EU-2023-1542",
            "article_id": "art-13",
            "quote": "Exact verbatim text",
            "match_status": "matched",
        },
        {
            "doc_id": "UNKNOWN",
            "article_id": "art-1",
            "quote": "Random text",
            "match_status": "unmatched",
        },
    ]

    attached = _attach_canonical_excerpts(citations)
    assert attached == 0
    assert "canonical_excerpt" not in citations[0]
    assert "canonical_excerpt" not in citations[1]


def test_verifier_node_empty_citations():
    state: GraphState = {
        "report_package": {
            "citations": [],
        }
    }

    result = verifier_node(state)
    assert result["agent_trace"][0]["node"] == "verify"
    assert result["agent_trace"][0]["status"] == "no_citations"


def test_verifier_node_with_real_citations():
    _ARTICLE_TEXT_CACHE[("EU-2023-1542", "art-13")] = (
        "Batteries shall be marked with the CE symbol."
    )

    state: GraphState = {
        "report_package": {
            "citations": [
                {
                    "doc_id": "EU-2023-1542",
                    "article_id": "art-13",
                    "quote": "Batteries shall be marked with the CE symbol.",
                }
            ],
            "auditMetadata": {},
        }
    }

    result = verifier_node(state)
    assert result["agent_trace"][0]["status"] == "success"
    assert result["agent_trace"][0]["matched"] == 1
    rp = result["report_package"]
    assert rp["auditMetadata"]["verificationMode"] == "kb_exact_quote"
    assert "evidencePack" in rp
