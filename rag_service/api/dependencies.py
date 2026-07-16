"""Small public API dependencies without infrastructure knowledge."""

from fastapi import Request

from rag_service.application.scans import ScanService


def get_scan_service(request: Request) -> ScanService:
    service = getattr(request.app.state, "scan_service", None)
    if not isinstance(service, ScanService):
        raise RuntimeError("scan service is not initialized")
    return service


def bearer_token(request: Request) -> str | None:
    authorization = request.headers.get("authorization", "")
    scheme, separator, token = authorization.partition(" ")
    if not separator or scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()
