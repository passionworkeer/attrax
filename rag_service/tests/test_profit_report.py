"""
Unit tests for generate_profit_report().
Covers: 充电宝, 乒乓球拍, fallback, LLM timeout fallback, and endpoint.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rag_service.generate.report_generator import (
    ReportGenerator,
    _identify_product_type,
    _get_fallback_data,
    PROFIT_REPORT_TEMPLATE,
    _PREBUILT_DATA,
)


# ─── fixtures ──────────────────────────────────────────────────────────────────

CHARGER_CHUNK = {
    "content": "欧盟合规充电宝成本与利润分析：合规模式 BOM $13.50 vs 裸奔模式 $9.20。",
    "doc_name": "EU_Products_欧盟合规充电宝成本与利润分析_docx",
}

PINGPANG_CHUNK = {
    "content": "乒乓球拍欧盟合规成本与利润：合规模式 COGS $35.00，裸奔 $12.00。",
    "doc_name": "EU_Products_乒乓球拍欧盟合规成本与利润_docx",
}

GENERIC_CHUNK = {
    "content": "合规要求 RoHS REACH。",
    "doc_name": "Generic_Compliance",
}


# ─── test: prebuilt data for 充电宝 ───────────────────────────────────────────

def test_profit_report_charging_bank_no_api():
    """充电宝 → 走预置数据通道，无 API 调用，不抛异常。"""
    gen = ReportGenerator(api_key="")
    report = gen.generate_profit_report(
        product_type="充电宝",
        market="EU",
        chunks=[CHARGER_CHUNK],
    )
    assert report is not None
    assert len(report) > 100
    # 预置数据中的关键字段
    assert "$13.50" in report
    assert "$9.20" in report
    assert "$0.71" in report    # barebone GP
    assert "$11.48" in report   # compliant GP
    # 表格结构
    assert "成本对比" in report or "成本对比表" in report
    assert "裸奔模式" in report
    assert "合规模式" in report
    # 结论
    assert "关键结论" in report or "结论" in report
    # 法规引用
    assert "法规引用" in report


# ─── test: prebuilt data for 乒乓球拍 ─────────────────────────────────────────

def test_profit_report_pingpang_no_api():
    """乒乓球拍 → 走预置数据通道。"""
    gen = ReportGenerator(api_key="")
    report = gen.generate_profit_report(
        product_type="乒乓球拍",
        market="EU",
        chunks=[PINGPANG_CHUNK],
    )
    assert report is not None
    assert len(report) > 100
    # 预置关键数字
    assert "$35.00" in report   # compliant BOM
    assert "$12.00" in report   # barebone BOM
    assert "$128.93" in report  # compliant GP
    assert "138%" in report     # premium
    assert "2026" in report     # policy year mentioned
    # 关键结论段落
    assert "合规溢价约 138%" in report
    assert "RAPEX" in report or "海关" in report


# ─── test: fallback for unknown product ──────────────────────────────────────

def test_profit_report_fallback_unknown_product():
    """未知产品 → Fallback 数据，不依赖 API key。"""
    gen = ReportGenerator(api_key="")
    report = gen.generate_profit_report(
        product_type="智能手环",
        market="US",
        chunks=[GENERIC_CHUNK],
    )
    assert report is not None
    assert len(report) > 100
    assert "智能手环" in report
    assert "$18.00" in report   # fallback compliant BOM
    assert "US" in report
    assert "关键结论" in report or "结论" in report


# ─── test: empty chunks still produces report ─────────────────────────────────

def test_profit_report_empty_chunks():
    """空 chunks → Fallback 数据，ReportGenerator 仍能生成报告。"""
    gen = ReportGenerator(api_key="")
    report = gen.generate_profit_report(
        product_type="充电宝",
        market="EU",
        chunks=[],
    )
    assert report is not None
    assert len(report) > 50
    # Should still have fallback structure
    assert "成本" in report or "BOM" in report


# ─── test: LLM timeout returns structured mock ─────────────────────────────────

def test_profit_report_llm_timeout_no_crash():
    """有 API key 但 LLM 超时 → 不崩溃，返回 mock 利润报告。"""
    # Provide a fake API key that will fail
    gen = ReportGenerator(api_key="sk-fake-key-that-will-fail")
    report = gen.generate_profit_report(
        product_type="充电宝",
        market="EU",
        chunks=[CHARGER_CHUNK],
    )
    # Should fall back gracefully
    assert report is not None
    assert len(report) > 50
    assert "成本" in report


# ─── test: _identify_product_type ────────────────────────────────────────────

def test_identify_product_type_from_chunks():
    assert _identify_product_type([CHARGER_CHUNK]) == "充电宝"
    assert _identify_product_type([PINGPANG_CHUNK]) == "乒乓球拍"
    assert _identify_product_type([GENERIC_CHUNK]) == ""
    assert _identify_product_type([]) == ""


# ─── test: fallback data completeness ────────────────────────────────────────

def test_fallback_data_fields():
    """Fallback 数据包含所有模板所需的占位符字段。"""
    data = _get_fallback_data("智能手环", "EU")
    required = [
        "product_name", "product_type", "barebone_bom", "compliant_bom",
        "barebone_total", "compliant_total", "barebone_gp", "compliant_gp",
        "premium_pct", "breakeven_units", "conclusions", "references",
        "compliant_risk", "barebone_risk_adj",
    ]
    for field in required:
        assert field in data, f"Missing field: {field}"


# ─── test: prebuilt data completeness ────────────────────────────────────────

def test_prebuilt_data_fields():
    """预置数据包含所有模板所需的占位符字段。"""
    for ptype, data in _PREBUILT_DATA.items():
        required = [
            "product_name", "barebone_bom", "compliant_bom", "barebone_total",
            "compliant_total", "barebone_gp", "compliant_gp",
            "premium_pct", "breakeven_units", "conclusions", "references",
            "compliant_risk_adj", "barebone_risk_adj",
        ]
        for field in required:
            assert field in data, f"Missing '{field}' in prebuilt data for {ptype}"


# ─── test: template renders all prebuilt products ─────────────────────────────

def test_template_renders_prebuilt():
    """PROFIT_REPORT_TEMPLATE 能完整渲染所有预置产品数据，无 KeyError。"""
    from datetime import date
    for ptype, data in _PREBUILT_DATA.items():
        filled = data.copy()
        filled["market"] = "EU"
        filled["report_date"] = date.today().isoformat()
        rendered = PROFIT_REPORT_TEMPLATE.format(**filled)
        assert len(rendered) > 200, f"Template render too short for {ptype}"
        assert "## [" in rendered
        assert "成本对比" in rendered


# ─── test: generate_with_metadata works ────────────────────────────────────────

def test_generate_with_metadata_profit_report():
    """generate_profit_report 可被 generate_with_metadata 间接调用。"""
    gen = ReportGenerator(api_key="")
    meta = gen.generate_with_metadata(
        query="充电宝合规成本",
        chunks=[CHARGER_CHUNK],
    )
    assert "report" in meta
    assert "chunks_used" in meta
    assert meta["chunks_used"] == 1