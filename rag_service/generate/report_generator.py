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