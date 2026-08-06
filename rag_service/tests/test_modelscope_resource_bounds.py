import threading
import time
from unittest.mock import MagicMock

import pytest

from rag_service.retrieval import modelScope_embedder as module
from rag_service.retrieval.modelScope_embedder import (
    ModelScopeEmbedder,
    ModelScopeQuotaExceeded,
)


def reset_state():
    module._QUERY_CACHE.clear()
    module._CALL_TIMESTAMPS.clear()
    module._PER_KEY_LOCKS.clear()


def test_hourly_quota_fails_fast_without_sleep(monkeypatch):
    reset_state()
    embedder = ModelScopeEmbedder(api_key="test")
    embedder._hourly_limit = 1
    embedder._window_seconds = 3600
    module._CALL_TIMESTAMPS.append(time.monotonic())
    sleep = MagicMock()
    monkeypatch.setattr(module.time, "sleep", sleep)

    with pytest.raises(ModelScopeQuotaExceeded) as exc:
        embedder._rate_limit()

    assert exc.value.retry_after_seconds > 0
    sleep.assert_not_called()


def test_per_key_lock_registry_is_empty_after_success():
    reset_state()
    embedder = ModelScopeEmbedder(api_key="test")
    embedder._rate_limit = MagicMock()
    embedder._call_api = MagicMock(return_value=[0.1, 0.2])

    assert embedder.embed_query("unique-lock-cleanup-query") == [0.1, 0.2]
    assert module._PER_KEY_LOCKS == {}


def test_same_key_waiters_share_one_call_and_release_registry():
    reset_state()
    embedder = ModelScopeEmbedder(api_key="test")
    embedder._rate_limit = MagicMock()
    release = threading.Event()
    entered = threading.Event()
    calls = 0
    call_lock = threading.Lock()

    def call_api(_text):
        nonlocal calls
        with call_lock:
            calls += 1
        entered.set()
        release.wait(timeout=2)
        return [0.5]

    embedder._call_api = call_api
    results = []

    def worker():
        results.append(embedder.embed_query("same-key-lock-cleanup"))

    first = threading.Thread(target=worker)
    second = threading.Thread(target=worker)
    first.start()
    assert entered.wait(timeout=1)
    second.start()
    release.set()
    first.join(timeout=2)
    second.join(timeout=2)

    assert results == [[0.5], [0.5]]
    assert calls == 1
    assert module._PER_KEY_LOCKS == {}
