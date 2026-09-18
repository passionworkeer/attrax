"""Test helpers — stand-in objects that let us drive ``fetch_url`` without
making real network calls.

The 2026-09-18 H14 rewrite moved the primary HTTP transport from
``urllib.request.urlopen`` to ``httpx.Client`` (connection pooling), so
tests drive the fetch loop through two seams:

* **httpx path** (what production uses): patch
  ``collectors.base._get_http_client`` to return a ``_FakeHttpxClient``.
  The fake records every request (url / headers / timeout) and replays
  queued responses or calls a ``side_effect`` callable.
* **urllib fallback** (the no-httpx venv): patch ``_get_http_client`` to
  return ``None`` and patch ``urllib.request.urlopen`` as before.

An ``Exception`` instance passed to ``client_with`` is raised on every
call — that is how transport failures (connect error, timeout) are
simulated without an httpx import in the test process.
"""
from __future__ import annotations

import urllib.error
from typing import Any, Callable


class _FakeHeaders(dict):
    """Case-insensitive header lookup (``httpx.Headers`` semantics)."""

    def get(self, key: str, default: Any = None) -> Any:
        for name, value in self.items():
            if name.lower() == key.lower():
                return value
        return default


class _FakeHttpxResponse:
    """Drop-in for ``httpx.Response`` carrying just enough surface area.

    ``content`` is already-decoded bytes (httpx decodes Content-Encoding
    transparently), so tests pass the final body here.
    """

    def __init__(
        self,
        body: bytes = b"",
        *,
        status_code: int = 200,
        last_modified: str | None = None,
        etag: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.status_code = status_code
        self.content = body
        self.is_closed = False
        merged: dict[str, str] = {}
        if last_modified:
            merged["Last-Modified"] = last_modified
        if etag:
            merged["ETag"] = etag
        if headers:
            merged.update(headers)
        self.headers = _FakeHeaders(merged)

    def close(self) -> None:
        self.is_closed = True

    def get(self, key: str, default: Any = None) -> Any:
        return self.headers.get(key, default)


class _FakeHttpxClient:
    """Stand-in for ``httpx.Client``; records every request and replays a
    configured response (or list of responses) when ``.get`` is called."""

    def __init__(
        self,
        response: Any = None,
        *,
        side_effect: Callable[..., Any] | None = None,
    ) -> None:
        self._response = response
        self._side_effect = side_effect
        self.requests: list[dict[str, Any]] = []

    def get(self, url: str, *, headers: dict, timeout: float) -> _FakeHttpxResponse:
        self.requests.append({"url": url, "headers": dict(headers), "timeout": timeout})
        if self._side_effect is not None:
            return self._side_effect(url, headers=headers, timeout=timeout)
        if isinstance(self._response, BaseException):
            raise self._response
        if isinstance(self._response, list):
            if not self._response:
                raise IndexError("FakeHttpxClient ran out of responses")
            return self._response.pop(0)
        if self._response is None:
            return _FakeHttpxResponse(b"x" * 200)
        return self._response

    def close(self) -> None:  # pragma: no cover — teardown only
        pass


def client_with(responses: Any) -> _FakeHttpxClient:
    """Build a fake httpx client that returns ``responses``.

    The argument can be a single ``_FakeHttpxResponse``, a list of them
    (replayed in order — index 0 first), a ``BaseException`` instance
    (raised on every call) or a callable (used as ``side_effect``). Tests
    ``patch.object`` / ``monkeypatch.setattr`` ``_get_http_client`` to
    return the resulting client.
    """
    if callable(responses) and not isinstance(responses, BaseException):
        return _FakeHttpxClient(side_effect=responses)
    return _FakeHttpxClient(responses)


def raises(exc: BaseException) -> Callable[..., Any]:
    """Build a ``side_effect`` that raises ``exc`` on every call."""

    def _side_effect(*args: Any, **kwargs: Any) -> Any:
        raise exc

    return _side_effect


def http_error(url: str, code: int, msg: str = "Client Error") -> urllib.error.HTTPError:
    """Build a urllib HTTPError — the shape ``urlopen`` raises on the
    fallback path and the shape the terminal-4xx branch expects."""
    return urllib.error.HTTPError(url, code, msg, hdrs=None, fp=None)


def disable_http_client(monkeypatch) -> None:
    """Force the urllib fallback path for this test (httpx "not installed").

    ``fetch_url`` resolves the client once per call via
    ``_get_http_client``; returning None makes it take the
    ``_urllib_request_once`` branch, which the test then intercepts by
    patching ``urllib.request.urlopen``.
    """
    monkeypatch.setattr(
        "scripts.watchdog.collectors.base._get_http_client", lambda: None
    )
