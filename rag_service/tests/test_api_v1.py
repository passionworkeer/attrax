import time

from fastapi import FastAPI
from fastapi.testclient import TestClient

from rag_service.api.v1 import router
from rag_service.application.scans import ScanService
from rag_service.infrastructure.file_backend import FileBackend


PNG = b"\x89PNG\r\n\x1a\n" + b"public-api-image"


def build_app(tmp_path):
    async def runner(payload):
        return {
            "status": "PASS",
            "report": "## compliant",
            "agent_trace": [{"node": "vision", "status": "success"}],
            "loop_count": 0,
            "documents": [],
            "report_package": {"roadmap": {"items": [{"id": "apply-ce"}]}},
        }

    app = FastAPI(version="test")
    app.state.scan_service = ScanService(FileBackend(tmp_path), runner=runner)
    app.state.readiness_provider = lambda: {
        "ready": True,
        "checks": {"scanService": True, "rag": True},
        "version": app.version,
    }
    app.include_router(router)
    return app


def create_scan(client: TestClient):
    response = client.post(
        "/api/v1/scans",
        data={
            "query": "check charger",
            "product": "USB charger",
            "category": "electronics",
            "markets": '["EU","US"]',
        },
        files={"images": ("front.png", PNG, "image/png")},
    )
    assert response.status_code == 202, response.text
    body = response.json()
    return body["data"]["sessionId"], body["data"]["accessToken"], body


def poll_ready(client: TestClient, session_id: str, token: str):
    for _ in range(50):
        response = client.get(
            f"/api/v1/scans/{session_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        if response.json()["data"]["status"] != "processing":
            return response
        time.sleep(0.01)
    raise AssertionError("scan did not finish")


def test_create_poll_roadmap_trace_and_delete_without_nextjs(tmp_path):
    app = build_app(tmp_path)
    with TestClient(app) as client:
        session_id, token, created = create_scan(client)
        assert created == {
            "data": {
                "sessionId": session_id,
                "accessToken": token,
                "status": "processing",
                "pollUrl": f"/api/v1/scans/{session_id}",
            },
            "error": None,
            "meta": {"requestId": created["meta"]["requestId"]},
        }

        ready = poll_ready(client, session_id, token)
        assert ready.status_code == 200
        assert ready.json()["data"]["result"]["complianceStatus"] == "PASS"

        headers = {"Authorization": f"Bearer {token}"}
        roadmap = client.get(f"/api/v1/scans/{session_id}/roadmap", headers=headers)
        trace = client.get(f"/api/v1/scans/{session_id}/trace", headers=headers)
        assert roadmap.json()["data"]["items"][0]["id"] == "apply-ce"
        assert trace.json()["data"][0]["node"] == "vision"

        deleted = client.delete(f"/api/v1/scans/{session_id}", headers=headers)
        assert deleted.status_code == 204
        missing = client.get(f"/api/v1/scans/{session_id}", headers=headers)
        assert missing.status_code == 404
        assert missing.json()["error"]["code"] == "NOT_FOUND"


def test_poll_requires_bearer_token_and_uses_error_envelope(tmp_path):
    with TestClient(build_app(tmp_path)) as client:
        session_id, token, _ = create_scan(client)
        missing = client.get(f"/api/v1/scans/{session_id}")
        wrong = client.get(
            f"/api/v1/scans/{session_id}",
            headers={"Authorization": "Bearer wrong"},
        )
        assert missing.status_code == 401
        assert wrong.status_code == 401
        assert missing.json()["data"] is None
        assert missing.json()["error"]["code"] == "UNAUTHORIZED"
        assert missing.json()["meta"]["requestId"].startswith("req_")
        assert missing.headers["x-request-id"] == missing.json()["meta"]["requestId"]
        poll_ready(client, session_id, token)


def test_create_rejects_invalid_signature_and_too_many_files(tmp_path):
    with TestClient(build_app(tmp_path)) as client:
        invalid = client.post(
            "/api/v1/scans",
            data={"query": "q", "category": "electronics", "markets": "EU"},
            files={"images": ("fake.png", b"not-png", "image/png")},
        )
        assert invalid.status_code == 400
        assert invalid.json()["error"]["code"] == "INVALID_FILE_SIGNATURE"

        files = [("images", (f"{index}.png", PNG, "image/png")) for index in range(9)]
        excessive = client.post(
            "/api/v1/scans",
            data={"query": "q", "category": "electronics", "markets": "EU"},
            files=files,
        )
        assert excessive.status_code == 400
        assert excessive.json()["error"]["code"] == "TOO_MANY_IMAGES"


def test_v1_health_ready_and_openapi_are_frontend_consumable(tmp_path):
    with TestClient(build_app(tmp_path)) as client:
        health = client.get("/api/v1/health")
        ready = client.get("/api/v1/ready")
        schema = client.get("/openapi.json").json()

        assert health.json()["data"]["status"] == "ok"
        assert ready.json()["data"]["ready"] is True
        assert "/api/v1/scans" in schema["paths"]
        assert "/api/v1/scans/{session_id}" in schema["paths"]


def test_production_app_mounts_the_public_v1_contract():
    from rag_service.main import app as production_app

    paths = production_app.openapi()["paths"]
    assert "/api/v1/scans" in paths
    assert "/api/v1/health" in paths
