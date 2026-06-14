"""Unit tests for rag_service.regulation_collectors.base.BaseCollector."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from rag_service.regulation_collectors.base import BaseCollector


@pytest.fixture
def collector(tmp_path):
    return BaseCollector(tmp_path, "TestAgent/1.0")


def _fake_response(content: bytes, status_code: int = 200, url: str = "https://x.test"):
    response = MagicMock()
    response.status_code = status_code
    response.content = content
    response.url = url
    response.headers = {"content-type": "application/octet-stream"}
    return response


def test_init_defaults(tmp_path):
    collector = BaseCollector(tmp_path, "Agent/2.0")
    assert collector.supplement_dir == tmp_path
    assert collector.user_agent == "Agent/2.0"
    assert collector.timeout == 90
    assert collector.max_retries == 3
    assert collector.curl_fallback is True
    assert collector.insecure_tls is False
    assert collector.failures == []
    assert collector.session.headers["User-Agent"] == "Agent/2.0"


def test_init_custom_options(tmp_path):
    collector = BaseCollector(
        tmp_path,
        "Agent/2.0",
        timeout=30,
        max_retries=5,
        curl_fallback=False,
        insecure_tls=True,
    )
    assert collector.timeout == 30
    assert collector.max_retries == 5
    assert collector.curl_fallback is False
    assert collector.insecure_tls is True
    assert collector.session.verify is False


def test_fetch_with_curl_passes_timeout(collector, tmp_path):
    dest = tmp_path / "out.bin"
    with patch("rag_service.regulation_collectors.base.subprocess.run") as run_mock:
        run_mock.return_value = MagicMock(returncode=0, stderr="", stdout="")
        dest.write_bytes(b"x")
        collector.fetch_with_curl("https://x.test/file", dest, timeout=42)
    cmd = run_mock.call_args[0][0]
    assert "--max-time" in cmd
    assert cmd[cmd.index("--max-time") + 1] == "42"


def test_register_fallback_used_after_http_and_curl_fail(tmp_path):
    collector = BaseCollector(tmp_path, "TestAgent/1.0", max_retries=1)
    collector.session.get = MagicMock(return_value=_fake_response(b"", status_code=502))
    collector.fetch_with_curl = MagicMock(return_value=False)
    fallback_called: list[str] = []

    def fallback(url, dest):
        fallback_called.append(url)
        dest.write_bytes(b"x" * 200)
        return True

    collector.register_fallback(fallback)
    with patch("rag_service.regulation_collectors.base.time.sleep"):
        result = collector.download("https://x.test/q", "q.bin", min_bytes=128)
    assert result["status"] == "downloaded-fallback"
    assert fallback_called == ["https://x.test/q"]
    assert collector.failures == []


def test_register_fallback_exception_recorded(tmp_path):
    collector = BaseCollector(tmp_path, "TestAgent/1.0", max_retries=1)
    collector.session.get = MagicMock(return_value=_fake_response(b"", status_code=502))
    collector.fetch_with_curl = MagicMock(return_value=False)
    collector.register_fallback(lambda url, dest: (_ for _ in ()).throw(RuntimeError("ps boom")))
    with patch("rag_service.regulation_collectors.base.time.sleep"):
        result = collector.download("https://x.test/q", "q.bin", min_bytes=128)
    assert result["status"] == "failed"
    assert "ps boom" in result["error"]


def test_fetch_success(collector):
    collector.session.get = MagicMock(return_value=_fake_response(b"hello"))
    content = collector.fetch("https://x.test/file")
    assert content == b"hello"
    assert collector.session.get.call_count == 1


def test_fetch_retries_until_success(collector):
    responses = [
        _fake_response(b"", status_code=500),
        _fake_response(b"", status_code=502),
        _fake_response(b"ok"),
    ]
    collector.session.get = MagicMock(side_effect=responses)
    with patch("rag_service.regulation_collectors.base.time.sleep"):
        content = collector.fetch("https://x.test/file")
    assert content == b"ok"
    assert collector.session.get.call_count == 3


def test_fetch_exhausts_retries(collector):
    collector.session.get = MagicMock(return_value=_fake_response(b"", status_code=503))
    with patch("rag_service.regulation_collectors.base.time.sleep"):
        with pytest.raises(RuntimeError, match="HTTP 503"):
            collector.fetch("https://x.test/file", retries=2)
    assert collector.session.get.call_count == 2


def test_fetch_with_curl_success(collector, tmp_path):
    dest = tmp_path / "out.bin"
    with patch("rag_service.regulation_collectors.base.subprocess.run") as run_mock:
        run_mock.return_value = MagicMock(returncode=0, stderr="", stdout="")
        # ensure dest gets created so size check passes
        dest.write_bytes(b"data")
        ok = collector.fetch_with_curl("https://x.test/file", dest)
    assert ok is True
    assert collector.failures == []
    cmd = run_mock.call_args[0][0]
    assert cmd[0] == "curl.exe"
    assert "-k" not in cmd


def test_fetch_with_curl_insecure_adds_flags(collector, tmp_path):
    collector.insecure_tls = True
    dest = tmp_path / "out.bin"
    with patch("rag_service.regulation_collectors.base.subprocess.run") as run_mock:
        run_mock.return_value = MagicMock(returncode=0, stderr="", stdout="")
        dest.write_bytes(b"data")
        collector.fetch_with_curl("https://x.test/file", dest)
    cmd = run_mock.call_args[0][0]
    assert "-k" in cmd
    assert "--ssl-no-revoke" in cmd


def test_fetch_with_curl_nonzero_exit(collector, tmp_path):
    dest = tmp_path / "missing.bin"
    with patch("rag_service.regulation_collectors.base.subprocess.run") as run_mock:
        run_mock.return_value = MagicMock(returncode=22, stderr="not found", stdout="")
        ok = collector.fetch_with_curl("https://x.test/file", dest)
    assert ok is False
    assert any("not found" in f["error"] for f in collector.failures)


def test_fetch_with_curl_exception(collector, tmp_path):
    dest = tmp_path / "missing.bin"
    with patch("rag_service.regulation_collectors.base.subprocess.run", side_effect=OSError("boom")):
        ok = collector.fetch_with_curl("https://x.test/file", dest)
    assert ok is False
    assert any("boom" in f["error"] for f in collector.failures)


def test_download_skips_existing(collector):
    existing = collector.supplement_dir / "x.bin"
    existing.parent.mkdir(parents=True, exist_ok=True)
    existing.write_bytes(b"x" * 256)
    result = collector.download("https://x.test/x", "x.bin", min_bytes=128)
    assert result["status"] == "existing"
    assert result["bytes"] == 256


def test_download_http_success(collector):
    collector.session.get = MagicMock(return_value=_fake_response(b"y" * 512))
    result = collector.download("https://x.test/y", "y.bin", min_bytes=128)
    assert result["status"] == "downloaded"
    assert result["bytes"] == 512
    assert (collector.supplement_dir / "y.bin").exists()


def test_download_http_fail_curl_success(collector, tmp_path):
    collector.session.get = MagicMock(return_value=_fake_response(b"", status_code=502))
    target = collector.supplement_dir / "z.bin"

    def fake_curl(url, dest):
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"z" * 256)
        return True

    collector.fetch_with_curl = MagicMock(side_effect=fake_curl)
    with patch("rag_service.regulation_collectors.base.time.sleep"):
        result = collector.download("https://x.test/z", "z.bin", min_bytes=128)
    assert result["status"] == "downloaded-curl"
    assert collector.failures == []


def test_download_full_failure_records(tmp_path):
    collector = BaseCollector(tmp_path, "TestAgent/1.0", max_retries=1)
    collector.session.get = MagicMock(return_value=_fake_response(b"", status_code=503))
    collector.fetch_with_curl = MagicMock(return_value=False)
    with patch("rag_service.regulation_collectors.base.time.sleep"):
        result = collector.download("https://x.test/q", "q.bin", min_bytes=128)
    assert result["status"] == "failed"
    assert len(collector.failures) == 1
    assert collector.failures[0]["url"] == "https://x.test/q"
    assert collector.failures[0]["file"] == "q.bin"


def test_download_full_failure_without_recording(tmp_path):
    collector = BaseCollector(tmp_path, "TestAgent/1.0", max_retries=1)
    collector.session.get = MagicMock(return_value=_fake_response(b"", status_code=503))
    collector.fetch_with_curl = MagicMock(return_value=False)
    with patch("rag_service.regulation_collectors.base.time.sleep"):
        result = collector.download(
            "https://x.test/q", "q.bin", min_bytes=128, record_failure=False
        )
    assert result["status"] == "failed"
    assert collector.failures == []


def test_record_failure_basic(collector):
    collector.record_failure("u", "f", "boom")
    assert collector.failures == [{"url": "u", "file": "f", "error": "boom"}]


def test_record_failure_with_extras(collector):
    collector.record_failure("u", "f", "boom", entry_id="abc", content_url="https://x")
    assert collector.failures[0]["entry_id"] == "abc"
    assert collector.failures[0]["content_url"] == "https://x"


def test_record_failure_truncates_long_error(collector):
    long_msg = "x" * 1000
    collector.record_failure("u", "f", long_msg)
    assert len(collector.failures[0]["error"]) == 500


def test_save_bytes(collector, tmp_path):
    path = collector.save_bytes(b"abc", "nested/file.bin")
    assert path == tmp_path / "nested" / "file.bin"
    assert path.read_bytes() == b"abc"


def test_build_manifest_is_abstract(collector):
    with pytest.raises(NotImplementedError):
        collector.build_manifest()