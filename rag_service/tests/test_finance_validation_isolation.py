"""Regression tests for Fix B (financial validation isolation).

Background: the KB-anchored pipeline emits a real compliance report (verified
17/17 quote-matches) and a separately emitted profit/finance sub-report.
The finance sub-report's structured fields (currency/costComparison/etc.)
are validated by a Pydantic StructuredProfitFields model; when LLM output
hallucinates bad numbers, validation fails. Before Fix B this caused the
ENTIRE package's `validationStatus` to flip to "invalid", which surfaced as
REPORT_PACKAGE_NOT_VERIFIED → status=degraded → source=fallback → red
DegradedBanner on the user-facing result page. The compliance report was
actually fine.

After Fix B the finance failure is recorded under
`auditMetadata.finance.validationStatus="invalid"` and surfaces as a
*warning* (FINANCE_DATA_INVALID), keeping the scan as status=ready /
source=real. The profit page reads the finance field to render its own
"数据不可用" notice.
"""
from __future__ import annotations

import asyncio
import hashlib

import pytest

from rag_service.application.scans import (
    ScanService,
    ScanSubmission,
    SubmittedUpload,
)
from rag_service.domain.scans import ScanSession
from rag_service.infrastructure.file_backend import FileBackend

PNG = b"\x89PNG\r\n\x1a\n" + b"test-image"


def _submission() -> ScanSubmission:
    return ScanSubmission(
        query="check charger",
        product="65W charger",
        category="electronics",
        markets=["EU"],
        uploads=[
            SubmittedUpload(
                kind="image",
                name="front.png",
                content_type="image/png",
                content=PNG,
            )
        ],
    )


def test_finance_invalid_does_not_downgrade_status(tmp_path):
    """Finance validation failure must not flip the package to degraded."""
    async def scenario():
        # Build a package with a valid compliance report and a deliberately
        # broken structuredFields — this is the exact failure shape that
        # triggered the false-positive degraded banner in production.
        bad_profit = {
            "currency": "INVALID_CURRENCY_TOO_LONG_FOR_PYDANTIC",
            "costComparison": {
                "barebone": {"totalUsd": "not-a-number", "breakdown": []},
                "compliant": {"totalUsd": None, "breakdown": "garbage"},
            },
        }
        package = {
            "productDossier": {
                "product": "65W charger",
                "category": "electronics",
                "markets": ["EU"],
                "query": "compliance scan",
            },
            "complianceReport": "# 真实合规报告\n\n合规判定: D 级。",
            "profitReport": {
                "markdown": "利润数据 LLM 幻觉",
                "structuredFields": bad_profit,
            },
            "roadmap": {"items": []},
            "decisionView": {
                "riskLevel": "HIGH",
                "summary": "需要补充铭牌图",
                "nodes": [],
            },
            "evidenceBundles": {"visual": [], "retrieval": [], "generation": []},
            "auditMetadata": {
                "schemaVersion": "report-package/v1",
                "generatedAt": "2026-09-12T07:27:50+00:00",
                "validationStatus": "normalized",
                "verificationMode": "kb_exact_quote",
            },
            "citations": [
                {
                    "doc_id": "EU-2011-65",
                    "article_id": "art-4",
                    "official_citation": "2011/65/EU Art. 4",
                    "quote": "Annex II 列具体限值",
                    "match_status": "matched",
                }
            ],
        }
        raw = {
            "status": "REJECTED",
            "report": "# 真实合规报告",
            "agent_trace": [
                {"node": "vision", "durationMs": 5054},
                {"node": "generate", "status": "success", "durationMs": 48484},
                {"node": "verify", "status": "success", "matched": 1},
            ],
            "loop_count": 0,
            "documents": [],
            "report_package": package,
        }

        async def runner(payload):
            return raw

        backend = FileBackend(tmp_path)
        service = ScanService(backend, runner=runner)
        created = await service.create_scan(_submission())
        await service.wait_for_idle()
        public = service.get_scan(created.session_id, created.access_token)

        # The key invariant: package-level validation stayed valid/normalized,
        # so the scan is NOT degraded and source is "real".
        assert public["status"] == "ready", (
            f"expected ready, got {public['status']!r}; "
            f"degradedReasons={public['result'].get('degradedReasons')}"
        )
        assert public["result"]["source"] == "real", (
            f"expected source=real, got {public['result']['source']!r}"
        )
        assert "REPORT_PACKAGE_NOT_VERIFIED" not in public["result"]["degradedReasons"], (
            "finance failure must not flip package-level validation"
        )

        # Finance-specific warning is present so the profit page can render
        # its own notice.
        assert "FINANCE_DATA_INVALID" in public["result"]["warnings"], (
            f"expected FINANCE_DATA_INVALID warning, got {public['result']['warnings']!r}"
        )

        # And the structured finance field is exposed on the package itself.
        pkg = public["result"]["reportPackage"]
        finance = pkg["auditMetadata"]["finance"]
        assert finance["validationStatus"] == "invalid", (
            f"expected finance.validationStatus=invalid, got {finance!r}"
        )

    asyncio.run(scenario())
