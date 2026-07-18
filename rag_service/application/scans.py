"""Application service for persistent, asynchronous compliance scans."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import secrets
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from rag_service.application.ports import ScanBackend, ScanRunner
from rag_service.domain.scans import ScanJob, ScanSession, StoredUpload
from rag_service.parser.docx_parser import _escape_prompt_injection, parse_docx


class ScanServiceError(Exception):
    code = "SCAN_SERVICE_ERROR"


class ScanNotFound(ScanServiceError):
    code = "NOT_FOUND"


class ScanUnauthorized(ScanServiceError):
    code = "UNAUTHORIZED"


class ScanNotReady(ScanServiceError):
    code = "NOT_READY"


class SubmittedUpload(BaseModel):
    model_config = ConfigDict(frozen=True)

    kind: Literal["image", "document"]
    name: str
    content_type: str
    content: bytes


class ScanSubmission(BaseModel):
    model_config = ConfigDict(frozen=True)

    query: str = Field(min_length=1, max_length=2_000)
    product: str = Field(default="", max_length=500)
    category: str = Field(min_length=1, max_length=100)
    markets: list[str] = Field(min_length=1, max_length=20)
    uploads: list[SubmittedUpload] = Field(min_length=1, max_length=13)


@dataclass(frozen=True)
class CreatedScan:
    session_id: str
    access_token: str
    status: str = "processing"

    @property
    def poll_url(self) -> str:
        return f"/api/v1/scans/{self.session_id}"


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _camelize(value: Any) -> Any:
    if isinstance(value, list):
        return [_camelize(item) for item in value]
    if not isinstance(value, dict):
        return value
    converted: dict[str, Any] = {}
    for key, item in value.items():
        parts = str(key).split("_")
        camel_key = parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])
        converted[camel_key] = _camelize(item)
    return converted


class ScanService:
    def __init__(self, backend: ScanBackend, runner: ScanRunner, max_attempts: int = 3):
        self.backend = backend
        self.runner = runner
        self.max_attempts = max(1, max_attempts)
        self._tasks: set[asyncio.Task[None]] = set()
        self._session_tasks: dict[str, asyncio.Task[None]] = {}

    async def create_scan(self, submission: ScanSubmission) -> CreatedScan:
        session_id = f"scan_{uuid.uuid4().hex}"
        job_id = f"job_{uuid.uuid4().hex}"
        access_token = secrets.token_urlsafe(32)
        session = ScanSession.new(
            session_id=session_id,
            access_token_hash=_token_hash(access_token),
            category=submission.category,
            markets=submission.markets,
        )
        try:
            self.backend.save_session(session)
            uploads = [
                self.backend.save_upload(
                    session_id=session_id,
                    kind=upload.kind,
                    original_name=upload.name,
                    content_type=upload.content_type,
                    content=upload.content,
                )
                for upload in submission.uploads
            ]
            self.backend.save_job(
                ScanJob.new(
                    job_id=job_id,
                    session_id=session_id,
                    query=submission.query,
                    product=submission.product,
                    category=submission.category,
                    markets=submission.markets,
                    upload_ids=[upload.upload_id for upload in uploads],
                )
            )
            self.backend.append_audit(
                {
                    "event": "scan_started",
                    "sessionId": session_id,
                    "category": submission.category,
                    "markets": submission.markets,
                    "fileCount": len(uploads),
                    "totalBytes": sum(upload.size for upload in uploads),
                }
            )
        except Exception:
            self.backend.delete_session(session_id)
            raise
        self._spawn(job_id, session_id)
        return CreatedScan(session_id=session_id, access_token=access_token)

    def _spawn(self, job_id: str, session_id: str) -> None:
        existing = self._session_tasks.get(session_id)
        if existing and not existing.done():
            return
        task = asyncio.create_task(self._run_job(job_id))
        self._tasks.add(task)
        self._session_tasks[session_id] = task

        def cleanup(done: asyncio.Task[None]) -> None:
            self._tasks.discard(done)
            if self._session_tasks.get(session_id) is done:
                self._session_tasks.pop(session_id, None)

        task.add_done_callback(cleanup)

    def resume_pending(self) -> None:
        for job in self.backend.list_recoverable_jobs():
            self._spawn(job.job_id, job.session_id)

    async def wait_for_idle(self) -> None:
        while self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)

    def _authorized_session(self, session_id: str, access_token: str) -> ScanSession:
        session = self.backend.get_session(session_id)
        if session is None:
            raise ScanNotFound(session_id)
        provided = _token_hash(access_token)
        if not hmac.compare_digest(provided, session.access_token_hash):
            raise ScanUnauthorized(session_id)
        return session

    def get_scan(self, session_id: str, access_token: str) -> dict[str, Any]:
        public = self._authorized_session(session_id, access_token).public_data()
        assets: list[dict[str, Any]] = []
        kind_indexes = {"image": 0, "document": 0}
        for upload in self.backend.list_uploads(session_id):
            assets.append(
                {
                    "kind": upload.kind,
                    "index": kind_indexes[upload.kind],
                    "name": upload.original_name,
                    "contentType": upload.content_type,
                    "size": upload.size,
                }
            )
            kind_indexes[upload.kind] += 1
        public["assets"] = assets
        return public

    def get_image_asset(
        self,
        session_id: str,
        access_token: str,
        index: int,
    ) -> tuple[StoredUpload, bytes]:
        """Return one authorized image without accepting a filesystem path."""
        self._authorized_session(session_id, access_token)
        images = [
            upload
            for upload in self.backend.list_uploads(session_id)
            if upload.kind == "image"
        ]
        if index < 0 or index >= len(images):
            raise ScanNotFound(f"asset:{index}")

        upload = images[index]
        path = Path(upload.path).resolve()
        if path.name != upload.stored_name or path.parent.name != session_id:
            raise ScanNotFound(f"asset:{index}")
        try:
            content = path.read_bytes()
        except OSError as exc:
            raise ScanNotFound(f"asset:{index}") from exc
        if hashlib.sha256(content).hexdigest() != upload.sha256:
            raise ScanNotFound(f"asset:{index}")
        return upload, content

    def delete_scan(self, session_id: str, access_token: str) -> None:
        self._authorized_session(session_id, access_token)
        task = self._session_tasks.get(session_id)
        if task and not task.done():
            task.cancel()
        self.backend.delete_session(session_id)
        self.backend.append_audit({"event": "scan_deleted", "sessionId": session_id})

    async def _run_job(self, job_id: str) -> None:
        job = self.backend.get_job(job_id)
        if job is None:
            return
        if job.attempts >= self.max_attempts:
            self._mark_failed(job, "SCAN_MAX_ATTEMPTS_EXCEEDED")
            return
        job = self.backend.claim_job(job_id)
        session = self.backend.get_session(job.session_id)
        if session is None:
            self.backend.delete_job(job.job_id)
            return
        self.backend.save_session(session.transition(progress=10, stage_text="processing"))
        # 后台心跳任务:每 2 秒把 progress 从 10 推到 90 (避免前端卡在 10%)
        # 单调递增,真实进度由最终 status=ready/degraded 触发到 100。
        heartbeat_task = asyncio.create_task(
            self._progress_heartbeat(job.session_id, started_at=time.monotonic())
        )
        try:
            payload = self._build_runner_payload(job)
            raw = await self.runner(payload)
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass
            current = self.backend.get_session(job.session_id)
            if current is None:
                return
            result, status = self._normalize_result(job, raw)
            self.backend.save_session(
                current.transition(
                    status=status,
                    progress=100,
                    stage_text="complete" if status == "ready" else "degraded",
                    result=result,
                    error=None,
                )
            )
            self.backend.delete_job(job.job_id)
            self.backend.append_audit(
                {"event": "scan_completed", "sessionId": job.session_id, "status": status}
            )
        except asyncio.CancelledError:
            heartbeat_task.cancel()
            raise
        except Exception as e:
            heartbeat_task.cancel()
            self._mark_failed(job, f"SCAN_FAILED: {e!r}"[:200])

    async def _progress_heartbeat(self, session_id: str, started_at: float) -> None:
        """单调推进 session.progress, 直到 cancelled 或 progress >= 90。

        真实进度到 100 由最终的 status=ready/degraded 触发。10 → 90 区间内每 2s +2% ,
        让前端 polling 时一直能看到动起来,而不是卡在 10%。
        """
        try:
            while True:
                await asyncio.sleep(2.0)
                cur = self.backend.get_session(session_id)
                if cur is None or cur.status != "processing":
                    return
                # 10% + (2%/2s * elapsed) 上限 90%
                elapsed = time.monotonic() - started_at
                projected = min(90, 10 + int(elapsed))
                if projected > (cur.progress or 0):
                    self.backend.save_session(cur.transition(progress=projected))
        except asyncio.CancelledError:
            return

    def _mark_failed(self, job: ScanJob, reason: str) -> None:
        failed_job = job.model_copy(
            update={"state": "failed", "failure_reason": reason, "started_at": None}
        )
        self.backend.save_job(failed_job)
        session = self.backend.get_session(job.session_id)
        if session is not None:
            self.backend.save_session(
                session.transition(
                    status="failed",
                    progress=100,
                    stage_text="failed",
                    result=None,
                    error=reason,
                )
            )
        self.backend.append_audit(
            {"event": "scan_failed", "sessionId": job.session_id, "error": reason}
        )

    def _build_runner_payload(self, job: ScanJob) -> dict[str, Any]:
        images: list[dict[str, Any]] = []
        pdfs: list[dict[str, Any]] = []
        documents: list[dict[str, Any]] = []
        for upload_id in job.upload_ids:
            upload = self.backend.get_upload(job.session_id, upload_id)
            if upload is None:
                raise FileNotFoundError(upload_id)
            path = Path(upload.path)
            content = path.read_bytes()
            if upload.kind == "image":
                images.append(
                    {
                        "buffer": content,
                        "mimeType": upload.content_type,
                        "name": upload.original_name,
                    }
                )
            elif upload.content_type == "application/pdf" or upload.original_name.lower().endswith(".pdf"):
                pdfs.append(
                    {"buffer": content, "mimeType": "application/pdf", "name": upload.original_name}
                )
            elif upload.original_name.lower().endswith(".docx"):
                parsed = parse_docx(str(path))
                documents.append(
                    {
                        "name": upload.original_name,
                        "mimeType": upload.content_type,
                        "text": str(parsed.get("rawText", ""))[:5_000],
                    }
                )
            else:
                text = content.decode("utf-8", errors="replace")[:5_000]
                documents.append(
                    {
                        "name": upload.original_name,
                        "mimeType": upload.content_type,
                        "text": _escape_prompt_injection(text),
                    }
                )
        return {
            "query": job.query,
            "product": job.product,
            "category": job.category,
            "markets": job.markets,
            "images": images,
            "pdfs": pdfs,
            "documents": documents,
        }

    @staticmethod
    def _normalize_result(job: ScanJob, raw: Any) -> tuple[dict[str, Any], str]:
        if hasattr(raw, "model_dump"):
            raw = raw.model_dump(mode="json")
        value = _camelize(dict(raw))
        compliance_status = str(value.get("status", "UNKNOWN")).upper()
        degraded = compliance_status == "DEMO"
        result = {
            "sessionId": job.session_id,
            "productName": job.product,
            "productCategory": job.category,
            "targetMarkets": job.markets,
            "complianceStatus": compliance_status,
            "complianceReport": value.get("report", ""),
            "agentTrace": value.get("agentTrace", []),
            "loopCount": value.get("loopCount", 0),
            "retrievedChunks": value.get("documents", []),
            "reportPackage": value.get("reportPackage"),
            "source": "demo" if degraded else "real",
        }
        return result, "degraded" if degraded else "ready"
