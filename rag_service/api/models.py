"""Public API envelopes and response models."""

from __future__ import annotations

import re
import uuid
from typing import Any, Generic, TypeVar

from fastapi import Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict


T = TypeVar("T")
_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{1,100}$")


class ApiMeta(BaseModel):
    requestId: str


class ApiError(BaseModel):
    code: str
    message: str
    details: dict[str, Any] | None = None


class ApiEnvelope(BaseModel, Generic[T]):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    data: T | None
    error: ApiError | None
    meta: ApiMeta


class CreatedScanData(BaseModel):
    sessionId: str
    accessToken: str
    status: str
    pollUrl: str


def request_id(request: Request) -> str:
    existing = getattr(request.state, "request_id", None)
    if isinstance(existing, str) and _REQUEST_ID.fullmatch(existing):
        return existing
    incoming = request.headers.get("x-request-id", "")
    value = incoming if _REQUEST_ID.fullmatch(incoming) else f"req_{uuid.uuid4().hex}"
    request.state.request_id = value
    return value


def success(request: Request, data: Any, status_code: int = 200) -> JSONResponse:
    rid = request_id(request)
    return JSONResponse(
        status_code=status_code,
        content={"data": data, "error": None, "meta": {"requestId": rid}},
        headers={"X-Request-Id": rid},
    )


def failure(
    request: Request,
    code: str,
    message: str,
    status_code: int,
    details: dict[str, Any] | None = None,
) -> JSONResponse:
    rid = request_id(request)
    headers = {"X-Request-Id": rid}
    # M1 (2026-09-18): every 503 raised through this envelope is a
    # capacity/queue condition (in-flight scan bound reached, queue backend
    # unavailable), not a malformed request. Tell clients how long to wait
    # before retrying instead of letting them hammer the endpoint.
    if status_code == 503:
        headers["Retry-After"] = "30"
    return JSONResponse(
        status_code=status_code,
        content={
            "data": None,
            "error": {"code": code, "message": message, "details": details},
            "meta": {"requestId": rid},
        },
        headers=headers,
    )
