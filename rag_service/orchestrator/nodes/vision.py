#!/usr/bin/env python3
"""
vision.py - Vision analysis node using mimoTalk (mimo-v2.5)

Analyzes uploaded product images to extract:
- Product type and category
- Brand and model info
- Certification marks (CE, FCC, RoHS, etc.)
- Warning labels and language
- Physical characteristics

Usage: This node runs at graph entry, enriching the query with vision data.
"""
import os
# Disable system proxy for all urllib calls (prevents WinError 10060 on Windows)
os.environ.pop("HTTP_PROXY", None)
os.environ.pop("HTTPS_PROXY", None)
os.environ.pop("http_proxy", None)
os.environ.pop("https_proxy", None)
os.environ.setdefault("NO_PROXY", "*")

import json
import base64
import logging
import urllib.request
import urllib.error
from typing import Optional

logger = logging.getLogger(__name__)

PROMPT = """你是一位跨境电商产品合规专家。请仔细分析这张产品图片，提取以下信息用于合规评估：

1. **产品类型**：这是什么产品？（如：充电器、玩具、家电等）
2. **品牌/型号**：是否可见品牌名或型号？
3. **认证标志**：图片中是否可见以下认证标志？
   - CE（欧盟）、FCC（美国）、UKCA（英国）、CCC（中国）
   - RoHS、WEEE、REACH
   - 其他认证标志
4. **警告标签**：是否有警告文字或符号？是什么语言？
5. **铭牌信息**：电压、电流、功率等电气参数是否标注？
6. **产品描述**：简短描述产品外观和主要功能

请用中文输出，格式清晰有条理。"""

# ── Module-level singleton ─────────────────────────────────────────────────

_analyzer_instance = None
_is_injected = False


def set_vision_analyzer(analyzer):
    """Inject VisionAnalyzer from outside the graph (lifespan setup)."""
    global _analyzer_instance, _is_injected
    _analyzer_instance = analyzer
    _is_injected = True


def _get_analyzer():
    """Get analyzer with lazy initialization."""
    global _analyzer_instance, _is_injected
    if _analyzer_instance is None and not _is_injected:
        from rag_service.config import settings
        _analyzer_instance = VisionAnalyzer(settings.mimotalk_api_key or None)
    return _analyzer_instance


# ── VisionAnalyzer ────────────────────────────────────────────────────────

class VisionAnalyzer:
    """Vision analysis using mimoTalk mimo-v2.5 multi-modal API."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get("MIMOTALK_API_KEY", "")
        self.base_url = os.environ.get(
            "MIMOTALK_BASE_URL",
            "https://token-plan-sgp.xiaomimimo.com/anthropic/v1"
        )
        self.model = os.environ.get("MIMOTALK_MODEL", "mimo-v2.5")

    def _call_mimotalk(self, messages: list[dict], max_tokens: int = 512) -> str:
        """Call mimoTalk /messages endpoint."""
        if not self.api_key:
            return ""

        body = json.dumps({
            "model": self.model,
            "max_tokens": max_tokens,
            "messages": messages,
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

        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.loads(r.read())
                return data.get("content", [{}])[0].get("text", "")
        except urllib.error.HTTPError as e:
            logger.error(f"mimoTalk HTTP {e.code}: {e.read().decode('utf-8', errors='replace')[:200]}")
        except Exception as e:
            logger.error(f"mimoTalk error: {type(e).__name__}: {e}")
        return ""

    def analyze_single_image(self, image_data: bytes, mime_type: str = "image/jpeg") -> dict:
        """Analyze one image and return structured result."""
        if not self.api_key:
            return {"error": "no_api_key", "description": "", "certifications": []}

        b64 = base64.b64encode(image_data).decode("utf-8")

        text = self._call_mimotalk([{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": mime_type, "data": b64}},
                {"type": "text", "text": PROMPT},
            ],
        }])

        if not text:
            return {"error": "vision_call_failed", "description": "", "certifications": []}

        return _parse_vision_text(text, text)

    def analyze_images(self, images: list[dict]) -> dict:
        """
        Analyze multiple images and merge results.

        Args:
            images: list of {"buffer": bytes, "mime_type": str, "name": str}

        Returns:
            merged analysis: descriptions, certifications, enriched query
        """
        if not images or not self.api_key:
            return _empty_vision_result()

        descriptions = []
        seen_certs = {}

        for img in images:
            buf = img.get("buffer", b"")
            if not buf:
                continue

            result = self.analyze_single_image(
                buf,
                img.get("mime_type", "image/jpeg")
            )

            if result.get("description"):
                descriptions.append(result["description"])

            for cert in result.get("certifications", []):
                mark = cert["mark"]
                if mark not in seen_certs or cert["confidence"] == "high":
                    seen_certs[mark] = cert

        combined_desc = "\n\n".join(descriptions)
        certs_list = list(seen_certs.values())

        cert_str = ", ".join(c["mark"] for c in certs_list) if certs_list else "未发现认证标志"
        enriched_query = _build_vision_enriched_query(combined_desc, certs_list)

        return {
            "descriptions": descriptions,
            "combined_description": combined_desc,
            "certifications": certs_list,
            "images_analyzed": len(images),
            "enriched_query": enriched_query,
            "cert_summary": cert_str,
        }


def _parse_vision_text(raw: str, raw_response: str) -> dict:
    """Parse structured info from vision model output."""
    certifications = []
    upper = raw.upper()
    cert_map = {
        "CE": {"region": "EU"}, "FCC": {"region": "US"},
        "UKCA": {"region": "UK"}, "CCC": {"region": "CN"},
        "ROHS": {"region": "EU"}, "WEEE": {"region": "EU"},
        "REACH": {"region": "EU"},
    }
    for mark, info in cert_map.items():
        if mark in upper:
            certifications.append({"mark": mark, "region": info["region"], "confidence": "high"})
        elif mark[0] in upper:
            certifications.append({"mark": mark, "region": info["region"], "confidence": "low"})

    return {"description": raw, "certifications": certifications, "raw_response": raw_response}


def _build_vision_enriched_query(description: str, certifications: list[dict]) -> str:
    """Build an enriched query incorporating vision analysis."""
    if not description:
        return ""
    certs = [c["mark"] for c in certifications]
    cert_part = f"，已发现认证标志：{', '.join(certs)}" if certs else "，未发现明显认证标志"
    desc_snippet = description[:300].replace("\n", " ")
    return f"{desc_snippet}{cert_part}"


def _empty_vision_result() -> dict:
    return {
        "descriptions": [],
        "combined_description": "",
        "certifications": [],
        "images_analyzed": 0,
        "enriched_query": "",
        "cert_summary": "未分析",
    }


# ── Graph Node ───────────────────────────────────────────────────────────

def vision_analysis_node(state: dict) -> dict:
    """
    Entry node: analyze uploaded images and enrich query with vision data.

    Runs only when images are provided; otherwise passes through.
    When vision_result is pre-computed (e.g. via API), preserve it.
    """
    images = state.get("images", [])
    query = state.get("query", "")

    if not images:
        # Preserve pre-computed vision_result from API call
        existing = state.get("vision_result", {})
        if existing and existing.get("certifications"):
            logger.info("Vision node: using pre-computed vision_result from API")
            return {
                "agent_trace": state.get("agent_trace", []) + [
                    {"node": "vision", "status": "precomputed",
                     "certs": len(existing.get("certifications", [])),
                     "cert_summary": existing.get("cert_summary", "")}
                ],
            }
        logger.info("Vision node: no images provided, skipping")
        return {
            "vision_result": _empty_vision_result(),
            "agent_trace": state.get("agent_trace", []) + [{"node": "vision", "status": "skipped"}],
        }

    analyzer = _get_analyzer()
    if not analyzer or not analyzer.api_key:
        logger.warning("Vision analyzer not available, skipping")
        return {
            "vision_result": _empty_vision_result(),
            "agent_trace": state.get("agent_trace", []) + [{"node": "vision", "status": "no_api_key"}],
        }

    try:
        vision_data = analyzer.analyze_images(images)
        enriched_q = vision_data.get("enriched_query", "")
        combined = f"{query} {enriched_q}".strip() if enriched_q else query

        trace_entry = {
            "node": "vision",
            "images_count": len(images),
            "certifications_found": len(vision_data.get("certifications", [])),
            "description_length": len(vision_data.get("combined_description", "")),
        }

        logger.info(f"Vision node: analyzed {len(images)} images, found {len(vision_data.get('certifications', []))} certs")

        return {
            "vision_result": vision_data,
            "query": combined,
            "agent_trace": state.get("agent_trace", []) + [trace_entry],
        }
    except Exception as e:
        logger.error(f"Vision node failed: {e}")
        return {
            "vision_result": _empty_vision_result(),
            "agent_trace": state.get("agent_trace", []) + [{"node": "vision", "status": "error", "error": str(e)}],
        }
