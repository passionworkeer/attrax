#!/usr/bin/env python3
"""
vision.py - Vision analysis node using MiniMax-M3

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
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

logger = logging.getLogger(__name__)

PROMPT = """你是产品视觉取证助手。只记录图片中可观察到的事实；不要给出法规结论、认证结论、价格或上市建议。

返回一个 JSON 对象，不能使用 Markdown、代码围栏或额外文字：
{
  "product_type": "一个具体产品类型；不确定时为 无法识别具体产品类型",
  "identity_confidence": "high|medium|low",
  "core_features": ["最多 4 条可见且与合规相关的特征"],
  "visible_certification_marks": ["仅图片中实际清晰可见的 CE/FCC/UKCA/CCC/RoHS/WEEE/REACH 标志"],
  "unreadable_or_missing_evidence": ["例如：铭牌区域未展示、标签文字不可辨认；没有就 []"],
  "questions_needed": ["需要用户补充确认的信息；没有就 []"],
  "issues": [
    {
      "label": "一句话描述视觉问题（如：铭牌无 CCC 标志 / 接口无 CE 标记 / 包装缺警告语）",
      "severity": "critical|high|medium|low",
      "region": {"x": 0.0-1.0, "y": 0.0-1.0, "w": 0.0-1.0, "h": 0.0-1.0},
      "regulation_ref": "可选：相关法规 ID（如 EU-2014-35）；不确定时省略"
    }
  ]
}
只对**视觉上能定位**的问题输出 region；纯文本类问题（如"未提供说明书"）不要写 region。
如果图片中未发现明显的视觉合规问题，issues 留空数组 []。

硬性规则：
- “图片未展示/看不清标志”只写入 unreadable_or_missing_evidence，绝不能写成“缺少认证”或“不合规”。
- 不得由充电盒、电池仓或 USB 接口推断为充电宝、电源适配器或移动电源；宁可使用更宽泛的产品类型。
- 只有完整、清晰可见的标志才可写入 visible_certification_marks；文字提及或猜测不算可见标志。
- 不确定的产品类型使用“无法识别具体产品类型”，并在 questions_needed 中说明需要哪张补拍图。"""

PRODUCT_TYPE_KEYWORDS = {
    "充电宝": ["移动电源", "power bank", "便携式充电器"],
    "耳机": ["蓝牙耳机", "有线耳机", "earphone", "headphone", "earbuds"],
    "加湿器": ["超声波加湿器", "humidifier", "mist maker"],
    "电池": ["电池组", "battery pack", "锂电池", "lithium battery"],
    "玩具": ["儿童玩具", "玩具产品", "toy", "儿童产品"],
    "化妆品": ["美妆", "cosmetic", "护肤品"],
    "充电器": ["电源适配器", "USB charger", "充电头", "charging adapter"],
    "灯具": ["LED灯", "台灯", "light", "lamp", "照明"],
    "家电": ["家用电器", "household appliance"],
    "蓝牙音箱": ["蓝牙音箱", "蓝牙音箱", "Bluetooth speaker", "wireless speaker"],
}

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
        _analyzer_instance = VisionAnalyzer(settings.effective_minimax_api_key or None)
    return _analyzer_instance


# ── VisionAnalyzer ────────────────────────────────────────────────────────

class VisionAnalyzer:
    """Vision analysis using the MiniMax Anthropic-compatible API."""

    def __init__(self, api_key: Optional[str] = None):
        from rag_service.config import resolve_minimax_config
        self.api_key, self.base_url, self.model = resolve_minimax_config(api_key)

    def _call_mimotalk(self, messages: list[dict], max_tokens: int = 512) -> str:
        """Call the MiniMax Anthropic-compatible /messages endpoint.

        Retries up to 3 times on network/timeout class errors with exponential
        backoff (1s, 2s). HTTPError (4xx/5xx) is a business-level failure and
        is NOT retried — the request reached the server, so retrying the same
        payload is unlikely to help and could mask a real config problem.
        """
        if not self.api_key:
            return ""

        body = json.dumps({
            "model": self.model,
            "max_tokens": max_tokens,
            "temperature": 0.1,
            "messages": messages,
        }).encode("utf-8")

        max_retries = 3
        base_delays = [1, 2]  # sleeps before attempt 2 and attempt 3

        for attempt in range(1, max_retries + 1):
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
                # Business error — request reached server, do not retry.
                logger.error(f"mimoTalk HTTP {e.code}: {e.read().decode('utf-8', errors='replace')[:200]}")
                return ""
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
                # Network / timeout class — retryable.
                if attempt < max_retries:
                    delay = base_delays[attempt - 1]
                    logger.warning(
                        f"mimoTalk network error (attempt {attempt}/{max_retries}): "
                        f"{type(e).__name__}: {e}; retrying in {delay}s"
                    )
                    time.sleep(delay)
                    continue
                logger.error(f"mimoTalk exhausted retries: {type(e).__name__}: {e}")
                return ""
            except Exception as e:
                # Unknown failure — do not retry blindly; log and bail.
                logger.error(f"mimoTalk error: {type(e).__name__}: {e}")
                return ""
        return ""

    # Audit P1-J: sniff magic bytes BEFORE base64-encoding so we don't waste
    # an LLM roundtrip on a corrupted / mismatched / empty upload. Mirrors the
    # frontend's lib/upload-validation.ts signature checks.
    _MAGIC_SIGNATURES = {
        "image/jpeg": [b"\xff\xd8\xff"],
        "image/png": [b"\x89PNG\r\n\x1a\n"],
        "image/webp": [b"RIFF", b"WEBP"],  # 12-byte check (RIFF + WEBP at offset 8)
    }

    def _looks_like_image(self, image_data: bytes, mime_type: str) -> bool:
        if not image_data or len(image_data) < 12:
            return False
        signatures = self._MAGIC_SIGNATURES.get(mime_type)
        if not signatures:
            # Unknown mime type — let the LLM decide but skip the trust.
            return True
        head = image_data[:12]
        for sig in signatures:
            if sig == b"RIFF" and head.startswith(sig) and head[8:12] == b"WEBP":
                return True
            if sig != b"RIFF" and head.startswith(sig):
                return True
        return False

    def analyze_single_image(self, image_data: bytes, mime_type: str = "image/jpeg") -> dict:
        """Analyze one image and return structured result."""
        if not self.api_key:
            return {"error": "no_api_key", "description": "", "certifications": []}

        if not self._looks_like_image(image_data, mime_type):
            # Audit P1-J: do not waste an LLM roundtrip on a corrupt / mismatched
            # upload (the most common production failure was users renaming
            # a JPEG to .png without re-encoding). The frontend already blocks
            # these via lib/upload-validation.ts magic-byte checks; this guard
            # is the last line of defense for back-channel uploads.
            return {
                "error": "invalid_image_buffer",
                "description": "",
                "certifications": [],
            }

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
        Analyze multiple images in parallel and merge results.

        Args:
            images: list of {"buffer": bytes, "mime_type": str, "name": str}

        Returns:
            merged analysis: descriptions, certifications, enriched query
        """
        if not images or not self.api_key:
            return _empty_vision_result()

        if len(images) == 1:
            # Single image: no parallelism overhead
            result = self.analyze_single_image(
                images[0].get("buffer", b""),
                images[0].get("mime_type", "image/jpeg")
            )
            certs_list = result.get("certifications", [])
            cert_str = ", ".join(c["mark"] for c in certs_list) if certs_list else "未发现认证标志"
            enriched_query = _build_vision_enriched_query(
                result.get("description", ""), certs_list
            )
            # Feature 1 (2.5D hotspots): tag each issue with the image index
            # so the UI can route the hotspot to the right thumbnail.
            tagged_issues = [
                {**issue, "image_index": 0}
                for issue in result.get("issues") or []
            ]
            return {
                "descriptions": [result.get("description", "")] if result.get("description") else [],
                "combined_description": result.get("description", ""),
                "certifications": certs_list,
                "issues": tagged_issues,
                "images_analyzed": 1,
                "enriched_query": enriched_query,
                "cert_summary": cert_str,
            }

        # Multiple images: parallel analysis via ThreadPoolExecutor
        def _analyze_one(img: dict):
            buf = img.get("buffer", b"")
            if not buf:
                return None
            return self.analyze_single_image(buf, img.get("mime_type", "image/jpeg"))

        descriptions = []
        seen_certs = {}

        with ThreadPoolExecutor(max_workers=min(len(images), 4)) as pool:
            futures = [pool.submit(_analyze_one, img) for img in images]
            for future in as_completed(futures):
                try:
                    result = future.result()
                    if result and result.get("description"):
                        descriptions.append(result["description"])
                    for cert in (result or {}).get("certifications", []):
                        mark = cert["mark"]
                        if mark not in seen_certs or cert["confidence"] == "high":
                            seen_certs[mark] = cert
                except Exception as e:
                    logger.debug(f"Image analysis failed: {e}")
            # Feature 1: collect issues across all images, tagging each with
            # the index of the image that produced it so the UI can route
            # the hotspot to the correct thumbnail.
            all_issues: list[dict] = []
            for image_index, future in enumerate(futures):
                try:
                    r = future.result()
                except Exception:
                    continue
                for issue in (r or {}).get("issues") or []:
                    all_issues.append({**issue, "image_index": image_index})

        combined_desc = "\n\n".join(descriptions)
        certs_list = list(seen_certs.values())

        cert_str = ", ".join(c["mark"] for c in certs_list) if certs_list else "未发现认证标志"
        enriched_query = _build_vision_enriched_query(combined_desc, certs_list)

        return {
            "descriptions": descriptions,
            "combined_description": combined_desc,
            "certifications": certs_list,
            "issues": all_issues,
            "images_analyzed": len(images),
            "enriched_query": enriched_query,
            "cert_summary": cert_str,
        }


def _parse_vision_text(raw: str, raw_response: str) -> dict:
    """Parse structured info from vision model output."""
    cert_map = {
        "CE": {"region": "EU"}, "FCC": {"region": "US"},
        "UKCA": {"region": "UK"}, "CCC": {"region": "CN"},
        "ROHS": {"region": "EU"}, "WEEE": {"region": "EU"},
        "REACH": {"region": "EU"},
    }
    # M3 is asked for JSON. Keep the legacy heading parser below so historical
    # providers/results remain readable during a rolling deployment.
    candidate = (raw or "").strip()
    if candidate.startswith("```"):
        lines = candidate.splitlines()
        candidate = "\n".join(lines[1:-1] if len(lines) >= 2 else []).strip()
        if candidate.lower().startswith("json"):
            candidate = candidate[4:].lstrip()
    try:
        structured = json.loads(candidate)
    except (TypeError, ValueError, json.JSONDecodeError):
        structured = None
    if isinstance(structured, dict):
        def string_list(key: str, limit: int) -> list[str]:
            value = structured.get(key)
            if not isinstance(value, list):
                return []
            return [str(item).strip() for item in value if str(item).strip()][:limit]

        product_type = str(structured.get("product_type") or "").strip()
        if product_type in {"无法识别具体产品类型", "无法确定", "unknown", "Unknown"}:
            product_type = ""
        confidence = str(structured.get("identity_confidence") or "low").lower()
        if confidence not in {"high", "medium", "low"}:
            confidence = "low"
        features = string_list("core_features", 4)
        visible_marks = {
            item.upper() for item in string_list("visible_certification_marks", 8)
        }
        certifications = [
            {"mark": mark, "region": info["region"], "confidence": "high"}
            for mark, info in cert_map.items()
            if mark in visible_marks
        ]
        unreadable = string_list("unreadable_or_missing_evidence", 6)
        questions = string_list("questions_needed", 6)
        # Feature 1 (2.5D hotspots): parse the LLM-emitted `issues` array with
        # normalized 0..1 bbox coordinates. Each issue becomes a hotspot on
        # the result page. Bad / missing bbox or severity falls back to safe
        # defaults so a partial LLM output cannot crash the orchestrator.
        issues_raw = structured.get("issues") or []
        issues: list[dict] = []
        if isinstance(issues_raw, list):
            for idx, item in enumerate(issues_raw[:8]):
                if not isinstance(item, dict):
                    continue
                region = item.get("region") or item.get("bbox") or {}
                if not isinstance(region, dict):
                    continue
                try:
                    x = float(region.get("x", -1))
                    y = float(region.get("y", -1))
                    w = float(region.get("w", -1))
                    h = float(region.get("h", -1))
                except (TypeError, ValueError):
                    continue
                if not (0 <= x <= 1 and 0 <= y <= 1 and 0 < w <= 1 and 0 < h <= 1):
                    continue
                severity_raw = str(item.get("severity") or "medium").lower()
                if severity_raw not in {"critical", "high", "medium", "low"}:
                    severity_raw = "medium"
                issues.append({
                    "id": f"vision-issue-{idx}",
                    "label": str(item.get("label") or "").strip()[:200],
                    "severity": severity_raw,
                    "bbox": {"x": x, "y": y, "w": w, "h": h},
                    "regulation_ref": (
                        str(item.get("regulation_ref") or "").strip() or None
                    ),
                })
        description_parts = []
        if product_type:
            description_parts.append(f"产品类型：{product_type}")
        if features:
            description_parts.append("核心特征：" + "；".join(features))
        if certifications:
            description_parts.append("可见认证标志：" + "、".join(item["mark"] for item in certifications))
        if unreadable:
            description_parts.append("未验证视觉证据：" + "；".join(unreadable))
        return {
            "description": "\n".join(description_parts),
            "product_type": product_type,
            "identity_confidence": confidence,
            "core_features": features,
            "certifications": certifications,
            "unreadable_or_missing_evidence": unreadable,
            "questions_needed": questions,
            "issues": issues,
            "raw_response": raw_response,
            "enriched_query": _build_vision_enriched_query("\n".join(description_parts), certifications),
        }

    certifications = []
    upper = raw.upper()
    for mark, info in cert_map.items():
        # Word-boundary check so we don't match substrings like "CE" inside "CELL".
        if f" {mark} " in f" {upper} ":
            certifications.append({"mark": mark, "region": info["region"], "confidence": "high"})
        elif f"{mark}" in upper:
            # Only add if it's clearly a cert mention, not just text
            for line in raw.split("\n"):
                if mark in line.upper():
                    certifications.append({"mark": mark, "region": info["region"], "confidence": "medium"})
                    break

    # Extract product type from structured format
    product_type = ""
    core_features = []
    lines = raw.split("\n")
    current_section = ""
    for line in lines:
        line = line.strip()
        if "产品类型" in line:
            current_section = "product_type"
            continue
        elif "核心特征" in line or "特征" in line:
            current_section = "features"
            continue
        elif "认证标志" in line:
            current_section = "certs"
            continue

        if "###" in line:
            # Generic markdown heading without a recognised label — treat as product type
            current_section = "product_type"
            continue

        if current_section == "product_type" and line:
            # Only take the first meaningful line as product type
            if not product_type and line not in ["无法识别具体产品类型", "无法确定"]:
                product_type = line
        elif current_section == "features" and line:
            core_features.append(line)
        elif current_section == "certs" and line and line not in ["无明显认证标志", "未发现认证标志"]:
            for mark, info in cert_map.items():
                if mark in line.upper():
                    certs = [c["mark"] for c in certifications]
                    if mark not in certs:
                        certifications.append({"mark": mark, "region": info["region"], "confidence": "high"})

    # Build enriched query: product type + core features only (no extra expansion)
    cert_part = f"，认证标志：{', '.join(c['mark'] for c in certifications)}" if certifications else ""
    features_part = f"，特征：{'；'.join(core_features[:3])}" if core_features else ""
    enriched_query = f"{product_type}{features_part}{cert_part}" if product_type else raw[:300]

    return {
        "description": raw,
        "product_type": product_type,
        "core_features": core_features,
        "certifications": certifications,
        # Legacy heading-format output carries no bbox info; keep the key
        # present so downstream consumers see a uniform shape (Feature 1).
        "issues": [],
        "raw_response": raw_response,
        "enriched_query": enriched_query,
    }


def _build_vision_enriched_query(description: str, certifications: list[dict]) -> str:
    """Build a focused enriched query from structured vision output."""
    # Prefer structured fields if available
    if "###" in description:
        # Already structured — rebuild from raw
        lines = description.split("\n")
        parts = []
        for line in lines:
            line = line.strip()
            if "产品类型" in line or line.startswith("###"):
                continue
            if line and not line.startswith("###") and line not in ["无法识别具体产品类型"]:
                # Only include if it's likely product type or feature
                if len(line) < 60 and not line.startswith("重要提示"):
                    parts.append(line)
        if parts:
            return "，".join(parts[:4])
    return description[:300].replace("\n", " ")


def _empty_vision_result() -> dict:
    return {
        "descriptions": [],
        "combined_description": "",
        "certifications": [],
        "issues": [],
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
    start_time = time.time()
    images = state.get("images", [])
    query = state.get("query", "")

    if not images:
        # Preserve pre-computed vision_result from API call
        existing = state.get("vision_result", {})
        if existing and existing.get("certifications"):
            logger.info("Vision node: using pre-computed vision_result from API")
            return {
                "agent_trace": [
                    {"node": "vision", "status": "precomputed",
                     "certs": len(existing.get("certifications", [])),
                     "cert_summary": existing.get("cert_summary", "")}
                ],
            }
        logger.info("Vision node: no images provided, skipping")
        return {
            "vision_result": _empty_vision_result(),
            "agent_trace": [{"node": "vision", "status": "skipped", "duration_ms": 0}],
        }

    analyzer = _get_analyzer()
    if not analyzer or not analyzer.api_key:
        logger.warning("Vision analyzer not available, skipping")
        return {
            "vision_result": _empty_vision_result(),
            "agent_trace": [{"node": "vision", "status": "no_api_key"}],
        }

    try:
        vision_data = analyzer.analyze_images(images)
        enriched_q = vision_data.get("enriched_query", "")
        combined = f"{query} {enriched_q}".strip() if enriched_q else query

        trace_entry = {
            "node": "vision",
            "images_count": len(images),
            "certifications_found": len(vision_data.get("certifications", [])),
            "description_length": len(vision_data.get("combined_description", "")), "duration_ms": int((time.time() - start_time) * 1000),
        }

        logger.info(f"Vision node: analyzed {len(images)} images, found {len(vision_data.get('certifications', []))} certs")

        return {
            "vision_result": vision_data,
            "query": combined,
            "agent_trace": [trace_entry],
        }
    except Exception as e:
        logger.error(f"Vision node failed: {e}")
        return {
            "vision_result": _empty_vision_result(),
            "agent_trace": [{"node": "vision", "status": "error", "error": str(e)}],
        }
