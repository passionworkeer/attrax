"""Domain records for the frontend-facing asynchronous scan API."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


DEFAULT_SESSION_TTL_HOURS = 24
DEFAULT_JOB_LEASE_SECONDS = 600


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


ScanStatus = Literal["processing", "ready", "degraded", "failed"]
JobState = Literal["queued", "running", "dead"]
UploadKind = Literal["image", "document"]


class ScanSession(BaseModel):
    model_config = ConfigDict(frozen=True)

    session_id: str
    access_token_hash: str
    status: ScanStatus = "processing"
    progress: int = Field(default=0, ge=0, le=100)
    stage_text: str = "queued"
    category: str
    markets: list[str]
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    expires_at: datetime = Field(
        default_factory=lambda: utc_now() + timedelta(hours=DEFAULT_SESSION_TTL_HOURS)
    )
    result: dict[str, Any] | None = None
    error: str | None = None

    @classmethod
    def new(
        cls,
        session_id: str,
        access_token_hash: str,
        category: str,
        markets: list[str],
        *,
        ttl_hours: int = DEFAULT_SESSION_TTL_HOURS,
    ) -> "ScanSession":
        now = utc_now()
        return cls(
            session_id=session_id,
            access_token_hash=access_token_hash,
            category=category,
            markets=list(markets),
            created_at=now,
            updated_at=now,
            expires_at=now + timedelta(hours=max(1, ttl_hours)),
        )

    def transition(
        self,
        *,
        ttl_hours: int = DEFAULT_SESSION_TTL_HOURS,
        **changes: Any,
    ) -> "ScanSession":
        now = utc_now()
        return self.model_copy(
            update={
                **changes,
                "updated_at": now,
                "expires_at": now + timedelta(hours=max(1, ttl_hours)),
            }
        )

    def public_data(self) -> dict[str, Any]:
        data = self.model_dump(mode="json", exclude={"access_token_hash"})
        return {
            "sessionId": data["session_id"],
            "status": data["status"],
            "progress": data["progress"],
            "stageText": data["stage_text"],
            "category": data["category"],
            "markets": data["markets"],
            "createdAt": data["created_at"],
            "updatedAt": data["updated_at"],
            "expiresAt": data["expires_at"],
            "result": data["result"],
            "error": data["error"],
        }


class StoredUpload(BaseModel):
    model_config = ConfigDict(frozen=True)

    upload_id: str
    session_id: str
    kind: UploadKind
    original_name: str
    stored_name: str
    path: str
    content_type: str
    size: int = Field(ge=0)
    sha256: str
    created_at: datetime = Field(default_factory=utc_now)


class ScanJob(BaseModel):
    model_config = ConfigDict(frozen=True)

    job_id: str
    session_id: str
    query: str
    product: str
    category: str
    markets: list[str]
    upload_ids: list[str]
    state: JobState = "queued"
    attempts: int = Field(default=0, ge=0)
    created_at: datetime = Field(default_factory=utc_now)
    started_at: datetime | None = None
    next_run_at: datetime = Field(default_factory=utc_now)
    lease_expires_at: datetime | None = None
    last_error: str | None = None

    @classmethod
    def new(
        cls,
        job_id: str,
        session_id: str,
        query: str,
        product: str,
        category: str,
        markets: list[str],
        upload_ids: list[str],
    ) -> "ScanJob":
        return cls(
            job_id=job_id,
            session_id=session_id,
            query=query,
            product=product,
            category=category,
            markets=list(markets),
            upload_ids=list(upload_ids),
        )

    def ready_to_claim(self, now: datetime | None = None) -> bool:
        now = now or utc_now()
        if self.state == "queued":
            return self.next_run_at <= now
        if self.state == "running":
            return self.lease_expires_at is None or self.lease_expires_at <= now
        return False

    def claimed(
        self,
        *,
        lease_seconds: int = DEFAULT_JOB_LEASE_SECONDS,
        now: datetime | None = None,
    ) -> "ScanJob":
        now = now or utc_now()
        if not self.ready_to_claim(now):
            return self
        return self.model_copy(
            update={
                "state": "running",
                "attempts": self.attempts + 1,
                "started_at": now,
                "lease_expires_at": now + timedelta(seconds=max(30, lease_seconds)),
            }
        )

    def renew_lease(
        self,
        *,
        lease_seconds: int = DEFAULT_JOB_LEASE_SECONDS,
        now: datetime | None = None,
    ) -> "ScanJob":
        now = now or utc_now()
        if self.state != "running":
            return self
        return self.model_copy(
            update={"lease_expires_at": now + timedelta(seconds=max(30, lease_seconds))}
        )

    def requeued(
        self,
        reason: str,
        *,
        delay_seconds: float,
        now: datetime | None = None,
    ) -> "ScanJob":
        now = now or utc_now()
        return self.model_copy(
            update={
                "state": "queued",
                "started_at": None,
                "lease_expires_at": None,
                "next_run_at": now + timedelta(seconds=max(0.0, delay_seconds)),
                "last_error": reason,
            }
        )

    def dead(self, reason: str) -> "ScanJob":
        return self.model_copy(
            update={
                "state": "dead",
                "started_at": None,
                "lease_expires_at": None,
                "last_error": reason,
            }
        )
