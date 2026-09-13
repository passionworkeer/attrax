"""Finance schema tests — audit 2026-09-13 §10.2.

Two contract changes:
1. ``gp`` may be negative (a real loss). The old non-negative constraint
   silently clamped losses to 0 to pass validation.
2. (Frontend-side, mirrored here for the record) an all-zero
   costComparison carries no information and renders as 待询价 — the
   backend keeps validating it as structurally fine; presentation of
   "unknown" happens at the adapter/synthesizer boundary.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from rag_service.schemas.report_package import FinancialCostSummary


def _summary(**overrides):
    base = dict(
        bom=3.0, packaging=0.5, cert=0.2, epr=0.0,
        logistics=0.3, warranty=0.0, asp=5.0, total=4.0, gp=1.0,
    )
    base.update(overrides)
    return FinancialCostSummary(**base)


class TestFinancialCostSummary:
    def test_baseline_valid(self):
        assert _summary().gp == 1.0

    def test_negative_gp_allowed_when_identity_holds(self):
        # Sell at 2.0 against 4.0 cost → gp = -2.0 (a loss). Must validate.
        summary = _summary(asp=2.0, gp=-2.0)
        assert summary.gp == -2.0

    def test_negative_cost_field_still_rejected(self):
        with pytest.raises(ValidationError):
            _summary(bom=-1.0)
        with pytest.raises(ValidationError):
            _summary(asp=-5.0)

    def test_margin_identity_still_enforced(self):
        with pytest.raises(ValidationError):
            _summary(gp=2.0)  # asp - total = 1.0, not 2.0

    def test_non_finite_rejected(self):
        with pytest.raises(ValidationError):
            _summary(gp=float("inf"))
        with pytest.raises(ValidationError):
            _summary(bom=float("nan"))

    def test_all_zero_is_structurally_valid(self):
        # The zero-filled shape the model emits for "unknown" passes the
        # numeric checks — the frontend synthesizer is responsible for
        # rendering it as 待询价 instead of $0.00 (see
        # tests/unit/profit-report-unknown-money.test.ts).
        summary = FinancialCostSummary(
            bom=0, packaging=0, cert=0, epr=0,
            logistics=0, warranty=0, asp=0, total=0, gp=0,
        )
        assert summary.gp == 0
