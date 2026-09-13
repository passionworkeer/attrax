"""Application service for persistent, asynchronous compliance scans."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import os
import secrets
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from rag_service.application.ports import ScanBackend, ScanRunner
from rag_service.domain.scans import ScanJob, ScanSession, StoredUpload, utc_now
from rag_service.parser.docx_parser import _escape_prompt_injection, parse_docx


from ..config import ALLOWED_MARKETS as _ALLOWED_MARKETS_SET
from ..config import MAX_MARKETS_PER_SCAN as _MAX_MARKETS_PER_SCAN

_ALLOWED_MARKETS = _ALLOWED_MARKETS_SET
_DOCUMENT_CHUNK_CHARS = 8_000
_MAX_DOCUMENT_CHUNKS = 20
_STRONG_VERIFICATION_MODES = {
    "nli", "llm_judge", "hybrid", "nli+llm", "kb_exact_quote",
}
# ``normalize_report_package`` emits ``normalized`` for a structurally valid
# package.  It is the pipeline's canonical success state (and is separately
# rejected when it becomes ``invalid``/``fallback``), so ScanService must not
# downgrade an otherwise evidence-backed real scan just because older callers
# used valid/passed/verified instead.
_VALID_PACKAGE_STATUSES = {"valid", "passed", "verified", "normalized"}


class ScanServiceError(Exception):
    code = "SCAN_SERVICE_ERROR"


class ScanNotFound(ScanServiceError):
    code = "NOT_FOUND"


class ScanUnauthorized(ScanServiceError):
    code = "UNAUTHORIZED"


class ScanNotReady(ScanServiceError):
    code = "NOT_READY"


class _RetryableScanResult(Exception):
    """Internal marker for a provider response that cannot be delivered yet."""


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


def _nested(source: Mapping[str, Any], *keys: str) -> Any:
    current: Any = source
    for key in keys:
        if not isinstance(current, Mapping):
            return None
        current = current.get(key)
    return current


def _nested_string(source: Mapping[str, Any], *keys: str) -> str:
    value = _nested(source, *keys)
    return str(value).strip().lower() if value is not None else ""


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
        markets = list(dict.fromkeys(market.strip().upper() for market in submission.markets))
        if (
            not markets
            or len(markets) > _MAX_MARKETS_PER_SCAN
            or any(market not in _ALLOWED_MARKETS for market in markets)
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
        current = self._session_tasks.get(session_id)
        if current and not current.done():
            return
        self._track_task(
            asyncio.create_task(self._run_job(job_id)),
            session_id=session_id,
        )

    def _schedule_retry(self, job: ScanJob, delay: float) -> None:
        async def retry_later() -> None:
            await asyncio.sleep(delay)
            current = self._session_tasks.get(job.session_id)
            if current is not None and not current.done():
                try:
                    await asyncio.wait_for(asyncio.shield(current), timeout=10.0)
                except (asyncio.TimeoutError, asyncio.CancelledError):
                    pass
            self._session_tasks.pop(job.session_id, None)
            if self.backend.get_session(job.session_id) is not None:
                self._spawn(job.job_id, job.session_id)

        self._track_task(asyncio.create_task(retry_later()), session_id=job.session_id)

    def resume_pending(self) -> None:
        self.backend.purge_expired_sessions()
        now = utc_now()
        for job in self.backend.list_recoverable_jobs():
            self._spawn(job.job_id, job.session_id)
        # 捡回 retry delay 期间被重启的 job:retry_later asyncio task 已丢失,
        # next_run_at 还在未来 -> list_recoverable_jobs 不返回 -> 需重新安排 delayed spawn
        for job in self.backend.list_pending_retry_jobs():
            delay = max(0.0, (job.next_run_at - now).total_seconds())
            self._schedule_retry(job, delay)

    async def wait_for_idle(self) -> None:
        while self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)

    def _authorized_session(self, session_id: str, access_token: str) -> ScanSession:
        session = self.backend.get_session(session_id)
        if session is None:
            raise ScanNotFound(session_id)
        if session.expires_at <= utc_now():
            self.backend.delete_session(session_id)
            raise ScanNotFound(session_id)
        if not hmac.compare_digest(_token_hash(access_token), session.access_token_hash):
            raise ScanUnauthorized(session_id)
        return session

    def get_scan(self, session_id: str, access_token: str) -> dict[str, Any]:
        public = self._authorized_session(session_id, access_token).public_data()
        assets: list[dict[str, Any]] = []
        indexes = {"image": 0, "document": 0}
        for upload in self.backend.list_uploads(session_id):
            assets.append(
                {
                    "kind": upload.kind,
                    "index": indexes[upload.kind],
                    "name": upload.original_name,
                    "contentType": upload.content_type,
                    "size": upload.size,
                }
            )
            indexes[upload.kind] += 1
        public["assets"] = assets
        return public

    def get_image_asset(
        self,
        session_id: str,
        access_token: str,
        index: int,
    ) -> tuple[StoredUpload, bytes]:
        self._authorized_session(session_id, access_token)
        images = [upload for upload in self.backend.list_uploads(session_id) if upload.kind == "image"]
        if index < 0 or index >= len(images):
            raise ScanNotFound(f"asset:{index}")
        try:
            return self.backend.read_upload(session_id, images[index].upload_id)
        except (FileNotFoundError, OSError) as exc:
            raise ScanNotFound(f"asset:{index}") from exc

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
        if session is None or session.expires_at <= utc_now():
            self.backend.delete_session(job.session_id)
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
            raw = await self.runner(self._build_runner_payload(job, progress_callback=self._make_progress_callback(job)))
            result, status, degraded_reason = self._normalize_result(job, raw)
            # A transport-successful LLM call can still omit a required scene
            # or return a malformed package. Treat that as a retryable provider
            # result, not as a terminal user-facing scan: the job already has a
            # bounded retry budget and a subsequent generation is independent.
            if (
                status == "degraded"
                and job.attempts < self.max_attempts
                and self._is_retryable_generation_result(raw)
            ):
                self._handle_job_error(job, _RetryableScanResult("invalid generation package"))
                return
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
                    # Plan 2026-09-13 §10.4 — stage latency breakdown for
                    # p50/p95 trending. Summed per pipeline node from the
                    # agent trace the runner already records.
                    "stageLatencyMs": self._stage_latencies(result),
                    "latencyMs": result.get("latencyMs"),
                    # §10.4: every result records the code version it ran
                    # on (the audit session's "codeVersion: unknown" gap).
                    # settings.build_sha reads ATTRAX_BUILD_SHA from
                    # rag_service/.env or the process env.
                    "codeVersion": self._build_sha() or "unknown",
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
        interval = max(10.0, self.lease_seconds / 3)
        try:
            while True:
                await asyncio.sleep(interval)
                if not self.backend.renew_job_lease(job_id, lease_seconds=self.lease_seconds):
                    return
                current = self.backend.get_session(session_id)
                if current is None or current.status != "processing":
                    return
                self.backend.save_session(current.transition(ttl_hours=self.session_ttl_hours))
        except asyncio.CancelledError:
            return

    @staticmethod
    def _build_sha() -> str:
        """Resolve the deployed code version: settings (.env) → process env."""
        try:
            from ..config import settings

            sha = (settings.build_sha or "").strip()
            if sha:
                return sha
        except Exception:
            pass
        return (os.environ.get("ATTRAX_BUILD_SHA") or "").strip()

    @staticmethod
    def _stage_latencies(result: Mapping[str, Any]) -> dict[str, int]:
        """Sum per-node durations (ms) from the agent trace, for §10.4 metrics."""
        breakdown: dict[str, int] = {}
        trace = result.get("agentTrace")
        if not isinstance(trace, list):
            return breakdown
        for entry in trace:
            if not isinstance(entry, Mapping):
                continue
            node = str(entry.get("node") or "").strip()
            duration = entry.get("durationMs") or entry.get("duration_ms")
            if not node or not isinstance(duration, (int, float)) or isinstance(duration, bool):
                continue
            if duration < 0:
                continue
            breakdown[node] = breakdown.get(node, 0) + int(duration)
        return breakdown

    @staticmethod
    def _classify_error(exc: Exception) -> tuple[bool, str]:
        status_code = getattr(exc, "status_code", None)
        if status_code == 504 or isinstance(exc, asyncio.TimeoutError):
            # The underlying executor thread may still be finishing. Retrying
            # immediately would duplicate provider spend and consume another worker.
            return False, "SCAN_TIMEOUT"
        if status_code in {400, 401, 403, 404, 409, 413, 422}:
            return False, "SCAN_INPUT_OR_STORAGE_FAILURE"
        if isinstance(exc, (FileNotFoundError, ValueError, TypeError)):
            return False, "SCAN_INPUT_OR_STORAGE_FAILURE"
        return True, "SCAN_PROVIDER_FAILURE"

    @staticmethod
    def _is_retryable_generation_result(raw: Any) -> bool:
        """Identify only model/package-shape failures eligible for a rerun.

        A valid PASS/WARN/REJECTED result is never retried.  This deliberately
        keys off the pipeline's explicit generation trace and audit state, not
        the final compliance verdict or user supplied content.
        """
        if hasattr(raw, "model_dump"):
            raw = raw.model_dump(mode="json")
        if not isinstance(raw, Mapping):
            return False
        value = _camelize(dict(raw))
        trace = value.get("agentTrace")
        if isinstance(trace, list):
            for entry in trace:
                if not isinstance(entry, Mapping) or entry.get("node") != "generate":
                    continue
                if str(entry.get("status") or "").lower() in {
                    "generation_failed", "error", "degraded",
                }:
                    return True
        package = _mapping(value.get("reportPackage"))
        audit = _mapping(package.get("auditMetadata") or package.get("audit_metadata"))
        return _nested_string(audit, "validationStatus") in {"invalid", "fallback"}

    def _handle_job_error(self, job: ScanJob, exc: Exception) -> None:
        retryable, stable_reason = self._classify_error(exc)
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
        safe_name = _escape_prompt_injection(Path(name).name)
        safe_text = _escape_prompt_injection(text)
        if not safe_text:
            return []
        total = min(
            _MAX_DOCUMENT_CHUNKS,
            (len(safe_text) + _DOCUMENT_CHUNK_CHARS - 1) // _DOCUMENT_CHUNK_CHARS,
        )
        truncated = len(safe_text) > _DOCUMENT_CHUNK_CHARS * _MAX_DOCUMENT_CHUNKS
        return [
            {
                "name": safe_name,
                "mimeType": mime_type,
                "text": safe_text[index * _DOCUMENT_CHUNK_CHARS : (index + 1) * _DOCUMENT_CHUNK_CHARS],
                "part": index + 1,
                "partCount": total,
                "truncated": truncated,
            }
            for index in range(total)
        ]

    def _build_runner_payload(
        self,
        job: ScanJob,
        *,
        progress_callback=None,
    ) -> dict[str, Any]:
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
                documents.extend(
                    self._document_chunks(
                        safe_name,
                        upload.content_type,
                        content.decode("utf-8", errors="replace"),
                    )
                )
        payload: dict[str, Any] = {
            "query": job.query,
            "product": job.product,
            "category": job.category,
            "markets": job.markets,
            "images": images,
            "pdfs": pdfs,
            "documents": documents,
            # Scan identity: flows into observation ids so hotspots carry the
            # session + image identity (plan §6: ids must not repeat across
            # scans/images).
            "session_id": job.session_id,
        }
        # Only inject the callback when the caller supplied one — keeps the
        # dict small for callers that don't care (tests, public direct calls).
        if progress_callback is not None:
            payload["progressCallback"] = progress_callback
        return payload

    def _make_progress_callback(self, job: ScanJob):
        """Return a thread-safe progress emitter used by run_compliance_graph.

        The runner fires `(stage_key, stage_state, progress)` from inside an
        executor thread. We persist those into the session so the burning
        page can poll real progress instead of the old 10 → 100 jump (audit
        2026-09-13 §4.1). FileBackend.save_session holds an RLock, so it's
        safe to call concurrently with the lease heartbeat.
        """

        def emit(stage_key: str, stage_state: str, progress: int) -> None:
            try:
                current = self.backend.get_session(job.session_id)
            except Exception:
                return
            if current is None or current.status != "processing":
                return
            stage_label = (
                f"{stage_key}:{stage_state}" if stage_state else stage_key
            )
            try:
                self.backend.save_session(
                    current.transition(
                        ttl_hours=self.session_ttl_hours,
                        stage_text=stage_label,
                        progress=max(current.progress, int(progress)),
                    )
                )
            except Exception:
                # Progress is best-effort. A failed write must never abort
                # the pipeline; the next lease heartbeat will re-emit state.
                return

        return emit

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
        raw_status = str(value.get("status", "UNKNOWN")).upper()
        compliance_status = raw_status if raw_status in {"PASS", "WARN", "REJECTED"} else "UNKNOWN"
        report = str(value.get("report", "")).strip()
        trace = value.get("agentTrace")
        package_value = value.get("reportPackage")

        # 弱验证(text_overlap 等)与真失败分开:弱验证只作 warning,不强制 degraded。
        # 生产默认 text_overlap 验证(无 NLI)不应让真实 PASS 扫描显示降级/UNKNOWN。
        hard_reasons: list[str] = []
        warnings: list[str] = []
        verification_mode: str | None = None
        # UNKNOWN is an honest, usable decision state in the KB-anchored
        # pipeline: it means the model cannot determine applicability from
        # the supplied evidence. It must not be relabelled as a provider
        # failure/fallback as long as the report package and citations are
        # otherwise verified.
        if raw_status not in {"PASS", "WARN", "REJECTED", "UNKNOWN"}:
            hard_reasons.append("UNVERIFIED_COMPLIANCE_STATUS")
        if not report:
            hard_reasons.append("EMPTY_COMPLIANCE_REPORT")
        if not isinstance(trace, list) or not trace:
            hard_reasons.append("MISSING_AGENT_TRACE")
            trace = []
        evidence = value.get("documents")
        if not isinstance(evidence, list):
            evidence = []

        package: dict[str, Any] | None
        if not isinstance(package_value, Mapping):
            hard_reasons.append("MISSING_REPORT_PACKAGE")
            package = None
        else:
            package = _mapping(package_value)
            audit = _mapping(package.get("auditMetadata") or package.get("audit_metadata"))
            validation_status = (
                _nested_string(audit, "validationStatus")
                or _nested_string(audit, "validation_status")
                or _nested_string(package, "validationStatus")
            )
            verification_mode = (
                _nested_string(audit, "verificationMode")
                or _nested_string(audit, "verification_mode")
                or _nested_string(package, "verificationMode")
            )
            source = _nested_string(package, "source")
            if validation_status not in _VALID_PACKAGE_STATUSES:
                hard_reasons.append("REPORT_PACKAGE_NOT_VERIFIED")
            if verification_mode not in _STRONG_VERIFICATION_MODES:
                # 弱验证 ≠ 真失败:只进 warnings,不进 hard_reasons、不强制 degraded。
                warnings.append("WEAK_OR_MISSING_CITATION_VERIFICATION")
            if source in {"demo", "fallback", "mock"}:
                hard_reasons.append("FALLBACK_REPORT_SOURCE")

            # 利润/财务子报告校验失败时,只进 warnings;不要因为利润数据不准
            # 就把整张合规报告打成 degraded。Profit 页面单独读
            # audit.finance.validationStatus 渲染专用提示。Fix B 2026-09-12。
            finance = _mapping(audit.get("finance") or audit.get("finance_validation"))
            finance_status = (
                _nested_string(finance, "validationStatus")
                or _nested_string(finance, "validation_status")
            )
            if finance_status == "invalid":
                warnings.append("FINANCE_DATA_INVALID")

            # Audit P0-D: same isolation pattern for decisionView / roadmap /
            # evidenceBundles. A malformed sub-scene surfaces as a warning;
            # the compliance report stays "ready" so users do not see the red
            # DegradedBanner for a partial-shape failure that does not affect
            # the verdict.
            for scene in ("decisionView", "roadmap", "evidenceBundles"):
                scene_obj = _mapping(audit.get(scene))
                scene_status = _nested_string(scene_obj, "validationStatus")
                if scene_status == "invalid":
                    warnings.append(f"{scene.upper()}_SHAPE_INVALID")

            coverage = (
                _nested(audit, "citationCoverage")
                or _nested(audit, "citation_coverage")
                or _nested(package, "citationCoverage")
            )
            if isinstance(coverage, (int, float)) and coverage <= 0:
                hard_reasons.append("ZERO_CITATION_COVERAGE")

        # De-RAG no longer produces retrieval chunks.  In KB-input mode the
        # report package's citations/evidencePack is the authoritative evidence
        # payload, so an empty legacy ``documents`` list is expected.  Keep the
        # old gate for runners that return neither representation: accepting a
        # report without any inspectable source evidence would still be unsafe.
        package_evidence = []
        if package is not None:
            for key in ("evidencePack", "citations"):
                candidate = package.get(key)
                if isinstance(candidate, list):
                    package_evidence.extend(item for item in candidate if isinstance(item, Mapping))
        if not evidence and not package_evidence:
            hard_reasons.append("NO_RETRIEVED_EVIDENCE")

        hard_reasons = list(dict.fromkeys(hard_reasons))
        warnings = list(dict.fromkeys(warnings))
        degraded_reason = ",".join(hard_reasons) or None
        status: Literal["ready", "degraded"] = "degraded" if hard_reasons else "ready"
        if status == "degraded":
            compliance_status = "UNKNOWN"

        citation_verification = {
            "mode": verification_mode,
            "strength": "strong" if verification_mode in _STRONG_VERIFICATION_MODES else "weak",
        }
        # The result page deliberately renders the actual provider and elapsed
        # pipeline time instead of demo's fixed "demo · 0.0 s". Preserve the
        # generator's provider and aggregate all measured trace-node timings at
        # the public v1 boundary, where both snake_case and camelCase runner
        # payloads have already been normalized.
        audit_metadata = _mapping(package.get("auditMetadata")) if package else {}
        rag_provider = _nested_string(audit_metadata, "provider")
        latency_ms = 0
        for entry in trace:
            if not isinstance(entry, Mapping):
                continue
            if not rag_provider and _nested_string(entry, "node") == "generate":
                rag_provider = _nested_string(entry, "provider")
            duration = entry.get("durationMs")
            if isinstance(duration, (int, float)) and not isinstance(duration, bool) and duration >= 0:
                latency_ms += int(duration)
        result = {
            "sessionId": job.session_id,
            "productName": job.product,
            "productCategory": job.category,
            "targetMarkets": job.markets,
            "complianceStatus": compliance_status,
            "complianceReport": report,
            "agentTrace": trace,
            "loopCount": value.get("loopCount", 0),
            "retrievedChunks": evidence,
            "reportPackage": package,
            "degradedReasons": hard_reasons,
            "warnings": warnings,
            "citationVerification": citation_verification,
            "ragProvider": rag_provider or None,
            "latencyMs": latency_ms,
            "source": "fallback" if status == "degraded" else "real",
        }
        return result, status, degraded_reason
