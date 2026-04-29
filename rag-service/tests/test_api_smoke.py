"""
API smoke tests: verify FastAPI endpoints respond correctly.
Run with: .venv\\Scripts\\python.exe -m pytest rag-service/tests/test_api_smoke.py -v
Requires: .venv\\Scripts\\python.exe -m uvicorn main:app --port 8000
In another terminal: .venv\\Scripts\\python.exe -m uvicorn main:app --port 8000 &
Skips automatically if the server is not running.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
import httpx

BASE_URL = "http://localhost:8000"


def _server_is_up():
    try:
        httpx.get(f"{BASE_URL}/health", timeout=3.0)
        return True
    except Exception:
        return False


requires_server = pytest.mark.skipif(
    not _server_is_up(),
    reason="FastAPI server not running on port 8000; start with: .venv\\Scripts\\python.exe -m uvicorn main:app --port 8000"
)


@pytest.fixture
def client():
    return httpx.Client(base_url=BASE_URL, timeout=10.0)


@requires_server
def test_health_endpoint(client):
    """GET /health returns 200 with status."""
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert "status" in data
    assert data["status"] == "ok"


@requires_server
def test_qdrant_health(client):
    """GET /health/qdrant returns connectivity status."""
    resp = client.get("/health/qdrant")
    assert resp.status_code == 200
    data = resp.json()
    assert "status" in data


@requires_server
def test_scan_demo_mode(client):
    """POST /scan returns response in DEMO_MODE."""
    resp = client.post("/scan", json={
        "query": "充电宝出口欧盟需要哪些认证？",
        "product": "USB充电宝",
        "category": "electronics",
        "markets": ["EU"],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "status" in data
    assert "report" in data
    assert "agent_trace" in data


@requires_server
def test_scan_returns_trace(client):
    """Scan response includes agent_trace."""
    resp = client.post("/scan", json={
        "query": "CE 标识要求",
        "category": "electronics",
        "markets": ["EU"],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data.get("agent_trace"), list)
    assert "loop_count" in data


@requires_server
def test_scan_multimarket(client):
    """Scan accepts multiple markets."""
    resp = client.post("/scan", json={
        "query": "充电宝认证要求",
        "category": "electronics",
        "markets": ["EU", "US"],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] in ("PASS", "WARN", "REJECTED", "UNKNOWN")


@requires_server
def test_scan_empty_query(client):
    """Scan handles empty query gracefully."""
    resp = client.post("/scan", json={
        "query": "",
        "category": "electronics",
        "markets": ["EU"],
    })
    # Should still return 200 (graceful handling)
    assert resp.status_code == 200


@requires_server
def test_scan_unknown_category(client):
    """Scan handles unknown category."""
    resp = client.post("/scan", json={
        "query": "认证要求",
        "category": "unknown_category_xyz_123",
        "markets": ["EU"],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "status" in data


@requires_server
def test_openapi_schema(client):
    """OpenAPI schema is available."""
    resp = client.get("/openapi.json")
    assert resp.status_code == 200
    schema = resp.json()
    assert "paths" in schema
    assert "/scan" in schema["paths"]
