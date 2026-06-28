r"""
Trust-proxy unit tests for rag_service.main._client_ip.

Verifies that X-Forwarded-For is only honored when the socket peer is in
settings.trusted_proxies; otherwise the socket peer address is returned
to prevent XFF spoofing from bypassing per-IP rate limits.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from starlette.requests import Request

from rag_service.config import settings
from rag_service.main import _client_ip


def _make_request(peer_host: str, xff: str | None) -> Request:
    headers: list[tuple[bytes, bytes]] = []
    if xff is not None:
        headers.append((b"x-forwarded-for", xff.encode("latin-1")))
    scope = {
        "type": "http",
        "client": (peer_host, 60000),
        "headers": headers,
        "method": "GET",
        "path": "/scan",
        "query_string": b"",
        "scheme": "http",
        "server": ("testserver", 80),
        "root_path": "",
        "http_version": "1.1",
        "app": None,
    }
    return Request(scope)


@pytest.fixture
def preserve_settings():
    previous = list(settings.trusted_proxies)
    yield
    settings.trusted_proxies = previous


def test_xff_honored_when_peer_is_trusted(preserve_settings):
    """Loopback peer is in the default trusted list → XFF first hop wins."""
    settings.trusted_proxies = ["127.0.0.1", "::1"]
    req = _make_request("127.0.0.1", xff="203.0.113.7, 10.0.0.1")
    assert _client_ip(req) == "203.0.113.7"


def test_xff_ignored_when_peer_untrusted(preserve_settings):
    """Spoofed XFF from a non-trusted peer MUST NOT be honored."""
    settings.trusted_proxies = ["127.0.0.1", "::1"]
    # Attacker connects from a random external IP and sends a forged XFF.
    req = _make_request("198.51.100.42", xff="203.0.113.7")
    assert _client_ip(req) == "198.51.100.42"


def test_socket_returned_when_no_xff(preserve_settings):
    """No XFF header → socket peer is always used."""
    settings.trusted_proxies = ["127.0.0.1", "::1"]
    req = _make_request("127.0.0.1", xff=None)
    assert _client_ip(req) == "127.0.0.1"


def test_empty_xff_falls_back_to_socket(preserve_settings):
    """Empty/whitespace XFF from trusted peer → socket peer is used."""
    settings.trusted_proxies = ["127.0.0.1", "::1"]
    req = _make_request("127.0.0.1", xff="   ")
    assert _client_ip(req) == "127.0.0.1"


def test_unknown_peer_lowercased_match(preserve_settings):
    """Trusted-proxy comparison is case-insensitive (IPv6 loopback variant)."""
    settings.trusted_proxies = ["127.0.0.1", "::1"]
    req = _make_request("::1", xff="203.0.113.9")
    assert _client_ip(req) == "203.0.113.9"
