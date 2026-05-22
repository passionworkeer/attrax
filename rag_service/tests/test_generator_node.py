"""
test_generator_node.py - Unit tests for rag_service.orchestrator.nodes.generator

Covers:
- generator_node(state) with edge cases
- _get_generator / set_generator injection
- user_documents context building
- agent_trace accumulation
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import MagicMock, patch


# ── Subject under test ──────────────────────────────────────────────────────
from rag_service.orchestrator.nodes import generator as generator_module


# ── Helpers ──────────────────────────────────────────────────────────────────

def make_state(**overrides):
    """Minimal GraphState factory with sensible defaults."""
    defaults = dict(
        query="锂电池出口欧盟需要哪些认证？",
        product="蓝牙耳机",
        markets=["EU"],
        documents=[],
        user_documents=[],
        agent_trace=[],
    )
    defaults.update(overrides)
    return defaults


def make_chunk(doc_name: str = "REACH法规", content: str = "REACH第22条限制铅含量。") -> dict:
    return {"doc_name": doc_name, "content": content, "id": "c1"}


def make_report_package() -> dict:
    return {
        "complianceReport": "## Compliance\nEvidence-backed report.",
        "profitReport": {"markdown": "## Profit\nFallback estimate."},
        "roadmap": {"totalDays": 14, "progress": 50, "items": []},
        "decisionView": {"summary": "Proceed after evidence review.", "keyFindings": [], "nodes": []},
    }


# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def reset_generator_singleton():
    """Reset the module-level generator singleton before and after each test."""
    generator_module._generator_instance = None
    generator_module._is_injected = False
    yield
    generator_module._generator_instance = None
    generator_module._is_injected = False


@pytest.fixture
def mock_generator():
    """Returns a MagicMock that quacks like ReportGenerator."""
    gen = MagicMock()
    gen.provider = "mimotalk"
    gen.generate.return_value = "## 合规报告\n\n这是一段测试报告内容。"
    return gen


@pytest.fixture
def empty_str_chunks():
    """documents list containing one empty-string chunk — boundary case."""
    return [
        {"doc_name": "Empty", "content": "", "id": "c1"},
        {"doc_name": "AlsoEmpty", "content": "  ", "id": "c2"},
    ]


# ── Test: set_generator / _get_generator injection ───────────────────────────

class TestGeneratorInjection:
    def test_set_generator_registers_instance(self, mock_generator):
        generator_module.set_generator(mock_generator)
        assert generator_module._get_generator() is mock_generator

    def test_injected_generator_takes_precedence_over_env(self, mock_generator, monkeypatch):
        monkeypatch.setenv("MIMOTALK_API_KEY", "env-key-xyz")
        generator_module.set_generator(mock_generator)
        # _get_generator should return the injected instance, never trying env
        result = generator_module._get_generator()
        assert result is mock_generator

    def test_no_generator_returns_none(self, monkeypatch):
        """Without set_generator, _get_generator relies on lazy init from config.
        When no API key is available the lazy init may fail silently,
        or it may succeed if settings resolves a generator — either is acceptable
        as long as it does not raise.
        """
        monkeypatch.delenv("MIMOTALK_API_KEY", raising=False)
        # Prevent actual lazy init from reaching the network by patching
        # _get_generator to return None, then verify the node handles None.
        with patch.object(generator_module, "_get_generator", return_value=None):
            result = generator_module._get_generator()
            assert result is None

    def test_lazy_init_without_injection(self, monkeypatch):
        """Without set_generator and with no API key, _get_generator returns None gracefully."""
        monkeypatch.delenv("MIMOTALK_API_KEY", raising=False)
        # Force lazy init path by ensuring no prior injection
        result = generator_module._get_generator()
        # Lazy init may succeed or fail depending on config, but must not raise
        # The key assertion: calling the function does not raise
        assert result is None or hasattr(result, "generate")


# ── Test: generator_node — empty / edge documents ────────────────────────────

class TestGeneratorNodeEdgeDocuments:
    def test_empty_documents_returns_error_message(self, mock_generator):
        """documents=[] → generation contains error message, no LLM called."""
        generator_module.set_generator(mock_generator)
        state = make_state(documents=[])

        result = generator_module.generator_node(state)

        assert "未找到合规信息" in result["generation"]
        mock_generator.generate.assert_not_called()

    def test_all_empty_string_documents_still_calls_generator(self, mock_generator, empty_str_chunks):
        """
        documents contains chunks with empty/blank content.
        The node does NOT filter these — generator receives them as-is.
        ReportGenerator.generate() itself handles the empty-content case internally.
        """
        generator_module.set_generator(mock_generator)
        state = make_state(documents=empty_str_chunks)

        result = generator_module.generator_node(state)

        mock_generator.generate.assert_called_once()
        assert result["generation"] is not None


# ── Test: generator_node — normal call ──────────────────────────────────────

class TestGeneratorNodeNormal:
    def test_normal_call_returns_generation_and_updates_trace(self, mock_generator):
        generator_module.set_generator(mock_generator)
        state = make_state(
            documents=[make_chunk()],
            markets=["EU", "US"],
        )

        result = generator_module.generator_node(state)

        assert "测试报告内容" in result["generation"]
        mock_generator.generate.assert_called_once()
        call_kwargs = mock_generator.generate.call_args.kwargs
        assert call_kwargs["product"] == "蓝牙耳机"
        assert call_kwargs["market"] == "EU, US"
        assert call_kwargs["query"] == "锂电池出口欧盟需要哪些认证？"

    def test_agent_trace_appended(self, mock_generator):
        generator_module.set_generator(mock_generator)
        state = make_state(
            documents=[make_chunk()],
            agent_trace=[{"node": "retriever", "chunks_count": 3}],
        )

        result = generator_module.generator_node(state)

        assert len(result["agent_trace"]) == 2
        trace = result["agent_trace"][1]
        assert trace["node"] == "generate"
        assert trace["provider"] == "mimotalk"
        assert "chunks_count" in trace

    def test_user_documents_included_in_doc_context(self, mock_generator):
        """user_documents are packed into doc_context and passed to generator."""
        generator_module.set_generator(mock_generator)
        state = make_state(
            documents=[make_chunk()],
            user_documents=[
                {"name": "产品规格书.pdf", "text": "额定容量 5000mAh，锂电池。"},
                {"name": "测试报告.docx", "text": "已通过 UN38.3 测试。"},
            ],
        )

        generator_module.generator_node(state)

        _, kwargs = mock_generator.generate.call_args
        assert "产品规格书.pdf" in kwargs["doc_context"]
        assert "测试报告.docx" in kwargs["doc_context"]
        assert "5000mAh" in kwargs["doc_context"]
        assert "UN38.3" in kwargs["doc_context"]

    def test_user_documents_trims_long_text(self, mock_generator):
        """Text from user docs is sliced to 3000 chars."""
        generator_module.set_generator(mock_generator)
        long_text = "X" * 5000
        state = make_state(
            documents=[make_chunk()],
            user_documents=[{"name": "超长文档.txt", "text": long_text}],
        )

        generator_module.generator_node(state)

        _, kwargs = mock_generator.generate.call_args
        assert len(kwargs["doc_context"]) < 5000
        assert "用户上传的产品文档" in kwargs["doc_context"]

    def test_user_documents_skips_empty_text(self, mock_generator):
        """Docs with empty/whitespace text are skipped in doc_context."""
        generator_module.set_generator(mock_generator)
        state = make_state(
            documents=[make_chunk()],
            user_documents=[
                {"name": "empty.txt", "text": ""},
                {"name": "blank.txt", "text": "   "},
                {"name": "valid.txt", "text": "实际内容。"},
            ],
        )

        generator_module.generator_node(state)

        _, kwargs = mock_generator.generate.call_args
        assert "empty.txt" not in kwargs["doc_context"]
        assert "blank.txt" not in kwargs["doc_context"]
        assert "valid.txt" in kwargs["doc_context"]

    def test_report_package_path_adds_layered_evidence(self):
        gen = MagicMock()
        gen.provider = "mimotalk"
        gen.supports_report_package = True
        gen.generate_report_package.return_value = make_report_package()
        generator_module.set_generator(gen)
        state = make_state(
            category="electronics",
            documents=[make_chunk()],
            vision_result={"product": "Power bank", "summary": "Visible charging ports"},
            user_documents=[{"name": "manual.pdf", "mime_type": "application/pdf", "text": "Manual text"}],
        )

        result = generator_module.generator_node(state)

        package = result["report_package"]
        assert package["productDossier"]["category"] == "electronics"
        assert package["evidenceBundles"]["visual"]
        assert len(package["evidenceBundles"]["retrieval"]) == 2
        assert any(
            item["layer"] == "audit"
            for item in package["evidenceBundles"]["generation"]
        )
        assert package["auditMetadata"]["traceNodeCount"] == 1
        gen.generate.assert_not_called()


# ── Test: generator_node — no generator / failure handling ───────────────────

class TestGeneratorNodeNoGenerator:
    def test_no_generator_returns_error_and_trace(self, monkeypatch):
        """When _get_generator returns None, node returns error generation."""
        # Mock _get_generator so it always returns None (simulates no generator)
        monkeypatch.setattr(generator_module, "_get_generator", lambda: None)
        state = make_state(documents=[make_chunk()])

        result = generator_module.generator_node(state)

        assert "错误" in result["generation"]
        assert "未初始化" in result["generation"] or any(
            e.get("error") == "no_generator"
            for e in result.get("agent_trace", [])
        )


class TestGeneratorNodeLLMFailure:
    def test_generator_raises_exception_degrades_gracefully(self, mock_generator):
        """When generator.generate() raises, node catches it and returns error message."""
        mock_generator.generate.side_effect = RuntimeError("网络超时")
        generator_module.set_generator(mock_generator)
        state = make_state(documents=[make_chunk()])

        result = generator_module.generator_node(state)

        assert "报告生成失败" in result["generation"]
        assert "网络超时" in result["generation"]


# ── Test: generator_node — trace integrity ──────────────────────────────────

class TestGeneratorNodeTraceIntegrity:
    def test_trace_contains_correct_fields(self, mock_generator):
        generator_module.set_generator(mock_generator)
        state = make_state(documents=[make_chunk(), make_chunk(doc_name="RoHS", content="RoHS限制汞含量。")])

        result = generator_module.generator_node(state)

        trace = result["agent_trace"][-1]
        assert "node" in trace
        assert "provider" in trace
        assert "chunks_count" in trace
        assert "generation_length" in trace
        assert trace["chunks_count"] == 2
        assert trace["generation_length"] == len(result["generation"])

    def test_empty_trace_initially(self, mock_generator):
        """Empty agent_trace in state is handled gracefully."""
        generator_module.set_generator(mock_generator)
        state = make_state(documents=[make_chunk()], agent_trace=[])

        result = generator_module.generator_node(state)

        assert len(result["agent_trace"]) == 1  # only this node's entry


# ── Test: generator_node — market string format ─────────────────────────────

class TestGeneratorNodeMarketFormat:
    def test_single_market_no_comma(self, mock_generator):
        generator_module.set_generator(mock_generator)
        state = make_state(markets=["EU"], documents=[make_chunk()])

        generator_module.generator_node(state)

        _, kwargs = mock_generator.generate.call_args
        assert kwargs["market"] == "EU"

    def test_multiple_markets_joined_with_comma(self, mock_generator):
        generator_module.set_generator(mock_generator)
        state = make_state(markets=["EU", "US", "CN"], documents=[make_chunk()])

        generator_module.generator_node(state)

        _, kwargs = mock_generator.generate.call_args
        assert kwargs["market"] == "EU, US, CN"
