"""Stable v1 API consumed by any replacement frontend."""

from __future__ import annotations

import hmac
import io
import json
import re
import zipfile
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import Response
from fastapi.security import HTTPAuthorizationCredentials

from rag_service.api.dependencies import bearer_scheme, bearer_token, get_scan_service
from rag_service.api.models import ApiEnvelope, CreatedScanData, failure, success
from rag_service.application.scans import (
    ScanNotFound,
    ScanSubmission,
    ScanUnauthorized,
    SubmittedUpload,
)
from rag_service.config import settings


router = APIRouter(prefix="/api/v1", tags=["public-v1"])

MAX_IMAGE_FILES = 8
MAX_DOCUMENT_FILES = 5
MAX_IMAGE_SIZE = 10 * 1024 * 1024
MAX_DOCUMENT_SIZE = 15 * 1024 * 1024
MAX_TEXT_SIZE = 1 * 1024 * 1024
MAX_TOTAL_UPLOAD_SIZE = 50 * 1024 * 1024
MAX_DOCX_EXPANDED_SIZE = 50 * 1024 * 1024
MAX_DOCX_MEMBERS = 500
UPLOAD_READ_CHUNK_SIZE = 1024 * 1024
ALLOWED_MARKETS = {"EU", "US", "UK", "CN", "AU", "SA", "AE", "JP"}
MAX_MARKETS = 5

_IMAGE_TYPES = {
    "image/jpeg": ({".jpg", ".jpeg"}, (b"\xff\xd8\xff",)),
    "image/png": ({".png"}, (b"\x89PNG",)),
    "image/webp": ({".webp"}, (b"RIFF",)),
}
_DOCUMENT_TYPES = {
    "application/pdf": {".pdf"},
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {".docx"},
    "application/octet-stream": {".docx"},
    "text/plain": {".txt"},
    "text/html": {".html", ".htm"},
}
_SESSION_ID = re.compile(r"^scan_[A-Za-z0-9_-]{1,64}$")


def _parse_markets(raw: str) -> list[str]:
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            values = [str(item).strip().upper() for item in parsed]
        else:
            values = []
    except (TypeError, ValueError):
        values = [item.strip().upper() for item in raw.split(",")]
    deduplicated = list(dict.fromkeys(value for value in values if value))
    if (
        not deduplicated
        or len(deduplicated) > MAX_MARKETS
        or any(value not in ALLOWED_MARKETS for value in deduplicated)
    ):
        return []
    return deduplicated


def _valid_signature(content_type: str, content: bytes) -> bool:
    if content_type == "image/webp":
        return content.startswith(b"RIFF") and content[8:12] == b"WEBP"
    if content_type == "application/pdf":
        return content.startswith(b"%PDF")
    if content_type in {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/octet-stream",
    }:
        return content.startswith((b"PK\x03\x04", b"PK\x05\x06"))
    if content_type in {"text/plain", "text/html"}:
        return True
    signatures = _IMAGE_TYPES.get(content_type, (set(), ()))[1]
    return any(content.startswith(signature) for signature in signatures)


async def _read_bounded(upload: UploadFile, limit: int) -> bytes | None:
    parts: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(UPLOAD_READ_CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            return None
        parts.append(chunk)
    return b"".join(parts)


def _valid_docx_archive(content: bytes) -> bool:
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            members = archive.infolist()
            if len(members) > MAX_DOCX_MEMBERS:
                return False
            expanded_size = sum(member.file_size for member in members)
            if expanded_size > MAX_DOCX_EXPANDED_SIZE:
                return False
            names = {member.filename.replace("\\", "/") for member in members}
            return "[Content_Types].xml" in names and "word/document.xml" in names
    except (OSError, zipfile.BadZipFile):
        return False


def _authorized_create_request(request: Request) -> bool:
    """Require the service-to-service secret whenever production configured it."""
    secret = settings.rag_internal_secret
    if not secret:
        return True
    provided = request.headers.get("x-internal-secret", "")
    return bool(provided) and hmac.compare_digest(provided, secret)


async def _read_uploads(
    request: Request,
    images: list[UploadFile],
    documents: list[UploadFile],
) -> tuple[list[SubmittedUpload] | None, Response | None]:
    if not images:
        return None, failure(request, "IMAGE_REQUIRED", "At least one image is required", 400)
    if len(images) > MAX_IMAGE_FILES:
        return None, failure(request, "TOO_MANY_IMAGES", "Too many images", 400)
    if len(documents) > MAX_DOCUMENT_FILES:
        return None, failure(request, "TOO_MANY_DOCUMENTS", "Too many documents", 400)

    submitted: list[SubmittedUpload] = []
    total_bytes = 0
    for kind, files, allowed, size_limit in (
        ("image", images, _IMAGE_TYPES, MAX_IMAGE_SIZE),
        ("document", documents, _DOCUMENT_TYPES, MAX_DOCUMENT_SIZE),
    ):
        for upload in files:
            name = Path(upload.filename or "upload").name
            content_type = (upload.content_type or "").lower()
            suffix = Path(name).suffix.lower()
            extensions = (
                allowed.get(content_type, (set(), ()))[0]
                if kind == "image"
                else allowed.get(content_type, set())
            )
            if content_type not in allowed or suffix not in extensions:
                return None, failure(request, "INVALID_FILE_TYPE", "Unsupported file type", 400)
            effective_limit = MAX_TEXT_SIZE if content_type in {"text/plain", "text/html"} else size_limit
            content = await _read_bounded(upload, effective_limit)
            if content is None:
                return None, failure(request, "FILE_TOO_LARGE", "Uploaded file is too large", 413)
            total_bytes += len(content)
            if total_bytes > MAX_TOTAL_UPLOAD_SIZE:
                return None, failure(request, "REQUEST_TOO_LARGE", "Total upload is too large", 413)
            if not _valid_signature(content_type, content):
                return None, failure(request, "INVALID_FILE_SIGNATURE", "File content does not match its type", 400)
            if suffix == ".docx" and not _valid_docx_archive(content):
                return None, failure(request, "INVALID_DOCX_ARCHIVE", "DOCX archive is invalid or unsafe", 400)
            submitted.append(
                SubmittedUpload(
                    kind=kind,
                    name=name,
                    content_type=content_type,
                    content=content,
                )
            )
    return submitted, None


def _session_and_token(
    request: Request,
    session_id: str,
    credentials: HTTPAuthorizationCredentials | None,
):
    if not _SESSION_ID.fullmatch(session_id):
        return None, None, failure(request, "NOT_FOUND", "Scan session not found", 404)
    token = bearer_token(credentials)
    if token is None:
        return None, None, failure(request, "UNAUTHORIZED", "Bearer token is required", 401)
    return get_scan_service(request), token, None


def _read_session(
    request: Request,
    session_id: str,
    credentials: HTTPAuthorizationCredentials | None,
):
    service, token, denied = _session_and_token(request, session_id, credentials)
    if denied:
        return None, None, denied
    try:
        return service, service.get_scan(session_id, token), None
    except ScanUnauthorized:
        return None, None, failure(request, "UNAUTHORIZED", "Invalid scan access token", 401)
    except ScanNotFound:
        return None, None, failure(request, "NOT_FOUND", "Scan session not found", 404)


@router.post("/scans", response_model=ApiEnvelope[CreatedScanData], status_code=202)
async def create_scan(
    request: Request,
    query: Annotated[str, Form()] = "",
    product: Annotated[str, Form()] = "",
    category: Annotated[str, Form()] = "electronics",
    markets: Annotated[str, Form()] = '["EU"]',
    images: Annotated[list[UploadFile], File()] = [],
    documents: Annotated[list[UploadFile], File()] = [],
):
    if not _authorized_create_request(request):
        return failure(request, "UNAUTHORIZED", "Internal service authorization is required", 401)
    if not query.strip() or len(query) > 2_000 or len(product) > 500 or len(category) > 100:
        return failure(request, "INVALID_REQUEST", "Invalid scan fields", 400)
    parsed_markets = _parse_markets(markets)
    if not parsed_markets:
        return failure(request, "INVALID_REQUEST", "Use one to five supported markets", 400)
    uploads, upload_error = await _read_uploads(request, images, documents)
    if upload_error:
        return upload_error
    try:
        created = await get_scan_service(request).create_scan(
            ScanSubmission(
                query=query.strip(),
                product=product.strip(),
                category=category.strip(),
                markets=parsed_markets,
                uploads=uploads or [],
            )
        )
    except (ValueError, TypeError):
        return failure(request, "INVALID_REQUEST", "Invalid scan fields", 400)
    except Exception:
        return failure(request, "SCAN_QUEUE_UNAVAILABLE", "Scan queue is unavailable", 503)
    return success(
        request,
        {
            "sessionId": created.session_id,
            "accessToken": created.access_token,
            "status": created.status,
            "pollUrl": created.poll_url,
        },
        202,
    )


@router.get("/scans/{session_id}", response_model=ApiEnvelope[dict[str, Any]])
def get_scan(
    request: Request,
    session_id: str,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
):
    _, session, denied = _read_session(request, session_id, credentials)
    return denied or success(request, session)


@router.get("/scans/{session_id}/roadmap", response_model=ApiEnvelope[dict[str, Any]])
def get_roadmap(
    request: Request,
    session_id: str,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
):
    _, session, denied = _read_session(request, session_id, credentials)
    if denied:
        return denied
    if session["status"] == "processing":
        return failure(request, "NOT_READY", "Scan result is not ready", 409)
    result = session.get("result") or {}
    package = result.get("reportPackage") or {}
    roadmap = package.get("roadmap")
    if not isinstance(roadmap, dict):
        return failure(request, "NOT_FOUND", "Roadmap not available", 404)
    return success(request, roadmap)


@router.get("/scans/{session_id}/trace", response_model=ApiEnvelope[list[dict[str, Any]]])
def get_trace(
    request: Request,
    session_id: str,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
):
    _, session, denied = _read_session(request, session_id, credentials)
    if denied:
        return denied
    if session["status"] == "processing":
        return failure(request, "NOT_READY", "Scan result is not ready", 409)
    trace = (session.get("result") or {}).get("agentTrace") or []
    if not trace:
        return failure(request, "NOT_FOUND", "Execution trace not available", 404)
    return success(request, trace)


@router.get("/scans/{session_id}/assets/{index}")
def get_asset(
    request: Request,
    session_id: str,
    index: int,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
):
    service, token, denied = _session_and_token(request, session_id, credentials)
    if denied:
        return denied
    try:
        upload, content = service.get_image_asset(session_id, token, index)
    except ScanUnauthorized:
        return failure(request, "UNAUTHORIZED", "Invalid scan access token", 401)
    except ScanNotFound:
        return failure(request, "NOT_FOUND", "Scan asset not found", 404)

    return Response(
        content=content,
        media_type=upload.content_type,
        headers={
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/scans/{session_id}", status_code=204)
def delete_scan(
    request: Request,
    session_id: str,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
):
    service, token, denied = _session_and_token(request, session_id, credentials)
    if denied:
        return denied
    try:
        service.delete_scan(session_id, token)
    except ScanUnauthorized:
        return failure(request, "UNAUTHORIZED", "Invalid scan access token", 401)
    except ScanNotFound:
        return failure(request, "NOT_FOUND", "Scan session not found", 404)
    return Response(status_code=204)


@router.get("/health", response_model=ApiEnvelope[dict[str, Any]])
def health(request: Request):
    return success(request, {"status": "ok", "version": request.app.version})


@router.get("/ready", response_model=ApiEnvelope[dict[str, Any]])
def ready(request: Request):
    provider = getattr(request.app.state, "readiness_provider", None)
    data = provider() if callable(provider) else {"ready": hasattr(request.app.state, "scan_service")}
    return success(request, data, 200 if data.get("ready") else 503)
