r"""
Shared-secret middleware tests.

Covers three behaviours of the protect_requests middleware that gates
internal write endpoints (/scan, /scan-multipart, /profit-report) on the
optional X-Internal-Secret header:

1. RAG_INTERNAL_SECRET unset (default) → write endpoints open as before
   (local/dev backward compatibility).
2. RAG_INTERNAL_SECRET set + correct header → request proceeds.
3. RAG_INTERNAL_SECRET set + wrong / missing header → 401.

GET /health and /ready must never be gated, regardless of secret state.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient

from rag_service.config import settings
from rag_service.main import app


@pytest.fixture
def client():
    # demo_mode short-circuits the actual scan logic so we don't need a
    # configured LLM/embedder — we only care about the middleware gate.
    previous_demo = settings.demo_mode
    previous_secret = settings.rag_internal_secret
    settings.demo_mode = True
    with TestClient(app) as c:
        yield c
    settings.demo_mode = previous_demo
    settings.rag_internal_secret = previous_secret


def test_write_endpoints_open_when_secret_unset(client):
    """Default behaviour: no secret configured → /scan proceeds."""
    settings.rag_internal_secret = ""
    resp = client.post("/scan", json={
        "query": "test",
        "category": "electronics",
        "markets": ["EU"],
    })
    # 200 in demo mode (no query-validation failure since query is non-empty).
    assert resp.status_code == 200


def test_write_endpoints_pass_when_secret_matches(client):
    """Secret set + matching X-Internal-Secret header → request proceeds."""
    settings.rag_internal_secret = "s3cret-value-xyz"
    resp = client.post(
        "/scan",
        json={
            "query": "test",
            "category": "electronics",
            "markets": ["EU"],
        },
        headers={"X-Internal-Secret": "s3cret-value-xyz"},
    )
    assert resp.status_code == 200


def test_write_endpoints_401_when_secret_mismatched(client):
    """Secret set + wrong header value → 401."""
    settings.rag_internal_secret = "s3cret-value-xyz"
    resp = client.post(
        "/scan",
        json={
            "query": "test",
            "category": "electronics",
            "markets": ["EU"],
        },
        headers={"X-Internal-Secret": "wrong-value"},
    )
    assert resp.status_code == 401


def test_write_endpoints_401_when_secret_missing(client):
    """Secret set + no header at all → 401."""
    settings.rag_internal_secret = "s3cret-value-xyz"
    resp = client.post("/scan", json={
        "query": "test",
        "category": "electronics",
        "markets": ["EU"],
    })
    assert resp.status_code == 401


def test_health_never_gated_even_when_secret_set(client):
    """GET /health is not in _RATE_LIMITED_PATHS → never gated."""
    settings.rag_internal_secret = "s3cret-value-xyz"
    resp = client.get("/health")
    assert resp.status_code == 200


def test_ready_never_gated_even_when_secret_set(client):
    """GET /ready must remain open for k8s / load-balancer probes."""
    settings.rag_internal_secret = "s3cret-value-xyz"
    resp = client.get("/ready")
    assert resp.status_code in (200, 503)


def test_profit_report_gated_when_secret_set(client):
    """/profit-report is also a write endpoint → gated by secret."""
    settings.rag_internal_secret = "s3cret-value-xyz"
    # No header → 401.
    resp = client.post("/profit-report", json={
        "product": "electronics",
        "category": "electronics",
        "markets": ["EU"],
    })
    assert resp.status_code == 401
    # Correct header → proceeds (demo_mode returns DEMO status without LLM).
    resp2 = client.post(
        "/profit-report",
        json={
            "product": "electronics",
            "category": "electronics",
            "markets": ["EU"],
        },
        headers={"X-Internal-Secret": "s3cret-value-xyz"},
    )
    assert resp2.status_code == 200
