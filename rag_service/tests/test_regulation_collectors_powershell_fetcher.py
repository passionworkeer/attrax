"""Unit tests for the Windows PowerShell fallback fetcher."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from rag_service.regulation_collectors.powershell_fetcher import fetch_with_powershell


def _powershell_cmd(url: str, dest: Path, headers=None, timeout=75, redirects=5):
    return fetch_with_powershell, (url, dest), {"timeout": timeout, "max_redirects": redirects, "headers": headers}


def test_fetch_with_powershell_returns_true_on_success(tmp_path):
    dest = tmp_path / "out.bin"
    with patch("rag_service.regulation_collectors.powershell_fetcher.subprocess.run") as run_mock:
        run_mock.return_value = MagicMock(returncode=0)
        dest.write_bytes(b"hello")
        ok = fetch_with_powershell("https://infoleg.gob.ar/infolegInternet/anexos/foo.pdf", dest)
    assert ok is True
    cmd = run_mock.call_args[0][0]
    assert cmd[0] == "powershell.exe"
    assert cmd[1] == "-NoProfile"
    assert cmd[2] == "-Command"
    script = cmd[3]
    assert "Invoke-WebRequest" in script
    assert "https://infoleg.gob.ar/infolegInternet/anexos/foo.pdf" in script
    assert "TimeoutSec 75" in script
    assert "MaximumRedirection 5" in script
    assert "-Headers" not in script


def test_fetch_with_powershell_includes_headers(tmp_path):
    dest = tmp_path / "out.bin"
    with patch("rag_service.regulation_collectors.powershell_fetcher.subprocess.run") as run_mock:
        run_mock.return_value = MagicMock(returncode=0)
        dest.write_bytes(b"x")
        fetch_with_powershell(
            "https://x.test",
            dest,
            headers={"User-Agent": "Mozilla/5.0", "Referer": "https://infoleg.gob.ar/"},
        )
    script = run_mock.call_args[0][0][3]
    assert "-Headers @{" in script
    assert "User-Agent" in script
    assert "Referer" in script


def test_fetch_with_powershell_returns_false_when_no_file(tmp_path):
    dest = tmp_path / "missing.bin"
    with patch("rag_service.regulation_collectors.powershell_fetcher.subprocess.run") as run_mock:
        run_mock.return_value = MagicMock(returncode=0)
        ok = fetch_with_powershell("https://x.test", dest)
    assert ok is False


def test_fetch_with_powershell_returns_false_on_oserror(tmp_path):
    dest = tmp_path / "out.bin"
    with patch(
        "rag_service.regulation_collectors.powershell_fetcher.subprocess.run",
        side_effect=OSError("powershell.exe missing"),
    ):
        ok = fetch_with_powershell("https://x.test", dest)
    assert ok is False


def test_fetch_with_powershell_custom_timeout_and_redirects(tmp_path):
    dest = tmp_path / "out.bin"
    with patch("rag_service.regulation_collectors.powershell_fetcher.subprocess.run") as run_mock:
        run_mock.return_value = MagicMock(returncode=0)
        dest.write_bytes(b"x")
        fetch_with_powershell("https://x.test", dest, timeout=30, max_redirects=2)
    script = run_mock.call_args[0][0][3]
    assert "TimeoutSec 30" in script
    assert "MaximumRedirection 2" in script