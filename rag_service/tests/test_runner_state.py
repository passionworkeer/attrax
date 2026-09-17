"""State-merge and terminal-status logic in the linear pipeline runner.

Both helpers were only reached indirectly, through the end-to-end KB pipeline
test. They deserve direct coverage because they carry invariants that are
cheap to break and expensive to notice:

  * `_merge` is what preserves the "agent_trace is append-only" audit
    invariant after LangGraph's collapse. A node returns only its own new
    trace entry; if merge ever stopped appending, every scan would report a
    single trace step and the audit trail would silently shrink.
  * `_final_status` is the "never grant a fake PASS" gate. It downgrades to
    UNKNOWN whenever the package failed validation, fell back to an
    unverified template, or the generation text is an error string. A
    regression here would let a degraded scan display as PASS.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

from rag_service.pipeline.runner import _final_status, _merge  # noqa: E402


def package(verdict: str | None = "PASS", validation_status: str | None = None) -> dict:
    audit: dict = {}
    if validation_status is not None:
        audit["validationStatus"] = validation_status
    decision: dict = {}
    if verdict is not None:
        decision["verdict"] = verdict
    return {"decisionView": decision, "auditMetadata": audit}


class TestMergeState:
    def test_appends_agent_trace_instead_of_overwriting(self):
        state = {"agent_trace": [{"node": "vision"}]}
        merged = _merge(state, {"agent_trace": [{"node": "generate"}]})
        assert merged["agent_trace"] == [{"node": "vision"}, {"node": "generate"}]

    def test_agent_trace_starts_empty_when_absent(self):
        merged = _merge({}, {"agent_trace": [{"node": "vision"}]})
        assert merged["agent_trace"] == [{"node": "vision"}]

    def test_other_keys_overwrite(self):
        state = {"query": "old", "report_package": {"a": 1}}
        merged = _merge(state, {"query": "new", "report_package": {"b": 2}})
        assert merged["query"] == "new"
        assert merged["report_package"] == {"b": 2}

    def test_keys_absent_from_update_are_preserved(self):
        merged = _merge({"images": [1], "query": "q"}, {"query": "q2"})
        assert merged["images"] == [1]

    def test_does_not_mutate_the_input_state(self):
        state = {"agent_trace": [{"node": "vision"}], "query": "q"}
        _merge(state, {"agent_trace": [{"node": "verify"}], "query": "changed"})
        assert state == {"agent_trace": [{"node": "vision"}], "query": "q"}

    def test_non_list_agent_trace_overwrites_rather_than_appending(self):
        # The append path is guarded by isinstance(value, list); anything else
        # must fall through to a plain overwrite instead of raising.
        merged = _merge({"agent_trace": [{"node": "vision"}]}, {"agent_trace": None})
        assert merged["agent_trace"] is None

    def test_update_does_not_alias_the_input_trace_list(self):
        state = {"agent_trace": [{"node": "vision"}]}
        update = {"agent_trace": [{"node": "generate"}]}
        merged = _merge(state, update)
        merged["agent_trace"].append({"node": "verify"})
        assert update["agent_trace"] == [{"node": "generate"}]


class TestFinalStatus:
    @pytest.mark.parametrize("verdict", ["PASS", "WARN", "REJECTED", "UNKNOWN"])
    def test_passes_through_known_verdicts(self, verdict):
        state = {"report_package": package(verdict), "generation": "real report text"}
        assert _final_status(state) == verdict

    @pytest.mark.parametrize(
        "validation_status",
        ["invalid", "fallback"],
    )
    def test_unvalidated_packages_never_report_pass(self, validation_status):
        # Even with a PASS verdict and real generation text, a package that
        # failed validation or fell back must not be presented as a verdict.
        state = {
            "report_package": package("PASS", validation_status),
            "generation": "real report text",
        }
        assert _final_status(state) == "UNKNOWN"

    def test_accepted_validation_statuses_do_not_downgrade(self):
        state = {
            "report_package": package("WARN", "normalized"),
            "generation": "real report text",
        }
        assert _final_status(state) == "WARN"

    @pytest.mark.parametrize(
        "generation",
        ["", "   ", "错误：报告生成失败", "error: boom", "Error"],
    )
    def test_useless_generation_text_downgrades_to_unknown(self, generation):
        state = {"report_package": package("PASS"), "generation": generation}
        assert _final_status(state) == "UNKNOWN"

    def test_missing_generation_key_downgrades_to_unknown(self):
        assert _final_status({"report_package": package("PASS")}) == "UNKNOWN"

    def test_unknown_verdict_string_downgrades(self):
        state = {"report_package": package("looks-fine"), "generation": "text"}
        assert _final_status(state) == "UNKNOWN"

    def test_missing_verdict_downgrades(self):
        state = {"report_package": package(None), "generation": "text"}
        assert _final_status(state) == "UNKNOWN"

    def test_lowercase_verdict_is_upper_cased(self):
        state = {"report_package": package("pass"), "generation": "text"}
        assert _final_status(state) == "PASS"

    @pytest.mark.parametrize("state", [{}, {"report_package": None}, {"report_package": {}}])
    def test_empty_states_are_unknown_not_an_error(self, state):
        assert _final_status(state) == "UNKNOWN"
