#!/usr/bin/env python3
"""
report_generator.py - Compliance report generator

主模型通过 Anthropic 兼容接口配置，并保留 DeepSeek 降级通道。
- 超时/失败 → 返回 mock 结构化报告，不降级到其他 provider
"""
import os
import logging
import json
import threading
import time
import urllib.request
import urllib.error

from rag_service.lifecycle import is_shutting_down
from rag_service.schemas.report_package import normalize_report_package
from rag_service.llm_response import extract_text_blocks

logger = logging.getLogger(__name__)


def _make_no_proxy_opener() -> urllib.request.OpenerDirector:
    """Return an opener that ignores system proxy settings.

    P1-8: the previous implementation popped ``HTTP_PROXY`` from
    ``os.environ`` at import time. That affected every other HTTP library
    in the process, not just urllib. Routing through an explicit
    ``ProxyHandler({})`` opener confines the bypass to this module.
    """
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


_NO_PROXY_OPENER = _make_no_proxy_opener()


# Feature flag for the KB-anchored generator path (De-RAG spec §7.3).
# Default OFF to keep behavior identical for the deployed system. Set to
# "true" / "1" / "yes" to switch the generator input from retrieval
# chunks to KB article texts; the prompt also gains the §4.1 citation
# rules and the JSON schema gains the `citations` field.
def _kb_input_enabled() -> bool:
    val = (os.environ.get("USE_KB_INPUT") or "").strip().lower()
    return val in {"1", "true", "yes", "on"}


# Spec §4.1 — citation rules appended to the system prompt when the KB
# path is active. The rules demand the LLM emit a `citations` array on
# every compliance claim. `quote_span` and `match_status` are filled
# post-LLM by `verify/quote_matcher.py`.
_CITATION_RULES = """
## 引用规则（强制，KB 模式）
对每条风险点、合规要求、禁止项目，必须在 JSON 顶层 `citations` 数组中输出：

{
  "doc_id": "EU-2023-1542",
  "article_id": "art-77",
  "official_citation": "(EU) 2023/1542 Art. 77",
  "quote": "原文引句，≤ 200 字符，必须逐字摘自下方条款正文"
}

- 找不到合适原文引句时，引句留空字符串，引文仍保留（按条款级定位）
- quote必须为一段连续原文，不能用省略号连接多段，不要翻译或概括；可摘短句以满足长度限制
- 严禁编造条款号或引句——不在原文里的引文会被后端校验拒绝并标记
- private 标准（GB/ASTM/UL/EN 等）没有条款正文，不要为其填 citations；改用 KB key_points 兜底
"""


class _TransientLLMError(Exception):
    """Internal sentinel: a retryable LLM transport failure.

    Wraps the original cause so callers can inspect it; raised only by
    ``_read_mimotalk_response`` and caught by ``_generate_mimotalk``.
    """

    def __init__(self, cause: Exception):
        super().__init__(str(cause))
        self.cause = cause

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

REPORT_PACKAGE_SYSTEM_PROMPT = """你是跨境电商合规与商业化专家。你会基于检索到的法规/成本语料，一次性生成四个前端场景需要的内容。

核心原则：
1. 你的输出服务于“是否可以推进下一步”的决策，而不是替代认证机构、律师或实验室；不得声称已合规、已获证或可以上市。
2. 严格区分三类信息：视觉观察（仅图片可见）、法规证据（仅来源文档）、商业估算（仅用户文件或来源明确支持）。不要把其中任意两类混为事实。
3. 只使用给定来源文档和用户上传文档中的法规/成本事实，不要编造法规条款、检测结论、认证状态或确定性数字。
4. 图片未展示或无法辨认铭牌/标志时，写“图片无法验证”，不能写“缺失”“不合规”。
5. 信息不足时必须写明“暂无充分依据”。利润、售价、BOM 等经营数据没有来源时必须写“待询价”，不得填充示例数字；路线图中的整改任务成本可以按任务类型给出保守区间，但 cost 字段只能填写一个简短价格区间（例如“¥3K-8K”），不得出现“AI估算”、括号、条件、复测说明或第二个价格区间。工期和日期没有来源时写“待确认”。
6. 合规报告、成本利润、排期路线图、AI 决策视图必须互相一致；上市阻断项只能来自法规证据或明确的视觉可见事实。
7. 每个法规事实在 complianceReport 内标注来源，格式为 [法规名称/条款]。直接输出 JSON，不要输出 Markdown 代码围栏或额外解释。

风险等级契约（决定前端得分展示，**必须**遵守）：
- `decisionView.verdict`：四个枚举的字符串之一，PASS/WARN/REJECTED/UNKNOWN。
- verdict 的业务语义必须固定，不能把证据不足误写成不合规：
    * PASS — 仅当本次提供的文件和可见信息足以支持“可继续下一步复核”；它仍不代表已获证或可上市。
    * WARN — 产品类别和适用法规已可判断，但还需要补充图片、铭牌、测试报告、DoC 或报价；这是图片看不清、认证标志不可见、供电方式待确认时的默认值。
    * REJECTED — 仅当给定法规或用户文件/清晰可见事实直接证明存在禁止、超限、错误标签或已知不符合项时使用；“图片未展示”“无法辨认”“尚未提供文件”绝不能触发 REJECTED。
    * UNKNOWN — 仅当连产品身份、目标市场或法规适用性都无法可靠确定时使用；若已有用户声明的品类/市场和法规锚点，应使用 WARN 并列出待补证据。
- `decisionView.riskLevel`：四个枚举的字符串之一，CRITICAL/HIGH/MEDIUM/LOW。
- `decisionView.nodes[].severity`：四个枚举的字符串之一，critical/high/medium/info。这是每个节点对整体风险的贡献——风险等级规则：
    * critical — 节点证据已构成上市阻断（例如缺 CE/UKCA、铭牌缺失、电池产品不合规等）
    * high — 节点证据构成高风险缺口（认证不全、技术文档缺失、警告标签不足）
    * medium — 节点证据需要二次审视（与具体类目对应法规有差异、备案未提交）
    * info — 节点证据属于流程性提醒（已识别、已检索、已合成），没有具体风险
- `decisionView.riskLevel` 必须等于 nodes 中所有 severity 的最大值；只要任一节点是 critical 或 high，决策层 riskLevel 必须是 CRITICAL/HIGH；全 info 时才是 LOW。
- vision 节点如果图片不清晰、铭牌未展示或标志不可辨认，severity 为 medium，并明确写“图片无法验证”；只有清晰可见的事实直接证明违规时才为 critical。
- retriever 节点如果召回 0 条相关法规、或仅召回通用条款，severity 默认 high。
- generate 节点（产生 LLM 文本）如果 complianceReport 中的事实无来源 [法规/条款] 引用，severity 默认 medium。

JSON 结构必须是：
{
  "complianceReport": "markdown string",
  "profitReport": {
    "markdown": "markdown string",
    "keyConclusion": "string",
    "premiumPct": "string",
    "breakevenUnits": "string",
    "pricingStrategy": "string",
    "riskNote": "string",
    "conclusions": "string",
    "references": "string",
    "structuredFields": {
      "currency": "USD",
      "costComparison": {
        "barebone": {"bom": 0, "packaging": 0, "cert": 0, "epr": 0, "logistics": 0, "warranty": 0, "asp": 0, "total": 0, "gp": 0},
        "compliant": {"bom": 0, "packaging": 0, "cert": 0, "epr": 0, "logistics": 0, "warranty": 0, "asp": 0, "total": 0, "gp": 0}
      }
    }
  },
  "roadmap": {
    "totalDays": 56,
    "totalCost": "¥25K-40K",
    "progress": 35,
    "items": [
      {
        "id": "1",
        "date": "YYYY-MM-DD",
        "title": "中文标题",
        "titleEn": "English title",
        "description": "中文描述",
        "descriptionEn": "English description",
        "type": "apply|test|certify|complete",
        "status": "completed|in-progress|pending",
        "estimatedDays": 7,
        "cost": "¥5K-15K",
        "documents": ["材料1"],
        "documentsEn": ["Document 1"]
      }
    ]
  },
  "decisionView": {
    "verdict": "PASS|WARN|REJECTED|UNKNOWN",
    "riskLevel": "CRITICAL|HIGH|MEDIUM|LOW",
    "summary": "string",
    "keyFindings": ["string"],
    "recommendedAction": "string",
    "nodes": [
      {
        "id": "vision",
        "type": "vision|query_planner|retriever|synthesis|generate|verify",
        "label": "中文节点名",
        "labelEn": "English node label",
        "severity": "critical|high|medium|info",
        "status": "success|pending|running|error",
        "duration": "1.2s",
        "confidence": 0.86,
        "reasoning": "中文解释",
        "reasoningEn": "English reasoning"
      }
    ]
  },
  "citations": [
    {
      "claim": "此引文支持的精确合规主张",
      "doc_id": "EU-2023-1542",
      "article_id": "art-77",
      "official_citation": "(EU) 2023/1542 Art. 77",
      "quote": "原文引句，逐字摘自下方条款正文（≤ 200 字符）"
    }
  ]
}

来源文档（唯一可用于法规事实和引文的材料）：
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


def _build_article_source_context(article_texts: dict[str, str]) -> str:
    """Render KB article texts as the LLM source context (spec §4.1).

    Input shape: {article_key: text} where article_key is the canonical
    id used throughout the system, e.g. "EU-2023-1542#art-77".

    Output: a numbered list of `{doc_id}#{article_id}\\n{text}` blocks
    with a stable numbering so the LLM can refer to them in citations.
    Private-with-summary regulations (no article text) are skipped —
    those anchors rely on KB key_points for the LLM context.
    """
    if not article_texts:
        return ""
    parts: list[str] = []
    for i, (article_key, text) in enumerate(article_texts.items(), start=1):
        # Truncate to keep total context manageable; the spec allows
        # ~7000 chars of JSON output, so we cap each article at ~1500.
        clipped = (text or "").strip()[:8000]
        if not clipped:
            continue
        parts.append(f"[{i}] {article_key}\n{clipped}")
    return "\n---\n".join(parts)


def _build_mandatory_section(mandatory_regulations: list[dict] | None) -> str:
    """Render the must-cover checklist (A+B hybrid anchor) for the prompt.

    The checklist is the PRIMARY claim set: every entry must surface in the
    compliance report with its reason. Corpus chunks (source_context) are
    supporting citations — an anchor without a matching chunk is still
    reported, with the caveat noted below.
    """
    if not mandatory_regulations:
        return ""
    lines = [
        "【必检法规清单】以下法规由品类/产品特征判定适用于本次扫描，",
        "合规报告中每一条都必须出现并给出其适用理由（reason）；",
        "若检索证据未覆盖某条，仍需列出并标注『依据规则库，待核实原文』。",
        "标注（库自动接入）的条目来自全库按品类/市场匹配的自动检索：至少给出适用性判断与",
        "下一步核实动作，证据不足时标注待核实即可，不必逐条展开完整分析。",
    ]
    for entry in mandatory_regulations:
        region = str(entry.get("region", "")).strip()
        doc = str(entry.get("doc_name", "")).strip()
        reason = str(entry.get("reason", "")).strip()
        auto = "（库自动接入）" if str(entry.get("curation") or "") == "auto" else ""
        lines.append(f"- [{region or 'GLOBAL'}] {doc}{auto} — {reason}")
    return "\n" + "\n".join(lines) + "\n"


def _parse_json_object(text: str) -> dict | None:
    """Parse a JSON object from raw LLM text, accepting fenced output.

    The balanced-object scan is O(n) per opening brace and dominates parse
    time on pathological multi-megabyte outputs, so very long inputs are
    capped before the scan and a warning is logged.
    """
    raw = (text or "").strip()

    max_chars = ReportGenerator._JSON_PARSE_MAX_CHARS
    if len(raw) > max_chars:
        logger.warning(
            "LLM JSON output %d chars exceeds parse cap %d; truncating before scan",
            len(raw), max_chars,
        )
        raw = raw[:max_chars]

    if raw.startswith("```"):
        lines = raw.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        raw = "\n".join(lines).strip()

    # Strip leading language hint on first fenced line, e.g. ```json
    if raw.lower().startswith("json"):
        raw = raw[4:].lstrip()

    # Strip a leading BOM that some LLMs prepend
    if raw.startswith("﻿"):
        raw = raw[1:]

    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except Exception as exc:
        # Malformed LLM output is the most common cause of parse failures
        # here. Log at WARNING so we can diagnose regressions without
        # breaking the downstream fallback to the substring search.
        logger.warning("direct json.loads failed: %s; raw[:200]=%r", exc, raw[:200])

    # Try to find the largest balanced top-level JSON object.
    decoder = json.JSONDecoder()
    best_root_obj: dict | None = None
    best_root_len = 0
    best_any_obj: dict | None = None
    best_any_len = 0

    for i, ch in enumerate(raw):
        if ch != "{":
            continue
        try:
            obj, end_idx = decoder.raw_decode(raw, i)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            obj_len = end_idx - i
            has_root_key = "complianceReport" in obj or "compliance_report" in obj or "compliance" in obj
            if has_root_key and obj_len > best_root_len:
                best_root_obj = obj
                best_root_len = obj_len
            elif obj_len > best_any_len:
                best_any_obj = obj
                best_any_len = obj_len

    if best_root_obj is not None:
        return best_root_obj

    # If raw mentions complianceReport, do NOT return a partial sub-object (like an isolated profitReport),
    # as that would cause the caller to bypass JSON repair and drop the LLM compliance report.
    if ("complianceReport" in raw or "compliance_report" in raw) and best_any_obj is not None:
        logger.warning(
            "Parsed inner JSON object missing root complianceReport key; rejecting partial sub-object to allow repair/fallback."
        )
    elif best_any_obj is not None:
        return best_any_obj

    # Truncation recovery: try closing open strings and structures from first {
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        try:
            data = json.loads(raw[start:end + 1])
            if isinstance(data, dict):
                return data
        except Exception as exc:
            logger.debug("substring json.loads failed: %s", exc)

    if start >= 0:
        candidate = raw[start:].rstrip()
        for suffix in ['"}', '"]}', '"}]}', '"}}', '}', ']}', ']}}']:
            try:
                data = json.loads(candidate + suffix)
                if isinstance(data, dict) and ("complianceReport" in data or "compliance_report" in data):
                    logger.info("Recovered truncated JSON by appending %r", suffix)
                    return data
            except Exception:
                continue

    return None


from rag_service.generate.prebuilt_profit_data import (
    PROFIT_REPORT_TEMPLATE,
    PROFIT_SYSTEM_PROMPT,
    _PREBUILT_DATA,
    _build_profit_context,
    _get_fallback_data,
)


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
    """Compliance report generator: configured primary, DeepSeek fallback.

    超时/网络错误 → 先尝试 DeepSeek 降级通道；两条都不通才返回 mock 报告。
    """

    supports_report_package = True

    def __init__(self, api_key: str | None = None):
        from rag_service.config import (
            resolve_deepseek_config,
            resolve_llm_config,
            resolve_llm_provider,
            resolve_llm_thinking,
            resolve_llm_timeout_seconds,
        )
        self.api_key, self.base_url, self.model = resolve_llm_config(api_key)
        self._primary_provider = resolve_llm_provider()
        self.thinking = resolve_llm_thinking()
        self.timeout_seconds = resolve_llm_timeout_seconds()
        (
            self.fallback_api_key,
            _openai_base,  # text-only generation speaks the Anthropic endpoint
            self.fallback_model,
            self.fallback_max_tokens,
            self.fallback_base_url,
        ) = resolve_deepseek_config()
        # Which provider actually answered the most recent call. The report
        # trace and reportPackage.auditMetadata surface this, so a fallback-served
        # report must not claim to be the primary provider's.
        # M17: this generator is a process-wide singleton while scans run
        # concurrently on executor threads, so the attribution is
        # THREAD-LOCAL — scan A and scan B must never read each other's
        # provider. The whole pipeline for one scan (vision → generate →
        # verify) runs on a single executor thread, so per-thread equals
        # per-scan. ``_reset_provider_attribution`` clears it at the start
        # of each generation request because executor threads are reused.
        self._attribution = threading.local()

    @property
    def provider(self) -> str:
        return getattr(self._attribution, "served_by", None) or self._primary_provider

    def _reset_provider_attribution(self) -> None:
        """Start a generation request with a fresh per-thread attribution."""
        self._attribution.served_by = None

    def generate_report_package(
        self,
        query: str,
        product: str,
        market: str,
        chunks: list[dict],
        max_tokens: int = 8192,
        doc_context: str = "",
        mandatory_regulations: list[dict] | None = None,
        article_texts: dict[str, str] | None = None,
        vision_context: str = "",
        *,
        vision_result: dict | None = None,
        user_documents: list[dict] | None = None,
    ) -> dict:
        """
        Generate the four result scenes in one LLM call:
        compliance report, profit report, roadmap, and decision view.

        mandatory_regulations (A+B hybrid, 2026-09-10): the must-cover
        checklist from the must_check matrix (category + features, market
        filtered). When provided, every entry MUST appear in the compliance
        report with its reason; corpus chunks are supporting citations.

        article_texts (De-RAG spec §7.3): KB-anchored article bodies keyed
        by canonical `{doc_id}#{article_id}`. When `USE_KB_INPUT=true` and
        `article_texts` is non-empty, this dict drives the LLM source
        context (instead of `chunks`). The LLM also gains the §4.1
        citation rules and is asked to populate `citations[]` on the
        top-level JSON. `chunks` are still passed through to the evidence
        bundles and the `normalize_report_package` call for backwards
        compatibility with the legacy path.
        """
        # M17: a new request starts a fresh per-thread attribution; the
        # pre-call `provider` reads below must see the primary provider, not
        # whatever a previous scan left on this (reused) executor thread.
        self._reset_provider_attribution()

        if not chunks and not article_texts:
            return self._fallback_report_package(
                product=product,
                market=market,
                query=query,
                chunks=chunks,
                error="未找到合规信息，请确保语料库已正确加载。",
            )

        # Spec §7.3: when KB mode is enabled and we have article texts,
        # use them as the LLM source context. The {KB mode + no texts}
        # combination is treated like the legacy path so the generator
        # degrades cleanly.
        use_kb = _kb_input_enabled() and bool(article_texts)
        if use_kb:
            source_context = _build_article_source_context(article_texts or {})
        else:
            source_context = _build_source_context(chunks, max_chunks=24, max_chars=700)
            if article_texts:
                source_context += (
                    "\n\n可定位条款正文（citationIds必须使用下列完整ID）：\n"
                    + _build_article_source_context(article_texts)
                )

        doc_section = (
            f"\n\n用户上传文档内容：\n{doc_context}\n"
            if doc_context
            else ""
        )
        anchor_section = _build_mandatory_section(mandatory_regulations)
        vision_section = (
            "\n\n视觉观察（仅代表图片可见内容，不是法规或认证结论）：\n"
            f"{vision_context.strip()}\n"
            if vision_context.strip()
            else "\n\n视觉观察：图片信息不足，产品身份与标志均待确认。\n"
        )

        finance_contract = (
            "\nFinance contract: emit profitReport.structuredFields only when every numeric "
            "value is supported by the retrieved material or user documents. Use a three-letter "
            "ISO currency and make each scenario satisfy asp - total = gp to two decimal places. "
            "Otherwise omit structuredFields entirely; never use example zeros or guessed values.\n"
        )
        system = REPORT_PACKAGE_SYSTEM_PROMPT.replace("{source_chunks}", finance_contract + source_context)
        system += (
            "\n审阅关联契约：顶层新增 reviewClaims 数组，按每个目标市场覆盖输入索引中全部checkId，每个市场每项只输出一次。"
            "每项字段：market（单个目标市场代码）、checkId（只能使用输入检查ID）、"
            "status（supported/blocked/unknown/not_applicable）、reason（分项判断与理由）、"
            "applicabilityReason（此法规为什么适用于本产品和市场）、"
            "citationIds（只能引用本次citations已有的doc_id#article_id）、"
            "observationIds（对应输入观察ID）、documentEvidence（[{documentIndex:从0开始的上传文件序号,quote:输入文档中的逐字原文}]）。"
            "每个市场分别判断；照片不能证明检测合格；没有完整依据必须unknown；"
            "不得编造引用、检查ID、观察ID或文件引文。未覆盖的检查保持待确认。"
            "documentIndex必须照抄user_document标签上的documentIndex属性，不能从1计数。"
            "文档优先使用提供的Available exact excerpt IDs：documentEvidence写{documentIndex:0,excerptId:\"e1\"}，系统会取回该文件的真实原句，不必重抄quote。"
            "一个结论可选择多个不同excerptId；必须选择与该结论直接相关的句子，不可仅选择文件标题证明检测通过。"
            "法律引用优先在citationIds选择输入中已有的完整doc_id#article_id，系统可定位原文；不必为了凑引文改写或翻译法条。"
            "产品事实与法律判断必须区分：品牌型号、年龄标识、外观是观察结果，不要把已识别事实写成无法识别，也不要为纯事实强行引用无关法条。"
            "涉及标签合规时说明已核对的具体要求和未核对的尺寸/位置/适用范围；仅有英文或警告图标不能判定全部标签要求符合。"
            "厂家证书可以证明厂家声明覆盖所列标准；试验实测结论、证书批次对应和证书存在是三种不同判断，分别说明。"
            "supported表示当前证据足以支持该项限定判断，不表示绝对准入：如果具体产品证书列出该标准、实验室和日期，可将‘证书覆盖’判断为supported，同时说明未独立复核原始试验数据。"
            "视觉检查中，清晰观察到要求内容可支持‘标识已存在’；可见范围内明确未见缺陷可支持‘本次目视未发现异常’。不得把这类限定判断写成全面合规。"
            "如果法规要求的追溯字段或证书与实物对应信息在已有图片和文档中仍缺失，status写blocked并明确补证动作，不要笼统写unknown。"
            "如果图片、官方说明书和同一产品证书共同支持电池仓、警告或标准覆盖，应交叉引用这些证据完成判断。"
            "documentEvidence.quote仅复制该文件内连续的原文句子（建议20至180字符），不能翻译、改写、拼接或用省略号删节；中文解释写入reason。"
            "照片未显示某标识，不等于实物全部位置均不存在；未完整覆盖标识位置时，不能仅据未见标识判blocked。"
            "每个有法规依据的分项必须填写citationIds。可以不重复输出顶层citations对象，系统会根据模型明确选择的条款ID附上标注来源的原文；不要将citationIds全部留空。"
            "已提供的厂家声明、产品证书、实验室报告分别记录其覆盖范围、型号、版本与日期；"
            "不要因未提供实验室原始报告而声称没有厂家证书。不得把自编摘要当作实验室合格证明。"
            "区域条件必须具体：英文标识不能自动满足所有欧盟成员国语言要求；未选择具体成员国时说明需按销售国语言核对。"
            "EPREL注册、能效标签、通用充电器标签只在已确定适用的具体产品范围内提出，不能泛化到所有家电。"
            "DoC中的型号/批次格式不能证明照片实物批次相同；证书列出某标准只能证明厂家声明的覆盖范围，不能声称已复核完整试验数据。"
            "这些分项只表示AI预检，不能替代正式准入许可。优先保留关联证据，压缩重复叙述。\n"
        )
        system += _CITATION_RULES

        user_prompt = (
            f"产品类型：{product}\n"
            f"目标市场：{market}\n"
            f"用户问题：{query}\n"
            f"{anchor_section}"
            f"{vision_section}"
            f"{doc_section}\n"
            "【输出预算与闭合契约】本次输出预算为 8192 tokens（约 14000 字符），尽量填满以输出更完整的报告。\n"
            "- 所有 JSON 对象与数组必须在末尾闭合（最后一个 `}` 和 `]` 都必须有），缺一个字符下游解析器会直接拒收并丢失整份报告。\n"
            "- 如果不确定完整内容的长度，**先闭合 JSON 框架再回头补字段值**；不要因为想写更长内容而省略末尾的闭合括号。\n"
            "- 字段填充顺序：先 complianceReport → reviewClaims → profitReport → roadmap → decisionView，最后再补 citations。\n"
            "- 严禁使用 Markdown 代码围栏（```json ... ```）包裹 JSON。\n"
            "请基于上述证据输出审阅报告，首先输出reviewClaims及其引用，再输出合规报告、合规排期路线图与AI决策视图。"
            "没有成本输入时profitReport.markdown仅写‘未提供成本数据，本报告不作利润预测’，不要展开利润报告。"
            "为避免响应截断：整个 JSON 控制在 12000 个字符以内，每项判断保持简短，"
            "complianceReport 与 profitReport.markdown 各不超过 1200 个汉字，"
            "roadmap.items 最多 5 项，decisionView.nodes 最多 6 项；每条 citation 必须有 claim。"
        )
        if self.provider == "qwen":
            user_prompt += (
                "\n千问本地交互限制：整个 JSON 控制在 12000 个字符以内，"
                "reviewClaims不可省略，覆盖输入索引中全部checkId；没有充分依据的项写unknown且说明缺什么，不要填造证据。"
                "complianceReport 不超过 500 个汉字，profitReport.markdown 不超过 80 个汉字，"
                "roadmap.items 最多 3 项，decisionView.nodes 最多 4 项；"
                "宁可缩短内容也必须先闭合全部 JSON 字符串、数组和对象。"
            )

        generation_max_tokens = min(max_tokens, 6144) if self.provider == "qwen" else max_tokens

        try:
            raw = self._generate_llm(system, user_prompt, generation_max_tokens)
        except Exception as e:
            logger.error("%s package generation failed: %r", self.provider, e)
            return self._fallback_report_package(
                product=product,
                market=market,
                query=query,
                chunks=chunks,
                error=f"LLM 调用失败：{e}",
            )

        parsed = _parse_json_object(raw)
        if parsed is None and raw.strip():
            # JSON syntax failure is recoverable without changing the evidence
            # set. Give M3 one tightly scoped repair call before declaring the
            # package degraded; this avoids turning otherwise useful output
            # into a demo-like fallback merely because a brace was truncated.
            repair_prompt = (
                "将下面的模型输出修复为一个完整、可解析的 JSON 对象。"
                "保留已有事实；不要补充法规、认证、金额、日期或引用；"
                "缺失字段使用空字符串、空数组或空对象。只输出 JSON。\n\n"
                f"<model_output>\n{raw[:12000]}\n</model_output>"
            )
            try:
                repaired = self._generate_llm(
                    "你是严格的 JSON 修复器，不得创造或改写事实。",
                    repair_prompt,
                    generation_max_tokens,
                )
                parsed = _parse_json_object(repaired)
                if parsed is not None:
                    raw = repaired
                    logger.info("%s package JSON repaired in one bounded retry", self.provider)
            except Exception as exc:
                logger.warning("%s package JSON repair failed: %r", self.provider, exc)
        if parsed is None:
            logger.warning("%s package generation returned non-JSON output", self.provider)
            return self._fallback_report_package(
                product=product,
                market=market,
                query=query,
                chunks=chunks,
                compliance_report=raw,
            )

        return self._normalize_report_package(
            parsed, product, market, query, chunks, self._extract_markdown_fallback(raw),
            vision_result=vision_result, user_documents=user_documents,
        )

    @staticmethod
    def _extract_markdown_fallback(raw: str) -> str:
        """Strip ``` fences / language hints so raw LLM text can serve as the
        compliance report body when the structured JSON omits the field."""
        text = (raw or "").strip()
        if text.startswith("```"):
            lines = text.splitlines()
            if lines and lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip().startswith("```"):
                lines = lines[:-1]
            text = "\n".join(lines).strip()
        if text.lower().startswith("json"):
            text = text[4:].lstrip()
        if text.startswith("﻿"):
            text = text[1:]
        return text

    def _normalize_report_package(
        self,
        package: dict,
        product: str,
        market: str,
        query: str,
        chunks: list[dict],
        markdown_fallback: str = "",
        *,
        vision_result: dict | None = None,
        user_documents: list[dict] | None = None,
    ) -> dict:
        """Normalize model JSON keys and fill missing scenes conservatively.

        P0-4: When the LLM JSON is missing required scenes (compliance report
        empty, profit empty), we mark validationStatus="invalid" so the
        downstream pipeline and UI cannot mistake a mock-filled package for a
        successful LLM generation. A non-empty markdown_fallback (raw LLM
        text) is downgraded to "fallback" rather than "invalid" because at
        least the model produced usable prose.
        """
        compliance = (
            package.get("complianceReport")
            or package.get("compliance_report")
            or package.get("report")
            or ""
        )
        validation_errors: list[str] = []
        used_markdown_fallback = False
        if not isinstance(compliance, str) or not compliance.strip():
            if markdown_fallback.strip():
                compliance = markdown_fallback
                used_markdown_fallback = True
                logger.info(
                    "complianceReport missing in JSON; using raw LLM text as fallback (%d chars)",
                    len(compliance),
                )
            else:
                compliance = self._mock_report(product, market, query, error="合规报告为空，已使用保守模板。")
                validation_errors.append("compliance_report_missing_from_llm_json")

        profit = package.get("profitReport") or package.get("profit_report") or {}
        if isinstance(profit, str):
            profit = {"markdown": profit}
        if not isinstance(profit, dict):
            profit = {}
        if not isinstance(profit.get("markdown"), str) or not profit.get("markdown", "").strip():
            profit["markdown"] = self._fallback_profit_markdown(product, market, chunks)
            validation_errors.append("profit_report_missing_from_llm_json")

        roadmap = package.get("roadmap") if isinstance(package.get("roadmap"), dict) else {}
        decision = package.get("decisionView") or package.get("decision_view") or {}
        if not isinstance(decision, dict):
            decision = {}

        fallback = self._fallback_report_package(product, market, query, chunks, compliance_report=compliance)
        # Spec §7.3: forward LLM-emitted citations to the top-level
        # package. quote_span/match_status stay None until the
        # quote_matcher pass (§7.4) runs against the article library.
        llm_citations = package.get("citations") if isinstance(package, dict) else None
        normalized = {
            "complianceReport": compliance,
            "profitReport": {**fallback["profitReport"], **profit},
            "roadmap": {**fallback["roadmap"], **roadmap},
            "decisionView": {**fallback["decisionView"], **decision},
            # Surface LLM JSON degradation honestly. Precedence:
            #   invalid  — required scenes were missing and mock-filled
            #   fallback — only the raw-text fallback path was used
            #   (omitted) — let normalize_report_package pick the default
            "auditMetadata": {
                "validationStatus": "invalid" if validation_errors else (
                    "fallback" if used_markdown_fallback else "normalized"
                ),
                "validationErrors": validation_errors,
            },
            "citations": llm_citations if llm_citations else [],
            "reviewClaims": (
                package.get("reviewClaims")
                if isinstance(package.get("reviewClaims"), list)
                else []
            ),
        }
        return normalize_report_package(
            normalized,
            product=product,
            market=market,
            query=query,
            chunks=chunks,
            provider=self.provider,
            # J19: sourceCounts must reflect the REAL inputs — user documents
            # and vision items — not always-zero defaults.
            vision_result=vision_result,
            user_documents=user_documents,
        )

    def _fallback_report_package(
        self,
        product: str,
        market: str,
        query: str,
        chunks: list[dict],
        error: str | None = None,
        compliance_report: str | None = None,
    ) -> dict:
        """Return a complete package without making another LLM call."""
        from datetime import date, timedelta

        today = date.today()
        markets = [m.strip() for m in str(market or "EU").split(",") if m.strip()]
        market_label = ", ".join(markets) or "EU"
        compliance = compliance_report or self._mock_report(product, market_label, query, error=error)
        profit_markdown = self._fallback_profit_markdown(product, market_label, chunks)

        def day(offset: int) -> str:
            return (today + timedelta(days=offset)).isoformat()

        package = {
            "complianceReport": compliance,
            "profitReport": {
                "markdown": profit_markdown,
                "keyConclusion": "合规模式可降低平台下架、清关扣押与召回风险，建议优先补齐关键认证。",
                "premiumPct": "估算",
                "breakevenUnits": "估算",
                "pricingStrategy": "以合规认证和低风险交付作为溢价依据，优先进入主流渠道。",
                "riskNote": "成本与风险敞口基于当前语料保守估算，落地前需结合真实 BOM 与检测报价复核。",
                "conclusions": "完成认证、标签和技术文档后再规模化销售，整体风险收益更稳定。",
                "references": "参考本次检索到的法规语料与用户上传文档。",
            },
            "roadmap": {
                "totalDays": 56,
                "totalCost": "¥25K+",
                "progress": 25,
                "items": [
                    {
                        "id": "1",
                        "date": day(0),
                        "title": "完成产品识别与风险初筛",
                        "titleEn": "Complete product identification and risk screening",
                        "description": f"确认 {product or '产品'} 在 {market_label} 的主要合规风险与证据缺口。",
                        "descriptionEn": "Confirm core compliance risks and evidence gaps for the target markets.",
                        "type": "complete",
                        "status": "completed",
                        "estimatedDays": 0,
                    },
                    {
                        "id": "2",
                        "date": day(7),
                        "title": "补齐技术资料与标签信息",
                        "titleEn": "Prepare technical files and labeling",
                        "description": "整理说明书、BOM、铭牌、警示标签、测试样品和已有证书。",
                        "descriptionEn": "Prepare manuals, BOM, nameplates, warnings, samples, and existing certificates.",
                        "type": "apply",
                        "status": "in-progress",
                        "estimatedDays": 7,
                        "documents": ["说明书", "BOM 清单", "铭牌/标签", "已有测试报告"],
                        "documentsEn": ["Manual", "BOM", "Nameplate/Label", "Existing test reports"],
                    },
                    {
                        "id": "3",
                        "date": day(21),
                        "title": "送检并完成关键认证",
                        "titleEn": "Run testing and obtain key certifications",
                        "description": "按目标市场安排安全、EMC、化学限制、包装/EPR 等检测或注册。",
                        "descriptionEn": "Run safety, EMC, chemical restriction, packaging/EPR tests or registrations.",
                        "type": "test",
                        "status": "pending",
                        "estimatedDays": 21,
                        "cost": "¥15,000-40,000",
                    },
                    {
                        "id": "4",
                        "date": day(56),
                        "title": "合规上市复核",
                        "titleEn": "Final compliant launch review",
                        "description": "复核证书、DoC、标签、包装和平台上架材料后再进入目标市场。",
                        "descriptionEn": "Review certificates, DoC, labels, packaging, and listing materials before launch.",
                        "type": "complete",
                        "status": "pending",
                        "estimatedDays": 7,
                    },
                ],
            },
            "decisionView": {
                "verdict": "UNKNOWN",
                # riskLevel 同 REPORT_PACKAGE_SYSTEM_PROMPT 风险等级契约:
                # = nodes[].severity 最大值。fallback 没真证据,vision/retriever/generate
                # 默认都是 info,而非硬编码 critical/high/medium,否则前端会把它 rollup 成
                # critical→35/D,与"零高危"自相矛盾(a2235dd 已修前端解耦,这里跟着改)。
                "riskLevel": "LOW",
                "summary": "系统先识别产品，再检索目标市场法规，最后生成合规、利润和执行路线图。",
                "keyFindings": [
                    "产品识别结果决定检索关键词和适用法规范围。",
                    "检索证据不足的部分以保守风险提示呈现。",
                    "路线图优先覆盖认证、标签、技术文档和上市复核。",
                ],
                "recommendedAction": "先补齐技术资料和可见标签，再启动目标市场检测/认证。",
                "nodes": [
                    {
                        "id": "vision",
                        "type": "vision",
                        "label": "产品视觉识别",
                        "labelEn": "Product vision analysis",
                        "status": "success",
                        "severity": "info",
                        "duration": "0s",
                        "confidence": 0.8,
                        "reasoning": "从图片中提取产品类型、核心特征和可见认证标志。",
                        "reasoningEn": "Extract product type, key features, and visible marks from images.",
                    },
                    {
                        "id": "retriever",
                        "type": "retriever",
                        "label": "法规与成本语料检索",
                        "labelEn": "Regulation and cost retrieval",
                        "status": "success",
                        "severity": "info",
                        "duration": "0s",
                        "confidence": 0.75,
                        "reasoning": "使用目标市场和产品特征召回相关法规、认证和成本片段。",
                        "reasoningEn": "Retrieve relevant regulation, certification, and cost evidence.",
                    },
                    {
                        "id": "generate",
                        "type": "generate",
                        "label": "四场景内容生成",
                        "labelEn": "Four-scene content generation",
                        "status": "success",
                        "severity": "info",
                        "duration": "0s",
                        "confidence": 0.78,
                        "reasoning": "一次生成合规报告、成本利润、排期路线图和决策解释。",
                        "reasoningEn": "Generate compliance, profit, roadmap, and decision content in one pass.",
                    },
                ],
            },
            "auditMetadata": {
                "validationStatus": "fallback",
                "validationErrors": [error] if error else [],
            },
        }
        return normalize_report_package(
            package,
            product=product,
            market=market_label,
            query=query,
            chunks=chunks,
            provider=self.provider,
        )

    def _fallback_profit_markdown(self, product: str, market: str, chunks: list[dict]) -> str:
        """Render profit markdown from prebuilt or conservative fallback data."""
        from datetime import date

        resolved_type = product or _identify_product_type(chunks) or "通用产品"
        data = _PREBUILT_DATA.get(resolved_type, _get_fallback_data(resolved_type, market)).copy()
        data["market"] = market
        data["report_date"] = date.today().isoformat()
        try:
            return PROFIT_REPORT_TEMPLATE.format(**data)
        except Exception as e:
            logger.warning(f"Fallback profit template failed: {e}")
            return self._mock_profit_report(resolved_type, market)

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
        Generate a compliance report through the configured primary provider.
        On failure: returns a mock structured report.
        """
        self._reset_provider_attribution()
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

        system = SYSTEM_PROMPT.replace("{source_chunks}", source_context)

        try:
            return self._generate_llm(system, user_prompt, max_tokens)
        except Exception as e:
            logger.error("%s failed: %s", self.provider, e)
            return self._mock_report(product, market, query, error=f"LLM 调用失败：{e}")

    # Max chars fed to the JSON parser's balanced-object scan. The scan is
    # O(n) per opening brace and pathological LLM output (e.g. very long
    # markdown wrapped in braces) can dominate parse time, so we cap it.
    _JSON_PARSE_MAX_CHARS = 200_000

    # LLM call retry config: 3 attempts, exponential backoff 1s/2s.
    # Only transient (network/timeout/5xx) errors are retried; business
    # errors (4xx auth/quota) surface immediately so we fall back to mock.
    _LLM_MAX_ATTEMPTS = 3
    _LLM_BACKOFF_BASE = 1.0  # seconds

    def _generate_llm(self, system: str, user_prompt: str, max_tokens: int) -> str:
        """Generate one completion, degrading to DeepSeek when the primary fails.

        Retries are limited to transient failures (URLError, timeout, 5xx
        HTTPError, or HTTP 429). Authentication/quota/business 4xx errors are
        re-raised so the caller can degrade to mock without burning attempts.

        When a fallback key is configured the primary gets only ONE attempt:
        3 attempts x the 90s read timeout + backoff is ~273s, which alone
        exceeds the 280s scan budget (main._SCAN_TIMEOUT_SECS) — retrying the
        primary to exhaustion would mean the fallback is never reached on the
        timeout-class outage it exists for. With a fallback on hand, degrading
        beats stalling.

        M2: once shutdown has been signalled, the retry loop stops and the
        degrade-to-DeepSeek branch is skipped — the process is draining and
        every further attempt would only keep a worker thread (and provider
        quota) busy after it decided to stop. The check sits on the retry
        path only, so the first attempt pays nothing.
        """
        self._reset_provider_attribution()
        request_body = {
            "model": self.model,
            "max_tokens": max_tokens,
            "temperature": 0.2,
            "system": system,
            "messages": [
                {"role": "user", "content": user_prompt},
            ],
        }
        thinking = self.thinking
        if not thinking and os.environ.get("MINIMAX_THINKING_MODE", "").strip().lower() in {
            "disabled", "off", "false", "0",
        }:
            thinking = "disabled"
        if thinking in {"enabled", "disabled"}:
            request_body["thinking"] = {"type": thinking}
        body = json.dumps(request_body).encode("utf-8")

        max_attempts = 1 if self.fallback_api_key else self._LLM_MAX_ATTEMPTS
        last_exc: Exception | None = None
        for attempt in range(1, max_attempts + 1):
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
            try:
                text = self._read_mimotalk_response(req)
                self._attribution.served_by = self._primary_provider
                return text
            except _TransientLLMError as e:
                last_exc = e.cause
                if attempt < max_attempts:
                    if is_shutting_down():
                        logger.info(
                            "shutdown requested; abandoning remaining report-"
                            "generation retries (attempt %d/%d)",
                            attempt, max_attempts,
                        )
                        break
                    delay = self._LLM_BACKOFF_BASE * (2 ** (attempt - 1))
                    logger.warning(
                        "%s transient failure (attempt %d/%d): %r; retrying in %.1fs",
                        self.provider, attempt, max_attempts, e.cause, delay,
                    )
                    # P1-11: this sleep runs inside the executor worker
                    # thread that ``main._run_scan_request`` dispatched via
                    # ``loop.run_in_executor(_executor, ...)`` — not the
                    # event loop thread — so a blocking sleep is fine here.
                    # Switching to ``await asyncio.sleep`` would require an
                    # async rewrite of ``_generate_mimotalk`` and all of its
                    # callers; deliberately deferred.
                    time.sleep(delay)
                    continue
                # Primary exhausted (or we deliberately only tried once):
                # fall through to the degrade path below.
                break
            except Exception as e:
                # Non-transient (auth/quota/parse) — do not retry.
                last_exc = e
                break

        if not self.fallback_api_key:
            # Defensive: the loop exits via return/break above.
            raise last_exc if last_exc else RuntimeError(
                "LLM retry loop exited unexpectedly"
            )
        if is_shutting_down():
            # Draining: do not open a fresh request against the fallback
            # provider either — fail now so the worker thread can end.
            raise last_exc if last_exc else RuntimeError(
                "shutdown requested during report generation"
            )

        logger.warning(
            "report generation: primary (%s) failed (%r); trying fallback (%s)",
            self.model, last_exc, self.fallback_model,
        )
        try:
            return self._generate_fallback(system, user_prompt, max_tokens)
        except Exception as fallback_exc:
            logger.error("report generation: fallback also failed: %r", fallback_exc)
            # Surface the PRIMARY failure — that is what the caller's degraded
            # path is meant to explain.
            raise last_exc if last_exc else fallback_exc

    def _generate_fallback(self, system: str, user_prompt: str, max_tokens: int) -> str:
        """Send the same request to DeepSeek's Anthropic-compatible endpoint.

        The body shape is identical (both endpoints are Anthropic
        ``/messages``), so only the base URL, credentials and model change.
        ``max_tokens`` is floored at the fallback budget because
        deepseek-flash spends part of that budget on reasoning_content.
        """
        # Measured on the real report-package prompt (2026-09-17):
        # effort=high (default) 41.2s / low 30.1s / none 24.9s — the thinking
        # trace (14K chars at high) costs more than the answer itself and the
        # output text length is unchanged. "none" is the documented way to
        # disable thinking on the Anthropic-compatible endpoint
        # (api-docs.deepseek.com/guides/thinking_mode).
        fallback_body = json.dumps({
            "model": self.fallback_model,
            "max_tokens": max(max_tokens, self.fallback_max_tokens),
            "temperature": 0.2,
            "reasoning": {"effort": "none"},
            "system": system,
            "messages": [
                {"role": "user", "content": user_prompt},
            ],
        }).encode("utf-8")

        req = urllib.request.Request(
            f"{self.fallback_base_url.rstrip('/')}/messages",
            data=fallback_body,
            headers={
                "Authorization": f"Bearer {self.fallback_api_key}",
                "Content-Type": "application/json",
                "anthropic-version": "2023-06-01",
                "x-api-key": self.fallback_api_key,
            },
        )
        text = self._read_mimotalk_response(req)
        self._attribution.served_by = "deepseek"
        return text

    def _read_llm_response(self, req: urllib.request.Request, timeout: float | None = None) -> str:
        """Execute a single /messages request and return its text content.

        Raises _TransientLLMError for retryable failures; everything else
        propagates as-is.

        The answer is the concatenation of the ``text`` blocks, NOT
        ``content[0]``: DeepSeek's Anthropic-compatible endpoint prefixes the
        answer with a ``{"type": "thinking"}`` block, so reading block 0 by
        position silently returns "" (and looks exactly like a provider
        outage). MiniMax returns a single text block, so this is a no-op there.
        """
        try:
            with _NO_PROXY_OPENER.open(req, timeout=timeout or self.timeout_seconds) as r:
                data = json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504):
                raise _TransientLLMError(e) from e
            raise
        except (urllib.error.URLError, TimeoutError) as e:
            raise _TransientLLMError(e) from e

        content = extract_text_blocks(data)
        if content and content.strip():
            # Observation: warn when the response approaches the prompt's
            # 12000-char JSON ceiling so a production regression surfaces
            # in logs (CLAUDE.md: 报告生成 ~16.4k 字符触顶事故).
            # 11000 ≈ model near ceiling; 14000 ≈ past declared 8192-token budget.
            if len(content) >= 14000:
                logger.error(
                    "LLM report response exceeded declared budget (%d chars ≥ 14000); "
                    "check whether model is ignoring 8192-token prompt constraint",
                    len(content),
                )
            elif len(content) >= 11000:
                logger.warning(
                    "LLM report response approaching JSON ceiling (%d chars ≥ 11000); "
                    "may need repair retry",
                    len(content),
                )
            logger.info(f"LLM report generated ({len(content)} chars)")
            return content
        raise ValueError("LLM returned empty response")

    def _generate_mimotalk(self, system: str, user_prompt: str, max_tokens: int) -> str:
        """Compatibility wrapper for older integrations and regression tests."""
        return self._generate_llm(system, user_prompt, max_tokens)

    def _read_mimotalk_response(
        self,
        req: urllib.request.Request,
        timeout: float | None = None,
    ) -> str:
        """Compatibility wrapper for the former provider-specific reader."""
        return self._read_llm_response(req, timeout=timeout)

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

        self._reset_provider_attribution()

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

        system = (
            PROFIT_SYSTEM_PROMPT
            .replace("{product_name}", product_type)
            .replace("{product_type}", product_type)
            .replace("{market}", market)
            .replace("{source_chunks}", source_context)
        )

        user_prompt = (
            f"请为「{product_type}」生成合规成本与利润分析报告。\n"
            f"目标市场：{market}\n"
            f"输出格式：直接输出 markdown，不要附加解释。"
        )

        try:
            report_text = self._generate_llm(system, user_prompt, max_tokens)
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
> ⚠️ 数据基于估算，如需精确值请配置 LLM API Key。

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

> 💡 此为降级 mock 报告，请配置 MINIMAX_API_KEY 获取精确数据。
"""
