import asyncio
import hashlib
from datetime import timedelta

import pytest

from rag_service.application.scans import (
    ScanNotFound,
    ScanService,
    ScanSubmission,
    ScanUnauthorized,
    SubmittedUpload,
)
from rag_service.domain.scans import ScanJob, ScanSession, utc_now
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
                "verificationMode": "nli",
                "citationCoverage": 1.0,
            },
        },
    }


def test_service_runs_job_persists_ready_result_and_stores_only_token_hash(tmp_path):
    async def scenario():
        seen = []

        async def runner(payload):
            seen.append(payload)
            return verified_result()

        backend = FileBackend(tmp_path)
        service = ScanService(backend, runner=runner)
        created = await service.create_scan(submission())
        await service.wait_for_idle()

        stored = backend.get_session(created.session_id)
        assert stored is not None
        assert stored.access_token_hash == hashlib.sha256(created.access_token.encode()).hexdigest()
        assert created.access_token not in (
            tmp_path / "sessions" / f"{created.session_id}.json"
        ).read_text()
        public = service.get_scan(created.session_id, created.access_token)
        assert public["status"] == "ready"
        assert public["result"]["complianceStatus"] == "PASS"
        assert public["result"]["reportPackage"]["roadmap"]["items"][0]["id"] == "step-1"
        assert public["result"]["source"] == "real"
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


def test_service_rejects_wrong_or_expired_session_tokens(tmp_path):
    async def scenario():
        async def runner(payload):
            return verified_result()

        backend = FileBackend(tmp_path)
        service = ScanService(backend, runner=runner)
        created = await service.create_scan(submission())
        with pytest.raises(ScanUnauthorized):
            service.get_scan(created.session_id, "wrong-token")
        await service.wait_for_idle()

        stored = backend.get_session(created.session_id)
        assert stored is not None
        backend.save_session(
            stored.model_copy(update={"expires_at": utc_now() - timedelta(seconds=1)})
        )
        with pytest.raises(ScanNotFound):
            service.get_scan(created.session_id, created.access_token)
        assert backend.get_session(created.session_id) is None

    asyncio.run(scenario())


def test_service_retries_provider_exception_then_marks_dead_without_secret_text(tmp_path):
    async def scenario():
        calls = 0

        async def runner(payload):
            nonlocal calls
            calls += 1
            raise RuntimeError("provider secret must not be exposed")

        backend = FileBackend(tmp_path)
        service = ScanService(
            backend,
            runner=runner,
            max_attempts=3,
            retry_base_seconds=0,
        )
        created = await service.create_scan(submission())
        await service.wait_for_idle()

        public = service.get_scan(created.session_id, created.access_token)
        assert calls == 3
        assert public["status"] == "failed"
        assert public["error"] == "SCAN_PROVIDER_FAILURE"
        job_files = list((tmp_path / "jobs").glob("*.json"))
        assert len(job_files) == 1
        assert '"state":"dead"' in job_files[0].read_text(encoding="utf-8")
        assert "provider secret" not in job_files[0].read_text(encoding="utf-8")
        assert "provider secret" not in (tmp_path / "audit.jsonl").read_text(encoding="utf-8")

    asyncio.run(scenario())


def test_service_retries_invalid_generation_package_then_persists_ready_result(tmp_path):
    """A model response missing required report scenes is retried internally."""
    async def scenario():
        calls = 0

        async def runner(payload):
            nonlocal calls
            calls += 1
            if calls == 1:
                return {
                    "status": "REJECTED",
                    "report": "partial provider response",
                    "agent_trace": [{"node": "generate", "status": "generation_failed"}],
                    "documents": [{"text": "evidence"}],
                    "report_package": {
                        "auditMetadata": {"validationStatus": "invalid"},
                    },
                }
            return verified_result()

        backend = FileBackend(tmp_path)
        service = ScanService(backend, runner=runner, retry_base_seconds=0)
        created = await service.create_scan(submission())
        await service.wait_for_idle()

        public = service.get_scan(created.session_id, created.access_token)
        assert calls == 2
        assert public["status"] == "ready"
        assert public["result"]["source"] == "real"

    asyncio.run(scenario())


def test_service_does_not_retry_timeout_because_executor_work_may_still_be_running(tmp_path):
    class GatewayTimeout(Exception):
        status_code = 504

    async def scenario():
        calls = 0

        async def runner(payload):
            nonlocal calls
            calls += 1
            raise GatewayTimeout("timed out")

        backend = FileBackend(tmp_path)
        service = ScanService(
            backend,
            runner=runner,
            max_attempts=3,
            retry_base_seconds=0,
        )
        created = await service.create_scan(submission())
        await service.wait_for_idle()

        public = service.get_scan(created.session_id, created.access_token)
        assert calls == 1
        assert public["status"] == "failed"
        assert public["error"] == "SCAN_TIMEOUT"

    asyncio.run(scenario())


def test_service_degrades_pass_when_evidence_is_missing(tmp_path):
    """缺证据 = 真失败 → degraded,与验证强弱无关。"""
    async def scenario():
        async def runner(payload):
            return {
                "status": "PASS",
                "report": "looks complete",
                "agent_trace": [{"node": "generator", "status": "success"}],
                "documents": [],  # 缺证据 → hard reason
                "report_package": {
                    "auditMetadata": {"validationStatus": "valid", "verificationMode": "nli"},
                },
            }

        backend = FileBackend(tmp_path)
        service = ScanService(backend, runner=runner)
        created = await service.create_scan(submission())
        await service.wait_for_idle()

        public = service.get_scan(created.session_id, created.access_token)
        assert public["status"] == "degraded"
        assert public["result"]["source"] == "fallback"
        assert public["result"]["complianceStatus"] == "UNKNOWN"
        assert "NO_RETRIEVED_EVIDENCE" in public["result"]["degradedReasons"]

    asyncio.run(scenario())


def test_service_keeps_verified_unknown_decision_as_real_result(tmp_path):
    """UNKNOWN is a decision outcome, not a synthetic provider failure."""
    async def scenario():
        async def runner(payload):
            return {
                "status": "UNKNOWN",
                "report": "Need a readable nameplate before applicability can be confirmed.",
                "agent_trace": [{"node": "vision"}, {"node": "generate"}, {"node": "verify"}],
                "documents": [],
                "report_package": {
                    "auditMetadata": {
                        "validationStatus": "normalized",
                        "verificationMode": "kb_exact_quote",
                        "citationCoverage": 1.0,
                    },
                    "citations": [{
                        "doc_id": "EU-2023-1542",
                        "article_id": "art-7",
                        "quote": "Requirements for batteries.",
                    }],
                    "evidencePack": [{
                        "doc_id": "EU-2023-1542",
                        "article_id": "art-7",
                        "quote": "Requirements for batteries.",
                    }],
                },
            }

        backend = FileBackend(tmp_path)
        service = ScanService(backend, runner=runner)
        created = await service.create_scan(submission())
        await service.wait_for_idle()

        public = service.get_scan(created.session_id, created.access_token)
        assert public["status"] == "ready"
        assert public["result"]["source"] == "real"
        assert public["result"]["complianceStatus"] == "UNKNOWN"
        assert public["result"]["degradedReasons"] == []

    asyncio.run(scenario())


def test_service_accepts_kb_only_report_package_evidence(tmp_path):
    """De-RAG runs have no retrieval chunks; verified KB citations are evidence."""
    async def scenario():
        async def runner(payload):
            return {
                "status": "PASS",
                "report": "KB-backed report",
                "agent_trace": [{"node": "vision"}, {"node": "generate"}, {"node": "verify"}],
                "documents": [],
                "report_package": {
                    "auditMetadata": {
                        "validationStatus": "normalized",
                        "verificationMode": "nli",
                        "citationCoverage": 1.0,
                    },
                    "citations": [{
                        "doc_id": "EU-2023-1542",
                        "article_id": "art-7",
                        "quote": "Requirements for batteries.",
                    }],
                    "evidencePack": [{
                        "doc_id": "EU-2023-1542",
                        "article_id": "art-7",
                        "quote": "Requirements for batteries.",
                    }],
                },
            }

        backend = FileBackend(tmp_path)
        service = ScanService(backend, runner=runner)
        created = await service.create_scan(submission())
        await service.wait_for_idle()

        public = service.get_scan(created.session_id, created.access_token)
        assert public["status"] == "ready"
        assert public["result"]["source"] == "real"
        assert public["result"]["retrievedChunks"] == []
        assert public["result"]["degradedReasons"] == []

    asyncio.run(scenario())


@pytest.mark.parametrize("verification_mode", ["text_overlap", "", None])
def test_service_marks_weak_verification_as_warning_without_degrading(
    tmp_path,
    verification_mode,
):
    """弱验证(text_overlap / 无 NLI)与真失败分开:有完整证据时只标 warning,不降级。"""
    async def scenario():
        async def runner(payload):
            audit = {"validationStatus": "valid"}
            if verification_mode is not None:
                audit["verificationMode"] = verification_mode
            return {
                "status": "PASS",
                "report": "looks complete",
                "agent_trace": [{"node": "generator", "status": "success"}],
                "documents": [{"text": "evidence chunk", "docName": "regulation.txt"}],
                "report_package": {"auditMetadata": audit},
            }

        backend = FileBackend(tmp_path)
        service = ScanService(backend, runner=runner)
        created = await service.create_scan(submission())
        await service.wait_for_idle()

        public = service.get_scan(created.session_id, created.access_token)
        # 弱验证不降级:status=ready / source=real / PASS 保持
        assert public["status"] == "ready"
        assert public["result"]["source"] == "real"
        assert public["result"]["complianceStatus"] == "PASS"
        assert public["result"]["degradedReasons"] == []
        # 但弱验证如实暴露在 warnings + citationVerification(前端可显示「验证较弱」)
        assert "WEAK_OR_MISSING_CITATION_VERIFICATION" in public["result"]["warnings"]
        assert public["result"]["citationVerification"]["strength"] == "weak"

    asyncio.run(scenario())


def test_service_degrades_when_report_package_validation_is_missing(tmp_path):
    async def scenario():
        result = verified_result()
        result["report_package"]["auditMetadata"].pop("validationStatus")

        async def runner(payload):
            return result

        backend = FileBackend(tmp_path)
        service = ScanService(backend, runner=runner)
        created = await service.create_scan(submission())
        await service.wait_for_idle()
        public = service.get_scan(created.session_id, created.access_token)
        assert public["status"] == "degraded"
        assert public["result"]["complianceStatus"] == "UNKNOWN"
        assert "REPORT_PACKAGE_NOT_VERIFIED" in public["result"]["degradedReasons"]

    asyncio.run(scenario())


def test_service_resumes_queued_job_after_restart(tmp_path):
    async def scenario():
        backend = FileBackend(tmp_path)
        session = ScanSession.new(
            "scan_resume",
            hashlib.sha256(b"token").hexdigest(),
            "electronics",
            ["EU"],
        )
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
            return verified_result("WARN")

        service = ScanService(backend, runner=runner)
        service.resume_pending()
        await service.wait_for_idle()
        assert backend.get_session("scan_resume").status == "ready"
        assert backend.get_job("job_resume") is None

    asyncio.run(scenario())


def test_service_resumes_pending_retry_job_after_restart(tmp_path):
    """retry delay 期间 restart:retry_later task 丢失,next_run_at 还在未来,
    list_recoverable_jobs 不返回,resume_pending 通过 list_pending_retry_jobs 重新安排 delayed spawn(P1-2)。"""
    async def scenario():
        backend = FileBackend(tmp_path)
        session = ScanSession.new(
            "scan_retry",
            hashlib.sha256(b"token").hexdigest(),
            "electronics",
            ["EU"],
        )
        backend.save_session(session)
        upload = backend.save_upload("scan_retry", "image", "front.png", "image/png", PNG)
        job = ScanJob.new(
            "job_retry",
            "scan_retry",
            "check",
            "charger",
            "electronics",
            ["EU"],
            [upload.upload_id],
        )
        # 模拟一次 retry 已调度:requeued,next_run_at=now+0.1s
        # retry_later asyncio task 假设在 pm2 restart 中丢失
        retrying = job.requeued("TRANSIENT", delay_seconds=0.1)
        backend.save_job(retrying)

        async def runner(payload):
            return verified_result("WARN")

        service = ScanService(backend, runner=runner)
        service.resume_pending()
        await service.wait_for_idle()
        assert backend.get_session("scan_retry").status == "ready"
        assert backend.get_job("job_retry") is None

    asyncio.run(scenario())


def test_service_delete_requires_token_and_removes_all_state(tmp_path):
    async def scenario():
        gate = asyncio.Event()

        async def runner(payload):
            await gate.wait()
            return verified_result()

        backend = FileBackend(tmp_path)
        service = ScanService(backend, runner=runner)
        created = await service.create_scan(submission())
        service.delete_scan(created.session_id, created.access_token)
        gate.set()
        await service.wait_for_idle()
        assert backend.get_session(created.session_id) is None
        assert not (tmp_path / "uploads" / created.session_id).exists()

    asyncio.run(scenario())


def test_submission_rejects_more_than_five_markets():
    with pytest.raises(ValueError):
        ScanSubmission(
            query="q",
            category="electronics",
            markets=["EU", "US", "UK", "CN", "AU", "JP"],
            uploads=[
                SubmittedUpload(
                    kind="image",
                    name="front.png",
                    content_type="image/png",
                    content=PNG,
                )
            ],
        )
