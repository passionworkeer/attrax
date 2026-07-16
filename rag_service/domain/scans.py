"""Domain records for the frontend-facing asynchronous scan API."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


ScanStatus = Literal["processing", "ready", "degraded", "failed"]
JobState = Literal["queued", "running", "failed"]
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
    result: dict[str, Any] | None = None
    error: str | None = None

    @classmethod
    def new(
        cls,
        session_id: str,
        access_token_hash: str,
        category: str,
        markets: list[str],
    ) -> "ScanSession":
        return cls(
            session_id=session_id,
            access_token_hash=access_token_hash,
            category=category,
            markets=list(markets),
        )

    def transition(self, **changes: Any) -> "ScanSession":
        return self.model_copy(update={**changes, "updated_at": utc_now()})

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
    failure_reason: str | None = None

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

    def claimed(self) -> "ScanJob":
        if self.state == "running":
            return self
        return self.model_copy(
            update={
                "state": "running",
                "attempts": self.attempts + 1,
                "started_at": utc_now(),
            }
        )
