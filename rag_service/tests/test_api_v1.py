import io
import json
import time
import zipfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from rag_service.api.v1 import router
from rag_service.application.scans import ScanService
from rag_service.config import settings
from rag_service.infrastructure.file_backend import FileBackend


PNG = b"\x89PNG\r\n\x1a\n" + b"public-api-image"


@pytest.fixture(autouse=True)
def clear_operator_secret(monkeypatch):
    """Keep the public-v1 contract tests independent of a local .env secret.

    Secret enforcement has its own explicit test below. Without this fixture,
    a developer's production-like ``rag_service/.env`` turns every ordinary
    request into 401 before the input/session behavior under test can run.
    """
    monkeypatch.setattr(settings, "rag_internal_secret", "")


def _pipeline_result():
    return {
        "status": "PASS",
        "report": "## compliant",
        "agent_trace": [{"node": "vision", "status": "success"}],
        "loop_count": 0,
        "documents": [{"source_id": "eu-rule", "region": "EU"}],
        "report_package": {
            "roadmap": {"items": [{"id": "apply-ce", "title": "Apply CE"}]},
            "auditMetadata": {
                "validationStatus": "valid",
                "verificationMode": "nli",
            },
        },
    }


def _mount_app(app, tmp_path, runner):
    app.state.scan_service = ScanService(
        FileBackend(tmp_path),
        runner=runner,
        retry_base_seconds=0,
    )
    app.state.readiness_provider = lambda: {
        "ready": True,
        "checks": {"scanService": True, "rag": True},
        "version": app.version,
    }
    app.include_router(router)
    return app


def build_app(tmp_path):
    async def runner(payload):
        return _pipeline_result()

    return _mount_app(FastAPI(version="test"), tmp_path, runner)


def create_scan(client: TestClient, headers=None, markets='["EU","US"]'):
    response = client.post(
        "/api/v1/scans",
        headers=headers or {},
        data={
            "query": "check charger",
            "product": "USB charger",
            "category": "electronics",
            "markets": markets,
        },
        files={"images": ("front.png", PNG, "image/png")},
    )
    assert response.status_code == 202, response.text
    body = response.json()
    return body["data"]["sessionId"], body["data"]["accessToken"], body


def poll_ready(client: TestClient, session_id: str, token: str):
    for _ in range(100):
        response = client.get(
            f"/api/v1/scans/{session_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        if response.json()["data"]["status"] != "processing":
            return response
        time.sleep(0.01)
    raise AssertionError("scan did not finish")


def minimal_docx(expanded_bytes: int = 16) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", "<Types />")
        archive.writestr("word/document.xml", "x" * expanded_bytes)
    return output.getvalue()


def test_create_poll_roadmap_trace_asset_and_delete_without_nextjs(tmp_path):
    with TestClient(build_app(tmp_path)) as client:
        session_id, token, created = create_scan(client)
        assert created["data"]["pollUrl"] == f"/api/v1/scans/{session_id}"
        assert created["meta"]["requestId"].startswith("req_")

        ready = poll_ready(client, session_id, token)
        assert ready.status_code == 200
        assert ready.json()["data"]["status"] == "ready"
        assert ready.json()["data"]["result"]["complianceStatus"] == "PASS"
        assert ready.json()["data"]["expiresAt"]

        headers = {"Authorization": f"Bearer {token}"}
        roadmap = client.get(f"/api/v1/scans/{session_id}/roadmap", headers=headers)
        trace = client.get(f"/api/v1/scans/{session_id}/trace", headers=headers)
        asset = client.get(f"/api/v1/scans/{session_id}/assets/0", headers=headers)
        assert roadmap.json()["data"]["items"][0]["id"] == "apply-ce"
        assert trace.json()["data"][0]["node"] == "vision"
        assert asset.content == PNG
        assert asset.headers["x-content-type-options"] == "nosniff"

        deleted = client.delete(f"/api/v1/scans/{session_id}", headers=headers)
        assert deleted.status_code == 204
        missing = client.get(f"/api/v1/scans/{session_id}", headers=headers)
        # Anti-enumeration: a deleted/unknown session is indistinguishable
        # from a wrong token — 401, never 404.
        assert missing.status_code == 401
        assert missing.json()["error"]["code"] == "UNAUTHORIZED"


def test_poll_and_assets_require_the_session_bearer_token(tmp_path):
    with TestClient(build_app(tmp_path)) as client:
        session_id, token, _ = create_scan(client)
        missing = client.get(f"/api/v1/scans/{session_id}")
        wrong = client.get(
            f"/api/v1/scans/{session_id}",
            headers={"Authorization": "Bearer wrong"},
        )
        asset_missing = client.get(f"/api/v1/scans/{session_id}/assets/0")
        assert missing.status_code == 401
        assert wrong.status_code == 401
        assert asset_missing.status_code == 401
        assert missing.json()["error"]["code"] == "UNAUTHORIZED"
        poll_ready(client, session_id, token)


def test_create_requires_internal_secret_when_configured(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "rag_internal_secret", "service-secret")
    with TestClient(build_app(tmp_path)) as client:
        denied = client.post(
            "/api/v1/scans",
            data={"query": "q", "category": "electronics", "markets": "EU"},
            files={"images": ("front.png", PNG, "image/png")},
        )
        assert denied.status_code == 401
        assert denied.json()["error"]["code"] == "UNAUTHORIZED"

        session_id, token, _ = create_scan(
            client,
            headers={"X-Internal-Secret": "service-secret"},
            markets="EU",
        )
        assert session_id.startswith("scan_")
        poll_ready(client, session_id, token)


def test_create_rejects_invalid_signature_market_and_file_counts(tmp_path):
    with TestClient(build_app(tmp_path)) as client:
        invalid = client.post(
            "/api/v1/scans",
            data={"query": "q", "category": "electronics", "markets": "EU"},
            files={"images": ("fake.png", b"not-png", "image/png")},
        )
        assert invalid.status_code == 400
        assert invalid.json()["error"]["code"] == "INVALID_FILE_SIGNATURE"

        invalid_market = client.post(
            "/api/v1/scans",
            data={"query": "q", "category": "electronics", "markets": "XX"},
            files={"images": ("front.png", PNG, "image/png")},
        )
        assert invalid_market.status_code == 400
        assert invalid_market.json()["error"]["code"] == "INVALID_REQUEST"

        too_many_markets = client.post(
            "/api/v1/scans",
            data={
                "query": "q",
                "category": "electronics",
                "markets": "EU,US,UK,CN,AU,JP",
            },
            files={"images": ("front.png", PNG, "image/png")},
        )
        assert too_many_markets.status_code == 400

        files = [("images", (f"{index}.png", PNG, "image/png")) for index in range(9)]
        excessive = client.post(
            "/api/v1/scans",
            data={"query": "q", "category": "electronics", "markets": "EU"},
            files=files,
        )
        assert excessive.status_code == 400
        assert excessive.json()["error"]["code"] == "TOO_MANY_IMAGES"


def test_docx_must_be_a_real_bounded_office_archive(tmp_path, monkeypatch):
    with TestClient(build_app(tmp_path)) as client:
        fake = client.post(
            "/api/v1/scans",
            data={"query": "q", "category": "electronics", "markets": "EU"},
            files=[
                ("images", ("front.png", PNG, "image/png")),
                (
                    "documents",
                    (
                        "fake.docx",
                        b"PK\x03\x04not-a-docx",
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    ),
                ),
            ],
        )
        assert fake.status_code == 400
        assert fake.json()["error"]["code"] == "INVALID_DOCX_ARCHIVE"

        import rag_service.api.v1 as v1

        monkeypatch.setattr(v1, "MAX_DOCX_EXPANDED_SIZE", 8)
        bomb = client.post(
            "/api/v1/scans",
            data={"query": "q", "category": "electronics", "markets": "EU"},
            files=[
                ("images", ("front.png", PNG, "image/png")),
                (
                    "documents",
                    (
                        "bomb.docx",
                        minimal_docx(expanded_bytes=128),
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    ),
                ),
            ],
        )
        assert bomb.status_code == 400
        assert bomb.json()["error"]["code"] == "INVALID_DOCX_ARCHIVE"


def test_trace_and_roadmap_are_unavailable_instead_of_fabricated(tmp_path):
    async def runner(payload):
        return {
            "status": "PASS",
            "report": "report",
            "agent_trace": [],
            "documents": [],
            "report_package": {
                "auditMetadata": {
                    "validationStatus": "valid",
                    "verificationMode": "text_overlap",
                }
            },
        }

    app = FastAPI(version="test")
    app.state.scan_service = ScanService(
        FileBackend(tmp_path),
        runner=runner,
        retry_base_seconds=0,
    )
    app.include_router(router)
    with TestClient(app) as client:
        session_id, token, _ = create_scan(client)
        ready = poll_ready(client, session_id, token)
        assert ready.json()["data"]["status"] == "degraded"
        headers = {"Authorization": f"Bearer {token}"}
        assert client.get(f"/api/v1/scans/{session_id}/trace", headers=headers).status_code == 404
        assert client.get(f"/api/v1/scans/{session_id}/roadmap", headers=headers).status_code == 404


def test_v1_health_ready_and_openapi_are_frontend_consumable(tmp_path):
    with TestClient(build_app(tmp_path)) as client:
        health = client.get("/api/v1/health")
        ready = client.get("/api/v1/ready")
        schema = client.get("/openapi.json").json()

        assert health.json()["data"]["status"] == "ok"
        assert ready.json()["data"]["ready"] is True
        assert "/api/v1/scans" in schema["paths"]
        assert "/api/v1/scans/{session_id}" in schema["paths"]
        assert "HTTPBearer" in schema["components"]["securitySchemes"]


def test_production_app_mounts_the_public_v1_contract():
    from rag_service.main import app as production_app

    paths = production_app.openapi()["paths"]
    assert "/api/v1/scans" in paths
    assert "/api/v1/health" in paths


def test_create_accepts_the_browsers_raw_form_shape(tmp_path):
    """The BFF streams the upload wizard's multipart body verbatim.

    That means the wire shape is whatever the browser built, not what the old
    BFF-side rename produced: ``markets`` is comma-joined rather than a JSON
    array, the Chinese ``query`` is absent, and the declared facts arrive
    under the browser's legacy ``userDeclaredFacts`` name.
    """
    captured: list = []

    async def runner(payload):
        captured.append(payload)
        return _pipeline_result()

    app = _mount_app(FastAPI(version="test"), tmp_path, runner)
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/scans",
            data={
                "category": "toy",
                "markets": "EU,US",
                "userDeclaredFacts": json.dumps({"battery": "否", "magnets": "否"}),
            },
            files={"images": ("front.png", PNG, "image/png")},
        )
        assert response.status_code == 202, response.text
        session_id = response.json()["data"]["sessionId"]
        token = response.json()["data"]["accessToken"]
        poll_ready(client, session_id, token)

    assert captured, "runner was never invoked"
    submission = captured[0]
    assert submission["query"] == "评估 toy 类产品在 EU/US 市场的合规风险"
    assert submission["markets"] == ["EU", "US"]
    assert submission["category"] == "toy"
    assert submission["declared_facts"] == {"battery": "否", "magnets": "否"}


def test_create_prefers_declared_facts_over_the_legacy_alias(tmp_path):
    """Both field names on the wire: the canonical one wins."""
    captured: list = []

    async def runner(payload):
        captured.append(payload)
        return _pipeline_result()

    app = _mount_app(FastAPI(version="test"), tmp_path, runner)
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/scans",
            data={
                "query": "check toy",
                "category": "toy",
                "markets": '["EU"]',
                "declared_facts": json.dumps({"battery": "absent"}),
                "userDeclaredFacts": json.dumps({"battery": "present"}),
            },
            files={"images": ("front.png", PNG, "image/png")},
        )
        assert response.status_code == 202, response.text
        session_id = response.json()["data"]["sessionId"]
        token = response.json()["data"]["accessToken"]
        poll_ready(client, session_id, token)

    assert captured[0]["declared_facts"] == {"battery": "absent"}
    assert captured[0]["query"] == "check toy"
