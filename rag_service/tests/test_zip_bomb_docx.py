"""DOCX zip-bomb 防护回归测试（2026-09-10 审计 4.5）。

构造高膨胀率（~1:2000）"结构合法"的恶意 DOCX，验证 api 层通过
zip 头声明的 file_size 预检拒绝（400 INVALID_DOCX_ARCHIVE），
而不是尝试解压导致内存/磁盘放大。
"""

import io
import zipfile

from fastapi import FastAPI
from fastapi.testclient import TestClient

from rag_service.api import v1
from rag_service.config import settings


PNG = b"\x89PNG\r\n\x1a\n" + b"zip-bomb-cover"


def build_app(tmp_path):
    from rag_service.application.scans import ScanService
    from rag_service.infrastructure.file_backend import FileBackend

    async def runner(payload):  # pragma: no cover - 不应被执行
        return {"status": "PASS", "report": "## x", "agent_trace": [], "loop_count": 0,
                "documents": [], "report_package": {}}

    app = FastAPI(version="test")
    app.state.scan_service = ScanService(FileBackend(tmp_path), runner=runner, retry_base_seconds=0)
    app.state.readiness_provider = lambda: {"ready": True, "checks": {}, "version": "t"}
    app.include_router(v1.router)
    return app


def _zip_bomb_docx() -> bytes:
    """单个 word/document.xml 声明解压后 > MAX_DOCX_EXPANDED_SIZE 的 DOCX。"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", "<Types/>")  # 通过结构校验所需
        # 200MB repeating payload，压缩后只有几十 KB —— 典型 zip bomb
        zf.writestr("word/document.xml", b"A" * (200 * 1024 * 1024))
    return buf.getvalue()


def test_docx_zip_bomb_rejected_before_extraction(tmp_path, monkeypatch):
    # This test targets archive inspection. Keep an operator's local service
    # secret from intercepting the request before that validation runs.
    monkeypatch.setattr(settings, "rag_internal_secret", "")
    bomb = _zip_bomb_docx()
    assert len(bomb) < 1 * 1024 * 1024, "压缩体积必须很小才有炸弹意义"
    assert v1.MAX_DOCX_EXPANDED_SIZE < 200 * 1024 * 1024

    with TestClient(build_app(tmp_path)) as client:
        response = client.post(
            "/api/v1/scans",
            data={"query": "q", "category": "electronics", "markets": '["EU"]'},
            files={
                "images": ("cover.png", PNG, "image/png"),
                "documents": (
                    "bomb.docx",
                    bomb,
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ),
            },
        )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_DOCX_ARCHIVE"


def test_normal_small_docx_passes_archive_check():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("[Content_Types].xml", "<Types/>")
        zf.writestr("word/document.xml", "<doc>ok</doc>")
    assert v1._valid_docx_archive(buf.getvalue()) is True


def test_bomb_detected_by_declared_size_only():
    """防线必须在解压前生效：_valid_docx_archive 只读 zip 头，不 inflate。"""
    bomb = _zip_bomb_docx()
    assert v1._valid_docx_archive(bomb) is False
