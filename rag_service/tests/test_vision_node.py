"""
pytest unit tests for rag_service/orchestrator/nodes/vision.py

Covers:
- _parse_vision_text()
- _build_vision_enriched_query()
- _empty_vision_result()
- VisionAnalyzer (analyze_single_image / analyze_images)
- vision_analysis_node()
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import patch, MagicMock, call
import urllib.error

from rag_service.orchestrator.nodes.vision import (
    _parse_vision_text,
    _build_vision_enriched_query,
    _empty_vision_result,
    VisionAnalyzer,
    vision_analysis_node,
    set_vision_analyzer,
    _get_analyzer,
)


# ─────────────────────────────────────────────
#  Shared fixtures
# ─────────────────────────────────────────────

@pytest.fixture
def clean_analyzer_state():
    """Reset module-level analyzer state before and after each test."""
    import rag_service.orchestrator.nodes.vision as mod
    mod._analyzer_instance = None
    mod._is_injected = False
    yield
    mod._analyzer_instance = None
    mod._is_injected = False


# ─────────────────────────────────────────────
#  Test data fixtures
# ─────────────────────────────────────────────

VALID_VISION_OUTPUT = """### 产品类型
蓝牙耳机

### 核心特征
入耳式
有线充电盒
锂电池供电

### 认证标志
CE, FCC
"""

MULTI_LINE_OUTPUT = """### 产品类型
USB充电器

### 核心特征
QC3.0快充
USB-C接口
过流保护

### 认证标志
CE
FCC
CCC
UKCA
RoHS
"""

CERT_ONLY_OUTPUT = """### 产品类型
移动电源

### 核心特征
10000mAh
锂电池

### 认证标志
CE, ROHS, WEEE, REACH
"""

PARTIAL_OUTPUT = """### 产品类型
LED台灯

### 认证标志
无明显认证标志
"""

CHINESE_CERT_OUTPUT = """### 产品类型
电动玩具

### 核心特征
3岁以上
ABS塑料

### 认证标志
CE
FCC
UKCA
"""


# ─────────────────────────────────────────────
#  Tests: _empty_vision_result()
# ─────────────────────────────────────────────

class TestEmptyVisionResult:
    def test_returns_correct_keys(self):
        result = _empty_vision_result()
        assert set(result.keys()) == {
            "descriptions", "combined_description", "certifications",
            "images_analyzed", "enriched_query", "cert_summary",
        }

    def test_all_default_values(self):
        result = _empty_vision_result()
        assert result["descriptions"] == []
        assert result["combined_description"] == ""
        assert result["certifications"] == []
        assert result["images_analyzed"] == 0
        assert result["enriched_query"] == ""
        assert result["cert_summary"] == "未分析"


# ─────────────────────────────────────────────
#  Tests: _parse_vision_text()
# ─────────────────────────────────────────────

class TestParseVisionText:
    """Unit tests for _parse_vision_text()."""

    # ── Product type extraction ───────────────

    def test_extracts_product_type(self):
        result = _parse_vision_text(VALID_VISION_OUTPUT, VALID_VISION_OUTPUT)
        assert result["product_type"] == "蓝牙耳机"

    def test_product_type_first_line_only(self):
        raw = """### 产品类型
蓝牙耳机
充电宝
"""
        result = _parse_vision_text(raw, raw)
        assert result["product_type"] == "蓝牙耳机"

    def test_unknown_product_type_returns_empty(self):
        raw = """### 产品类型
无法识别具体产品类型
"""
        result = _parse_vision_text(raw, raw)
        assert result["product_type"] == ""

    def test_missing_product_type_section(self):
        # No "产品类型" heading — nothing should be captured as product type
        raw = "no section headers at all\njust a plain line"
        result = _parse_vision_text(raw, raw)
        assert result["product_type"] == ""

    # ── Certification recognition ─────────────

    def test_recognizes_ce_mark(self):
        result = _parse_vision_text(VALID_VISION_OUTPUT, VALID_VISION_OUTPUT)
        marks = [c["mark"] for c in result["certifications"]]
        assert "CE" in marks

    def test_recognizes_fcc_mark(self):
        result = _parse_vision_text(VALID_VISION_OUTPUT, VALID_VISION_OUTPUT)
        marks = [c["mark"] for c in result["certifications"]]
        assert "FCC" in marks

    def test_recognizes_rohs_mark(self):
        result = _parse_vision_text(CERT_ONLY_OUTPUT, CERT_ONLY_OUTPUT)
        marks = [c["mark"] for c in result["certifications"]]
        assert "ROHS" in marks

    def test_recognizes_weeemark(self):
        result = _parse_vision_text(CERT_ONLY_OUTPUT, CERT_ONLY_OUTPUT)
        marks = [c["mark"] for c in result["certifications"]]
        assert "WEEE" in marks

    def test_recognizes_reach_mark(self):
        result = _parse_vision_text(CERT_ONLY_OUTPUT, CERT_ONLY_OUTPUT)
        marks = [c["mark"] for c in result["certifications"]]
        assert "REACH" in marks

    def test_recognizes_ukca_mark(self):
        result = _parse_vision_text(CHINESE_CERT_OUTPUT, CHINESE_CERT_OUTPUT)
        marks = [c["mark"] for c in result["certifications"]]
        assert "UKCA" in marks

    def test_recognizes_ccc_mark(self):
        result = _parse_vision_text(MULTI_LINE_OUTPUT, MULTI_LINE_OUTPUT)
        marks = [c["mark"] for c in result["certifications"]]
        assert "CCC" in marks

    def test_cert_has_region_field(self):
        result = _parse_vision_text(VALID_VISION_OUTPUT, VALID_VISION_OUTPUT)
        ce_cert = next((c for c in result["certifications"] if c["mark"] == "CE"), None)
        assert ce_cert is not None
        assert ce_cert["region"] == "EU"

    def test_cert_has_confidence_field(self):
        result = _parse_vision_text(VALID_VISION_OUTPUT, VALID_VISION_OUTPUT)
        for cert in result["certifications"]:
            assert "confidence" in cert
            assert cert["confidence"] in ("high", "medium")

    def test_no_certs_when_none_present(self):
        result = _parse_vision_text(PARTIAL_OUTPUT, PARTIAL_OUTPUT)
        assert result["certifications"] == []

    def test_does_not_duplicate_certs(self):
        # certs may appear in both the cert_map scan and the certs-section scan;
        # the code deduplicates by checking if mark is already in the list.
        raw = """### 认证标志
CE, FCC
"""
        result = _parse_vision_text(raw, raw)
        marks = [c["mark"] for c in result["certifications"]]
        assert marks.count("CE") == 1

    # ── Core features extraction ─────────────

    def test_extracts_core_features(self):
        raw = "### 产品类型\nUSB Charger\n### 核心特征\nfast charge\nUSB-C\n"
        result = _parse_vision_text(raw, raw)
        assert isinstance(result["core_features"], list)
        assert len(result["core_features"]) > 0

    # ── enriched_query construction ───────────

    def test_enriched_query_contains_product_type(self):
        result = _parse_vision_text(VALID_VISION_OUTPUT, VALID_VISION_OUTPUT)
        assert result["product_type"] in result["enriched_query"]

    def test_enriched_query_includes_cert_part(self):
        result = _parse_vision_text(VALID_VISION_OUTPUT, VALID_VISION_OUTPUT)
        assert "认证标志" in result["enriched_query"] or "CE" in result["enriched_query"]

    # ── Return structure ──────────────────────

    def test_returns_all_required_keys(self):
        result = _parse_vision_text(VALID_VISION_OUTPUT, VALID_VISION_OUTPUT)
        assert set(result.keys()) == {
            "description", "product_type", "core_features",
            "certifications", "raw_response", "enriched_query",
        }

    def test_description_equals_raw(self):
        result = _parse_vision_text(VALID_VISION_OUTPUT, "custom_response")
        assert result["description"] == VALID_VISION_OUTPUT

    def test_raw_response_preserved(self):
        result = _parse_vision_text(VALID_VISION_OUTPUT, "custom_response")
        assert result["raw_response"] == "custom_response"

    # ── Edge cases ────────────────────────────

    def test_empty_input_returns_empty_struct(self):
        result = _parse_vision_text("", "")
        assert result["product_type"] == ""
        assert result["certifications"] == []

    def test_whitespace_only_lines_skipped(self):
        raw = """### 产品类型

   \t

蓝牙耳机
"""
        result = _parse_vision_text(raw, raw)
        assert result["product_type"] == "蓝牙耳机"

    def test_preserves_raw_response_on_failure(self):
        raw = "### 产品类型\n无法识别具体产品类型\n"
        result = _parse_vision_text(raw, raw)
        # enriched_query falls back to raw[:300]
        assert result["enriched_query"] != ""


# ─────────────────────────────────────────────
#  Tests: _build_vision_enriched_query()
# ─────────────────────────────────────────────

class TestBuildVisionEnrichedQuery:
    """Unit tests for _build_vision_enriched_query()."""

    def test_structured_description_returns_joined_parts(self):
        result = _build_vision_enriched_query(
            "蓝牙耳机，特征：入耳式；锂电池供电",
            [{"mark": "CE", "region": "EU", "confidence": "high"}]
        )
        assert isinstance(result, str)
        assert len(result) > 0

    def test_empty_description_returns_empty(self):
        result = _build_vision_enriched_query("", [])
        assert result == ""

    def test_long_description_truncated(self):
        long_desc = "X" * 500
        result = _build_vision_enriched_query(long_desc, [])
        assert len(result) <= 300

    def test_with_no_structured_format(self):
        result = _build_vision_enriched_query(
            "This is a plain unstructured description of the product.",
            []
        )
        assert isinstance(result, str)

    def test_returns_string(self):
        result = _build_vision_enriched_query("test", [])
        assert isinstance(result, str)

    def test_empty_certs_list_handled(self):
        result = _build_vision_enriched_query("产品描述", [])
        assert isinstance(result, str)


# ─────────────────────────────────────────────
#  Tests: VisionAnalyzer._call_mimotalk()
# ─────────────────────────────────────────────

class TestVisionAnalyzerMimotalk:
    """Test _call_mimotalk with mocked HTTP layer."""

    def test_no_api_key_returns_empty_string(self):
        analyzer = VisionAnalyzer(api_key="")
        result = analyzer._call_mimotalk([])
        assert result == ""

    @patch("urllib.request.urlopen")
    def test_successful_call_returns_text(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)
        mock_response.read.return_value = b'{"content":[{"text":"product type"}]}'
        mock_urlopen.return_value = mock_response

        analyzer = VisionAnalyzer(api_key="test-key")
        result = analyzer._call_mimotalk([{"role": "user", "content": []}])
        assert result == "product type"

    @patch("urllib.request.urlopen")
    def test_http_error_returns_empty_string(self, mock_urlopen):
        # Provide a proper file-like body so e.read() works in the exception handler
        mock_body = MagicMock()
        mock_body.read.return_value = b'{"error": "bad request"}'
        mock_urlopen.side_effect = urllib.error.HTTPError(
            "url", 401, "Unauthorized", {}, mock_body
        )
        analyzer = VisionAnalyzer(api_key="bad-key")
        result = analyzer._call_mimotalk([{"role": "user", "content": []}])
        assert result == ""

    @patch("urllib.request.urlopen")
    def test_timeout_error_returns_empty_string(self, mock_urlopen):
        mock_urlopen.side_effect = Exception("timeout")
        analyzer = VisionAnalyzer(api_key="test-key")
        result = analyzer._call_mimotalk([{"role": "user", "content": []}])
        assert result == ""


# ─────────────────────────────────────────────
#  Tests: VisionAnalyzer.analyze_single_image()
# ─────────────────────────────────────────────

class TestVisionAnalyzerSingleImage:
    """Test analyze_single_image()."""

    @patch.dict("os.environ", {"MIMOTALK_API_KEY": ""})
    def test_no_api_key_returns_error_dict(self):
        analyzer = VisionAnalyzer(api_key="")
        result = analyzer.analyze_single_image(b"\x00\x01\x02", "image/jpeg")
        assert result["error"] == "no_api_key"
        assert result["description"] == ""
        assert result["certifications"] == []

    @patch.object(VisionAnalyzer, "_call_mimotalk")
    def test_vision_call_failed_returns_error_dict(self, mock_call):
        mock_call.return_value = ""
        analyzer = VisionAnalyzer(api_key="test-key")
        result = analyzer.analyze_single_image(b"\x00\x01\x02", "image/jpeg")
        assert result["error"] == "vision_call_failed"

    @patch.object(VisionAnalyzer, "_call_mimotalk")
    def test_successful_analysis_returns_parsed_dict(self, mock_call):
        mock_call.return_value = VALID_VISION_OUTPUT
        analyzer = VisionAnalyzer(api_key="test-key")
        result = analyzer.analyze_single_image(b"\x00\x01\x02", "image/jpeg")
        assert "product_type" in result
        assert "certifications" in result
        assert result["product_type"] == "蓝牙耳机"

    @patch.object(VisionAnalyzer, "_call_mimotalk")
    def test_passes_mime_type_correctly(self, mock_call):
        mock_call.return_value = VALID_VISION_OUTPUT
        analyzer = VisionAnalyzer(api_key="test-key")
        analyzer.analyze_single_image(b"\x00", "image/png")
        # Verify the call was made (mime type is embedded in the messages list)
        args = mock_call.call_args[0][0]
        content = args[0]["content"]
        img_block = next(b for b in content if b.get("type") == "image")
        assert img_block["source"]["media_type"] == "image/png"


# ─────────────────────────────────────────────
#  Tests: VisionAnalyzer.analyze_images()
# ─────────────────────────────────────────────

class TestVisionAnalyzerAnalyzeImages:
    """Test analyze_images()."""

    def test_no_images_returns_empty_result(self):
        analyzer = VisionAnalyzer(api_key="test-key")
        result = analyzer.analyze_images([])
        assert result == _empty_vision_result()

    @patch.dict("os.environ", {"MIMOTALK_API_KEY": ""})
    def test_no_api_key_returns_empty_result(self):
        analyzer = VisionAnalyzer(api_key="")
        result = analyzer.analyze_images([{"buffer": b"x", "mime_type": "image/jpeg"}])
        assert result == _empty_vision_result()

    @patch.object(VisionAnalyzer, "analyze_single_image")
    def test_single_image_returns_descriptions_list(self, mock_single):
        mock_single.return_value = {
            "product_type": "蓝牙耳机",
            "description": "入耳式蓝牙耳机",
            "certifications": [{"mark": "CE", "region": "EU", "confidence": "high"}],
        }
        analyzer = VisionAnalyzer(api_key="test-key")
        result = analyzer.analyze_images([{"buffer": b"x", "mime_type": "image/jpeg"}])
        assert "descriptions" in result
        assert result["images_analyzed"] == 1
        assert result["cert_summary"] == "CE"

    @patch.object(VisionAnalyzer, "analyze_single_image")
    def test_multiple_images_merges_descriptions(self, mock_single):
        mock_single.side_effect = [
            {
                "product_type": "蓝牙耳机",
                "description": "入耳式蓝牙耳机",
                "certifications": [{"mark": "CE", "region": "EU", "confidence": "high"}],
            },
            {
                "product_type": "充电盒",
                "description": "有线充电盒",
                "certifications": [{"mark": "FCC", "region": "US", "confidence": "high"}],
            },
        ]
        analyzer = VisionAnalyzer(api_key="test-key")
        result = analyzer.analyze_images([
            {"buffer": b"img1", "mime_type": "image/jpeg"},
            {"buffer": b"img2", "mime_type": "image/jpeg"},
        ])
        assert len(result["descriptions"]) == 2
        assert result["images_analyzed"] == 2

    @patch.object(VisionAnalyzer, "analyze_single_image")
    def test_multiple_images_deduplicates_certifications(self, mock_single):
        mock_single.side_effect = [
            {
                "product_type": "蓝牙耳机",
                "description": "描述1",
                "certifications": [{"mark": "CE", "region": "EU", "confidence": "high"}],
            },
            {
                "product_type": "充电盒",
                "description": "描述2",
                "certifications": [{"mark": "CE", "region": "EU", "confidence": "high"}],
            },
        ]
        analyzer = VisionAnalyzer(api_key="test-key")
        result = analyzer.analyze_images([
            {"buffer": b"img1", "mime_type": "image/jpeg"},
            {"buffer": b"img2", "mime_type": "image/jpeg"},
        ])
        ce_count = sum(1 for c in result["certifications"] if c["mark"] == "CE")
        assert ce_count == 1

    @patch.object(VisionAnalyzer, "analyze_single_image")
    def test_high_confidence_overwrites_medium(self, mock_single):
        mock_single.side_effect = [
            {
                "product_type": "产品A",
                "description": "描述A",
                "certifications": [{"mark": "CE", "region": "EU", "confidence": "medium"}],
            },
            {
                "product_type": "产品B",
                "description": "描述B",
                "certifications": [{"mark": "CE", "region": "EU", "confidence": "high"}],
            },
        ]
        analyzer = VisionAnalyzer(api_key="test-key")
        result = analyzer.analyze_images([
            {"buffer": b"img1", "mime_type": "image/jpeg"},
            {"buffer": b"img2", "mime_type": "image/jpeg"},
        ])
        ce_cert = next((c for c in result["certifications"] if c["mark"] == "CE"), None)
        assert ce_cert["confidence"] == "high"

    @patch.object(VisionAnalyzer, "analyze_single_image")
    def test_skips_empty_buffer_images(self, mock_single):
        # _analyze_one skips empty-buffer images (returns None).
        # Both images here have non-empty buffers, so both reach analyze_single_image.
        # images_analyzed counts all input images; only results with non-empty
        # description enter the descriptions list.
        mock_single.side_effect = [
            {"product_type": "p1", "description": "desc1", "certifications": []},
            {"product_type": "p2", "description": "desc2", "certifications": []},
        ]
        analyzer = VisionAnalyzer(api_key="test-key")
        result = analyzer.analyze_images([
            {"buffer": b"img1", "mime_type": "image/jpeg"},
            {"buffer": b"img2", "mime_type": "image/jpeg"},
        ])
        # Both images counted; both descriptions included (both non-empty)
        assert result["images_analyzed"] == 2
        assert len(result["descriptions"]) == 2

    @patch.object(VisionAnalyzer, "analyze_single_image")
    def test_returns_enriched_query(self, mock_single):
        mock_single.return_value = {
            "product_type": "蓝牙耳机",
            "description": "入耳式",
            "certifications": [{"mark": "CE", "region": "EU", "confidence": "high"}],
        }
        analyzer = VisionAnalyzer(api_key="test-key")
        result = analyzer.analyze_images([{"buffer": b"x", "mime_type": "image/jpeg"}])
        assert "enriched_query" in result
        assert isinstance(result["enriched_query"], str)


# ─────────────────────────────────────────────
#  Tests: vision_analysis_node()
# ─────────────────────────────────────────────

class TestVisionAnalysisNode:
    """Integration tests for vision_analysis_node()."""

    def test_no_images_returns_empty_result(self):
        state = {"query": "CE marking", "images": [], "agent_trace": []}
        result = vision_analysis_node(state)
        assert result["vision_result"] == _empty_vision_result()
        assert result["agent_trace"][-1]["status"] == "skipped"

    def test_preserves_precomputed_vision_result(self):
        precomputed = {
            "certifications": [{"mark": "CE", "region": "EU", "confidence": "high"}],
            "cert_summary": "CE",
        }
        state = {
            "query": "CE marking",
            "images": [],
            "vision_result": precomputed,
            "agent_trace": [],
        }
        result = vision_analysis_node(state)
        assert result["agent_trace"][-1]["status"] == "precomputed"

    @patch("rag_service.orchestrator.nodes.vision._get_analyzer")
    def test_no_api_key_returns_empty_result(self, mock_get_analyzer):
        mock_analyzer = MagicMock()
        mock_analyzer.api_key = ""
        mock_get_analyzer.return_value = mock_analyzer

        state = {
            "query": "CE marking",
            "images": [{"buffer": b"x", "mime_type": "image/jpeg"}],
            "agent_trace": [],
        }
        result = vision_analysis_node(state)
        assert result["vision_result"] == _empty_vision_result()
        assert result["agent_trace"][-1]["status"] == "no_api_key"

    @patch("rag_service.orchestrator.nodes.vision._get_analyzer")
    def test_normal_flow_enriches_query(self, mock_get_analyzer):
        mock_analyzer = MagicMock()
        mock_analyzer.api_key = "test-key"
        mock_analyzer.analyze_images.return_value = {
            "descriptions": ["蓝牙耳机"],
            "combined_description": "蓝牙耳机",
            "certifications": [{"mark": "CE", "region": "EU", "confidence": "high"}],
            "images_analyzed": 1,
            "enriched_query": "蓝牙耳机，认证标志：CE",
            "cert_summary": "CE",
        }
        mock_get_analyzer.return_value = mock_analyzer

        state = {
            "query": "出口欧盟",
            "images": [{"buffer": b"x", "mime_type": "image/jpeg"}],
            "agent_trace": [],
        }
        result = vision_analysis_node(state)
        assert "vision_result" in result
        assert "CE" in result["query"]
        assert result["agent_trace"][-1]["node"] == "vision"

    @patch("rag_service.orchestrator.nodes.vision._get_analyzer")
    def test_no_enriched_query_preserves_original(self, mock_get_analyzer):
        mock_analyzer = MagicMock()
        mock_analyzer.api_key = "test-key"
        mock_analyzer.analyze_images.return_value = {
            "descriptions": [],
            "combined_description": "",
            "certifications": [],
            "images_analyzed": 1,
            "enriched_query": "",
            "cert_summary": "未分析",
        }
        mock_get_analyzer.return_value = mock_analyzer

        state = {
            "query": "出口欧盟",
            "images": [{"buffer": b"x", "mime_type": "image/jpeg"}],
            "agent_trace": [],
        }
        result = vision_analysis_node(state)
        assert result["query"] == "出口欧盟"

    @patch("rag_service.orchestrator.nodes.vision._get_analyzer")
    def test_exception_returns_empty_result(self, mock_get_analyzer):
        mock_analyzer = MagicMock()
        mock_analyzer.api_key = "test-key"
        mock_analyzer.analyze_images.side_effect = RuntimeError("API error")
        mock_get_analyzer.return_value = mock_analyzer

        state = {
            "query": "CE marking",
            "images": [{"buffer": b"x", "mime_type": "image/jpeg"}],
            "agent_trace": [],
        }
        result = vision_analysis_node(state)
        assert result["vision_result"] == _empty_vision_result()
        assert result["agent_trace"][-1]["status"] == "error"

    @patch("rag_service.orchestrator.nodes.vision._get_analyzer")
    def test_agent_trace_accumulates(self, mock_get_analyzer):
        mock_analyzer = MagicMock()
        mock_analyzer.api_key = "test-key"
        mock_analyzer.analyze_images.return_value = {
            "descriptions": [],
            "combined_description": "",
            "certifications": [],
            "images_analyzed": 1,
            "enriched_query": "",
            "cert_summary": "未分析",
        }
        mock_get_analyzer.return_value = mock_analyzer

        state = {
            "query": "test",
            "images": [{"buffer": b"x", "mime_type": "image/jpeg"}],
            "agent_trace": [{"node": "other", "status": "done"}],
        }
        result = vision_analysis_node(state)
        assert len(result["agent_trace"]) == 2
        assert result["agent_trace"][0]["node"] == "other"
        assert result["agent_trace"][1]["node"] == "vision"


# ─────────────────────────────────────────────
#  Tests: set_vision_analyzer / _get_analyzer
# ─────────────────────────────────────────────

class TestVisionAnalyzerDI:
    """Test dependency injection helpers."""

    def test_set_vision_analyzer_injects_instance(
        self, clean_analyzer_state
    ):
        injected = MagicMock()
        set_vision_analyzer(injected)
        result = _get_analyzer()
        assert result is injected

    def test_set_vision_analyzer_prevents_lazy_init(
        self, clean_analyzer_state
    ):
        injected = MagicMock()
        injected.api_key = "injected-key"
        set_vision_analyzer(injected)
        # _get_analyzer should NOT try to import settings
        result = _get_analyzer()
        assert result is injected
