"""Small public API dependencies without infrastructure knowledge."""

from fastapi import Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from rag_service.application.scans import ScanService


bearer_scheme = HTTPBearer(auto_error=False)


def get_scan_service(request: Request) -> ScanService:
    service = getattr(request.app.state, "scan_service", None)
    if not isinstance(service, ScanService):
        raise RuntimeError("scan service is not initialized")
    return service


def bearer_token(credentials: HTTPAuthorizationCredentials | None) -> str | None:
    if credentials is None or credentials.scheme.lower() != "bearer":
        return None
    token = credentials.credentials.strip()
    return token or None
