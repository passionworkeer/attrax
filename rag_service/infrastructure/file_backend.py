"""Atomic local-file adapter for sessions, uploads, jobs, and audit events."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import threading
import uuid
from pathlib import Path
from typing import Any

from rag_service.domain.scans import ScanJob, ScanSession, StoredUpload, UploadKind


_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]+$")


class FileBackend:
    def __init__(self, root: str | Path):
        self.root = Path(root).resolve()
        self.sessions_dir = self.root / "sessions"
        self.jobs_dir = self.root / "jobs"
        self.uploads_dir = self.root / "uploads"
        self.audit_path = self.root / "audit.jsonl"
        self._lock = threading.RLock()
        for directory in (self.sessions_dir, self.jobs_dir, self.uploads_dir):
            directory.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _id(value: str) -> str:
        if not _SAFE_ID.fullmatch(value):
            raise ValueError("identifier contains unsupported characters")
        return value

    def _session_path(self, session_id: str) -> Path:
        return self.sessions_dir / f"{self._id(session_id)}.json"

    def _job_path(self, job_id: str) -> Path:
        return self.jobs_dir / f"{self._id(job_id)}.json"

    @staticmethod
    def _write_json_atomic(path: Path, value: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(f"{path.suffix}.{uuid.uuid4().hex}.tmp")
        try:
            temporary.write_text(
                json.dumps(value, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8",
            )
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)

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

    def save_upload(
        self,
        session_id: str,
        kind: UploadKind,
        original_name: str,
        content_type: str,
        content: bytes,
    ) -> StoredUpload:
        safe_session = self._id(session_id)
        upload_id = f"upload_{uuid.uuid4().hex}"
        suffix = Path(original_name).suffix.lower()
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
            original_name=Path(original_name).name,
            stored_name=stored_name,
            path=str(path),
            content_type=content_type,
            size=len(content),
            sha256=hashlib.sha256(content).hexdigest(),
        )
        with self._lock:
            directory.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(f"{path.suffix}.tmp")
            try:
                temporary.write_bytes(content)
                os.replace(temporary, path)
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
            for path in sorted(directory.glob("upload_*.json")):
                uploads.append(StoredUpload.model_validate_json(path.read_text(encoding="utf-8")))
        return uploads

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

    def claim_job(self, job_id: str) -> ScanJob:
        with self._lock:
            job = self.get_job(job_id)
            if job is None:
                raise KeyError(job_id)
            claimed = job.claimed()
            if claimed != job:
                self.save_job(claimed)
            return claimed

    def list_recoverable_jobs(self) -> list[ScanJob]:
        jobs = []
        with self._lock:
            for path in self.jobs_dir.glob("*.json"):
                job = ScanJob.model_validate_json(path.read_text(encoding="utf-8"))
                if job.state in ("queued", "running"):
                    jobs.append(job)
        return sorted(jobs, key=lambda item: (item.created_at, item.job_id))

    def append_audit(self, event: dict[str, Any]) -> None:
        line = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
        with self._lock:
            self.root.mkdir(parents=True, exist_ok=True)
            with self.audit_path.open("a", encoding="utf-8", newline="\n") as stream:
                stream.write(line + "\n")

    def delete_session(self, session_id: str) -> None:
        safe_session = self._id(session_id)
        with self._lock:
            self._session_path(safe_session).unlink(missing_ok=True)
            for path in self.jobs_dir.glob("*.json"):
                job = ScanJob.model_validate_json(path.read_text(encoding="utf-8"))
                if job.session_id == safe_session:
                    path.unlink(missing_ok=True)
            upload_directory = self.uploads_dir / safe_session
            if upload_directory.exists():
                shutil.rmtree(upload_directory)
