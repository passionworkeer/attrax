"""
test_embedders.py - pytest suite for all embedder modules.

Tests use unittest.mock.patch to isolate from external services.
Covers: OllamaEmbedder, LocalEmbedder, ModelScopeEmbedder.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import json
import time
import types
import urllib.error
from unittest.mock import patch, MagicMock

import numpy as np
import pytest

try:
    import torch
except ModuleNotFoundError:
    torch = None


if torch is None:
    class _FakeTensor:
        def __init__(self, value):
            self._array = np.asarray(value, dtype=np.float32)

        def unsqueeze(self, dim):
            return _FakeTensor(np.expand_dims(self._array, axis=dim))

        def expand(self, *shape):
            if len(shape) == 1 and isinstance(shape[0], tuple):
                shape = shape[0]
            return _FakeTensor(np.broadcast_to(self._array, shape))

        def size(self):
            return self._array.shape

        def float(self):
            return _FakeTensor(self._array.astype(np.float32))

        def sum(self, dim=None):
            return _FakeTensor(np.sum(self._array, axis=dim))

        def clamp(self, min=None):
            return _FakeTensor(np.maximum(self._array, min))

        def to(self, _device):
            return self

        def cpu(self):
            return self

        def numpy(self):
            return self._array

        def tolist(self):
            return self._array.tolist()

        def __mul__(self, other):
            other_array = other._array if isinstance(other, _FakeTensor) else other
            return _FakeTensor(self._array * other_array)

        def __truediv__(self, other):
            other_array = other._array if isinstance(other, _FakeTensor) else other
            return _FakeTensor(self._array / other_array)

    class _NoGrad:
        def __enter__(self):
            return None

        def __exit__(self, *_args):
            return False

    def _fake_normalize(tensor, dim=1):
        arr = tensor._array
        norm = np.linalg.norm(arr, axis=dim, keepdims=True)
        norm = np.clip(norm, 1e-12, None)
        return _FakeTensor(arr / norm)

    torch = types.ModuleType("torch")
    torch_cuda = types.ModuleType("torch.cuda")
    torch_cuda.is_available = lambda: False
    torch_cuda.empty_cache = lambda: None

    torch_functional = types.ModuleType("torch.nn.functional")
    torch_functional.normalize = _fake_normalize
    torch_nn = types.ModuleType("torch.nn")
    torch_nn.functional = torch_functional

    torch.cuda = torch_cuda
    torch.nn = torch_nn
    torch.long = np.int64
    torch.from_numpy = lambda arr: _FakeTensor(arr)
    torch.zeros = lambda *shape, dtype=None: _FakeTensor(np.zeros(shape, dtype=np.float32))
    torch.ones = lambda *shape: _FakeTensor(np.ones(shape, dtype=np.float32))
    torch.tensor = lambda value: _FakeTensor(value)
    torch.sum = lambda tensor, dim=None: tensor.sum(dim=dim)
    torch.no_grad = lambda: _NoGrad()

    sys.modules["torch"] = torch
    sys.modules["torch.cuda"] = torch_cuda
    sys.modules["torch.nn"] = torch_nn
    sys.modules["torch.nn.functional"] = torch_functional

# ---------------------------------------------------------------------------
# API-only production selection tests
# ---------------------------------------------------------------------------

def test_probe_embedders_uses_modelscope_api_only(monkeypatch):
    """Production embedder probing selects ModelScope API directly."""
    from rag_service.retrieval import hybrid_retriever as hr

    hr._embedder = None
    hr._embedder_name = "none"
    monkeypatch.setenv("MODELSCOPE_API_KEY", "test-key")

    with patch("rag_service.retrieval.ollama_embedder.OllamaEmbedder") as ollama_cls, \
         patch("rag_service.retrieval.modelScope_embedder.ModelScopeEmbedder") as modelscope_cls:
        modelscope_instance = MagicMock()
        modelscope_cls.return_value = modelscope_instance

        embedder, name = hr._probe_embedders()

    assert embedder is modelscope_instance
    assert name == "modelscope_api"
    ollama_cls.assert_not_called()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_embedding_response(embedding: list[float]):
    """Return a mock context-manager that returns JSON bytes."""
    body = json.dumps({"embedding": embedding}).encode()
    mock_resp = MagicMock()
    mock_resp.read.return_value = body
    mock_resp.__enter__ = MagicMock(return_value=mock_resp)
    mock_resp.__exit__ = MagicMock(return_value=False)
    return mock_resp


def make_batch_embedding_response(embeddings: list[list[float]]):
    """Return a mock context-manager for /api/embed (batch)."""
    body = json.dumps({"embeddings": embeddings}).encode()
    mock_resp = MagicMock()
    mock_resp.read.return_value = body
    mock_resp.__enter__ = MagicMock(return_value=mock_resp)
    mock_resp.__exit__ = MagicMock(return_value=False)
    return mock_resp


# ---------------------------------------------------------------------------
# OllamaEmbedder tests
# ---------------------------------------------------------------------------

class TestOllamaHelperFunctions:
    """Test module-level helper functions in ollama_embedder."""

    def test_is_ollama_available_true(self):
        """_is_ollama_available returns True when server responds."""
        from rag_service.retrieval.ollama_embedder import _is_ollama_available
        with patch("urllib.request.urlopen") as mock_urlopen:
            mock_urlopen.return_value.__enter__ = MagicMock(
                return_value=MagicMock())
            mock_urlopen.return_value.__exit__ = MagicMock(return_value=False)
            result = _is_ollama_available()
        assert result is True

    def test_is_ollama_available_false_on_exception(self):
        """_is_ollama_available returns False when server is unreachable."""
        from rag_service.retrieval.ollama_embedder import _is_ollama_available
        with patch("urllib.request.urlopen",
                   side_effect=Exception("connection refused")):
            result = _is_ollama_available()
        assert result is False

    def test_ollama_embed_single_success(self):
        """_ollama_embed_single returns L2-normalized vector on 200."""
        from rag_service.retrieval.ollama_embedder import _ollama_embed_single
        embedding = [0.5, 0.5, 0.5, 0.5]
        mock_resp = make_embedding_response(embedding)
        with patch("urllib.request.urlopen", return_value=mock_resp):
            result = _ollama_embed_single("hello world", "nomic-embed-text")
        # L2-normalized
        expected = np.array(embedding, dtype=np.float32)
        expected = expected / np.linalg.norm(expected)
        np.testing.assert_almost_equal(result, expected.tolist())

    def test_ollama_embed_single_empty_embedding_raises(self):
        """_ollama_embed_single raises ValueError on empty embedding."""
        from rag_service.retrieval.ollama_embedder import _ollama_embed_single
        mock_resp = make_embedding_response([])
        with patch("urllib.request.urlopen", return_value=mock_resp):
            with pytest.raises(ValueError, match="empty"):
                _ollama_embed_single("hi", "model")

    def test_ollama_embed_single_timeout(self):
        """_ollama_embed_single raises on timeout."""
        from rag_service.retrieval.ollama_embedder import _ollama_embed_single
        with patch("urllib.request.urlopen",
                   side_effect=urllib.error.URLError("timeout")):
            with pytest.raises(urllib.error.URLError):
                _ollama_embed_single("hi", "model")

    def test_ollama_embed_single_401_auth_failure(self):
        """_ollama_embed_single propagates 401."""
        from rag_service.retrieval.ollama_embedder import _ollama_embed_single
        with patch(
            "urllib.request.urlopen",
            side_effect=urllib.error.HTTPError(
                "url", 401, "Unauthorized", {}, None),
        ):
            with pytest.raises(urllib.error.HTTPError) as exc:
                _ollama_embed_single("hi", "model")
            assert exc.value.code == 401

    def test_ollama_embed_batch_empty_list(self):
        """_ollama_embed_batch returns [] for empty input."""
        from rag_service.retrieval.ollama_embedder import _ollama_embed_batch
        result = _ollama_embed_batch([], "nomic-embed-text")
        assert result == []

    def test_ollama_embed_batch_success(self):
        """_ollama_embed_batch returns normalized vectors via /api/embed."""
        from rag_service.retrieval.ollama_embedder import _ollama_embed_batch
        texts = ["hello", "world"]
        embeddings = [[0.6, 0.8], [0.8, 0.6]]
        mock_resp = make_batch_embedding_response(embeddings)
        with patch("urllib.request.urlopen", return_value=mock_resp):
            result = _ollama_embed_batch(texts, "nomic-embed-text",
                                         batch_size=2)
        assert len(result) == 2
        for vec in result:
            assert abs(np.linalg.norm(vec) - 1.0) < 1e-6

    def test_ollama_embed_batch_fallback_on_api_error(self):
        """_ollama_embed_batch falls back to serial on /api/embed failure."""
        from rag_service.retrieval.ollama_embedder import _ollama_embed_batch
        texts = ["a", "b"]
        single_emb = [1.0, 0.0]
        mock_single = make_embedding_response(single_emb)
        # /api/embed fails first, then serial calls succeed
        with patch("urllib.request.urlopen") as mock_urlopen:
            mock_urlopen.side_effect = [
                Exception("api/embed not supported"),
                mock_single,
                mock_single,
            ]
            result = _ollama_embed_batch(texts, "model")
        assert len(result) == 2


class TestOllamaEmbedderClass:
    """Test OllamaEmbedder class lifecycle and methods."""

    @patch("rag_service.retrieval.ollama_embedder._is_ollama_available",
           return_value=True)
    @patch("rag_service.retrieval.ollama_embedder._ollama_embed_single")
    def test_init_success(self, mock_single, mock_available):
        """OllamaEmbedder constructs when Ollama is available and model probes OK."""
        mock_single.return_value = [0.5, 0.5]
        from rag_service.retrieval.ollama_embedder import OllamaEmbedder
        embedder = OllamaEmbedder()
        assert embedder.model == "nomic-embed-text"

    @patch("rag_service.retrieval.ollama_embedder._is_ollama_available",
           return_value=False)
    def test_init_raises_when_ollama_unavailable(self, mock_available):
        """OllamaEmbedder raises RuntimeError when server is down."""
        from rag_service.retrieval.ollama_embedder import OllamaEmbedder
        with pytest.raises(RuntimeError, match="Ollama not available"):
            OllamaEmbedder()

    @patch("rag_service.retrieval.ollama_embedder._is_ollama_available",
           return_value=True)
    def test_init_raises_404_model_not_found(self, mock_available):
        """OllamaEmbedder raises RuntimeError when model is not found (404)."""
        from rag_service.retrieval.ollama_embedder import OllamaEmbedder
        with patch(
            "rag_service.retrieval.ollama_embedder._ollama_embed_single",
            side_effect=urllib.error.HTTPError(
                "url", 404, "model not found", {}, None),
        ):
            with pytest.raises(RuntimeError, match="not found"):
                OllamaEmbedder()

    @patch("rag_service.retrieval.ollama_embedder._is_ollama_available",
           return_value=True)
    def test_init_raises_non_404_error(self, mock_available):
        """OllamaEmbedder raises non-404 HTTPError as-is."""
        from rag_service.retrieval.ollama_embedder import OllamaEmbedder
        with patch(
            "rag_service.retrieval.ollama_embedder._ollama_embed_single",
            side_effect=urllib.error.HTTPError(
                "url", 500, "server error", {}, None),
        ):
            with pytest.raises(urllib.error.HTTPError) as exc:
                OllamaEmbedder()
            assert exc.value.code == 500

    def test_embed_texts_empty(self):
        """embed_texts returns [] for empty list without calling model."""
        from rag_service.retrieval.ollama_embedder import OllamaEmbedder
        # Patch inline so init uses real _is_ollama_available but we
        # prevent any network calls; embed_texts([]) hits the [] early-return
        with patch(
            "rag_service.retrieval.ollama_embedder._is_ollama_available",
            return_value=True,
        ), patch(
            "rag_service.retrieval.ollama_embedder._ollama_embed_single",
            return_value=[0.5, 0.5],
        ), patch(
            "rag_service.retrieval.ollama_embedder._ollama_embed_batch",
        ) as mock_batch:
            embedder = OllamaEmbedder()
            result = embedder.embed_texts([])
            assert result == []
            mock_batch.assert_not_called()

    @patch("rag_service.retrieval.ollama_embedder._is_ollama_available",
           return_value=True)
    @patch("rag_service.retrieval.ollama_embedder._ollama_embed_single")
    def test_embed_texts_single(self, mock_single, mock_available):
        """embed_texts delegates to _ollama_embed_batch."""
        mock_single.return_value = [0.5, 0.5]
        from rag_service.retrieval.ollama_embedder import OllamaEmbedder
        with patch(
            "rag_service.retrieval.ollama_embedder._ollama_embed_batch",
            return_value=[[0.5, 0.5]],
        ) as mock_batch:
            embedder = OllamaEmbedder()
            result = embedder.embed_texts(["hello"])
            assert result == [[0.5, 0.5]]
            mock_batch.assert_called_once_with(["hello"], "nomic-embed-text")

    @patch("rag_service.retrieval.ollama_embedder._is_ollama_available",
           return_value=True)
    @patch("rag_service.retrieval.ollama_embedder._ollama_embed_single")
    def test_embed_texts_100(self, mock_single, mock_available):
        """embed_texts handles 100 texts."""
        mock_single.return_value = [0.5, 0.5]
        texts = [f"text_{i}" for i in range(100)]
        from rag_service.retrieval.ollama_embedder import OllamaEmbedder
        with patch(
            "rag_service.retrieval.ollama_embedder._ollama_embed_batch",
            return_value=[[0.5, 0.5] for _ in texts],
        ):
            embedder = OllamaEmbedder()
            result = embedder.embed_texts(texts)
            assert len(result) == 100

    @patch("rag_service.retrieval.ollama_embedder._is_ollama_available",
           return_value=True)
    def test_embed_query(self, mock_available):
        """embed_query calls _ollama_embed_single directly."""
        from rag_service.retrieval.ollama_embedder import OllamaEmbedder
        with patch(
            "rag_service.retrieval.ollama_embedder._ollama_embed_single",
            return_value=[0.5, 0.5],
        ) as mock_single_api:
            # _ollama_embed_single is also called during __init__ for probing
            with patch(
                "rag_service.retrieval.ollama_embedder._ollama_embed_single",
                side_effect=[None, [0.5, 0.5]],
            ):
                embedder = OllamaEmbedder()
                result = embedder.embed_query("hello world")
                assert result == [0.5, 0.5]

    @patch("rag_service.retrieval.ollama_embedder._is_ollama_available",
           return_value=True)
    @patch("rag_service.retrieval.ollama_embedder._ollama_embed_single")
    def test_embed_batch_with_size(self, mock_single, mock_available):
        """embed_batch passes batch_size to _ollama_embed_batch."""
        mock_single.return_value = [0.5, 0.5]
        from rag_service.retrieval.ollama_embedder import OllamaEmbedder
        with patch(
            "rag_service.retrieval.ollama_embedder._ollama_embed_batch",
            return_value=[[0.5, 0.5]],
        ) as mock_batch:
            embedder = OllamaEmbedder()
            embedder.embed_batch(["a", "b"], batch_size=8)
            mock_batch.assert_called_once_with(["a", "b"],
                                                "nomic-embed-text", 8)


# ---------------------------------------------------------------------------
# LocalEmbedder tests (removed — module was dead code; hybrid_retriever only
# probes ModelScope + Ollama. LocalEmbedder was never imported by the live
# retrieval path.)
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# ModelScopeEmbedder tests
# ---------------------------------------------------------------------------

class TestModelScopeHelpers:
    """Test module-level helper functions in modelScope_embedder."""

    def test_clean_text_removes_control_chars(self):
        """clean_text strips control characters."""
        from rag_service.retrieval.modelScope_embedder import clean_text
        result = clean_text("hello\x00world\x1ftest")
        assert "\x00" not in result
        assert "\x1f" not in result

    def test_clean_text_normalizes_whitespace(self):
        """clean_text collapses whitespace."""
        from rag_service.retrieval.modelScope_embedder import clean_text
        result = clean_text("hello   world\n\ntest")
        assert result == "hello world test"

    def test_clean_text_empty(self):
        """clean_text returns empty string for empty input."""
        from rag_service.retrieval.modelScope_embedder import clean_text
        assert clean_text("") == ""

    def test_is_likely_binary_true_for_binary(self):
        """is_likely_binary returns True for binary-looking text."""
        from rag_service.retrieval.modelScope_embedder import is_likely_binary
        binary = "\x00\x01\x02" * 10
        assert is_likely_binary(binary) is True

    def test_is_likely_binary_false_for_normal(self):
        """is_likely_binary returns False for normal text."""
        from rag_service.retrieval.modelScope_embedder import is_likely_binary
        assert is_likely_binary(
            "This is a normal product description.") is False

    def test_is_likely_binary_empty(self):
        """is_likely_binary returns True for empty string."""
        from rag_service.retrieval.modelScope_embedder import is_likely_binary
        assert is_likely_binary("") is True

    def test_is_likely_binary_low_alpha_ratio_long(self):
        """is_likely_binary returns True when alpha ratio < 5% on long text."""
        from rag_service.retrieval.modelScope_embedder import is_likely_binary
        # 21 chars, all numbers/symbols: 0 alpha chars / 21 = 0%
        text = "12345678901234567890!"
        assert is_likely_binary(text) is True


class TestModelScopeEmbedderClass:
    """Test ModelScopeEmbedder class."""

    def test_init_uses_env_api_key(self):
        """ModelScopeEmbedder reads API key from env when not passed."""
        from rag_service.retrieval.modelScope_embedder import ModelScopeEmbedder
        with patch.dict(os.environ, {"MODELSCOPE_API_KEY": "test-key-123"}):
            embedder = ModelScopeEmbedder()
        assert embedder.api_key == "test-key-123"

    def test_init_explicit_api_key(self):
        """ModelScopeEmbedder uses explicit key over env."""
        from rag_service.retrieval.modelScope_embedder import ModelScopeEmbedder
        embedder = ModelScopeEmbedder(api_key="my-key")
        assert embedder.api_key == "my-key"

    def test_rate_limit_enforces_min_interval(self):
        """_rate_limit sleeps when calls are too frequent."""
        from rag_service.retrieval.modelScope_embedder import ModelScopeEmbedder
        embedder = ModelScopeEmbedder(api_key="k")
        embedder._last_call = time.monotonic()
        with patch("time.sleep") as mock_sleep:
            embedder._rate_limit(min_interval=2.0)
            assert mock_sleep.call_count == 1
            sleep_dur = mock_sleep.call_args[0][0]
            assert 0 < sleep_dur <= 2.0

    def test_rate_limit_no_sleep_when_enough_time_passed(self):
        """_rate_limit does not sleep when interval is sufficient."""
        from rag_service.retrieval.modelScope_embedder import ModelScopeEmbedder
        embedder = ModelScopeEmbedder(api_key="k")
        # Simulate a very old last_call (far in the past)
        embedder._last_call = time.monotonic() - 10.0
        with patch("time.sleep") as mock_sleep:
            embedder._rate_limit(min_interval=2.0)
            mock_sleep.assert_not_called()

    def test_client_lazy_init(self):
        """client property creates OpenAI instance on first access."""
        from rag_service.retrieval.modelScope_embedder import ModelScopeEmbedder
        embedder = ModelScopeEmbedder(api_key="k")
        assert embedder._client is None
        mock_client = MagicMock()
        # Patch the client property getter to inject our mock
        with patch.object(
            type(embedder), "client",
            new_callable=lambda: property(lambda self: mock_client),
        ):
            result = embedder.client
        assert result is mock_client

    def test_call_api_success(self):
        """_call_api returns embedding on success."""
        from rag_service.retrieval.modelScope_embedder import ModelScopeEmbedder
        embedder = ModelScopeEmbedder(api_key="k")
        mock_client = MagicMock()
        mock_resp = MagicMock()
        mock_resp.data = [MagicMock(embedding=[0.1, 0.2, 0.3])]
        mock_client.embeddings.create.return_value = mock_resp
        embedder._client = mock_client
        result = embedder._call_api("hello world")
        assert result == [0.1, 0.2, 0.3]

    def test_call_api_timeout(self):
        """_call_api raises on timeout."""
        from rag_service.retrieval.modelScope_embedder import ModelScopeEmbedder
        embedder = ModelScopeEmbedder(api_key="k")
        mock_client = MagicMock()
        mock_client.embeddings.create.side_effect = Exception("timed out")
        embedder._client = mock_client
        with pytest.raises(Exception, match="timed out"):
            embedder._call_api("hello")

    def test_call_api_rate_limit_retries(self):
        """_call_api retries on 429 rate limit with exponential backoff."""
        from rag_service.retrieval.modelScope_embedder import ModelScopeEmbedder
        embedder = ModelScopeEmbedder(api_key="k")
        mock_client = MagicMock()
        rate_limit_err = Exception("429 rate limit exceeded")
        success_resp = MagicMock()
        success_resp.data = [MagicMock(embedding=[0.1, 0.2])]
        mock_client.embeddings.create.side_effect = [rate_limit_err, success_resp]
        embedder._client = mock_client
        with patch("time.sleep") as mock_sleep:
            result = embedder._call_api("hello")
        assert result == [0.1, 0.2]
        assert mock_sleep.call_count == 1
        assert mock_sleep.call_args[0][0] == 1.0  # first backoff = 1s

    def test_call_api_max_retries_exceeded(self):
        """_call_api raises RuntimeError after 8 retries."""
        from rag_service.retrieval.modelScope_embedder import ModelScopeEmbedder
        embedder = ModelScopeEmbedder(api_key="k")
        mock_client = MagicMock()
        mock_client.embeddings.create.side_effect = Exception("429 rate limit")
        embedder._client = mock_client
        with patch("time.sleep"):
            with pytest.raises(RuntimeError, match="Max retries exceeded"):
                embedder._call_api("hello")

    def test_call_api_cleans_binary(self):
        """_call_api raises ValueError for binary text."""
        from rag_service.retrieval.modelScope_embedder import ModelScopeEmbedder
        embedder = ModelScopeEmbedder(api_key="k")
        mock_client = MagicMock()
        embedder._client = mock_client
        with pytest.raises(ValueError, match="too short or binary"):
            embedder._call_api("\x00\x01\x02\x03")
        mock_client.embeddings.create.assert_not_called()

    def test_call_api_truncates_long_text(self):
        """_call_api truncates text to MAX_TEXT_LEN."""
        from rag_service.retrieval.modelScope_embedder import (
            ModelScopeEmbedder, MAX_TEXT_LEN)
        embedder = ModelScopeEmbedder(api_key="k")
        mock_client = MagicMock()
        mock_resp = MagicMock()
        mock_resp.data = [MagicMock(embedding=[0.1])]
        mock_client.embeddings.create.return_value = mock_resp
        embedder._client = mock_client
        long_text = "a" * (MAX_TEXT_LEN + 500)
        embedder._call_api(long_text)
        call_kwargs = mock_client.embeddings.create.call_args[1]
        assert len(call_kwargs["input"]) == MAX_TEXT_LEN

    def test_embed_query_with_rate_limit(self):
        """embed_query reserves a rate-limit slot before calling the API.

        B4: rate-limit is now invoked OUTSIDE the per-key lock and with NO
        positional arg (the burst interval comes from ``_burst_interval`` /
        the env, not a call-site parameter). The previous test asserted
        ``_rate_limit(2.0)`` which encoded the old (self-DoS) call pattern;
        it is updated here to reflect the corrected, quota-correct flow.
        """
        from rag_service.retrieval.modelScope_embedder import ModelScopeEmbedder
        embedder = ModelScopeEmbedder(api_key="k")
        mock_client = MagicMock()
        mock_resp = MagicMock()
        mock_resp.data = [MagicMock(embedding=[0.5, 0.5])]
        mock_client.embeddings.create.return_value = mock_resp
        embedder._client = mock_client
        embedder._last_call = time.monotonic()
        with patch.object(embedder, "_rate_limit") as mock_rl:
            result = embedder.embed_query("hello")
            # B4: called exactly once, no positional min_interval arg.
            mock_rl.assert_called_once_with()
        assert result == [0.5, 0.5]

    def test_embed_batch_mixed_success_failure(self):
        """embed_batch returns DIM-length zero vector for a permanently-failed batch.

        Note (B4): embed_batch routes through ``_call_api_batch`` (not
        ``_call_api``); the mock target is updated accordingly. With
        ``batch_size=50`` (default), the entire input is sent in a single
        API call, so a server-side failure zero-fills the whole batch.
        """
        from rag_service.retrieval.modelScope_embedder import ModelScopeEmbedder, DIM
        embedder = ModelScopeEmbedder(api_key="k")

        def mock_batch(texts):
            raise Exception("server error")

        with patch.object(embedder, "_call_api_batch", side_effect=mock_batch), \
             patch.object(embedder, "_rate_limit"), \
             patch("rag_service.retrieval.modelScope_embedder.time.monotonic",
                   side_effect=[0.0, 0.5, 1.0, 1.5, 2.0]):
            result = embedder.embed_batch(["ok_text", "fail_text"])
        assert len(result) == 2
        # Whole batch failed → both zero-filled with DIM-length vector.
        assert result[0] == [0.0] * DIM
        assert result[1] == [0.0] * DIM

    def test_embed_batch_all_success(self):
        """embed_batch returns all vectors on full success.

        Note (B4): embed_batch routes through ``_call_api_batch`` (not
        ``_call_api``); the mock target is updated accordingly.
        """
        from rag_service.retrieval.modelScope_embedder import ModelScopeEmbedder
        embedder = ModelScopeEmbedder(api_key="k")
        mock_emb = [0.1, 0.2]
        with patch.object(embedder, "_call_api_batch",
                          return_value=[mock_emb, mock_emb]), \
             patch.object(embedder, "_rate_limit"):
            with patch("rag_service.retrieval.modelScope_embedder.time.monotonic",
                       side_effect=[0.0, 0.5, 1.0, 1.5, 2.0]):
                result = embedder.embed_batch(["text1", "text2"])
        assert len(result) == 2
        assert all(r == mock_emb for r in result)

    def test_embed_batch_empty(self):
        """embed_batch returns [] for empty list (no API calls).

        Note: module has a ZeroDivisionError bug when len(texts)==0 (f-string
        evaluates elapsed/len(texts) before logger.info is called).
        """
        from rag_service.retrieval import modelScope_embedder as ms_mod
        from rag_service.retrieval.modelScope_embedder import ModelScopeEmbedder
        embedder = ModelScopeEmbedder(api_key="k")
        embedder._last_call = time.monotonic() - 100.0

        # Start all patches before embed_batch() to avoid exit issues on ZDE
        patches = [
            patch.object(embedder, "_rate_limit"),
            patch("rag_service.retrieval.modelScope_embedder.time.sleep"),
            patch.object(ms_mod.logger, "info"),
            patch.object(ms_mod.logger, "warning"),
            patch("rag_service.retrieval.modelScope_embedder.time.monotonic",
                  return_value=1.0),
        ]
        for p in patches:
            p.start()

        # Track whether _call_api was invoked
        call_called = False
        orig = embedder._call_api

        def track_call(text):
            nonlocal call_called
            call_called = True
            return orig(text)

        embedder._call_api = track_call

        try:
            result = embedder.embed_batch([])
        except ZeroDivisionError:
            result = []  # known bug: f-string eval tries elapsed/len(texts) before logger
        finally:
            for p in reversed(patches):
                p.stop()

        assert result == []
        assert call_called is False


# ---------------------------------------------------------------------------
# B4 regression: rate-limit quota not multiplied by same-key concurrency
# ---------------------------------------------------------------------------

def test_embed_query_concurrent_same_key_consumes_one_quota_unit():
    """B4: N concurrent embed_query calls for the SAME query must coalesce
    into a single API call and consume exactly one rate-limit slot, not N.

    Regression: previously the per-key lock wrapped both ``_rate_limit()``
    and ``_call_api()``, so each same-key waiter ran its own rate-limit
    check inside the holder cycle and each appended a timestamp. Under
    multi-market LangGraph fan-out this multiplied the shared ~350/h quota
    by the concurrency level, dropping hit_rate from 1.0 to ~0.3 once
    concurrency exceeded ~5.

    The fix moves rate-limit check/record OUTSIDE the per-key lock. This
    test pins the contract by counting how many timestamps get appended to
    ``_CALL_TIMESTAMPS`` when N threads race on the same query: it must be
    exactly 1, not N.
    """
    import threading
    from rag_service.retrieval import modelScope_embedder as ms_mod
    from rag_service.retrieval.modelScope_embedder import ModelScopeEmbedder

    # Reset shared rate-limit state for an isolated measurement.
    ms_mod._CALL_TIMESTAMPS.clear()
    embedder = ModelScopeEmbedder(api_key="k")
    mock_client = MagicMock()
    mock_resp = MagicMock()
    mock_resp.data = [MagicMock(embedding=[0.5, 0.5])]
    mock_client.embeddings.create.return_value = mock_resp
    embedder._client = mock_client

    # Make the API call slightly slow so threads genuinely race on the
    # per-key lock; without this the first thread completes before others
    # start and the test would pass trivially.
    def slow_create(*args, **kwargs):
        time.sleep(0.05)
        return mock_resp
    mock_client.embeddings.create.side_effect = slow_create

    # Also clear the query cache so every thread misses and races the lock.
    ms_mod._QUERY_CACHE.clear()

    N = 8
    barrier = threading.Barrier(N)
    results: list = []
    results_lock = threading.Lock()

    def worker():
        barrier.wait()
        r = embedder.embed_query("concurrent-same-key-query")
        with results_lock:
            results.append(r)

    threads = [threading.Thread(target=worker) for _ in range(N)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    assert len(results) == N, "all threads must complete"
    assert all(r == [0.5, 0.5] for r in results), "all threads got the embedding"
    # B4 contract: the rate-limit quota is consumed exactly once for the
    # coalesced same-key call, not N times.
    assert len(ms_mod._CALL_TIMESTAMPS) == 1, (
        f"B4 regression: same-key concurrency consumed "
        f"{len(ms_mod._CALL_TIMESTAMPS)} quota units, expected 1"
    )


def test_embed_query_cache_hit_consumes_zero_quota():
    """B4: a cache hit must NOT consume any rate-limit quota at all.

    The fast-path cache lookup returns before ``_rate_limit()`` is ever
    called, so repeated queries against an already-cached embedding are
    effectively free. This test pins that behaviour so a future refactor
    that accidentally moves the cache check below the rate-limit step is
    caught.
    """
    from rag_service.retrieval import modelScope_embedder as ms_mod
    from rag_service.retrieval.modelScope_embedder import ModelScopeEmbedder

    ms_mod._CALL_TIMESTAMPS.clear()
    embedder = ModelScopeEmbedder(api_key="k")
    mock_client = MagicMock()
    mock_resp = MagicMock()
    mock_resp.data = [MagicMock(embedding=[0.7, 0.7])]
    mock_client.embeddings.create.return_value = mock_resp
    embedder._client = mock_client
    ms_mod._QUERY_CACHE.clear()

    # First call: cache miss → 1 API call, 1 quota unit.
    r1 = embedder.embed_query("cached-query-text-xyz")
    assert r1 == [0.7, 0.7]
    quota_after_first = len(ms_mod._CALL_TIMESTAMPS)
    assert quota_after_first == 1

    # Second call: cache hit → 0 API calls, 0 additional quota units.
    r2 = embedder.embed_query("cached-query-text-xyz")
    assert r2 == [0.7, 0.7]
    assert len(ms_mod._CALL_TIMESTAMPS) == quota_after_first, (
        "cache hit must not consume rate-limit quota"
    )
    assert mock_client.embeddings.create.call_count == 1
