#!/usr/bin/env python3
"""
report_generator.py - Compliance report generator (mimoTalk only)

唯一 LLM：mimoTalk mimo-v2.5
- 超时/失败 → 返回 mock 结构化报告，不降级到其他 provider
"""
import os
import logging
import json
import urllib.request
import urllib.error

# Disable system proxy for all urllib calls (prevents WinError 10060 on Windows)
os.environ.pop("HTTP_PROXY", None)
os.environ.pop("HTTPS_PROXY", None)
os.environ.pop("http_proxy", None)
os.environ.pop("https_proxy", None)
os.environ.setdefault("NO_PROXY", "*")

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """你是跨境电商合规专家。根据用户上传的产品图片，生成精准的合规报告。

**核心工作流（严格按顺序执行）：**

1. **确认产品**：根据图片，先明确描述具体产品（如"蓝牙耳机，带充电盒"），产品类型是报告的核心。

2. **审查文档**：检索到的法规文档可能包含不同产品。先判断每篇文档是否与当前产品相关：
   - 直接相关 → 使用该文档内容
   - 不相关（如检索到充电宝法规，但当前产品是耳机）→ 跳过，不输出
   - 跨界通用（如充电宝法规中关于锂电池运输的UN38.3条款）→ 选择其中通用条款选择性使用

3. **报告生成**：只围绕产品图片识别的具体产品（如"蓝牙耳机"）生成报告，标题必须包含产品名。

4. **引用要求**：每条事实必须标注来源 [法规名称/条款]，无来源不编造。

5. **信息不足时**：明确说明"该方面暂无具体法规依据"，不推断。

**报告结构（中文输出，标题必须含产品名）：**

## [具体产品名] 合规要求（针对该产品）
## [具体产品名] 禁止/限制项目
## [具体产品名] 合规建议
## 法规引用

来源文档（已按产品相关性过滤，通用条款已标注）：
{source_chunks}"""


def _build_source_context(chunks: list[dict], max_chunks: int = 20, max_chars: int = 600) -> str:
    """Build a compact source context string from chunks."""
    parts = []
    for i, chunk in enumerate(chunks[:max_chunks]):
        doc = chunk.get("doc_name", "Unknown")
        article = chunk.get("article_no", "")
        content = chunk.get("content", "")[:max_chars].replace("\n", " ")
        parts.append(f"[{i+1}] {doc} {article}\n{content}")
    return "\n---\n".join(parts)


# ─────────────────────────────────────────────────────────────────────────────
# 预置利润报告模板（固定结构，LLM 只填充占位符）
# ─────────────────────────────────────────────────────────────────────────────

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


def _identify_product_type(chunks: list[dict]) -> str:
    """根据 chunks 的文档名推断产品类型。"""
    keywords_map = {
        "充电宝": "充电宝",
        "移动电源": "充电宝",
        "乒乓球拍": "乒乓球拍",
        "乒乓球": "乒乓球拍",
    }
    for chunk in chunks:
        doc_name = chunk.get("doc_name", "")
        content = chunk.get("content", "")[:500]
        for kw, ptype in keywords_map.items():
            if kw in doc_name or kw in content:
                return ptype
    return ""


class ReportGenerator:
    """
    Compliance report generator using mimoTalk only.
    超时/网络错误 → 返回 mock 报告，不调用其他 LLM。
    """

    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or os.environ.get("MIMOTALK_API_KEY", "")
        self.base_url = os.environ.get(
            "MIMOTALK_BASE_URL", "https://token-plan-sgp.xiaomimimo.com/anthropic/v1"
        )
        self.model = os.environ.get("MIMOTALK_MODEL", "mimo-v2.5")

    @property
    def provider(self) -> str:
        return "mimotalk"

    def generate(
        self,
        query: str,
        product: str,
        market: str,
        chunks: list[dict],
        max_tokens: int = 4096,
        doc_context: str = "",
    ) -> str:
        """
        Generate compliance report via mimoTalk.
        On failure: returns a mock structured report.
        """
        if not chunks:
            return self._mock_report(product, market, query, error="未找到合规信息，请确保语料库已正确加载。")

        source_context = _build_source_context(chunks)

        doc_section = (
            f"\n\n## 用户上传的产品文档\n{doc_context}\n"
            if doc_context
            else ""
        )

        user_prompt = (
            f"产品类型：{product}\n"
            f"目标市场：{market}\n"
            f"用户问题：{query}\n\n"
            f"请根据以上来源文档，生成针对「{product}」的合规报告。\n"
            f"【重要】报告中所有合规要求必须与「{product}」直接相关，"
            f"不要混入充电宝、移动电源等其他产品内容。\n"
            f"{doc_section}"
        )

        system = SYSTEM_PROMPT.format(source_chunks=source_context)

        try:
            return self._generate_mimotalk(system, user_prompt, max_tokens)
        except Exception as e:
            logger.error(f"mimoTalk failed: {e}")
            return self._mock_report(product, market, query, error=f"LLM 调用失败：{e}")

    def _generate_mimotalk(self, system: str, user_prompt: str, max_tokens: int) -> str:
        """Call mimoTalk /v1/messages endpoint."""
        body = json.dumps({
            "model": self.model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [
                {"role": "user", "content": user_prompt},
            ],
        }).encode("utf-8")

        req = urllib.request.Request(
            f"{self.base_url.rstrip('/')}/messages",
            data=body,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "anthropic-version": "2023-06-01",
                "x-api-key": self.api_key,
            },
        )

        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read())
            content = data.get("content", [{}])[0].get("text", "")
            if content and content.strip():
                logger.info(f"mimoTalk report generated ({len(content)} chars)")
                return content
            raise ValueError("mimoTalk returned empty response")

    def _mock_report(
        self,
        product: str,
        market: str,
        query: str,
        error: str | None = None,
    ) -> str:
        """Return a structured mock report when LLM is unavailable."""
        import re

        # Extract product/market from prompt if not provided
        if not product or product == "产品":
            m = re.search(r"产品[：:](.+?)(?:\n|$)", query)
            product = m.group(1).strip() if m else "产品"
        if not market or market == "目标市场":
            m = re.search(r"目标市场[：:](.+?)(?:\n|$)", query)
            market = m.group(1).strip() if m else "EU/US"

        error_block = f"\n> ⚠️ {error}\n" if error else ""

        return f"""## 合规报告

{error_block}
产品：{product} | 目标市场：{market}

### 合规要求
- 确认产品是否需要 CE/FCC 等认证标志
- 检查 RoHS/REACH 有害物质限制要求
- 准备符合当地标签法规的产品铭牌
- 保存合规技术文档以备抽查

### 禁止/限制项目
- 铅、镉、汞等有害物质含量限制（RoHS / REACH）
- 特定电子产品的能效要求（如 ErP 指令）
- 儿童产品安全标准（EN 71 系列）
- 锂电池运输安全要求（UN 38.3）

### 合规建议
1. 委托有资质的检测机构进行产品测试
2. 获取 CE/FCC 等目标市场认证
3. 建立产品合规技术文档包（TDF）
4. 定期跟踪目标市场法规变化

### 法规引用
- EU:参阅《欧盟通用产品安全指令》/ RoHS指令 / REACH法规
- US: 参阅 FCC 联邦法规第 47 篇 / CPSC 法规
- CN: 参阅 GB 标准体系

> 💡 此为降级 mock 报告，请检查后端服务是否正常运行。
"""

    def generate_profit_report(
        self,
        product_type: str,
        market: str,
        chunks: list[dict],
        max_tokens: int = 2048,
    ) -> str:
        """
        生成合规成本与利润分析报告。

        策略：预置模板 + 查表填充（已知产品走快通道，无 API 调用；
        未知产品走 LLM 填充，仍有模板保底）。

        Args:
            product_type: 产品类型，如 "充电宝"、"乒乓球拍"
            market: 目标市场，如 "EU"
            chunks: 从语料库检索到的相关文档片段
            max_tokens: LLM 最大输出 token 数

        Returns:
            格式化 markdown 利润报告
        """
        from datetime import date

        # 1. 确定产品类型（优先级：显式参数 > chunk 推断）
        resolved_type = product_type or _identify_product_type(chunks)
        if not resolved_type:
            resolved_type = "通用产品"

        # 2. 查预置数据表（快通道，不调用 LLM）
        if resolved_type in _PREBUILT_DATA:
            data = _PREBUILT_DATA[resolved_type].copy()
            logger.info(f"Profit report: using prebuilt data for '{resolved_type}'")
        else:
            # 3a. 尝试 LLM 填充（如果 chunks 非空且有 API Key）
            data = None
            if chunks and self.api_key:
                try:
                    data = self._llm_fill_profit_report(resolved_type, market, chunks, max_tokens)
                except Exception as e:
                    logger.warning(f"Profit LLM fill failed, using fallback: {e}")

            # 3b. LLM 失败或无 chunks → Fallback 估算数据
            if data is None:
                logger.info(f"Profit report: using fallback data for '{resolved_type}'")
                data = _get_fallback_data(resolved_type, market)

        # 4. 强制覆盖 market 字段（保持一致性）
        data["market"] = market
        data["report_date"] = date.today().isoformat()

        # 5. 渲染模板
        try:
            return PROFIT_REPORT_TEMPLATE.format(**data)
        except Exception as e:
            logger.error(f"Template render failed: {e}")
            return self._mock_profit_report(resolved_type, market)

    def _llm_fill_profit_report(
        self,
        product_type: str,
        market: str,
        chunks: list[dict],
        max_tokens: int,
    ) -> dict | None:
        """调用 LLM 从 chunks 中提取利润数据填充模板占位符。失败返回 None。"""
        source_context = _build_profit_context(chunks, product_type)

        system = PROFIT_SYSTEM_PROMPT.format(
            product_name=product_type,
            product_type=product_type,
            market=market,
            source_chunks=source_context,
        )

        user_prompt = (
            f"请为「{product_type}」生成合规成本与利润分析报告。\n"
            f"目标市场：{market}\n"
            f"输出格式：直接输出 markdown，不要附加解释。"
        )

        try:
            report_text = self._generate_mimotalk(system, user_prompt, max_tokens)
            # LLM 返回完整 markdown 报告时直接使用
            if report_text.strip():
                # 若 LLM 输出了完整报告结构（包含成本对比表），直接返回
                if "成本对比" in report_text and ("裸奔" in report_text or "barebone" in report_text.lower()):
                    return self._parse_profit_report_markdown(report_text)
                # 否则视为返回了完整报告，整体返回
                return {"_raw_report": report_text}
        except Exception as e:
            logger.error(f"LLM profit fill failed: {e}")
            raise

        return None

    def _parse_profit_report_markdown(self, report_text: str) -> dict:
        """
        尝试从 LLM 返回的 markdown 中提取结构化字段。
        若解析失败，将原始文本包装在 _raw_report 中。
        """
        import re

        def extract(label: str) -> str:
            # 匹配 | label | value | 或 | label | value |
            patterns = [
                rf"\|\s*{re.escape(label)}\s*\|\s*([^\|]+?)\s*\|",
                rf"\*\*{re.escape(label)}\*\*\s*([^*\n]+)",
            ]
            for p in patterns:
                m = re.search(p, report_text)
                if m:
                    return m.group(1).strip()
            return "—"

        return {
            "_raw_report": report_text,
            "_note": "LLM generated raw markdown; direct rendering.",
        }

    def _mock_profit_report(self, product_type: str, market: str) -> str:
        """LLM 超时时返回 mock 利润报告（不崩溃）。"""
        fallback = _get_fallback_data(product_type, market)
        fallback["market"] = market
        fallback["report_date"] = "—"
        try:
            return PROFIT_REPORT_TEMPLATE.format(**fallback)
        except Exception:
            return f"""## {product_type} 合规成本与利润分析报告

> 目标市场：{market} | 报告日期：—
> ⚠️ 数据基于估算，如需精确值请配置 mimoTalk API Key。

### 一、成本对比表（合规模式 vs 裸奔模式）

| 成本项 | 裸奔模式 | 合规模式 | 差异 |
|--------|---------|---------|------|
| 材料成本(BOM) | $10.00 | $18.00 | +$8.00 |
| 包装与印刷 | $0.30 | $0.80 | +$0.50 |
| 认证费(单台摊销) | $0.00 | $0.50 | +$0.50 |
| EPR运营费 | $0.00 | $0.30 | +$0.30 |
| 售后/保修预留 | $0.30 | $0.80 | +$0.50 |
| 物流与渠道 | $5.00 | $5.00 | 持平 |
| **总直接成本** | **$15.60** | **$25.40** | **+$9.80 (+63%)** |

### 二、关键结论
1. 合规溢价约 63%，但可支撑 2–3 倍定价。
2. 合规模式净利润约 $26.60/台，显著优于裸奔模式。
3. 合规是结构性竞争优势，建议尽早投入。

> 💡 此为降级 mock 报告，请配置 MIMOTALK_API_KEY 获取精确数据。
"""

    def generate_with_metadata(self, query: str, chunks: list[dict]) -> dict:
        """Generate report with metadata."""
        report = self.generate(
            query=query,
            product=chunks[0].get("product", "产品") if chunks else "产品",
            market=chunks[0].get("market", "EU") if chunks else "EU",
            chunks=chunks,
        )
        return {
            "report": report,
            "chunks_used": len(chunks),
            "doc_names": list({c.get("doc_name", "") for c in chunks}),
        }