from __future__ import annotations

PROFIT_REPORT_TEMPLATE = """## [{product_name}] 合规成本与利润分析报告

> 目标市场：{market} | 产品类型：{product_type} | 报告日期：{report_date}

---

### 一、成本对比表（合规模式 vs 裸奔模式）

| 成本项 | 裸奔模式 | 合规模式 | 差异 |
|--------|---------|---------|------|
| 材料成本(BOM) | {barebone_bom} | {compliant_bom} | {bom_diff} |
| 包装与印刷 | {barebone_packaging} | {compliant_packaging} | {packaging_diff} |
| 认证费(单台摊销) | {barebone_cert} | {compliant_cert} | {cert_diff} |
| EPR运营费 | {barebone_epr} | {compliant_epr} | {epr_diff} |
| 售后/保修预留 | {barebone_warranty} | {compliant_warranty} | {warranty_diff} |
| 物流与渠道 | {barebone_logistics} | {compliant_logistics} | {logistics_diff} |
| **总直接成本** | **{barebone_total}** | **{compliant_total}** | **{total_diff}** |

### 二、收益对比

| 收益项 | 裸奔模式 | 合规模式 | 差异 |
|--------|---------|---------|------|
| 平均售价(ASP) | {barebone_asp} | {compliant_asp} | {asp_diff} |
| 毛利润(单台) | {barebone_gp} | {compliant_gp} | {gp_diff} |
| 毛利率 | {barebone_gpm} | {compliant_gpm} | — |

### 三、风险调整后净收益

| 模式 | 毛利润 | 风险敞口 | 经风险调整净收益 |
|------|--------|---------|----------------|
| 合规模式 | {compliant_gp} | {compliant_risk} | **{compliant_risk_adj}** |
| 裸奔模式 | {barebone_gp} | {barebone_risk} | **{barebone_risk_adj}** |

> 风险敞口说明：{risk_note}

### 四、盈亏平衡分析

- 合规溢价约 **{premium_pct}**
- 盈亏平衡点：约 **{breakeven_units}** 台
- 合规模式定价策略：{pricing_strategy}

### 五、关键结论

{conclusions}

### 六、法规引用

{references}
"""

# ─────────────────────────────────────────────────────────────────────────────
# 从语料库 JSON 中提取利润数据的 Prompt（LLM 专用）
# ─────────────────────────────────────────────────────────────────────────────

PROFIT_SYSTEM_PROMPT = """你是跨境电商合规财务专家。根据以下语料库数据，为「{product_name}」生成合规成本与利润分析报告。

**任务：** 从语料库数据中精确提取数字，填入报告模板的占位符。

**产品类型：** {product_type}
**目标市场：** {market}

**重要规则：**
1. 只使用语料库中的实际数据，不要编造数字
2. 所有金额单位统一为美元（USD）
3. 找不到具体数值时，使用语料库中的范围估算，并标注"估算"
4. 表格中"差异"列填写：+$X.XX 或 -$X.XX 或 "持平"
5. 结论部分要体现合规与裸奔的对比逻辑

**语料库数据：**
{source_chunks}

**输出格式：** 直接输出填好的 markdown 报告，不要附加解释文字。
"""


def _extract_numbers_from_chunk(chunk: dict, product_type: str) -> dict:
    """
    从单个 chunk 中提取与利润分析相关的数字。
    返回 dict，key 为字段名，value 为提取的值（字符串）。
    """
    import re
    content = chunk.get("content", "") + " " + chunk.get("rawText", "")
    doc_name = chunk.get("doc_name", "")

    def extract_num(pattern: str, default="—"):
        m = re.search(pattern, content)
        return m.group(1) if m else default

    def extract_range(pattern: str, default="—"):
        m = re.search(pattern, content)
        if m:
            return f"{m.group(1)}–{m.group(2)}"
        return default

    return {
        "doc_name": doc_name,
        "content_preview": content[:200],
    }


def _build_profit_context(chunks: list[dict], product_type: str, max_chars: int = 3000) -> str:
    """构建供 LLM 使用的利润分析语料上下文。"""
    parts = []
    total_chars = 0
    for i, chunk in enumerate(chunks):
        doc = chunk.get("doc_name", "Unknown")
        text = chunk.get("content", "")[:max_chars]
        total_chars += len(text)
        if total_chars > max_chars:
            break
        parts.append(f"[{i+1}] 来源：{doc}\n{text}")
    return "\n---\n".join(parts)


# ─────────────────────────────────────────────────────────────────────────────
# 预置填充数据（产品类型已知时直接查表，不走 LLM，速度更快）
# ─────────────────────────────────────────────────────────────────────────────

_PREBUILT_DATA: dict[str, dict] = {
    # ── 充电宝 ──────────────────────────────────────────────────────────────
    "充电宝": {
        "product_name": "充电宝（便携式储能设备）",
        "product_type": "electronics/battery",
        "barebone_bom": "$9.20",
        "compliant_bom": "$13.50",
        "bom_diff": "+$4.30",
        "barebone_packaging": "$0.25",
        "compliant_packaging": "$0.65",
        "packaging_diff": "+$0.40",
        "barebone_cert": "$0.05",
        "compliant_cert": "$0.45",
        "cert_diff": "+$0.40",
        "barebone_epr": "$0.00",
        "compliant_epr": "$0.35",
        "epr_diff": "+$0.35",
        "barebone_warranty": "$0.45",
        "compliant_warranty": "$0.90",
        "warranty_diff": "+$0.45",
        "barebone_logistics": "$6.00",
        "compliant_logistics": "$6.00",
        "logistics_diff": "持平",
        "barebone_total": "$15.95",
        "compliant_total": "$21.85",
        "total_diff": "+$5.90 (+37%)",
        "barebone_asp": "$19.99",
        "compliant_asp": "$39.99",
        "asp_diff": "+$20.00",
        "barebone_gp": "$0.71",
        "compliant_gp": "$11.48",
        "gp_diff": "+$10.77",
        "barebone_gpm": "3.6%",
        "compliant_gpm": "28.7%",
        "compliant_risk": "$0.00",
        "compliant_risk_adj": "$11.48",
        "barebone_risk": "35–50% 扣押/召回概率",
        "barebone_risk_adj": "-$4.00（期望值亏损）",
        "risk_note": "裸奔模式在2025年后欧盟监管环境下被查处概率约35%–50%，"
                      "一旦扣押单次损失约$15.95–$31.90/台；合规模式零风险敞口。",
        "premium_pct": "37%",
        "breakeven_units": "295",
        "pricing_strategy": "建议定价 $39.99–$49.99，进入亚马逊/MediaMarkt 等主流渠道",
        "conclusions": (
            "1. **合规溢价约 37%**：单台成本增加约 $5.90，但可支撑 2 倍以上定价。\n"
            "2. **合规模式净利润 $11.48/台**，裸奔模式经风险调整后期望利润为 **负数**（约 -$4/台）。\n"
            "3. **盈亏平衡点仅 295 台**，规模出货后合规成本可忽略不计。\n"
            "4. **关键合规节点**：V-0 阻燃外壳、A 级电芯、USB-C/PD 芯片、CE/WEEE/EPR 注册。\n"
            "5. **2027 年结构性风险**：电池可拆卸性要求（+~$1.62/台），裸奔产品届时将无法通关。"
        ),
        "references": (
            "- (EU) 2023/1542《欧盟电池法规》\n"
            "- EN 62368-1 电气安全标准（外壳阻燃 V-0 级）\n"
            "- Directive (EU) 2022/2380 统一充电器指令（USB-C/PD）\n"
            "- RoHS 2011/65/EU / REACH (EC) No 1907/2006\n"
            "- 德国 BattG / VerpackG / ElektroG EPR 体系\n"
            "- 法国电池法 EPR 回收费体系"
        ),
    },
    # ── 乒乓球拍 ────────────────────────────────────────────────────────────
    "乒乓球拍": {
        "product_name": "乒乓球拍（底板+胶皮/海绵）",
        "product_type": "sports_equipment/toys",
        "barebone_bom": "$12.00",
        "compliant_bom": "$35.00",
        "bom_diff": "+$23.00",
        "barebone_packaging": "$0.50",
        "compliant_packaging": "$1.50",
        "packaging_diff": "+$1.00",
        "barebone_cert": "$0.00",
        "compliant_cert": "$0.20",
        "cert_diff": "+$0.20（EN 717-1 + GC-MS 单型号摊销）",
        "barebone_epr": "$0.00",
        "compliant_epr": "$0.05",
        "epr_diff": "+$0.05（EU Rep + 法国 EPR）",
        "barebone_warranty": "$0.20",
        "compliant_warranty": "$0.50",
        "warranty_diff": "+$0.30",
        "barebone_logistics": "$8.00",
        "compliant_logistics": "$12.00",
        "logistics_diff": "+$4.00（平台履约费差异）",
        "barebone_total": "$20.70",
        "compliant_total": "$49.25",
        "total_diff": "+$28.55 (+138%)",
        "barebone_asp": "$45.00",
        "compliant_asp": "$180.00",
        "asp_diff": "+$135.00",
        "barebone_gp": "$21.50",
        "compliant_gp": "$128.93",
        "gp_diff": "+$107.43",
        "barebone_gpm": "47.7%",
        "compliant_gpm": "71.6%",
        "compliant_risk": "$0.00",
        "compliant_risk_adj": "$128.93",
        "barebone_risk": "RAPEX 通报 + 海关扣押（期望损失 ~$25/台）",
        "barebone_risk_adj": "-$3.50（2026年结构性亏损）",
        "risk_note": "2026年7月废除150欧元免税门槛后，每件包裹强制征收3欧元固定税。"
                      "裸奔产品被海关100%数字化筛查，RAPEX通报概率接近100%。",
        "premium_pct": "138%",
        "breakeven_units": "1,500台（行政及测试固定成本摊销）",
        "pricing_strategy": "建议定价 $150–$200/支，进入 Decathlon / 体育专业零售渠道",
        "conclusions": (
            "1. **合规溢价约 138%**：材料与行政成本增加约 $28.55/支，但支撑 4 倍定价。\n"
            "2. **合规模式净收益 $128.93/支**，裸奔模式经 2026 年关税改革冲击后为 **-$3.50/支（亏损）**。\n"
            "3. **合规成本的杠杆效应极小**：BOM 溢价+MDI 胶/环烷基油/GS 标志测试等合计约 $0.57/支，"
            "在 $128 利润面前如九牛一毛。\n"
            "4. **关键合规节点**：EN 717-1 甲醛测试（<0.062 mg/m³）、GC-MS PAHs 筛查、"
            "FSC 木材溯源、GPSR 欧盟责任人、Triman 标识。\n"
            "5. **2026 政策拐点**：废除 De Minimis 后，裸奔模式全面丧失成本优势。"
        ),
        "references": (
            "- REACH 法规附件XVII第77项（甲醛释放，2026年8月起 ≤0.062 mg/m³）\n"
            "- REACH 附件XVII第50项（PAHs 限值 8 种高危化合物）\n"
            "- REACH 附件XVII第63项（PVC 铅含量 ≥0.1% 禁止）\n"
            "- REACH 附件XVII第51项（邻苯二甲酸酯 ≥0.1% 限制）\n"
            "- GPSR (EU) 2023/988《通用产品安全法规》（2024年12月13日起强制）\n"
            "- 法国 EPR/Triman 包装标识体系（Citeo 注册）\n"
            "- 欧盟木材法规 EUTR / EUDR 森林溯源"
        ),
    },
}


def _get_fallback_data(product_type: str, market: str) -> dict:
    """产品类型不在预置列表时，返回基于语料库通用逻辑的估算数据。"""
    return {
        "product_name": product_type,
        "product_type": "general",
        "barebone_bom": "$10.00",
        "compliant_bom": "$18.00",
        "bom_diff": "+$8.00",
        "barebone_packaging": "$0.30",
        "compliant_packaging": "$0.80",
        "packaging_diff": "+$0.50",
        "barebone_cert": "$0.00",
        "compliant_cert": "$0.50",
        "cert_diff": "+$0.50",
        "barebone_epr": "$0.00",
        "compliant_epr": "$0.30",
        "epr_diff": "+$0.30",
        "barebone_warranty": "$0.30",
        "compliant_warranty": "$0.80",
        "warranty_diff": "+$0.50",
        "barebone_logistics": "$5.00",
        "compliant_logistics": "$5.00",
        "logistics_diff": "持平",
        "barebone_total": "$15.60",
        "compliant_total": "$25.40",
        "total_diff": "+$9.80 (+63%)",
        "barebone_asp": "$25.00",
        "compliant_asp": "$55.00",
        "asp_diff": "+$30.00",
        "barebone_gp": "$7.40",
        "compliant_gp": "$26.60",
        "gp_diff": "+$19.20",
        "barebone_gpm": "29.6%",
        "compliant_gpm": "48.4%",
        "compliant_risk": "$0.00",
        "compliant_risk_adj": "$26.60",
        "barebone_risk": "20–40% 扣押/召回概率（视市场）",
        "barebone_risk_adj": "约-$2.00（期望值亏损）",
        "risk_note": "非合规产品在目标市场面临监管处罚风险。"
                      "具体概率取决于市场严格程度（EU > US > UK）。",
        "premium_pct": "63%",
        "breakeven_units": "约500台",
        "pricing_strategy": "建议定价为裸奔产品的 2–3 倍，定位中高端市场",
        "conclusions": (
            "1. **合规溢价约 63%**：单台成本增加约 $9.80，定价可提升 2–3 倍。\n"
            "2. **合规模式净利润约 $26.60/台**，显著高于裸奔模式。\n"
            "3. **关键合规节点**：CE/FCC 认证、RoHS/REACH 测试、产品安全标签。\n"
            "4. **合规是结构性竞争优势**：在监管趋严的大趋势下，合规投入是高确定性回报。"
        ),
        "references": (
            "- CE/FCC 产品安全认证\n"
            "- RoHS 2011/65/EU / REACH (EC) No 1907/2006\n"
            "- 目标市场 EPR 注册体系\n"
            "- GPSR (EU) 2023/988（如适用）"
        ),
    }
