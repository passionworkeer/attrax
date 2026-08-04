"""Application service for persistent, asynchronous compliance scans."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import secrets
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from rag_service.application.ports import ScanBackend, ScanRunner
from rag_service.domain.scans import ScanJob, ScanSession, StoredUpload
from rag_service.parser.docx_parser import _escape_prompt_injection, parse_docx


_ALLOWED_MARKETS = {"EU", "US", "UK", "CN", "AU", "SA", "AE", "JP"}
_MAX_MARKETS_PER_SCAN = 5
_DOCUMENT_CHUNK_CHARS = 8_000
_MAX_DOCUMENT_CHUNKS = 20


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
    markets: list[str] = Field(min_length=1, max_length=_MAX_MARKETS_PER_SCAN)
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


def _mapping(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def _nested_string(source: Mapping[str, Any], *keys: str) -> str:
    current: Any = source
    for key in keys:
        if not isinstance(current, Mapping):
            return ""
        current = current.get(key)
    return str(current).strip().lower() if current is not None else ""


class ScanService:
    def __init__(
        self,
        backend: ScanBackend,
        runner: ScanRunner,
        max_attempts: int = 3,
        *,
        retry_base_seconds: float = 2.0,
        lease_seconds: int = 600,
        session_ttl_hours: int = 24,
    ):
        self.backend = backend
        self.runner = runner
        self.max_attempts = max(1, max_attempts)
        self.retry_base_seconds = max(0.0, retry_base_seconds)
        self.lease_seconds = max(30, lease_seconds)
        self.session_ttl_hours = max(1, session_ttl_hours)
        self._tasks: set[asyncio.Task[None]] = set()
        self._session_tasks: dict[str, asyncio.Task[None]] = {}

    async def create_scan(self, submission: ScanSubmission) -> CreatedScan:
        markets = [market.strip().upper() for market in submission.markets]
        if len(markets) > _MAX_MARKETS_PER_SCAN or any(
            market not in _ALLOWED_MARKETS for market in markets
        ):
            raise ValueError("unsupported target market")

        self.backend.purge_expired_sessions()
        session_id = f"scan_{uuid.uuid4().hex}"
        job_id = f"job_{uuid.uuid4().hex}"
        access_token = secrets.token_urlsafe(32)
        session = ScanSession.new(
            session_id=session_id,
            access_token_hash=_token_hash(access_token),
            category=submission.category,
            markets=markets,
            ttl_hours=self.session_ttl_hours,
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
                    markets=markets,
                    upload_ids=[upload.upload_id for upload in uploads],
                )
            )
            self.backend.append_audit(
                {
                    "event": "scan_started",
                    "sessionId": session_id,
                    "jobId": job_id,
                    "category": submission.category,
                    "markets": markets,
                    "fileCount": len(uploads),
                    "totalBytes": sum(upload.size for upload in uploads),
                }
            )
        except Exception:
            self.backend.delete_session(session_id)
            raise
        self._spawn(job_id, session_id)
        return CreatedScan(session_id=session_id, access_token=access_token)

    def _track_task(
        self,
        task: asyncio.Task[None],
        *,
        session_id: str | None = None,
    ) -> None:
        self._tasks.add(task)
        if session_id is not None:
            self._session_tasks[session_id] = task

        def cleanup(done: asyncio.Task[None]) -> None:
            self._tasks.discard(done)
            if session_id is not None and self._session_tasks.get(session_id) is done:
                self._session_tasks.pop(session_id, None)

        task.add_done_callback(cleanup)

    def _spawn(self, job_id: str, session_id: str) -> None:
        existing = self._session_tasks.get(session_id)
        if existing and not existing.done():
            return
        self._track_task(
            asyncio.create_task(self._run_job(job_id)),
            session_id=session_id,
        )

    def _schedule_retry(self, job: ScanJob, delay: float) -> None:
        async def retry_later() -> None:
            await asyncio.sleep(delay)
            while True:
                existing = self._session_tasks.get(job.session_id)
                if existing is None or existing.done():
                    break
                await asyncio.sleep(0)
            if existing is not None:
                self._session_tasks.pop(job.session_id, None)
            self._spawn(job.job_id, job.session_id)

        self._track_task(asyncio.create_task(retry_later()))

    def resume_pending(self) -> None:
        self.backend.purge_expired_sessions()
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
        """Return one authorized image without trusting stored filesystem paths."""
        self._authorized_session(session_id, access_token)
        images = [
            upload
            for upload in self.backend.list_uploads(session_id)
            if upload.kind == "image"
        ]
        if index < 0 or index >= len(images):
            raise ScanNotFound(f"asset:{index}")
        upload = images[index]
        try:
            restored, content = self.backend.read_upload(session_id, upload.upload_id)
        except (FileNotFoundError, OSError) as exc:
            raise ScanNotFound(f"asset:{index}") from exc
        return restored, content

    def delete_scan(self, session_id: str, access_token: str) -> None:
        self._authorized_session(session_id, access_token)
        task = self._session_tasks.get(session_id)
        if task and not task.done():
            task.cancel()
        self.backend.delete_session(session_id)
        self.backend.append_audit({"event": "scan_deleted", "sessionId": session_id})

    async def _run_job(self, job_id: str) -> None:
        existing = self.backend.get_job(job_id)
        if existing is None:
            return
        if existing.attempts >= self.max_attempts and existing.state != "running":
            self._mark_dead(existing, "SCAN_MAX_ATTEMPTS_EXCEEDED")
            return

        job = self.backend.claim_job(job_id, lease_seconds=self.lease_seconds)
        if job is None:
            return

        session = self.backend.get_session(job.session_id)
        if session is None:
            self.backend.delete_job(job.job_id)
            return

        self.backend.save_session(
            session.transition(
                ttl_hours=self.session_ttl_hours,
                status="processing",
                progress=max(session.progress, 10),
                stage_text="processing",
                error=None,
            )
        )
        lease_task = asyncio.create_task(self._lease_heartbeat(job.job_id, job.session_id))
        try:
            payload = self._build_runner_payload(job)
            raw = await self.runner(payload)
            result, status, degraded_reason = self._normalize_result(job, raw)
            current = self.backend.get_session(job.session_id)
            if current is None:
                return
            self.backend.save_session(
                current.transition(
                    ttl_hours=self.session_ttl_hours,
                    status=status,
                    progress=100,
                    stage_text="complete" if status == "ready" else "degraded",
                    result=result,
                    error=degraded_reason,
                )
            )
            self.backend.delete_job(job.job_id)
            self.backend.append_audit(
                {
                    "event": "scan_completed",
                    "sessionId": job.session_id,
                    "jobId": job.job_id,
                    "attempt": job.attempts,
                    "status": status,
                    "degradedReason": degraded_reason,
                }
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self._handle_job_error(job, exc)
        finally:
            lease_task.cancel()
            try:
                await lease_task
            except asyncio.CancelledError:
                pass

    async def _lease_heartbeat(self, job_id: str, session_id: str) -> None:
        """Refresh the execution lease without inventing user-facing progress."""
        interval = max(10.0, self.lease_seconds / 3)
        try:
            while True:
                await asyncio.sleep(interval)
                if not self.backend.renew_job_lease(
                    job_id,
                    lease_seconds=self.lease_seconds,
                ):
                    return
                current = self.backend.get_session(session_id)
                if current is None or current.status != "processing":
                    return
                self.backend.save_session(
                    current.transition(ttl_hours=self.session_ttl_hours)
                )
        except asyncio.CancelledError:
            return

    def _handle_job_error(self, job: ScanJob, exc: Exception) -> None:
        retryable = not isinstance(exc, (FileNotFoundError, ValueError, TypeError))
        stable_reason = (
            "SCAN_PROVIDER_FAILURE" if retryable else "SCAN_INPUT_OR_STORAGE_FAILURE"
        )
        if retryable and job.attempts < self.max_attempts:
            delay = min(60.0, self.retry_base_seconds * (2 ** max(0, job.attempts - 1)))
            queued = job.requeued(stable_reason, delay_seconds=delay)
            self.backend.save_job(queued)
            current = self.backend.get_session(job.session_id)
            if current is not None:
                self.backend.save_session(
                    current.transition(
                        ttl_hours=self.session_ttl_hours,
                        status="processing",
                        progress=max(current.progress, 10),
                        stage_text="retrying",
                        result=None,
                        error="SCAN_RETRY_SCHEDULED",
                    )
                )
            self.backend.append_audit(
                {
                    "event": "scan_retry_scheduled",
                    "sessionId": job.session_id,
                    "jobId": job.job_id,
                    "attempt": job.attempts,
                    "nextAttempt": job.attempts + 1,
                    "delaySeconds": delay,
                    "errorType": type(exc).__name__,
                }
            )
            self._schedule_retry(queued, delay)
            return
        self._mark_dead(job, stable_reason, error_type=type(exc).__name__)

    def _mark_dead(
        self,
        job: ScanJob,
        reason: str,
        *,
        error_type: str | None = None,
    ) -> None:
        self.backend.save_job(job.dead(reason))
        session = self.backend.get_session(job.session_id)
        if session is not None:
            self.backend.save_session(
                session.transition(
                    ttl_hours=self.session_ttl_hours,
                    status="failed",
                    progress=100,
                    stage_text="failed",
                    result=None,
                    error=reason,
                )
            )
        self.backend.append_audit(
            {
                "event": "scan_failed",
                "sessionId": job.session_id,
                "jobId": job.job_id,
                "attempt": job.attempts,
                "error": reason,
                "errorType": error_type,
            }
        )

    @staticmethod
    def _document_chunks(name: str, mime_type: str, text: str) -> list[dict[str, Any]]:
        escaped_name = _escape_prompt_injection(Path(name).name)
        escaped_text = _escape_prompt_injection(text)
        if not escaped_text:
            return []
        total = min(
            _MAX_DOCUMENT_CHUNKS,
            (len(escaped_text) + _DOCUMENT_CHUNK_CHARS - 1) // _DOCUMENT_CHUNK_CHARS,
        )
        truncated = len(escaped_text) > _DOCUMENT_CHUNK_CHARS * _MAX_DOCUMENT_CHUNKS
        chunks = []
        for index in range(total):
            start = index * _DOCUMENT_CHUNK_CHARS
            part = escaped_text[start : start + _DOCUMENT_CHUNK_CHARS]
            chunks.append(
                {
                    "name": escaped_name,
                    "mimeType": mime_type,
                    "text": part,
                    "part": index + 1,
                    "partCount": total,
                    "truncated": truncated,
                }
            )
        return chunks

    def _build_runner_payload(self, job: ScanJob) -> dict[str, Any]:
        images: list[dict[str, Any]] = []
        pdfs: list[dict[str, Any]] = []
        documents: list[dict[str, Any]] = []
        for upload_id in job.upload_ids:
            upload, content = self.backend.read_upload(job.session_id, upload_id)
            safe_name = Path(upload.original_name).name
            if upload.kind == "image":
                images.append(
                    {
                        "buffer": content,
                        "mimeType": upload.content_type,
                        "name": safe_name,
                    }
                )
            elif upload.content_type == "application/pdf" or safe_name.lower().endswith(".pdf"):
                pdfs.append(
                    {
                        "buffer": content,
                        "mimeType": "application/pdf",
                        "name": safe_name,
                    }
                )
            elif safe_name.lower().endswith(".docx"):
                parsed = parse_docx(upload.path)
                documents.extend(
                    self._document_chunks(
                        safe_name,
                        upload.content_type,
                        str(parsed.get("rawText", "")),
                    )
                )
            else:
                text = content.decode("utf-8", errors="replace")
                documents.extend(
                    self._document_chunks(safe_name, upload.content_type, text)
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
    def _normalize_result(
        job: ScanJob,
        raw: Any,
    ) -> tuple[dict[str, Any], Literal["ready", "degraded"], str | None]:
        if hasattr(raw, "model_dump"):
            raw = raw.model_dump(mode="json")
        if not isinstance(raw, Mapping):
            raise TypeError("scan runner returned a non-object payload")

        value = _camelize(dict(raw))
        compliance_status = str(value.get("status", "UNKNOWN")).upper()
        report = str(value.get("report", "")).strip()
        agent_trace = value.get("agentTrace")
        retrieved_chunks = value.get("documents")
        report_package = value.get("reportPackage")

        degraded_reasons: list[str] = []
        if compliance_status not in {"PASS", "WARN", "REJECTED"}:
            degraded_reasons.append("UNVERIFIED_COMPLIANCE_STATUS")
            compliance_status = "UNKNOWN"
        if not report:
            degraded_reasons.append("EMPTY_COMPLIANCE_REPORT")
        if not isinstance(agent_trace, list) or not agent_trace:
            degraded_reasons.append("MISSING_AGENT_TRACE")
            agent_trace = []
        if not isinstance(retrieved_chunks, list) or not retrieved_chunks:
            degraded_reasons.append("NO_RETRIEVED_EVIDENCE")
            retrieved_chunks = []
        if not isinstance(report_package, Mapping):
            degraded_reasons.append("MISSING_REPORT_PACKAGE")
            report_package = None
        else:
            package = _mapping(report_package)
            validation_status = (
                _nested_string(package, "auditMetadata", "validationStatus")
                or _nested_string(package, "validationStatus")
            )
            verification_mode = (
                _nested_string(package, "auditMetadata", "verificationMode")
                or _nested_string(package, "verificationMode")
            )
            source = _nested_string(package, "source")
            if validation_status in {"invalid", "failed", "degraded"}:
                degraded_reasons.append("REPORT_PACKAGE_INVALID")
            if verification_mode in {"unverified", "text_overlap", "none"}:
                degraded_reasons.append("WEAK_CITATION_VERIFICATION")
            if source in {"demo", "fallback", "mock"}:
                degraded_reasons.append("FALLBACK_REPORT_SOURCE")

        degraded_reason = ",".join(dict.fromkeys(degraded_reasons)) or None
        status: Literal["ready", "degraded"] = (
            "degraded" if degraded_reason else "ready"
        )
        result = {
            "sessionId": job.session_id,
            "productName": job.product,
            "productCategory": job.category,
            "targetMarkets": job.markets,
            "complianceStatus": compliance_status,
            "complianceReport": report,
            "agentTrace": agent_trace,
            "loopCount": value.get("loopCount", 0),
            "retrievedChunks": retrieved_chunks,
            "reportPackage": report_package,
            "degradedReasons": degraded_reasons,
            "source": "fallback" if status == "degraded" else "real",
        }
        return result, status, degraded_reason
