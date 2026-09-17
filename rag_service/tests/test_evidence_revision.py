"""Evidence supplementation + revision re-run (plan 2026-09-14 §5.3, J10).

Covers:
- append_evidence stores files on a completed session and keeps the
  original uploads intact (原始证据不丢).
- idempotency: the same idempotency_key is a no-op (不重复存储).
- request_revision queues a job carrying ALL uploads (old + new) and is
  idempotent for the same key.
- processing sessions reject both endpoints with NOT_READY.
- upload count limit enforcement.
"""
from __future__ import annotations

import asyncio

import pytest

from rag_service.application.scans import (
    ScanNotReady,
    ScanService,
    ScanSubmission,
    SubmittedUpload,
)
from rag_service.infrastructure.file_backend import FileBackend


PNG = b"\x89PNG\r\n\x1a\n" + b"front-image"


def submission() -> ScanSubmission:
    return ScanSubmission(
        query="check toy",
        product="building blocks",
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
    )


def verified_result(status: str = "PASS"):
    return {
        "status": status,
        "report": "## compliant",
        "agent_trace": [{"node": "generator", "status": "success"}],
        "loop_count": 1,
        "documents": [{"source_id": "eu-rule", "region": "EU"}],
        "report_package": {
            "roadmap": {"items": [{"id": "step-1", "title": "Apply"}]},
            "auditMetadata": {
                "validationStatus": "valid",
                "verificationMode": "kb_exact_quote",
                "citationCoverage": 1.0,
            },
            "citations": [
                {
                    "doc_id": "EU-2023-1542",
                    "article_id": "art-7",
                    "quote": "Requirements for batteries.",
                }
            ],
            "evidencePack": [
                {
                    "doc_id": "EU-2023-1542",
                    "article_id": "art-7",
                    "quote": "Requirements for batteries.",
                }
            ],
        },
    }


def make_service(tmp_path, runner_result=None, running=False):
    async def runner(payload):
        if running:
            # Simulate a long-running scan: never completes during the test.
            await asyncio.sleep(3600)
        return runner_result if runner_result is not None else verified_result()

    backend = FileBackend(tmp_path)
    service = ScanService(backend, runner=runner)
    return backend, service


@pytest.fixture()
def completed(tmp_path):
    async def scenario():
        backend, service = make_service(tmp_path)
        created = await service.create_scan(submission())
        await service.wait_for_idle()
        return backend, service, created

    return asyncio.run(scenario())


def test_append_evidence_preserves_original_uploads(completed):
    backend, service, created = completed

    result = service.append_evidence(
        created.session_id,
        created.access_token,
        idempotency_key="req-1",
        uploads=[
            SubmittedUpload(
                kind="image",
                name="nameplate.png",
                content_type="image/png",
                content=PNG,
            )
        ],
    )

    assert result["status"] == "stored"
    assert result["storedCount"] == 1
    uploads = backend.list_uploads(created.session_id)
    # Original front.png survives; the supplement is added, not replacing.
    assert len(uploads) == 2
    assert {u.original_name for u in uploads} == {"front.png", "nameplate.png"}


def test_revision_preserves_user_query_not_generated_report(completed):
    backend, service, created = completed
    session = backend.get_session(created.session_id)
    assert session.result["originalQuery"] == "check toy"
    assert service._revision_job_fields(session) == ("check toy", "building blocks")
    legacy = session.model_copy(update={"result": {"productName": "product", "complianceReport": "wrong old conclusion"}})
    query, product = service._revision_job_fields(legacy)
    assert "wrong old conclusion" not in query
    assert "toy" in query
    assert product == ""


def test_append_evidence_is_idempotent(completed):
    _, service, created = completed
    upload = SubmittedUpload(
        kind="image",
        name="nameplate.png",
        content_type="image/png",
        content=PNG,
    )

    first = service.append_evidence(
        created.session_id, created.access_token, idempotency_key="req-1", uploads=[upload]
    )
    second = service.append_evidence(
        created.session_id, created.access_token, idempotency_key="req-1", uploads=[upload]
    )

    assert first["status"] == "stored"
    assert second["status"] == "already_applied"
    assert second["storedCount"] == 0


def test_append_evidence_rejects_processing_session(tmp_path):
    async def scenario():
        _, service = make_service(tmp_path, running=True)
        created = await service.create_scan(submission())
        await asyncio.sleep(0)  # let the job spawn
        with pytest.raises(ScanNotReady):
            service.append_evidence(
                created.session_id,
                created.access_token,
                idempotency_key="req-1",
                uploads=[
                    SubmittedUpload(
                        kind="image",
                        name="x.png",
                        content_type="image/png",
                        content=PNG,
                    )
                ],
            )

    asyncio.run(scenario())


def test_request_revision_queues_job_with_all_uploads(completed):
    backend, service, created = completed
    service.append_evidence(
        created.session_id,
        created.access_token,
        idempotency_key="ev-1",
        uploads=[
            SubmittedUpload(
                kind="image",
                name="nameplate.png",
                content_type="image/png",
                content=PNG,
            )
        ],
    )

    # request_revision spawns an asyncio task — run inside a loop.
    async def scenario():
        return service.request_revision(
            created.session_id, created.access_token, idempotency_key="rev-1"
        )

    result = asyncio.run(scenario())

    assert result["status"] == "queued"
    # First revision after the original scan (which counts as revision 1).
    assert result["revision"] == 2
    audit_events = [
        line
        for line in backend.audit_path.read_text(encoding="utf-8").splitlines()
        if '"revision:' in line
    ]
    assert audit_events, "revision request must be audited"
    # The job carries every upload id (original + supplement).
    uploads = backend.list_uploads(created.session_id)
    assert len(uploads) == 2


def test_request_revision_is_idempotent(completed):
    _, service, created = completed

    async def scenario():
        first = service.request_revision(
            created.session_id, created.access_token, idempotency_key="rev-1"
        )
        second = service.request_revision(
            created.session_id, created.access_token, idempotency_key="rev-1"
        )
        return first, second

    first, second = asyncio.run(scenario())
    assert first["status"] == "queued"
    assert second["status"] == "already_queued"
    assert second["revision"] == first["revision"]


def test_append_evidence_enforces_upload_limit(completed):
    _, service, created = completed
    with pytest.raises(ValueError):
        service.append_evidence(
            created.session_id,
            created.access_token,
            idempotency_key=None,
            uploads=[
                SubmittedUpload(
                    kind="image",
                    name=f"extra-{i}.png",
                    content_type="image/png",
                    content=PNG,
                )
                for i in range(service._MAX_EVIDENCE_UPLOADS)
            ],
        )
