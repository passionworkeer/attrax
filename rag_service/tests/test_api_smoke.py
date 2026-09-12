r"""
API smoke tests: verify the in-process FastAPI app responds correctly.
Run with: DEMO_MODE=true .venv\Scripts\python.exe -m pytest rag_service/tests/test_api_smoke.py -v
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient

from rag_service.config import settings
from rag_service import main as main_module
from rag_service.main import _parse_markets, app


@pytest.fixture(scope="module")
def client():
    previous_demo_mode = settings.demo_mode
    settings.demo_mode = True
    with TestClient(app) as test_client:
        yield test_client
    settings.demo_mode = previous_demo_mode


def test_health_endpoint(client):
    """GET /health returns 200 with status."""
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert "status" in data
    assert data["status"] == "ok"
    assert data["version"] == app.version


def test_ready_endpoint_reports_dependency_checks(client):
    """GET /ready returns dependency readiness checks for deploy probes."""
    resp = client.get("/ready")
    assert resp.status_code in (200, 503)
    data = resp.json()
    assert data["version"] == app.version
    assert "ready" in data
    assert "checks" in data
    assert "kb_anchors" in data["checks"]
    assert "regulation_library" in data["checks"]
    assert data["checks"]["kb_anchors"] is True
    assert data["checks"]["regulation_library"] is True


def test_ready_endpoint_reports_required_api_keys(client):
    """Production readiness reports the LLM key as the sole gate
    (De-RAG §7.7: embedding stack is gone)."""
    previous_demo_mode = settings.demo_mode
    previous_minimax = settings.minimax_api_key
    settings.demo_mode = False
    settings.minimax_api_key = ""
    try:
        resp = client.get("/ready")
    finally:
        settings.demo_mode = previous_demo_mode
        settings.minimax_api_key = previous_minimax

    assert resp.status_code == 503
    data = resp.json()
    assert data["checks"]["minimax_api_key"] is False
    # KB / regulation library still load regardless of LLM key.
    assert data["checks"]["kb_anchors"] is True


def test_readiness_returns_200_with_all_kb_checks_passing(client):
    """Happy path: KB + regulation library load + LLM key configured →
    readiness is 200 and gates pass."""
    resp = client.get("/ready")
    assert resp.status_code == 200
    data = resp.json()
    assert data["ready"] is True
    assert data["checks"]["kb_anchors"] is True
    assert data["checks"]["regulation_library"] is True
    assert data["checks"]["minimax_api_key"] is True


def test_parse_markets_accepts_json_array():
    """Multipart form market values preserve JSON array entries."""
    assert _parse_markets('["EU","US"]') == ["EU", "US"]


def test_scan_requires_query(client):
    """POST /scan with empty query returns 400."""
    resp = client.post("/scan", json={
        "query": "",
        "category": "electronics",
        "markets": ["EU"],
    })
    assert resp.status_code == 400


def test_scan_with_valid_request(client):
    """POST /scan with valid request returns a demo response in test mode."""
    resp = client.post("/scan", json={
        "query": "充电宝出口欧盟需要哪些认证？",
        "product": "USB充电宝",
        "category": "electronics",
        "markets": ["EU"],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "DEMO"


def test_openapi_schema(client):
    """OpenAPI schema is available."""
    resp = client.get("/openapi.json")
    assert resp.status_code == 200
    schema = resp.json()
    assert "paths" in schema
    assert "/scan" in schema["paths"]
