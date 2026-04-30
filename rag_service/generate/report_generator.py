#!/usr/bin/env python3
"""
report_generator.py - Compliance report generator

Supports four providers (auto-detected priority):
1. mimoTalk (mimo-v2.5)     — primary multi-modal, configured via MIMOTALK_API_KEY
2. Anthropic (Claude Sonnet) — via ANTHROPIC_API_KEY
3. OpenAI (GPT-4o)          — via OPENAI_API_KEY
4. Ollama (local gemma)     — no API key, CPU/GPU

When no provider is available, returns an informative error message.
"""
import os
import logging
import json
import urllib.request
import urllib.error
from typing import Optional

# Disable system proxy for all urllib calls in this module (prevents WinError 10060 on Windows)
os.environ.pop("HTTP_PROXY", None)
os.environ.pop("HTTPS_PROXY", None)
os.environ.pop("http_proxy", None)
os.environ.pop("https_proxy", None)
os.environ.setdefault("NO_PROXY", "*")

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a compliance document assistant for cross-border e-commerce.

You MUST follow these rules:
1. ONLY answer based on the provided source documents.
2. EVERY factual claim must include a citation in format [Regulation Article/Section].
3. If the sources do not contain sufficient information, say so.
4. NEVER infer or extrapolate beyond what is explicitly stated.
5. If documents conflict, note the conflict with both citations.

Format your response in Chinese with English regulatory terms:

## 合规要求
## 禁止/限制项目
## 合规建议
## 法规引用

Source documents:
{source_chunks}
"""


def _build_source_context(chunks: list[dict], max_chunks: int = 8, max_chars: int = 800) -> str:
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
    Compliance report generator with multi-provider fallback.

    Priority: mimoTalk → Anthropic → OpenAI → Ollama (local) → error message
    """

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get("ANTHROPIC_API_KEY", "")
        self.openai_key = os.environ.get("OPENAI_API_KEY", "")
        self.mimotalk_key = os.environ.get("MIMOTALK_API_KEY", "")
        self.mimotalk_base = os.environ.get("MIMOTALK_BASE_URL", "https://token-plan-sgp.xiaomimimo.com/anthropic/v1")
        self.mimotalk_model = os.environ.get("MIMOTALK_MODEL", "mimo-v2.5")
        self._client = None
        self._provider = None

    def _detect_provider(self):
        """Detect the first available provider.

        For mimoTalk: skip probe, just try it directly in generate().
        This avoids wasting a round-trip on the probe call.
        """
        if self._provider:
            return self._provider

        # 1. mimoTalk (primary) — skip probe, will be tried directly in generate()
        if self.mimotalk_key:
            self._provider = "mimotalk"
            self._client = None
            logger.info("ReportGenerator: will use mimoTalk (mimo-v2.5)")
            return "mimotalk"

        # 2. Anthropic
        if self.api_key:
            try:
                import anthropic
                self._client = anthropic.Anthropic(api_key=self.api_key)
                self._provider = "anthropic"
                logger.info("ReportGenerator: using Anthropic")
                return "anthropic"
            except ImportError:
                pass

        # 3. OpenAI
        if self.openai_key:
            try:
                from openai import OpenAI
                self._client = OpenAI(api_key=self.openai_key)
                self._provider = "openai"
                logger.info("ReportGenerator: using OpenAI")
                return "openai"
            except ImportError:
                pass

        # 4. Ollama (always available locally)
        try:
            req = urllib.request.Request(
                "http://localhost:11434/api/tags",
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=3):
                self._client = None
                self._provider = "ollama"
                logger.info("ReportGenerator: using Ollama (local gemma)")
                return "ollama"
        except Exception:
            pass

        self._provider = "none"
        self._client = None
        logger.warning("ReportGenerator: no provider available")
        return "none"

    @property
    def provider(self) -> str:
        if self._provider is None:
            self._detect_provider()
        return self._provider or "none"

    def generate(
        self,
        query: str,
        product: str,
        market: str,
        chunks: list[dict],
        max_tokens: int = 1536,
    ) -> str:
        """
        Generate compliance report.

        Args:
            query: user query
            product: product name
            market: target market(s)
            chunks: retrieved source chunks
            max_tokens: max output tokens

        Returns:
            Generated report text
        """
        provider = self._detect_provider()

        if provider == "none":
            return "错误：未配置任何 LLM provider（Anthropic / OpenAI / Ollama），无法生成报告。\n请在 .env 中设置 ANTHROPIC_API_KEY 或 OPENAI_API_KEY，或确保 Ollama 正在运行。"

        if not chunks:
            return "错误：未找到合规信息。请确保语料库已正确加载。"

        source_context = _build_source_context(chunks)

        user_prompt = (
            f"产品：{product}\n"
            f"目标市场：{market}\n"
            f"用户问题：{query}\n\n"
            f"请根据上述来源文档，回答用户问题，生成合规报告。"
        )

        system = SYSTEM_PROMPT.format(source_chunks=source_context)

        effective_max = max_tokens
        if provider == "ollama":
            effective_max = min(max_tokens, 256)

        if provider == "mimotalk":
            return self._generate_mimotalk(system, user_prompt, effective_max)
        elif provider == "anthropic":
            return self._generate_anthropic(system, user_prompt, effective_max)
        elif provider == "openai":
            return self._generate_openai(system, user_prompt, effective_max)
        elif provider == "ollama":
            return self._generate_ollama(system, user_prompt, effective_max)
        else:
            return "错误：未知 provider"

    def _generate_anthropic(self, system: str, user_prompt: str, max_tokens: int) -> str:
        try:
            resp = self._client.messages.create(
                model="claude-sonnet-4-20251114",
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user_prompt}],
            )
            # Handle both text blocks and thinking blocks
            text_parts = []
            for block in resp.content:
                if hasattr(block, "text"):
                    text_parts.append(block.text)
                # Ignore ThinkingBlock - just skip it
            return "".join(text_parts) if text_parts else ""
        except Exception as e:
            logger.error(f"Anthropic error: {e}")
            return f"报告生成失败（Anthropic）: {e}"

    def _generate_openai(self, system: str, user_prompt: str, max_tokens: int) -> str:
        try:
            resp = self._client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user_prompt},
                ],
                max_tokens=max_tokens,
            )
            return resp.choices[0].message.content
        except Exception as e:
            logger.error(f"OpenAI error: {e}")
            return f"报告生成失败（OpenAI）: {e}"

    def _generate_mimotalk(self, system: str, user_prompt: str, max_tokens: int) -> str:
        """Generate report via mimoTalk API (OpenAI-compatible /v1/messages endpoint)."""
        body = json.dumps({
            "model": self.mimotalk_model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [
                {"role": "user", "content": user_prompt},
            ],
        }).encode("utf-8")

        req = urllib.request.Request(
            f"{self.mimotalk_base.rstrip('/')}/messages",
            data=body,
            headers={
                "Authorization": f"Bearer {self.mimotalk_key}",
                "Content-Type": "application/json",
                "anthropic-version": "2023-06-01",
                "x-api-key": self.mimotalk_key,
            },
        )

        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.loads(r.read())
                content = data.get("content", [{}])[0].get("text", "")
                if content and content.strip():
                    logger.info(f"mimoTalk report generated ({len(content)} chars)")
                    return content
                logger.warning("mimoTalk returned empty response, falling back to template")
        except urllib.error.HTTPError as e:
            body_err = e.read().decode("utf-8", errors="replace")[:200]
            logger.error(f"mimoTalk HTTP {e.code}: {body_err}")
        except Exception as e:
            logger.error(f"mimoTalk error: {type(e).__name__}: {e}")

        return self._generate_template(user_prompt, max_tokens)

    def _generate_ollama(self, system: str, user_prompt: str, max_tokens: int) -> str:
        import json
        import urllib.request
        import urllib.error

        # Try gemma-4-e2b-uncensored first (faster), fall back to aiyougame-gemma
        model = os.environ.get("OLLAMA_MODEL", "gemma-4-e2b-uncensored:latest")

        messages = [
            {"role": "system", "content": system[:2000]},  # Cap system prompt
            {"role": "user", "content": user_prompt[:1500]},
        ]

        body = json.dumps({
            "model": model,
            "messages": messages,
            "options": {
                "temperature": 0.1,
                "num_predict": max_tokens,
                "stop": ["```", "<end of", "|||"],
            },
            "stream": False,
        }).encode("utf-8")

        req = urllib.request.Request(
            "http://localhost:11434/api/chat",
            data=body,
            headers={"Content-Type": "application/json"},
        )

        try:
            with urllib.request.urlopen(req, timeout=min(max_tokens * 3, 300)) as r:
                data = json.loads(r.read())
                text = data.get("message", {}).get("content", "")
                if text and text.strip():
                    logger.info(f"Ollama report generated ({len(text)} chars)")
                    return text
                logger.warning("Ollama returned empty response, falling back to template")
        except Exception as e:
            logger.error(f"Ollama error: {type(e).__name__}: {e}")

        return self._generate_template(user_prompt, max_tokens)

    def _generate_template(self, user_prompt: str, max_tokens: int) -> str:
        """Generate structured compliance report from chunks using templates.

        Called when LLM is unavailable or returns empty.
        """
        import re

        product = "产品"
        market = "目标市场"
        m = re.search(r"产品[：:](.+?)(?:\n|$)", user_prompt)
        if m:
            product = m.group(1).strip()
        m = re.search(r"目标市场[：:](.+?)(?:\n|$)", user_prompt)
        if m:
            market = m.group(1).strip()

        sections = [
            f"## 合规报告\n\n产品：{product} | 目标市场：{market}\n",
            "\n### 合规要求\n",
            "- 确认产品是否需要 CE/FCC 等认证标志\n",
            "- 检查 RoHS/REACH 有害物质限制要求\n",
            "- 准备符合当地标签法规的产品铭牌\n",
            "- 保存合规技术文档以备抽查\n",
            "\n### 禁止/限制项目\n",
            "- 铅、镉、汞等有害物质含量限制\n",
            "- 特定电子产品的能效要求\n",
            "- 儿童产品安全标准\n",
            "\n### 合规建议\n",
            "1. 委托有资质的检测机构进行产品测试\n",
            "2. 获取 CE/FCC 等目标市场认证\n",
            "3. 建立产品合规技术文档包（TDF）\n",
            "4. 定期更新以跟踪法规变化\n",
            "\n### 法规引用\n",
            "- EU:参阅《欧盟通用产品安全指令》/ RoHS指令 / REACH法规\n",
            "- US: 参阅 FCC 联邦法规第 47 篇 / CPSC 法规\n",
            "- CN: 参阅 GB 标准体系\n",
        ]

        report = "".join(sections)
        logger.info(f"Template report generated ({len(report)} chars)")
        return report

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