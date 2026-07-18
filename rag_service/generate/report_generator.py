#!/usr/bin/env python3
"""
report_generator.py - Compliance report generator (mimoTalk only)

唯一 LLM：MiniMax-M3（Anthropic 兼容接口）
- 超时/失败 → 返回 mock 结构化报告，不降级到其他 provider
"""
import os
import logging
import json
import time
import urllib.request
import urllib.error

from rag_service.schemas.report_package import normalize_report_package

# Disable system proxy for all urllib calls (prevents WinError 10060 on Windows)
os.environ.pop("HTTP_PROXY", None)
os.environ.pop("HTTPS_PROXY", None)
os.environ.pop("http_proxy", None)
os.environ.pop("https_proxy", None)
os.environ.setdefault("NO_PROXY", "*")

logger = logging.getLogger(__name__)


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
1. 只使用给定来源文档和用户上传文档中的事实，不要编造法规条款或确定性数字。
2. 信息不足时必须写明“暂无充分依据”，可以给出保守估算但要标注“估算”。
3. 合规报告、成本利润、排期路线图、AI 决策视图必须互相一致。
4. 合规报告中的事实需要标注来源，格式为 [法规名称/条款]。
5. 直接输出 JSON，不要输出 Markdown 代码围栏，不要附加解释。

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
    "references": "string"
  },
  "roadmap": {
    "totalDays": 56,
    "totalCost": "¥25K+",
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
        "cost": "¥5,000-15,000",
        "documents": ["材料1"],
        "documentsEn": ["Document 1"]
      }
    ]
  },
  "decisionView": {
    "summary": "string",
    "keyFindings": ["string"],
    "recommendedAction": "string",
    "nodes": [
      {
        "id": "vision",
        "type": "vision|query_planner|retriever|synthesis|generate|verify",
        "label": "中文节点名",
        "labelEn": "English node label",
        "status": "success|pending|running|error",
        "duration": "1.2s",
        "confidence": 0.86,
        "reasoning": "中文解释",
        "reasoningEn": "English reasoning"
      }
    ]
  }
}

来源文档：
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
    best_obj: dict | None = None
    best_len = 0
    for i, ch in enumerate(raw):
        if ch != "{":
            continue
        try:
            obj, end_idx = decoder.raw_decode(raw, i)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict) and end_idx - i > best_len:
            best_obj = obj
            best_len = end_idx - i
    if best_obj is not None:
        return best_obj

    # Last-resort: substring between first { and last }.
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        try:
            data = json.loads(raw[start:end + 1])
            return data if isinstance(data, dict) else None
        except Exception as exc:
            logger.warning("substring json.loads failed: %s; slice[:200]=%r", exc, raw[start:end + 1][:200])
            return None

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
    """
    Compliance report generator using mimoTalk only.
    超时/网络错误 → 返回 mock 报告，不调用其他 LLM。
    """
    supports_report_package = True

    def __init__(self, api_key: str | None = None):
        from rag_service.config import resolve_minimax_config
        self.api_key, self.base_url, self.model = resolve_minimax_config(api_key)

    @property
    def provider(self) -> str:
        return "minimax"

    def generate_report_package(
        self,
        query: str,
        product: str,
        market: str,
        chunks: list[dict],
        max_tokens: int = 4096,
        doc_context: str = "",
    ) -> dict:
        """
        Generate the four result scenes in one LLM call:
        compliance report, profit report, roadmap, and decision view.
        """
        if not chunks:
            return self._fallback_report_package(
                product=product,
                market=market,
                query=query,
                chunks=chunks,
                error="未找到合规信息，请确保语料库已正确加载。",
            )

        source_context = _build_source_context(chunks, max_chunks=24, max_chars=700)
        doc_section = (
            f"\n\n用户上传文档内容：\n{doc_context}\n"
            if doc_context
            else ""
        )

        system = REPORT_PACKAGE_SYSTEM_PROMPT.replace("{source_chunks}", source_context)
        user_prompt = (
            f"产品类型：{product}\n"
            f"目标市场：{market}\n"
            f"用户问题：{query}\n"
            f"{doc_section}\n"
            "请基于上述证据一次性生成四个场景内容：合规报告、成本利润报告、合规排期路线图、AI 决策视图。"
            "输出必须是可解析 JSON，不要使用 Markdown 代码围栏。"
            "为避免响应截断：整个 JSON 控制在 7000 个字符以内，"
            "complianceReport 与 profitReport.markdown 各不超过 1200 个汉字，"
            "roadmap.items 最多 5 项，decisionView.nodes 最多 6 项；优先保证所有 JSON 字段闭合。"
        )

        try:
            raw = self._generate_mimotalk(system, user_prompt, max_tokens)
        except Exception as e:
            logger.error(f"mimoTalk package generation failed: {e!r}")
            return self._fallback_report_package(
                product=product,
                market=market,
                query=query,
                chunks=chunks,
                error=f"LLM 调用失败：{e}",
            )

        parsed = _parse_json_object(raw)
        if parsed is None:
            logger.warning("mimoTalk package generation returned non-JSON output")
            return self._fallback_report_package(
                product=product,
                market=market,
                query=query,
                chunks=chunks,
                compliance_report=raw,
            )

        return self._normalize_report_package(
            parsed, product, market, query, chunks, self._extract_markdown_fallback(raw)
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
        }
        return normalize_report_package(
            normalized,
            product=product,
            market=market,
            query=query,
            chunks=chunks,
            provider=self.provider,
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

        system = SYSTEM_PROMPT.replace("{source_chunks}", source_context)

        try:
            return self._generate_mimotalk(system, user_prompt, max_tokens)
        except Exception as e:
            logger.error(f"mimoTalk failed: {e}")
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

    def _generate_mimotalk(self, system: str, user_prompt: str, max_tokens: int) -> str:
        """Call mimoTalk /v1/messages endpoint with bounded retries.

        Retries are limited to transient failures (URLError, timeout, 5xx
        HTTPError, or HTTP 429). Authentication/quota/business 4xx errors are
        re-raised so the caller can degrade to mock without burning attempts.
        """
        body = json.dumps({
            "model": self.model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [
                {"role": "user", "content": user_prompt},
            ],
        }).encode("utf-8")

        last_exc: Exception | None = None
        for attempt in range(1, self._LLM_MAX_ATTEMPTS + 1):
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
                return self._read_mimotalk_response(req)
            except _TransientLLMError as e:
                last_exc = e.cause
                if attempt < self._LLM_MAX_ATTEMPTS:
                    delay = self._LLM_BACKOFF_BASE * (2 ** (attempt - 1))
                    logger.warning(
                        "mimoTalk transient failure (attempt %d/%d): %r; retrying in %.1fs",
                        attempt, self._LLM_MAX_ATTEMPTS, e.cause, delay,
                    )
                    time.sleep(delay)
                    continue
                raise last_exc  # type: ignore[misc]
            except Exception as e:
                # Non-transient (auth/quota/parse) — do not retry.
                raise

        # Defensive: loop should exit via return/raise above.
        raise last_exc if last_exc else RuntimeError("mimoTalk retry loop exited unexpectedly")

    def _read_mimotalk_response(self, req: urllib.request.Request) -> str:
        """Execute a single mimoTalk request and return the text content.

        Raises _TransientLLMError for retryable failures; everything else
        propagates as-is.
        """
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                data = json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504):
                raise _TransientLLMError(e) from e
            raise
        except (urllib.error.URLError, TimeoutError) as e:
            raise _TransientLLMError(e) from e

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

> 💡 此为降级 mock 报告，请配置 MINIMAX_API_KEY 获取精确数据。
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
