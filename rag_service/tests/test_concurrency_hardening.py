"""Concurrency-hardening regression tests (2026-09-18 batch).

Each test drives the real code path: real threads, real asyncio tasks, the
real file backend. Only the network boundary is replaced — with the smallest
object that can hold a call open — because the failure modes under test
(shared mutable attribution, unbounded fan-out, retry burning) are exactly
about what happens around that boundary.
"""
from __future__ import annotations

import asyncio
import hashlib
import threading
import time
import urllib.error
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from rag_service import lifecycle
from rag_service.api.v1 import router
from rag_service.application import scans as scans_module
from rag_service.application.scans import (
    ScanCapacityExceeded,
    ScanService,
    ScanSubmission,
    SubmittedUpload,
)
from rag_service.config import settings
from rag_service.domain.scans import ScanJob, ScanSession
from rag_service.generate.report_generator import ReportGenerator, _TransientLLMError
from rag_service.infrastructure.file_backend import FileBackend
from rag_service.pipeline.nodes import vision as vision_module


PNG = b"\x89PNG\r\n\x1a\n" + b"hardening-image"


@pytest.fixture(autouse=True)
def clear_operator_secret(monkeypatch):
    """Keep these tests independent of a local .env RAG_INTERNAL_SECRET."""
    monkeypatch.setattr(settings, "rag_internal_secret", "")


def _submission() -> ScanSubmission:
    return ScanSubmission(
        query="check charger",
        product="USB charger",
        category="electronics",
        markets=["EU", "US"],
        uploads=[
            SubmittedUpload(
                kind="image",
                name="front.png",
                content_type="image/png",
                content=PNG,
            )
        ],
    )


def _verified_result() -> dict:
    return {
        "status": "PASS",
        "report": "## compliant",
        "agent_trace": [{"node": "generator", "status": "success"}],
        "loop_count": 1,
        "documents": [{"source_id": "eu-rule", "region": "EU"}],
        "report_package": {
            "roadmap": {"items": [{"id": "step-1", "title": "Apply"}]},
            "auditMetadata": {
                "validationStatus": "valid",
                "verificationMode": "nli",
                "citationCoverage": 1.0,
            },
        },
    }


# ── M1: admission control ────────────────────────────────────────────────


def test_in_flight_bound_rejects_excess_and_frees_slots_on_completion(tmp_path):
    """Two busy scans + bound=2 → the third submission is rejected fast, and
    once the busy scans finish their slots are reusable."""

    async def scenario():
        gate = asyncio.Event()

        async def runner(payload):
            await gate.wait()
            return _verified_result()

        service = ScanService(
            FileBackend(tmp_path),
            runner=runner,
            retry_base_seconds=0,
            max_in_flight_scans=2,
        )
        await service.create_scan(_submission())
        await service.create_scan(_submission())

        with pytest.raises(ScanCapacityExceeded):
            await service.create_scan(_submission())

        gate.set()
        await service.wait_for_idle()

        # Slots were released at the terminal state — a new submission is
        # admitted again instead of the bound leaking shut.
        third = await service.create_scan(_submission())
        assert third.session_id
        await service.wait_for_idle()

    asyncio.run(scenario())


def test_failed_scan_releases_its_in_flight_slot(tmp_path):
    async def scenario():
        async def runner(payload):
            raise RuntimeError("provider exploded")

        service = ScanService(
            FileBackend(tmp_path),
            runner=runner,
            max_attempts=1,
            retry_base_seconds=0,
            max_in_flight_scans=1,
        )
        created = await service.create_scan(_submission())
        await service.wait_for_idle()
        assert service.get_scan(created.session_id, created.access_token)["status"] == "failed"
        # The dead scan must not hold the only slot.
        second = await service.create_scan(_submission())
        assert second.session_id
        await service.wait_for_idle()

    asyncio.run(scenario())


def test_scan_creation_at_capacity_returns_503_with_retry_after(tmp_path):
    gate = threading.Event()

    async def runner(payload):
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, gate.wait, 10)
        return _verified_result()

    app = FastAPI(version="test")
    app.state.scan_service = ScanService(
        FileBackend(tmp_path),
        runner=runner,
        retry_base_seconds=0,
        max_in_flight_scans=1,
    )
    app.include_router(router)

    def post(client):
        return client.post(
            "/api/v1/scans",
            data={"query": "check charger", "category": "electronics", "markets": '["EU"]'},
            files={"images": ("front.png", PNG, "image/png")},
        )

    try:
        with TestClient(app) as client:
            first = post(client)
            assert first.status_code == 202, first.text
            session_id = first.json()["data"]["sessionId"]
            token = first.json()["data"]["accessToken"]

            second = post(client)
            assert second.status_code == 503, second.text
            assert second.headers.get("retry-after") == "30"
            assert second.json()["error"]["code"] == "SCAN_QUEUE_UNAVAILABLE"

            # Release the accepted scan and wait for it to finish so the app
            # tears down with no task still holding an executor thread.
            gate.set()
            headers = {"Authorization": f"Bearer {token}"}
            deadline = time.time() + 10
            while time.time() < deadline:
                polled = client.get(f"/api/v1/scans/{session_id}", headers=headers)
                if polled.json()["data"]["status"] != "processing":
                    break
                time.sleep(0.05)
            else:
                pytest.fail("accepted scan never left the processing state")
    finally:
        gate.set()


# ── M6: staggered resume ─────────────────────────────────────────────────


def test_resume_pending_spawns_in_batches_then_completes_all(tmp_path, monkeypatch):
    monkeypatch.setattr(scans_module._settings, "scan_worker_concurrency", 3)

    async def scenario():
        backend = FileBackend(tmp_path)
        for index in range(6):
            session_id = f"scan_resume_{index}"
            backend.save_session(
                ScanSession.new(
                    session_id,
                    hashlib.sha256(f"token-{index}".encode()).hexdigest(),
                    "electronics",
                    ["EU"],
                )
            )
            upload = backend.save_upload(
                session_id, "image", "front.png", "image/png", PNG
            )
            backend.save_job(
                ScanJob.new(
                    f"job_resume_{index}",
                    session_id,
                    "check",
                    "charger",
                    "electronics",
                    ["EU"],
                    [upload.upload_id],
                )
            )

        async def runner(payload):
            return _verified_result()

        service = ScanService(backend, runner=runner, retry_base_seconds=0)
        service.resume_pending()
        # Yield once: the stager must stop at the batch boundary instead of
        # spawning all six recoverable jobs in one burst.
        await asyncio.sleep(0)
        assert len(service._session_tasks) == 3

        await service.wait_for_idle()
        for index in range(6):
            assert backend.get_session(f"scan_resume_{index}").status == "ready"

    asyncio.run(scenario())


# ── H4: vision singleflight + M7: HTTP fan-out cap ───────────────────────


def test_concurrent_same_image_shares_one_primary_provider_call(monkeypatch):
    analyzer = object.__new__(vision_module.VisionAnalyzer)
    analyzer.api_key = "test"
    analyzer.model = "test-model"
    analyzer.fallback_model = "fallback-model"
    analyzer.fallback_api_key = ""
    analyzer._vision_primary = "minimax"

    calls = []
    release = threading.Event()

    def respond(*args, **kwargs):
        calls.append(1)
        release.wait(5)
        return '{"product_type": "charger"}'

    monkeypatch.setattr(analyzer, "_call_mimotalk", respond)

    def call():
        return analyzer._vision_text(b"same-image-bytes", "image/png", "PROMPT", None, 1536)

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(call)
        deadline = time.time() + 5
        while not calls and time.time() < deadline:
            time.sleep(0.01)
        assert calls, "first provider call never started"
        second = pool.submit(call)
        time.sleep(0.05)  # let the second caller join the in-flight request
        release.set()
        r1 = first.result(timeout=10)
        r2 = second.result(timeout=10)

    assert len(calls) == 1, "concurrent scans of one image must share the call"
    assert r1[0] == r2[0] == '{"product_type": "charger"}'


def test_vision_http_semaphore_bounds_concurrent_provider_calls(monkeypatch):
    # A single scan fans out to 4 images, so the real cap must never drop
    # below that or a scan would starve itself.
    assert vision_module._VISION_HTTP_CONCURRENCY >= 4

    analyzer = object.__new__(vision_module.VisionAnalyzer)
    analyzer.timeout_seconds = 1.0
    monkeypatch.setattr(
        vision_module, "_VISION_HTTP_SEMAPHORE", threading.Semaphore(2)
    )

    active: list[int] = []
    peak: list[int] = []
    lock = threading.Lock()

    class _Response:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return b"{}"

    class _Opener:
        def open(self, request, timeout=None):
            with lock:
                active.append(1)
                peak.append(len(active))
            time.sleep(0.05)
            with lock:
                active.pop()
            return _Response()

    monkeypatch.setattr(vision_module, "_NO_PROXY_OPENER", _Opener())

    def call():
        return analyzer._post_json(
            "https://provider.example/messages", "key", b"{}", {}
        )

    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(call) for _ in range(6)]
        for future in futures:
            assert future.result(timeout=10) == {}

    assert len(peak) == 6
    assert max(peak) <= 2, "provider calls exceeded the semaphore bound"


# ── M17: per-thread provider attribution ─────────────────────────────────


def _report_generator() -> ReportGenerator:
    gen = ReportGenerator(api_key="primary-key")
    gen.base_url = "https://primary.example/v1"
    gen.model = "primary-model"
    gen._primary_provider = "minimax"
    gen.fallback_api_key = "fallback-key"
    gen.fallback_base_url = "https://fallback.example/anthropic/v1"
    gen.fallback_model = "fallback-model"
    gen.fallback_max_tokens = 1024
    return gen


def test_provider_attribution_does_not_leak_between_threads(monkeypatch):
    """Scan A's attribution must survive scan B's fallback on another thread."""
    gen = _report_generator()
    b_done = threading.Event()

    def fake_read(self, request, timeout=None):
        url = request.full_url
        if "fallback.example" in url:
            return '{"complianceReport": "fallback answer"}'
        if threading.current_thread().name == "worker-b":
            raise _TransientLLMError(
                urllib.error.HTTPError(url, 500, "boom", hdrs=None, fp=None)
            )
        return '{"complianceReport": "primary answer"}'

    monkeypatch.setattr(ReportGenerator, "_read_llm_response", fake_read)

    seen: dict[str, str] = {}

    def worker_a():
        gen._generate_llm("sys", "user", 100)
        # Let worker B record its (fallback) attribution before reading ours.
        assert b_done.wait(5)
        seen["a"] = gen.provider

    def worker_b():
        gen._generate_llm("sys", "user", 100)
        b_done.set()
        seen["b"] = gen.provider

    thread_a = threading.Thread(target=worker_a, name="worker-a")
    thread_b = threading.Thread(target=worker_b, name="worker-b")
    thread_a.start()
    thread_b.start()
    thread_a.join(timeout=10)
    thread_b.join(timeout=10)

    assert not thread_a.is_alive() and not thread_b.is_alive()
    assert seen["a"] == "minimax"
    assert seen["b"] == "deepseek"


# ── M2: shutdown flag gates retries ──────────────────────────────────────


def test_vision_transport_abandons_retries_after_shutdown(monkeypatch):
    analyzer = object.__new__(vision_module.VisionAnalyzer)
    analyzer.timeout_seconds = 1.0
    attempts: list[float] = []

    class _FailingOpener:
        def open(self, request, timeout=None):
            attempts.append(timeout)
            raise urllib.error.URLError("network down")

    monkeypatch.setattr(vision_module, "_NO_PROXY_OPENER", _FailingOpener())

    lifecycle.signal_shutdown()
    result = analyzer._post_json(
        "https://provider.example/messages", "key", b"{}", {}
    )

    assert result is None
    assert len(attempts) == 1, "shutdown must skip the remaining retry attempts"


def test_vision_does_not_switch_to_the_fallback_provider_after_shutdown(monkeypatch):
    analyzer = object.__new__(vision_module.VisionAnalyzer)
    analyzer.api_key = "test"
    analyzer.model = "test-model"
    analyzer.fallback_model = "fallback-model"
    analyzer.fallback_api_key = "fallback-key"
    analyzer._vision_primary = "minimax"

    calls: list[str] = []

    def primary(*args, **kwargs):
        calls.append("primary")
        return ""

    def fallback(*args, **kwargs):  # pragma: no cover — must not run
        calls.append("fallback")
        raise AssertionError("fallback provider called during shutdown")

    monkeypatch.setattr(analyzer, "_call_mimotalk", primary)
    monkeypatch.setattr(analyzer, "_call_deepseek", fallback)

    lifecycle.signal_shutdown()
    text, cache_hit = analyzer._vision_text(
        b"shutdown-image-bytes", "image/png", "PROMPT", None, 1536
    )

    assert (text, cache_hit) == ("", False)
    assert calls == ["primary"]


def test_report_generation_abandons_retries_and_fallback_after_shutdown(monkeypatch):
    gen = _report_generator()
    urls: list[str] = []

    def fake_read(self, request, timeout=None):
        urls.append(request.full_url)
        raise _TransientLLMError(
            urllib.error.HTTPError(request.full_url, 503, "down", hdrs=None, fp=None)
        )

    monkeypatch.setattr(ReportGenerator, "_read_llm_response", fake_read)

    lifecycle.signal_shutdown()
    with pytest.raises(urllib.error.HTTPError):
        gen._generate_llm("sys", "user", 100)

    assert len(urls) == 1, "no retry after shutdown"
    assert all("fallback.example" not in url for url in urls), (
        "the fallback provider must not be called during shutdown"
    )
