"""Shared base class for official-source regulation collectors.

Concrete collectors (e.g. scripts/collect_more_official_sources.py) inherit
BaseCollector and only contribute their entry lists and manifest assembly.
"""
from __future__ import annotations

import subprocess
import time
from pathlib import Path
from typing import Any, Callable

import requests


DEFAULT_TIMEOUT = 90
DEFAULT_MAX_RETRIES = 3
DEFAULT_MIN_BYTES = 128
CURL_COMMAND = ["curl.exe", "-L", "--fail"]
FallbackFetcher = Callable[[str, Path], bool]


class BaseCollector:
    def __init__(
        self,
        supplement_dir: Path,
        user_agent: str,
        *,
        timeout: int = DEFAULT_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
        curl_fallback: bool = True,
        insecure_tls: bool = False,
    ) -> None:
        self.supplement_dir = Path(supplement_dir)
        self.user_agent = user_agent
        self.timeout = timeout
        self.max_retries = max_retries
        self.curl_fallback = curl_fallback
        self.insecure_tls = insecure_tls
        self.failures: list[dict[str, Any]] = []
        self._fallback_fetchers: list[FallbackFetcher] = []
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": user_agent, "Accept": "*/*"})
        if insecure_tls:
            self.session.verify = False
            try:
                import urllib3

                urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            except ImportError:  # pragma: no cover - urllib3 is a transitive dep
                pass

    def fetch(self, url: str, *, timeout: int | None = None, retries: int | None = None) -> bytes:
        return self._fetch_response(url, timeout=timeout, retries=retries).content

    def _fetch_response(self, url: str, *, timeout: int | None = None, retries: int | None = None):
        attempts = retries if retries is not None else self.max_retries
        wait = timeout if timeout is not None else self.timeout
        last_error = ""
        for attempt in range(attempts):
            try:
                response = self.session.get(url, timeout=wait, allow_redirects=True)
                if response.status_code >= 400:
                    raise RuntimeError(f"HTTP {response.status_code}")
                return response
            except Exception as exc:
                last_error = str(exc)
                if attempt + 1 < attempts:
                    time.sleep(1 + attempt)
        raise RuntimeError(last_error or "fetch failed")

    def fetch_with_curl(self, url: str, dest: Path, *, timeout: int = 120) -> bool:
        command = [
            *CURL_COMMAND,
            "--max-time",
            str(timeout),
            "-A",
            self.user_agent,
            "-o",
            str(dest),
            url,
        ]
        if self.insecure_tls:
            command.extend(["-k", "--ssl-no-revoke"])
        try:
            result = subprocess.run(command, text=True, capture_output=True, check=False)
        except Exception as exc:
            self._record_failure_raw(url, str(dest), str(exc))
            return False
        if result.returncode != 0:
            message = (result.stderr or result.stdout or f"curl exit {result.returncode}")[-500:]
            self._record_failure_raw(url, str(dest), message)
            return False
        return dest.exists() and dest.stat().st_size > 0

    def register_fallback(self, fetcher: FallbackFetcher) -> None:
        """Register an additional fallback fetcher invoked after HTTP + curl.

        The fetcher takes (url, dest) and returns True on success.
        """
        self._fallback_fetchers.append(fetcher)

    def download(
        self,
        url: str,
        rel_path: str,
        *,
        min_bytes: int = DEFAULT_MIN_BYTES,
        force: bool = False,
        curl_fallback: bool | None = None,
        record_failure: bool = True,
    ) -> dict[str, Any]:
        path = self.supplement_dir / rel_path
        if path.exists() and path.stat().st_size >= min_bytes and not force:
            return {
                "url": url,
                "file": rel_path,
                "status": "existing",
                "bytes": path.stat().st_size,
                "content_type": "",
            }
        path.parent.mkdir(parents=True, exist_ok=True)
        last_error = ""
        try:
            response = self._fetch_response(url)
            if len(response.content) < min_bytes:
                raise RuntimeError(f"too small: {len(response.content)} bytes")
            path.write_bytes(response.content)
            return {
                "url": url,
                "final_url": response.url,
                "file": rel_path,
                "status": "downloaded",
                "bytes": len(response.content),
                "content_type": response.headers.get("content-type", ""),
            }
        except Exception as exc:
            last_error = str(exc)

        use_curl = self.curl_fallback if curl_fallback is None else curl_fallback
        if use_curl and self.fetch_with_curl(url, path):
            return {
                "url": url,
                "file": rel_path,
                "status": "downloaded-curl",
                "bytes": path.stat().st_size,
                "content_type": "",
            }

        for fetcher in self._fallback_fetchers:
            try:
                if fetcher(url, path):
                    return {
                        "url": url,
                        "file": rel_path,
                        "status": "downloaded-fallback",
                        "bytes": path.stat().st_size,
                        "content_type": "",
                    }
            except Exception as exc:
                last_error = str(exc)

        if record_failure:
            self.record_failure(url=url, file=rel_path, error=last_error[-500:])
        return {"url": url, "file": rel_path, "status": "failed", "error": last_error}

    def record_failure(self, url: str, file: str, error: str, **extra: Any) -> None:
        entry: dict[str, Any] = {"url": url, "file": file, "error": str(error)[:500]}
        entry.update(extra)
        self.failures.append(entry)

    def _record_failure_raw(self, url: str, dest: str, message: str) -> None:
        self.failures.append({"url": url, "file": dest, "error": message[-500:]})

    def save_bytes(self, content: bytes, rel_path: str) -> Path:
        path = self.supplement_dir / rel_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def build_manifest(self) -> dict[str, Any]:  # pragma: no cover - abstract
        raise NotImplementedError