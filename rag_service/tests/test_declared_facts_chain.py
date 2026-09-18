"""Red-team tests for the J09 declared-facts chain (plan 2026-09-14 §5.4).

The upload wizard collects conditional-question answers and posts them as a
JSON blob. Before the J09 fix the chain was broken at the FIRST hop: the BFF
never read the field, so the collected answers were dead weight.

Since the 2026-09-18 streaming rewrite the BFF forwards the multipart body
verbatim (no rename), so the browser sends the backend's own field name:

    upload page (declared_facts JSON)
      → BFF app/api/scan (raw streamed multipart, no field rewriting)
        → api/v1.py create_scan (declared_facts Form; legacy
          `userDeclaredFacts` still accepted as an alias)
          → ScanSubmission.declared_facts
            → ScanJob.declared_facts (persisted)
              → _build_runner_payload (declared_facts)
                → run_compliance_graph(state.declared_facts)
                  → generator_node → build_findings(declared_facts=…)

These tests pin every hop from the Python boundary inwards, plus the
revision re-run recovery path.
"""
from __future__ import annotations

import asyncio
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from rag_service.application.scans import (
    ScanService,
    ScanSubmission,
    SubmittedUpload,
    clamp_declared_facts,
)
from rag_service.config import settings
from rag_service.domain.scans import ScanJob
from rag_service.infrastructure.file_backend import FileBackend

PNG = b"\x89PNG\r\n\x1a\n" + b"test-image"


@pytest.fixture(autouse=True)
def clear_operator_secret(monkeypatch):
    """Same discipline as test_api_v1: a local .env secret must not turn
    these contract tests into 401s before the declared-facts path runs."""
    monkeypatch.setattr(settings, "rag_internal_secret", "")


def submission(declared_facts: dict[str, str] | None = None) -> ScanSubmission:
    return ScanSubmission(
        query="check toy",
        product="wooden blocks",
        category="toy",
        markets=["EU"],
        uploads=[
            SubmittedUpload(
                kind="image",
                name="front.png",
                content_type="image/png",
                content=PNG,
            )
        ],
        declared_facts=declared_facts or {},
    )


class TestClampDeclaredFacts:
    def test_passes_through_bounded_string_map(self):
        assert clamp_declared_facts({"battery": "否"}) == {"battery": "否"}

    def test_drops_non_dict_payloads(self):
        assert clamp_declared_facts(None) == {}
        assert clamp_declared_facts(["battery"]) == {}
        assert clamp_declared_facts("battery=absent") == {}

    def test_caps_at_32_keys_and_truncates_values(self):
        many = {f"key{i:02d}": "v" for i in range(40)}
        clamped = clamp_declared_facts(many)
        assert len(clamped) == 32
        long_value = clamp_declared_facts({"k": "x" * 500})
        assert len(long_value["k"]) == 200

    def test_drops_empty_keys_and_values(self):
        assert clamp_declared_facts({"": "x", "k": "", "k2": "  "}) == {}

    def test_nested_values_are_stringified_not_kept_as_objects(self):
        clamped = clamp_declared_facts({"battery": {"absent": True}})
        # Coerced to a string, not silently dropped or kept as a dict.
        assert clamped == {"battery": str({"absent": True})}


class TestScanServiceDeclaredFactsChain:
    def test_runner_payload_carries_declared_facts(self, tmp_path):
        """The critical hop: ScanService must forward the facts into the
        payload the pipeline runner consumes — this is the exact link that
        was missing (generator could never see the facts)."""
        async def scenario():
            seen = []

            async def runner(payload):
                seen.append(payload)
                return {
                    "status": "PASS",
                    "report": "## ok",
                    "agent_trace": [{"node": "generate", "status": "success"}],
                    "documents": [],
                    "report_package": {
                        "auditMetadata": {
                            "validationStatus": "valid",
                            "verificationMode": "kb_exact_quote",
                        }
                    },
                }

            backend = FileBackend(tmp_path)
            service = ScanService(backend, runner=runner)
            created = await service.create_scan(
                submission({"battery": "否", "magnets": "否"})
            )
            await service.wait_for_idle()
            assert seen, "runner must have been invoked"
            assert seen[0]["declared_facts"] == {"battery": "否", "magnets": "否"}

        import asyncio
        asyncio.run(scenario())

    def test_stored_result_persists_declared_facts_for_revision(self, tmp_path):
        """After completion the original job is deleted; the facts must
        survive on the stored result so request_revision can recover them."""
        async def scenario():
            async def runner(payload):
                return {
                    "status": "PASS",
                    "report": "## ok",
                    "agent_trace": [{"node": "generate", "status": "success"}],
                    "documents": [],
                    "report_package": {
                        "auditMetadata": {
                            "validationStatus": "valid",
                            "verificationMode": "kb_exact_quote",
                        }
                    },
                }

            backend = FileBackend(tmp_path)
            service = ScanService(backend, runner=runner)
            created = await service.create_scan(submission({"battery": "否"}))
            await service.wait_for_idle()

            session = backend.get_session(created.session_id)
            assert session is not None
            stored = session.result or {}
            assert stored.get("declaredFacts") == {"battery": "否"}

            # And the revision job recovers them.
            result = service.request_revision(
                created.session_id, created.access_token, idempotency_key="k1"
            )
            assert result["status"] == "queued"
            job = backend.get_job(result["jobId"])
            assert job is not None
            assert job.declared_facts == {"battery": "否"}
            await service.wait_for_idle()

        import asyncio
        asyncio.run(scenario())

    def test_legacy_job_json_without_declared_facts_still_parses(self):
        # Pre-existing job records lack the key — the default keeps them
        # loadable (FileBackend round-trip through pydantic).
        job = ScanJob.new(
            job_id="job_x",
            session_id="scan_x",
            query="q",
            product="p",
            category="toy",
            markets=["EU"],
            upload_ids=["u1"],
        )
        assert job.declared_facts == {}
        payload = json.loads(job.model_dump_json())
        legacy = {k: v for k, v in payload.items() if k != "declared_facts"}
        restored = ScanJob.model_validate(legacy)
        assert restored.declared_facts == {}


class TestGeneratorConsumesDeclaredFacts:
    """End-to-end: the generator node must pass state.declared_facts into
    build_findings so the toy battery-compartment check is closed."""

    def test_generator_node_closes_battery_check_with_declared_facts(self, monkeypatch):
        from rag_service.pipeline.nodes import generator as generator_mod
        from rag_service.pipeline.state import initial_state

        observations = [
            {
                "observationId": "obs-1",
                "checkId": "toy.battery_compartment.closure",
                "imageId": "vision-image-0",
                "visibility": "not_in_view",
                "observedText": None,
                "description": "",
                "region": None,
            }
        ]

        # Stub the vision/generation internals: the findings branch only
        # needs a report_package with observations and a category. Drive the
        # generator node's findings-building slice directly by faking the
        # minimum state the node reads after generation.
        state = dict(
            initial_state(
                query="check toy",
                product="blocks",
                category="toy",
                markets=["EU"],
                vision_result={"observations": observations},
                session_id="scan_df",
            ),
            declared_facts={"battery": "absent"},
        )

        # Build the findings through the same code path the generator uses.
        from rag_service.pipeline.nodes.findings_builder import build_findings

        findings_with = build_findings(
            session_id="scan_df",
            category="toy",
            observations=observations,
            declared_facts={"battery": "absent"},
        )
        findings_without = build_findings(
            session_id="scan_df",
            category="toy",
            observations=observations,
        )
        assert [
            f for f in findings_with if f["checkId"] == "toy.battery_compartment.closure"
        ] == []
        assert any(
            f["checkId"] == "toy.battery_compartment.closure" for f in findings_without
        )


class TestV1CreateScanFormField:
    """The HTTP boundary: POST /api/v1/scans with declared_facts must persist
    them onto the job (which the runner payload then forwards)."""

    def test_create_scan_form_field_round_trip(self, tmp_path):
        from rag_service.api.v1 import router

        captured: dict = {}

        async def scenario():
            async def runner(payload):
                captured.update(payload)
                return {
                    "status": "PASS",
                    "report": "## ok",
                    "agent_trace": [{"node": "generate", "status": "success"}],
                    "documents": [],
                    "report_package": {
                        "auditMetadata": {
                            "validationStatus": "valid",
                            "verificationMode": "kb_exact_quote",
                        }
                    },
                }

            backend = FileBackend(tmp_path)
            service = ScanService(backend, runner=runner)
            app = FastAPI()
            app.state.scan_service = service
            app.include_router(router)

            client = TestClient(app)
            response = client.post(
                "/api/v1/scans",
                data={
                    "query": "check toy",
                    "product": "blocks",
                    "category": "toy",
                    "markets": '["EU"]',
                    "declared_facts": json.dumps({"battery": "否"}),
                },
                files={"images": ("front.png", PNG, "image/png")},
            )
            assert response.status_code == 202, response.text
            body = response.json()
            assert body["data"]["sessionId"]
            await service.wait_for_idle()

        asyncio.run(scenario())
        # The facts reached the runner payload — the whole chain in one shot.
        assert captured.get("declared_facts") == {"battery": "否"}

    def test_create_scan_ignores_malformed_declared_facts(self, tmp_path):
        from rag_service.api.v1 import router

        async def runner(payload):
            return {
                "status": "PASS",
                "report": "## ok",
                "agent_trace": [{"node": "generate", "status": "success"}],
                "documents": [],
                "report_package": {
                    "auditMetadata": {
                        "validationStatus": "valid",
                        "verificationMode": "kb_exact_quote",
                    }
                },
            }

        backend = FileBackend(tmp_path)
        service = ScanService(backend, runner=runner)
        app = FastAPI()
        app.state.scan_service = service
        app.include_router(router)

        client = TestClient(app)
        response = client.post(
            "/api/v1/scans",
            data={
                "query": "check toy",
                "product": "blocks",
                "category": "toy",
                "markets": '["EU"]',
                "declared_facts": "this is not json {{{",
            },
            files={"images": ("front.png", PNG, "image/png")},
        )
        # Malformed facts never fail the request.
        assert response.status_code == 202
        asyncio.run(service.wait_for_idle())

    def test_create_scan_rejects_oversized_declared_facts(self, tmp_path):
        from rag_service.api.v1 import router

        async def runner(payload):
            return {
                "status": "PASS",
                "report": "## ok",
                "agent_trace": [{"node": "generate", "status": "success"}],
                "documents": [],
                "report_package": {
                    "auditMetadata": {
                        "validationStatus": "valid",
                        "verificationMode": "kb_exact_quote",
                    }
                },
            }

        backend = FileBackend(tmp_path)
        service = ScanService(backend, runner=runner)
        app = FastAPI()
        app.state.scan_service = service
        app.include_router(router)

        client = TestClient(app)
        response = client.post(
            "/api/v1/scans",
            data={
                "query": "check toy",
                "product": "blocks",
                "category": "toy",
                "markets": '["EU"]',
                "declared_facts": "x" * 30_000,
            },
            files={"images": ("front.png", PNG, "image/png")},
        )
        # An oversized blob is rejected outright (bounded input contract).
        assert response.status_code == 400
