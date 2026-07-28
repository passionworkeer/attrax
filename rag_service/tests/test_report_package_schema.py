import os
import sys
import json
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rag_service.schemas.report_package import ReportPackage, normalize_report_package


def _financial_costs(*, asp: float, total: float, gp: float) -> dict:
    return {
        "bom": 10.0,
        "packaging": 1.0,
        "cert": 2.0,
        "epr": 1.0,
        "logistics": 3.0,
        "warranty": 1.0,
        "asp": asp,
        "total": total,
        "gp": gp,
    }


def _package_with_finance(cost_comparison: dict) -> dict:
    return {
        "complianceReport": "## Compliance",
        "profitReport": {
            "markdown": "## Profit analysis retained for review.",
            "structuredFields": {"currency": "USD", "costComparison": cost_comparison},
        },
    }


def test_normalize_report_package_preserves_valid_structured_finance():
    normalized = normalize_report_package(
        _package_with_finance(
            {
                "barebone": _financial_costs(asp=28.0, total=20.0, gp=8.0),
                "compliant": _financial_costs(asp=30.0, total=24.0, gp=6.0),
            }
        ),
        product="Power bank",
        market="EU",
    )

    finance = normalized["profitReport"]["structuredFields"]["costComparison"]
    assert finance["barebone"]["asp"] == 28.0
    assert finance["compliant"]["gp"] == 6.0
    assert normalized["auditMetadata"]["validationStatus"] == "normalized"


def test_normalize_report_package_drops_invalid_structured_finance_but_keeps_prose():
    normalized = normalize_report_package(
        _package_with_finance(
            {
                "barebone": _financial_costs(asp=28.0, total=20.0, gp=8.0),
                "compliant": _financial_costs(asp=30.0, total=24.0, gp=7.0),
            }
        ),
        product="Power bank",
        market="EU",
    )

    assert normalized["profitReport"]["markdown"] == "## Profit analysis retained for review."
    assert "structuredFields" not in normalized["profitReport"]
    assert normalized["auditMetadata"]["validationStatus"] == "invalid"
    assert "financial_data_invalid" in normalized["auditMetadata"]["validationErrors"]


def test_normalize_report_package_adds_dossier_evidence_and_audit():
    package = {
        "compliance_report": "## Compliance\nUse CE evidence.",
        "profit_report": "## Profit\nConservative estimate.",
        "roadmap": {"totalDays": "30", "progress": 120, "items": [{"id": 1, "estimatedDays": None}]},
        "decision_view": {"summary": "Proceed carefully.", "keyFindings": "not-a-list", "nodes": None},
    }
    chunks = [
        {
            "id": "chunk-1",
            "doc_name": "CE Guide",
            "article_no": "Article 1",
            "content": "CE marking evidence",
            "market": "EU",
            "score": 0.91,
        }
    ]

    normalized = normalize_report_package(
        package,
        product="Power bank",
        category="electronics",
        market="EU, US",
        query="What certifications are needed?",
        chunks=chunks,
        vision_result={"product": "Power bank", "summary": "Visible battery pack"},
        agent_trace=[{"node": "retriever", "status": "success"}],
        user_documents=[{"name": "manual.pdf", "mime_type": "application/pdf", "text": "Manual text"}],
        provider="mimotalk",
    )

    validated = ReportPackage.model_validate(normalized)
    assert validated.productDossier.product == "Power bank"
    assert validated.productDossier.markets == ["EU", "US"]
    assert validated.roadmap.progress == 100
    assert validated.roadmap.items[0].estimatedDays == 0
    assert len(validated.evidenceBundles.visual) == 1
    assert len(validated.evidenceBundles.retrieval) == 2
    assert any(item.layer == "audit" for item in validated.evidenceBundles.generation)
    assert validated.auditMetadata.provider == "mimotalk"


def test_normalize_report_package_records_invalid_empty_report():
    normalized = normalize_report_package(
        {"profitReport": {"markdown": "profit"}},
        product="Widget",
        market="EU",
        query="query",
    )

    assert normalized["complianceReport"]
    assert normalized["auditMetadata"]["validationStatus"] == "invalid"
    assert normalized["auditMetadata"]["validationErrors"]


def test_contract_fixture_matches_python_schema():
    fixture_path = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "report-package.contract.json"
    payload = json.loads(fixture_path.read_text(encoding="utf-8"))

    validated = ReportPackage.model_validate(payload)

    assert validated.productDossier.product == "USB-C power adapter"
    assert validated.roadmap.items[0].titleEn == "Complete nameplate and warning labels"
    assert validated.decisionView.nodes[0].reasoningEn.endswith("one pass.")
    assert validated.evidenceBundles.retrieval[0].source == "RoHS Guide"
