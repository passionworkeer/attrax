#!/usr/bin/env python3
"""
report_generator.py - Claude Sonnet compliance report generator

Generates structured compliance reports with forced citation format.
"""
import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a compliance document assistant for cross-border e-commerce.

You MUST follow these rules:
1. ONLY answer based on the provided source documents.
2. EVERY factual claim must include a citation in format [Regulation Article/Section p.X].
   Example: "根据 [REACH Article 22 p.45]，铅含量限制为0.1%。"
3. If the sources do not contain sufficient information to answer, respond EXACTLY:
   "The available documents do not contain sufficient information to answer this question."
4. NEVER infer, assume, or extrapolate beyond what is explicitly stated.
5. If documents conflict, note the conflict with both citations.

Source documents:
{source_chunks}

User question: {question}
Product: {product}
Target market: {market}

Generate a compliance report in Chinese with English regulatory terms. Structure with:
## 合规要求
## 禁止/限制项目
## 合规建议
## 法规引用

Format citations as: [法规名 Article/Section p.页码]
"""


class ReportGenerator:
    """Claude Sonnet report generator with citation enforcement."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get("ANTHROPIC_API_KEY", "")
        self._client = None

    @property
    def client(self):
        if self._client is None:
            import anthropic
            self._client = anthropic.Anthropic(api_key=self.api_key)
        return self._client

    def generate(
        self,
        query: str,
        product: str,
        market: str,
        chunks: list[dict],
        max_tokens: int = 2048,
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
        if not chunks:
            return "错误：未找到足够的合规信息。请确保语料库已正确加载。"

        # Build source context
        source_chunks = []
        for i, chunk in enumerate(chunks[:10]):  # Limit to 10 chunks for context
            doc = chunk.get("doc_name", "Unknown")
            article = chunk.get("article_no", "")
            content = chunk.get("content", "")[:1000]  # Limit each chunk
            source_chunks.append(f"[文档{i+1}] {doc} {article}\n{content}\n")

        context = "\n---\n".join(source_chunks)

        try:
            response = self.client.messages.create(
                model="claude-sonnet-4-20251114",
                max_tokens=max_tokens,
                system=SYSTEM_PROMPT.format(
                    source_chunks=context,
                    question=query,
                    product=product,
                    market=market,
                ),
                messages=[{"role": "user", "content": query}],
            )
            return response.content[0].text
        except Exception as e:
            logger.error(f"Report generation failed: {e}")
            return f"报告生成失败: {e}"

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
