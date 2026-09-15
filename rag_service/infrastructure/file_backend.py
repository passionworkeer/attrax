"""Atomic local-file adapter for sessions, uploads, jobs, and audit events."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator

from rag_service.domain.scans import ScanJob, ScanSession, StoredUpload, UploadKind, utc_now


_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]+$")
_JOB_LOCK_STALE_SECONDS = 60


class FileBackend:
    """Small single-host backend with cross-process-safe job claiming.

    JSON files remain the persistence format, but job state transitions are
    protected by an O_EXCL lock file and an expiring job lease. This makes the
    backend safe for process restarts and prevents two Uvicorn/PM2 workers from
    claiming the same job at the same time. Horizontal multi-host deployments
    should still use a transactional database-backed queue.
    """

    def __init__(self, root: str | Path):
        self.root = Path(root).resolve()
        self.sessions_dir = self.root / "sessions"
        self.jobs_dir = self.root / "jobs"
        self.uploads_dir = self.root / "uploads"
        self.audit_path = self.root / "audit.jsonl"
        self._lock = threading.RLock()
        for directory in (self.root, self.sessions_dir, self.jobs_dir, self.uploads_dir):
            directory.mkdir(parents=True, exist_ok=True)
            self._chmod(directory, 0o700)

    @staticmethod
    def _chmod(path: Path, mode: int) -> None:
        try:
            path.chmod(mode)
        except OSError:
            pass

    @staticmethod
    def _id(value: str) -> str:
        if not _SAFE_ID.fullmatch(value):
            raise ValueError("identifier contains unsupported characters")
        return value

    def _session_path(self, session_id: str) -> Path:
        return self.sessions_dir / f"{self._id(session_id)}.json"

    def _job_path(self, job_id: str) -> Path:
        return self.jobs_dir / f"{self._id(job_id)}.json"

    def _job_lock_path(self, job_id: str) -> Path:
        return self.jobs_dir / f"{self._id(job_id)}.lock"

    @classmethod
    def _write_json_atomic(cls, path: Path, value: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(f"{path.suffix}.{uuid.uuid4().hex}.tmp")
        try:
            temporary.write_text(
                json.dumps(value, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8",
            )
            cls._chmod(temporary, 0o600)
            os.replace(temporary, path)
            cls._chmod(path, 0o600)
        finally:
            temporary.unlink(missing_ok=True)

    @contextmanager
    def _exclusive_job_lock(self, job_id: str) -> Iterator[bool]:
        """Acquire a short-lived cross-process lock for one job transition."""
        lock_path = self._job_lock_path(job_id)
        fd: int | None = None
        for attempt in range(2):
            try:
                fd = os.open(
                    lock_path,
                    os.O_CREAT | os.O_EXCL | os.O_WRONLY,
                    0o600,
                )
                os.write(fd, f"{os.getpid()} {time.time()}\n".encode("ascii"))
                break
            except FileExistsError:
                try:
                    stale = time.time() - lock_path.stat().st_mtime > _JOB_LOCK_STALE_SECONDS
                except FileNotFoundError:
                    stale = False
                if stale and attempt == 0:
                    lock_path.unlink(missing_ok=True)
                    continue
                yield False
                return

        try:
            yield fd is not None
        finally:
            if fd is not None:
                try:
                    os.close(fd)
                finally:
                    lock_path.unlink(missing_ok=True)

    def save_session(self, session: ScanSession) -> None:
        with self._lock:
            self._write_json_atomic(
                self._session_path(session.session_id),
                session.model_dump(mode="json"),
            )

    def get_session(self, session_id: str) -> ScanSession | None:
        path = self._session_path(session_id)
        with self._lock:
            if not path.exists():
                return None
            return ScanSession.model_validate_json(path.read_text(encoding="utf-8"))

    def purge_expired_sessions(self, now: datetime | None = None) -> int:
        now = now or utc_now()
        expired: list[str] = []
        with self._lock:
            for path in self.sessions_dir.glob("*.json"):
                try:
                    session = ScanSession.model_validate_json(path.read_text(encoding="utf-8"))
                except Exception:
                    continue
                if session.expires_at <= now:
                    expired.append(session.session_id)
        for session_id in expired:
            self.delete_session(session_id)
            self.append_audit({"event": "scan_expired", "sessionId": session_id})
        return len(expired)

    def save_upload(
        self,
        session_id: str,
        kind: UploadKind,
        original_name: str,
        content_type: str,
        content: bytes,
    ) -> StoredUpload:
        safe_session = self._id(session_id)
        timestamp_ns = time.time_ns()
        upload_id = f"upload_{timestamp_ns:020d}_{uuid.uuid4().hex[:8]}"
        safe_original_name = Path(original_name).name or "upload"
        suffix = Path(safe_original_name).suffix.lower()
        if not re.fullmatch(r"\.[a-z0-9]{1,8}", suffix):
            suffix = ""
        stored_name = f"{upload_id}{suffix}"
        directory = self.uploads_dir / safe_session
        path = directory / stored_name
        metadata_path = directory / f"{upload_id}.json"
        upload = StoredUpload(
            upload_id=upload_id,
            session_id=session_id,
            kind=kind,
            original_name=safe_original_name,
            stored_name=stored_name,
            path=str(path),
            content_type=content_type,
            size=len(content),
            sha256=hashlib.sha256(content).hexdigest(),
        )
        with self._lock:
            directory.mkdir(parents=True, exist_ok=True)
            self._chmod(directory, 0o700)
            temporary = path.with_suffix(f"{path.suffix}.{uuid.uuid4().hex}.tmp")
            try:
                temporary.write_bytes(content)
                self._chmod(temporary, 0o600)
                os.replace(temporary, path)
                self._chmod(path, 0o600)
                self._write_json_atomic(metadata_path, upload.model_dump(mode="json"))
            finally:
                temporary.unlink(missing_ok=True)
        return upload

    def list_uploads(self, session_id: str) -> list[StoredUpload]:
        directory = self.uploads_dir / self._id(session_id)
        if not directory.exists():
            return []
        uploads = []
        with self._lock:
            for path in directory.glob("upload_*.json"):
                uploads.append(StoredUpload.model_validate_json(path.read_text(encoding="utf-8")))
        return sorted(uploads, key=lambda item: (item.created_at, item.upload_id))

    def get_upload(self, session_id: str, upload_id: str) -> StoredUpload | None:
        safe_upload = self._id(upload_id)
        path = self.uploads_dir / self._id(session_id) / f"{safe_upload}.json"
        with self._lock:
            if not path.exists():
                return None
            return StoredUpload.model_validate_json(path.read_text(encoding="utf-8"))

    def read_upload(self, session_id: str, upload_id: str) -> tuple[StoredUpload, bytes]:
        upload = self.get_upload(session_id, upload_id)
        if upload is None:
            raise FileNotFoundError(upload_id)

        expected_dir = (self.uploads_dir / self._id(session_id)).resolve()
        path = Path(upload.path).resolve()
        if (
            not path.is_relative_to(expected_dir)
            or path.parent != expected_dir
            or path.name != upload.stored_name
        ):
            raise FileNotFoundError(upload_id)

        content = path.read_bytes()
        if len(content) != upload.size:
            raise OSError(f"upload size mismatch: {upload_id}")
        if hashlib.sha256(content).hexdigest() != upload.sha256:
            raise OSError(f"upload digest mismatch: {upload_id}")
        return upload, content

    def save_job(self, job: ScanJob) -> None:
        with self._lock:
            self._write_json_atomic(self._job_path(job.job_id), job.model_dump(mode="json"))

    def get_job(self, job_id: str) -> ScanJob | None:
        path = self._job_path(job_id)
        with self._lock:
            if not path.exists():
                return None
            return ScanJob.model_validate_json(path.read_text(encoding="utf-8"))

    def delete_job(self, job_id: str) -> None:
        with self._lock:
            self._job_path(job_id).unlink(missing_ok=True)
            self._job_lock_path(job_id).unlink(missing_ok=True)

    def claim_job(self, job_id: str, *, lease_seconds: int) -> ScanJob | None:
        with self._exclusive_job_lock(job_id) as acquired:
            if not acquired:
                return None
            with self._lock:
                job = self.get_job(job_id)
                if job is None or not job.ready_to_claim():
                    return None
                claimed = job.claimed(lease_seconds=lease_seconds)
                self.save_job(claimed)
                return claimed

    def renew_job_lease(self, job_id: str, *, lease_seconds: int) -> bool:
        with self._exclusive_job_lock(job_id) as acquired:
            if not acquired:
                return False
            with self._lock:
                job = self.get_job(job_id)
                if job is None or job.state != "running":
                    return False
                self.save_job(job.renew_lease(lease_seconds=lease_seconds))
                return True

    def list_recoverable_jobs(self) -> list[ScanJob]:
        jobs = []
        with self._lock:
            for path in self.jobs_dir.glob("*.json"):
                try:
                    job = ScanJob.model_validate_json(path.read_text(encoding="utf-8"))
                except Exception:
                    continue
                if job.ready_to_claim():
                    jobs.append(job)
        return sorted(jobs, key=lambda item: (item.next_run_at, item.created_at, item.job_id))

    def list_pending_retry_jobs(self) -> list[ScanJob]:
        """state=queued 且 next_run_at 还在未来的 job(retry delay 期间被重启丢失 retry_later task)。"""
        jobs = []
        now = utc_now()
        with self._lock:
            for path in self.jobs_dir.glob("*.json"):
                try:
                    job = ScanJob.model_validate_json(path.read_text(encoding="utf-8"))
                except Exception:
                    continue
                if job.state == "queued" and job.next_run_at > now:
                    jobs.append(job)
        return sorted(jobs, key=lambda item: (item.next_run_at, item.created_at, item.job_id))

    def append_audit(self, event: dict[str, Any]) -> None:
        payload = {
            "timestamp": utc_now().isoformat(),
            "codeVersion": os.environ.get("ATTRAX_BUILD_SHA", "unknown"),
            **event,
        }
        line = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        with self._lock:
            self.root.mkdir(parents=True, exist_ok=True)
            with self.audit_path.open("a", encoding="utf-8", newline="\n") as stream:
                stream.write(line + "\n")
            self._chmod(self.audit_path, 0o600)

    def audit_event_exists(self, event: str) -> bool:
        """Idempotency probe for the evidence/revision endpoints (plan §5.3).

        True when an audit event with this exact name was recorded before —
        used to make retried requests with the same idempotency key no-ops
        so files are not double-stored and jobs not double-spawned."""
        if not self.audit_path.exists():
            return False
        try:
            with self.audit_path.open("r", encoding="utf-8") as stream:
                for line in stream:
                    try:
                        payload = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if payload.get("event") == event:
                        return True
        except OSError:
            return False
        return False

    def delete_session(self, session_id: str) -> None:
        safe_session = self._id(session_id)
        with self._lock:
            self._session_path(safe_session).unlink(missing_ok=True)
            for path in self.jobs_dir.glob("*.json"):
                try:
                    job = ScanJob.model_validate_json(path.read_text(encoding="utf-8"))
                except Exception:
                    continue
                if job.session_id == safe_session:
                    path.unlink(missing_ok=True)
                    self._job_lock_path(job.job_id).unlink(missing_ok=True)
            upload_directory = self.uploads_dir / safe_session
            if upload_directory.exists():
                shutil.rmtree(upload_directory)
