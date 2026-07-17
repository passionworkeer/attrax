import asyncio
import hashlib

import pytest

from rag_service.application.scans import (
    ScanService,
    ScanSubmission,
    ScanUnauthorized,
    SubmittedUpload,
)
from rag_service.domain.scans import ScanJob, ScanSession
from rag_service.infrastructure.file_backend import FileBackend


PNG = b"\x89PNG\r\n\x1a\n" + b"test-image"


def submission() -> ScanSubmission:
    return ScanSubmission(
        query="check charger",
        product="USB charger",
        category="electronics",
        markets=["EU", "US"],
        uploads=[
            SubmittedUpload(
                kind="image",
                name="front.png",
                content_type="image/png",
                content=PNG,
            )
        ],
    )


def test_service_runs_job_persists_ready_result_and_stores_only_token_hash(tmp_path):
    async def scenario():
        seen = []

        async def runner(payload):
            seen.append(payload)
            return {
                "status": "PASS",
                "report": "## compliant",
                "agent_trace": [{"node": "generator", "status": "success"}],
                "loop_count": 1,
                "documents": [{"source_id": "eu-rule"}],
                "report_package": {"roadmap": {"items": [{"id": "step-1"}]}},
            }

        backend = FileBackend(tmp_path)
        service = ScanService(backend, runner=runner)
        created = await service.create_scan(submission())
        await service.wait_for_idle()

        stored = backend.get_session(created.session_id)
        assert stored.access_token_hash == hashlib.sha256(created.access_token.encode()).hexdigest()
        assert created.access_token not in (tmp_path / "sessions" / f"{created.session_id}.json").read_text()
        public = service.get_scan(created.session_id, created.access_token)
        assert public["status"] == "ready"
        assert public["result"]["complianceStatus"] == "PASS"
        assert public["result"]["reportPackage"]["roadmap"]["items"][0]["id"] == "step-1"
        assert public["assets"] == [
            {
                "kind": "image",
                "index": 0,
                "name": "front.png",
                "contentType": "image/png",
                "size": len(PNG),
            }
        ]
        assert seen[0]["images"][0]["buffer"] == PNG
        assert backend.list_recoverable_jobs() == []

    asyncio.run(scenario())


def test_service_rejects_wrong_token_without_leaking_session(tmp_path):
    async def scenario():
        async def runner(payload):
            return {"status": "PASS", "report": "ok", "agent_trace": [], "loop_count": 0}

        service = ScanService(FileBackend(tmp_path), runner=runner)
        created = await service.create_scan(submission())
        with pytest.raises(ScanUnauthorized):
            service.get_scan(created.session_id, "wrong-token")
        await service.wait_for_idle()

    asyncio.run(scenario())


def test_service_marks_runner_exception_failed_and_persists_failed_job(tmp_path):
    async def scenario():
        async def runner(payload):
            raise RuntimeError("provider secret must not be exposed")

        backend = FileBackend(tmp_path)
        service = ScanService(backend, runner=runner)
        created = await service.create_scan(submission())
        await service.wait_for_idle()

        public = service.get_scan(created.session_id, created.access_token)
        assert public["status"] == "failed"
        assert public["error"] == "SCAN_FAILED"
        job_files = list((tmp_path / "jobs").glob("*.json"))
        assert len(job_files) == 1
        assert "provider secret" not in job_files[0].read_text(encoding="utf-8")

    asyncio.run(scenario())


def test_service_resumes_queued_job_after_restart(tmp_path):
    async def scenario():
        backend = FileBackend(tmp_path)
        session = ScanSession.new("scan_resume", hashlib.sha256(b"token").hexdigest(), "electronics", ["EU"])
        backend.save_session(session)
        upload = backend.save_upload("scan_resume", "image", "front.png", "image/png", PNG)
        backend.save_job(
            ScanJob.new(
                "job_resume",
                "scan_resume",
                "check",
                "charger",
                "electronics",
                ["EU"],
                [upload.upload_id],
            )
        )

        async def runner(payload):
            return {"status": "WARN", "report": "review", "agent_trace": [], "loop_count": 0}

        service = ScanService(backend, runner=runner)
        service.resume_pending()
        await service.wait_for_idle()
        assert backend.get_session("scan_resume").status == "ready"
        assert backend.get_job("job_resume") is None

    asyncio.run(scenario())


def test_service_delete_requires_token_and_removes_all_state(tmp_path):
    async def scenario():
        gate = asyncio.Event()

        async def runner(payload):
            await gate.wait()
            return {"status": "PASS", "report": "ok", "agent_trace": [], "loop_count": 0}

        backend = FileBackend(tmp_path)
        service = ScanService(backend, runner=runner)
        created = await service.create_scan(submission())
        service.delete_scan(created.session_id, created.access_token)
        gate.set()
        await service.wait_for_idle()
        assert backend.get_session(created.session_id) is None
        assert not (tmp_path / "uploads" / created.session_id).exists()

    asyncio.run(scenario())
