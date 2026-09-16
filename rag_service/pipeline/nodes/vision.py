#!/usr/bin/env python3
"""
vision.py - Vision analysis node (MiniMax-M3 primary, DeepSeek fallback)

Analyzes uploaded product images to extract:
- Product type and category
- Brand and model info
- Certification marks (CE, FCC, RoHS, etc.)
- Warning labels and language
- Physical characteristics

The primary provider speaks Anthropic's /messages shape; the fallback speaks
OpenAI's /chat/completions shape. Callers build messages once in the Anthropic
shape and ``_to_openai_messages`` translates when the fallback is needed, so
the two prompts (free-form + checklist) stay provider-agnostic.

Usage: This node runs at graph entry, enriching the query with vision data.
"""
import os
# P1-8: proxy bypass used to be implemented by mutating ``os.environ`` at
# import time, which silently affects every other library in the process
# (httpx, requests, anything that reads HTTP_PROXY). Now we route through a
# dedicated opener below — the env vars are left untouched.

import json
import asyncio  # P1-7: asyncio.gather + Semaphore for multi-image dispatch
import base64
import logging
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

logger = logging.getLogger(__name__)


def _make_no_proxy_opener() -> urllib.request.OpenerDirector:
    """Return an opener that ignores system proxy settings.

    ``urllib.request.build_opener(ProxyHandler({}))`` installs an explicit
    empty-proxy handler that overrides any HTTP_PROXY/HTTPS_PROXY env vars
    for the resulting opener — but only for callers that go through this
    opener, not for the rest of the process. That was the bug P1-8 fixed:
    popping ``HTTP_PROXY`` from ``os.environ`` leaked to every other HTTP
    library the process happened to import.
    """
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


# Module-level singleton opener — ProxyHandler({}) is stateless, so a
# single shared instance is safe to reuse across calls and across threads.
_NO_PROXY_OPENER = _make_no_proxy_opener()

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

# ── Checklist observation prompt (plan 2026-09-13 §5 + §7.1 step 3) ─────────
# The checklist path replaces free-form issue emission for categories that
# have an inspection profile: the server selects checkIds from
# data/inspection_profiles/*.yaml, and the model ONLY returns per-check
# observations. It must not invent checkIds, regulations, prices, or
# pipeline nodes — those are server-owned.
CHECKLIST_PROMPT_TEMPLATE = """你是产品视觉取证助手。对下面列出的每个检查项，只报告"这张图里看到了什么、在哪里、看得清不清楚"。不要给出法规结论、合规判断、认证真伪、价格或建议。

检查项清单（每项必须出现在 observations 里，一项一条）：
{checklist}

返回一个 JSON 对象，不能使用 Markdown、代码围栏或额外文字：
{{
  "product_type": "一个具体产品类型；不确定时为 无法识别具体产品类型",
  "identity_confidence": "high|medium|low",
  "core_features": ["最多 4 条可见且与合规相关的特征"],
  "visible_certification_marks": ["仅图片中实际清晰可见的 CE/FCC/UKCA/CCC/RoHS/WEEE/REACH 标志"],
  "questions_needed": ["需要用户补充确认的信息；没有就 []"],
  "observations": [
    {{
      "check_id": "必须逐字使用清单里的 id",
      "visibility": "present_readable|present_unreadable|not_in_view|occluded|absent_in_visible_scope",
      "observed_text": "标签/文字上实际读到的内容；没有为 null",
      "description": "一句话描述看到的内容或为何看不到",
      "bbox": {{"x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0}}
    }}
  ]
}}

硬性规则：
- visibility 只能取上面五个值；清单里每一项都必须有一条 observation，不知道的用 not_in_view。
- bbox 是归一化坐标（0.0-1.0），只有**肉眼可定位**的观察才填 bbox；not_in_view 的项 bbox 为 null。
- absent_in_visible_scope 仅当完整标签区域清晰可见、但清单期望的字段确实未出现时使用；它不是"产品缺少该标识"的结论。
- 不得推断被遮挡/内部部件的属性；不得输出法规 ID 或合规结论。
- 只有完整、清晰可见的标志才可写入 visible_certification_marks。"""

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

# Bump when PROMPT / CHECKLIST_PROMPT_TEMPLATE semantics change — the
# observation cache keys on this so stale analyses never mix with new
# prompt behavior (plan §10.3: 图像观察按 hash＋模型＋Prompt 版本缓存).
VISION_PROMPT_VERSION = "vision-prompt/v2-2026-09-13"

_analyzer_instance = None
_is_injected = False
_vision_cache = None


def _get_vision_cache():
    global _vision_cache
    if _vision_cache is None:
        from rag_service.verify.vision_cache import VisionResponseCache

        _vision_cache = VisionResponseCache()
    return _vision_cache


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


def _to_openai_messages(messages: list[dict]) -> list[dict]:
    """Translate Anthropic-shaped messages into OpenAI-shaped ones.

    Only the parts the vision prompts actually use are translated: ``text``
    blocks pass through and ``image`` blocks (``source`` object) become
    ``image_url`` blocks carrying a ``data:`` URL. Anthropic carries the image
    as ``source.data`` + ``source.media_type``; the OpenAI-compatible endpoint
    wants one data URL and infers the format from the bytes.
    """
    converted: list[dict] = []
    for message in messages:
        content = message.get("content")
        if not isinstance(content, list):
            converted.append(message)
            continue
        blocks: list[dict] = []
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "image":
                source = block.get("source") or {}
                media_type = source.get("media_type") or "image/jpeg"
                data = source.get("data") or ""
                blocks.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:{media_type};base64,{data}"},
                })
            elif block.get("type") == "text":
                blocks.append({"type": "text", "text": block.get("text", "")})
        converted.append({**message, "content": blocks})
    return converted


# ── VisionAnalyzer ────────────────────────────────────────────────────────

class VisionAnalyzer:
    """Vision analysis: MiniMax Anthropic API, degrading to DeepSeek.

    MiniMax is the primary provider; when its call returns nothing (timeout,
    network failure, 4xx/5xx) the same image request is retried against the
    OpenAI-compatible fallback endpoint. ``available`` is True when either
    provider is configured, so a deployment with only the fallback key still
    gets visual evidence instead of a silently image-blind scan.
    """

    def __init__(self, api_key: Optional[str] = None, fallback_api_key: Optional[str] = None):
        from rag_service.config import resolve_deepseek_config, resolve_minimax_config
        self.api_key, self.base_url, self.model = resolve_minimax_config(api_key)
        (
            self.fallback_api_key,
            self.fallback_base_url,
            self.fallback_model,
            self.fallback_max_tokens,
        ) = resolve_deepseek_config(fallback_api_key)

    @property
    def available(self) -> bool:
        """True when at least one vision provider has credentials."""
        return bool(self.api_key or self.fallback_api_key)

    def _post_json(
        self,
        url: str,
        api_key: str,
        body: bytes,
        headers: dict,
        timeout: int = 60,
    ) -> Optional[dict]:
        """POST a JSON body and return the parsed response, or None.

        Retries up to 3 times on network/timeout class errors with exponential
        backoff (1s, 2s). HTTPError (4xx/5xx) is a business-level failure and
        is NOT retried — the request reached the server, so retrying the same
        payload is unlikely to help and could mask a real config problem.
        """
        max_retries = 3
        base_delays = [1, 2]  # sleeps before attempt 2 and attempt 3

        for attempt in range(1, max_retries + 1):
            req = urllib.request.Request(
                url,
                data=body,
                headers={"Authorization": f"Bearer {api_key}", **headers},
            )
            try:
                with _NO_PROXY_OPENER.open(req, timeout=timeout) as r:
                    return json.loads(r.read())
            except urllib.error.HTTPError as e:
                # Business error — request reached server, do not retry.
                logger.error(
                    f"vision HTTP {e.code} ({url}): "
                    f"{e.read().decode('utf-8', errors='replace')[:200]}"
                )
                return None
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
                # Network / timeout class — retryable.
                if attempt < max_retries:
                    delay = base_delays[attempt - 1]
                    logger.warning(
                        f"vision network error (attempt {attempt}/{max_retries}, {url}): "
                        f"{type(e).__name__}: {e}; retrying in {delay}s"
                    )
                    time.sleep(delay)
                    continue
                logger.error(f"vision exhausted retries ({url}): {type(e).__name__}: {e}")
                return None
            except Exception as e:
                # Unknown failure — do not retry blindly; log and bail.
                logger.error(f"vision error ({url}): {type(e).__name__}: {e}")
                return None
        return None

    def _call_mimotalk(self, messages: list[dict], max_tokens: int = 1536) -> str:
        """Call the MiniMax Anthropic-compatible /messages endpoint."""
        if not self.api_key:
            return ""

        body = json.dumps({
            "model": self.model,
            "max_tokens": max_tokens,
            "temperature": 0.1,
            "messages": messages,
        }).encode("utf-8")

        data = self._post_json(
            f"{self.base_url.rstrip('/')}/messages",
            self.api_key,
            body,
            headers={
                "Content-Type": "application/json",
                "anthropic-version": "2023-06-01",
                "x-api-key": self.api_key,
            },
        )
        if not isinstance(data, dict):
            return ""
        content = data.get("content") or [{}]
        if not isinstance(content, list) or not content:
            return ""
        first = content[0] if isinstance(content[0], dict) else {}
        return first.get("text", "")

    def _call_deepseek(self, messages: list[dict], max_tokens: Optional[int] = None) -> str:
        """Call the DeepSeek OpenAI-compatible /chat/completions endpoint.

        Fallback path only — the caller hands us Anthropic-shaped ``messages``
        and we translate them before sending. ``max_tokens`` defaults to the
        fallback provider's own budget, which is deliberately larger than the
        primary's: deepseek-flash is a reasoning model and its
        ``reasoning_content`` is billed against the same completion budget.
        """
        if not self.fallback_api_key:
            return ""

        budget = max_tokens or self.fallback_max_tokens
        body = json.dumps({
            "model": self.fallback_model,
            "max_tokens": budget,
            "temperature": 0.1,
            "messages": _to_openai_messages(messages),
        }).encode("utf-8")

        data = self._post_json(
            f"{self.fallback_base_url.rstrip('/')}/chat/completions",
            self.fallback_api_key,
            body,
            headers={"Content-Type": "application/json"},
        )
        if not isinstance(data, dict):
            return ""
        choices = data.get("choices") or [{}]
        if not isinstance(choices, list) or not choices:
            return ""
        first = choices[0] if isinstance(choices[0], dict) else {}
        message = first.get("message") or {}
        if not isinstance(message, dict):
            return ""
        content = message.get("content")
        if isinstance(content, str) and content.strip():
            return content
        # A reasoning model can burn the whole completion budget on
        # reasoning_content and still return HTTP 200 with an empty answer.
        # That is a budget problem, not a provider outage — say so, otherwise
        # it reads as "the fallback is down too" and someone re-checks the key.
        if message.get("reasoning_content"):
            logger.error(
                "vision fallback (%s) spent its %d-token budget on reasoning "
                "without emitting an answer; raise DEEPSEEK_MAX_TOKENS",
                self.fallback_model,
                budget,
            )
        return ""

    def _vision_text(
        self,
        image_data: bytes,
        mime_type: str,
        prompt: str,
        checks: Optional[list[dict]],
        max_tokens: int,
    ) -> str:
        """Return the raw model text for one image, primary provider first.

        Cache layering: a hit under the primary key short-circuits both
        providers. A fallback result is cached under its own provider-keyed
        entry so a later primary success is never served the fallback's text
        (and vice versa). The primary is still re-attempted on the next call —
        the fallback is a degradation, so a cached fallback answer must never
        pre-empt a primary provider that has recovered.
        """
        cache = _get_vision_cache()
        primary_key = cache.cache_key(
            image_data, self.model, VISION_PROMPT_VERSION, checks
        )
        cached = cache.get(primary_key)
        if cached:
            return cached

        messages = [{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": mime_type,
                        "data": base64.b64encode(image_data).decode("utf-8"),
                    },
                },
                {"type": "text", "text": prompt},
            ],
        }]

        text = self._call_mimotalk(messages, max_tokens=max_tokens)
        if text:
            cache.put(primary_key, text)
            return text

        return self._vision_text_from_fallback(messages, image_data, checks)

    def _vision_text_from_fallback(
        self,
        messages: list[dict],
        image_data: bytes,
        checks: Optional[list[dict]],
    ) -> str:
        """Serve one image from the fallback provider (empty when unconfigured).

        The primary's ``max_tokens`` is intentionally not forwarded: the two
        providers have different output budgets (see ``_call_deepseek``).
        """
        if not self.fallback_api_key:
            return ""

        cache = _get_vision_cache()
        fallback_key = cache.cache_key(
            image_data, self.fallback_model, VISION_PROMPT_VERSION, checks
        )
        cached = cache.get(fallback_key)
        if cached:
            return cached

        text = self._call_deepseek(messages)
        if text:
            logger.warning(
                "vision: primary provider (%s) failed, served by fallback (%s)",
                self.model,
                self.fallback_model,
            )
            cache.put(fallback_key, text)
        return text

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
        if not self.available:
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

        text = self._vision_text(image_data, mime_type, PROMPT, None, 1536)

        if not text:
            return {"error": "vision_call_failed", "description": "", "certifications": []}

        return _parse_vision_text(text, text)

    def analyze_single_image_with_checks(
        self,
        image_data: bytes,
        mime_type: str,
        checks: list[dict],
    ) -> dict:
        """Checklist-mode analysis (plan 2026-09-13 §7.1 step 3).

        ``checks`` is a list of ``{"id", "title"}`` dicts from the category's
        inspection profile. The model answers per-check observations only;
        legacy ``issues`` remains empty because judgments moved to the
        findings layer. Falls back to the legacy free-form prompt when the
        checklist call fails, so an LLM hiccup degrades to the old behavior
        instead of killing the scan.
        """
        if not self.available:
            return {"error": "no_api_key", "description": "", "certifications": [], "observations": []}

        if not self._looks_like_image(image_data, mime_type):
            return {
                "error": "invalid_image_buffer",
                "description": "",
                "certifications": [],
                "observations": [],
            }

        checklist_block = "\n".join(
            f"- id: {item['id']}｜{item.get('title') or item['id']}" for item in checks
        )
        prompt = CHECKLIST_PROMPT_TEMPLATE.format(checklist=checklist_block)
        text = self._vision_text(image_data, mime_type, prompt, checks, 3072)
        if not text:
            # Checklist call failed — fall back to the legacy prompt so the
            # scan still gets vision data (observations stay empty).
            legacy = self.analyze_single_image(image_data, mime_type)
            legacy.setdefault("observations", [])
            return legacy

        parsed = _parse_vision_text(text, text)
        parsed.setdefault("observations", [])
        return parsed

    def analyze_images_with_checks(
        self,
        images: list[dict],
        checks: list[dict],
        session_id: str = "scan",
    ) -> dict:
        """Multi-image checklist analysis returning merged observations.

        Single-image path avoids the thread pool; multi-image runs the same
        bounded parallelism as ``analyze_images`` (≤4 workers).
        """
        if not images or not self.available:
            result = _empty_vision_result()
            result["observations"] = []
            return result

        selected_check_ids = [item["id"] for item in checks]

        if len(images) == 1:
            result = self.analyze_single_image_with_checks(
                images[0].get("buffer", b""),
                images[0].get("mime_type", images[0].get("mimeType", "image/jpeg")),
                checks,
            )
            observations = _parse_checklist_observations(
                result, 0, session_id, selected_check_ids
            )
            legacy_result = self._legacy_shape_from(result)
            legacy_result["observations"] = observations
            return legacy_result

        # P1-7: replace the ThreadPoolExecutor with asyncio.gather under a
        # bounded semaphore. ``_call_mimotalk`` is still sync (urllib-based)
        # so each per-image call is wrapped in ``asyncio.to_thread`` to keep
        # the event loop unblocked. ``vision_analysis_node`` runs in an
        # executor worker thread that has no running event loop, so
        # ``asyncio.run`` is safe; if a future caller invokes us from inside
        # an async context we fall back to the old ThreadPoolExecutor.
        concurrency = min(len(images), 4)
        results = self._run_parallel_with_checks(images, checks, concurrency)
        raw_results: list[dict | None] = list(results)

        descriptions: list[str] = []
        seen_certs: dict[str, dict] = {}
        observations: list[dict] = []
        for index, result in enumerate(raw_results):
            if not result:
                continue
            if result.get("description"):
                descriptions.append(result["description"])
            for cert in result.get("certifications", []):
                mark = cert["mark"]
                if mark not in seen_certs or cert.get("confidence") == "high":
                    seen_certs[mark] = cert
            structured = result if isinstance(result, dict) else {}
            observations.extend(
                _parse_checklist_observations(
                    structured, index, session_id, selected_check_ids
                )
            )

        certs_list = list(seen_certs.values())
        cert_str = ", ".join(c["mark"] for c in certs_list) if certs_list else "未发现认证标志"
        combined = "\n\n".join(descriptions)
        return {
            "descriptions": descriptions,
            "combined_description": combined,
            "certifications": certs_list,
            "issues": [],  # checklist mode: judgments live in findings, not here
            "observations": observations,
            "images_analyzed": len(images),
            "enriched_query": _build_vision_enriched_query(combined, certs_list),
            "cert_summary": cert_str,
        }

    @staticmethod
    def _legacy_shape_from(result: dict) -> dict:
        """Map a checklist-mode single-image result onto the legacy shape."""
        certs_list = result.get("certifications", [])
        description = result.get("description", "")
        return {
            "descriptions": [description] if description else [],
            "combined_description": description,
            "certifications": certs_list,
            "issues": result.get("issues", []),
            "images_analyzed": 1,
            "enriched_query": _build_vision_enriched_query(description, certs_list),
            "cert_summary": ", ".join(c["mark"] for c in certs_list) if certs_list else "未发现认证标志",
        }

    # ── P1-7 parallel dispatch helpers ────────────────────────────────────
    #
    # ``analyze_images`` / ``analyze_images_with_checks`` previously ran
    # per-image calls through a ``concurrent.futures.ThreadPoolExecutor``.
    # That works but stacks two thread pools (the LLM is sync, but the
    # pipeline node runs in ``run_in_executor`` already). Switching to
    # ``asyncio.gather`` + ``asyncio.Semaphore`` lets a single event loop
    # schedule N concurrent sync calls via ``asyncio.to_thread`` — same
    # bounded parallelism, no extra executor pool.

    def _run_parallel_with_checks(
        self,
        images: list[dict],
        checks: list[dict],
        concurrency: int,
    ) -> list[dict | None]:
        """Bounded-parallel checklist analysis.

        Returns a list aligned with ``images``: ``None`` for empty-buffer
        or failed entries, the parsed dict on success.
        """
        try:
            return asyncio.run(
                self._gather_with_checks(images, checks, concurrency)
            )
        except RuntimeError:
            # Already inside a running event loop — fall back to the
            # legacy ThreadPoolExecutor path so an async caller doesn't
            # crash on us.
            return self._gather_with_checks_threadpool(images, checks, concurrency)

    def _run_parallel_legacy(
        self,
        images: list[dict],
        concurrency: int,
    ) -> list[dict | None]:
        """Bounded-parallel legacy analysis (no checks)."""
        try:
            return asyncio.run(self._gather_legacy(images, concurrency))
        except RuntimeError:
            return self._gather_legacy_threadpool(images, concurrency)

    async def _gather_with_checks(
        self,
        images: list[dict],
        checks: list[dict],
        concurrency: int,
    ) -> list[dict | None]:
        semaphore = asyncio.Semaphore(concurrency)

        async def one(img: dict) -> dict | None:
            buf = img.get("buffer", b"")
            if not buf:
                return None
            async with semaphore:
                # analyze_single_image_with_checks is sync; offload to a
                # worker thread so the event loop stays unblocked.
                return await asyncio.to_thread(
                    self.analyze_single_image_with_checks,
                    buf,
                    img.get("mime_type", img.get("mimeType", "image/jpeg")),
                    checks,
                )

        tasks = [one(img) for img in images]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        ordered: list[dict | None] = []
        for index, value in enumerate(results):
            if isinstance(value, BaseException):
                logger.debug(
                    "checklist analysis failed for image %d: %s",
                    index,
                    value,
                )
                ordered.append(None)
            else:
                ordered.append(value)
        return ordered

    async def _gather_legacy(
        self,
        images: list[dict],
        concurrency: int,
    ) -> list[dict | None]:
        semaphore = asyncio.Semaphore(concurrency)

        async def one(img: dict) -> dict | None:
            buf = img.get("buffer", b"")
            if not buf:
                return None
            async with semaphore:
                return await asyncio.to_thread(
                    self.analyze_single_image,
                    buf,
                    img.get("mime_type", "image/jpeg"),
                )

        tasks = [one(img) for img in images]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        ordered: list[dict | None] = []
        for index, value in enumerate(results):
            if isinstance(value, BaseException):
                logger.debug("Image analysis failed for image %d: %s", index, value)
                ordered.append(None)
            else:
                ordered.append(value)
        return ordered

    def _gather_with_checks_threadpool(
        self,
        images: list[dict],
        checks: list[dict],
        concurrency: int,
    ) -> list[dict | None]:
        """ThreadPoolExecutor fallback when an event loop is already running."""
        raw_results: list[dict | None] = [None] * len(images)
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            futures = {
                pool.submit(
                    self.analyze_single_image_with_checks,
                    img.get("buffer", b""),
                    img.get("mime_type", img.get("mimeType", "image/jpeg")),
                    checks,
                ): index
                for index, img in enumerate(images)
            }
            for future, index in futures.items():
                try:
                    raw_results[index] = future.result()
                except Exception as exc:  # pragma: no cover — defensive
                    logger.debug(
                        "checklist analysis failed for image %d: %s", index, exc
                    )
        return raw_results

    def _gather_legacy_threadpool(
        self,
        images: list[dict],
        concurrency: int,
    ) -> list[dict | None]:
        """ThreadPoolExecutor fallback for legacy multi-image path."""
        def _analyze_one(img: dict) -> dict | None:
            buf = img.get("buffer", b"")
            if not buf:
                return None
            return self.analyze_single_image(buf, img.get("mime_type", "image/jpeg"))

        raw_results: list[dict | None] = [None] * len(images)
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            futures = {
                pool.submit(_analyze_one, img): index
                for index, img in enumerate(images)
            }
            for future, index in futures.items():
                try:
                    raw_results[index] = future.result()
                except Exception as exc:
                    logger.debug("Image analysis failed for image %d: %s", index, exc)
        return raw_results

    def analyze_images(self, images: list[dict]) -> dict:
        """
        Analyze multiple images in parallel and merge results.

        Args:
            images: list of {"buffer": bytes, "mime_type": str, "name": str}

        Returns:
            merged analysis: descriptions, certifications, enriched query
        """
        if not images or not self.available:
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

        # Multiple images: bounded parallelism. P1-7: prefer
        # ``asyncio.gather`` + ``asyncio.Semaphore`` over ThreadPoolExecutor;
        # each per-image call is sync (urllib urlopen) so it goes through
        # ``asyncio.to_thread``. ``vision_analysis_node`` runs in an executor
        # worker thread with no running event loop; if a future caller is
        # already inside one, ``_run_parallel_legacy`` falls back to the
        # ThreadPoolExecutor path to stay safe.
        concurrency = min(len(images), 4)
        results = self._run_parallel_legacy(images, concurrency)

        descriptions = []
        seen_certs = {}

        for result in results:
            if result and result.get("description"):
                descriptions.append(result["description"])
            for cert in (result or {}).get("certifications", []):
                mark = cert["mark"]
                if mark not in seen_certs or cert["confidence"] == "high":
                    seen_certs[mark] = cert
            # Feature 1: collect issues across all images, tagging each with
            # the index of the image that produced it so the UI can route
            # the hotspot to the correct thumbnail.
        all_issues: list[dict] = []
        for image_index, result in enumerate(results):
            for issue in (result or {}).get("issues") or []:
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
            # Checklist mode (plan §5): the model's per-check observations
            # array passes through raw — _parse_checklist_observations
            # normalizes/validates it per session. Found via the 2026-09-13
            # production scan: the model returned perfect observations but
            # this dict dropped the key, so every check backfilled to
            # not_assessed.
            "observations": structured.get("observations")
            if isinstance(structured.get("observations"), list)
            else [],
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


# ── Checklist observation parsing (plan 2026-09-13 §7.1 step 3) ─────────────

_VALID_VISIBILITIES = {
    "present_readable",
    "present_unreadable",
    "not_in_view",
    "occluded",
    "absent_in_visible_scope",
}


def _parse_checklist_observations(
    structured: dict,
    image_index: int,
    session_id: str,
    selected_check_ids: list[str],
) -> list[dict]:
    """Normalize the model's per-check observations to the v2 contract.

    Enforces:
    - every emitted check_id must be one of the server-selected ids
      (unknown ids are dropped, not passed through)
    - visibility must be one of the five states (default not_in_view)
    - bbox passes through raw; grounding.py validates/clamps later
    - ids carry the scan + image identity (audit §6: "ID 至少带本次扫描与
      图片的身份,不能每张图从 vision-issue-0 重复编号")
    """
    raw_observations = structured.get("observations")
    if not isinstance(raw_observations, list):
        return []

    selected = set(selected_check_ids)
    parsed: list[dict] = []
    for position, item in enumerate(raw_observations):
        if not isinstance(item, dict):
            continue
        check_id = str(item.get("check_id") or item.get("checkId") or "").strip()
        if check_id not in selected:
            continue
        visibility = str(item.get("visibility") or "").strip().lower()
        if visibility not in _VALID_VISIBILITIES:
            visibility = "not_in_view"

        observed_text = item.get("observed_text") or item.get("observedText")
        bbox_raw = item.get("bbox") or item.get("region")
        bbox: dict | None = None
        if isinstance(bbox_raw, dict) and bbox_raw:
            try:
                bbox = {
                    "x": float(bbox_raw.get("x", -1)),
                    "y": float(bbox_raw.get("y", -1)),
                    "w": float(bbox_raw.get("w", bbox_raw.get("width", -1))),
                    "h": float(bbox_raw.get("h", bbox_raw.get("height", -1))),
                }
            except (TypeError, ValueError):
                bbox = None
            else:
                if bbox["w"] <= 0 or bbox["h"] <= 0:
                    bbox = None

        parsed.append(
            {
                "observationId": f"{session_id}-img{image_index}-obs{position}",
                "checkId": check_id,
                "imageIndex": image_index,
                "imageId": f"vision-image-{image_index}",
                "visibility": visibility,
                "observedText": (
                    str(observed_text).strip()[:500]
                    if isinstance(observed_text, str) and observed_text.strip()
                    else None
                ),
                "description": str(item.get("description") or "").strip()[:500],
                "region": (
                    {
                        "kind": "bbox",
                        "coordinateSpace": "normalized_canonical_image",
                        "bbox": bbox,
                    }
                    if bbox
                    else None
                ),
            }
        )

    # Server-side full-set validation: every selected check must come back.
    # Missing ones get backfilled as not_assessed so a partial model response
    # can never look like "all clear" (plan §5.1).
    returned = {entry["checkId"] for entry in parsed}
    for check_id in selected_check_ids:
        if check_id in returned:
            continue
        parsed.append(
            {
                "observationId": f"{session_id}-img{image_index}-{check_id}-unassessed",
                "checkId": check_id,
                "imageIndex": image_index,
                "imageId": f"vision-image-{image_index}",
                "visibility": "not_assessed",
                "observedText": None,
                "description": "",
                "region": None,
            }
        )
    return parsed


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

    Checklist mode (plan 2026-09-13 §5): when the category has an
    inspection profile, the model receives the fixed check list and
    returns per-check observations instead of free-form issues. The
    legacy free-form path still runs when no profile exists (``other``
    without confirmation, legacy callers) so behavior degrades, not
    breaks.
    """
    start_time = time.time()
    images = state.get("images", [])
    query = state.get("query", "")
    category = str(state.get("category") or "").strip().lower()
    session_id = str(state.get("session_id") or "scan")

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
    if not analyzer or not analyzer.available:
        logger.warning("Vision analyzer not available, skipping")
        return {
            "vision_result": _empty_vision_result(),
            "agent_trace": [{"node": "vision", "status": "no_api_key"}],
        }

    # Checklist selection: category → profile → visual checks. Categories
    # with no profile file fall back to the legacy free-form prompt.
    checklist_checks: list[dict] = []
    if category:
        try:
            from rag_service.pipeline.nodes.visual_checks import (
                effective_checks,
            )
            checklist_checks = [
                {"id": check.id, "title": check.title}
                for check in effective_checks(category)
                if any(method in {"vision", "ocr"} for method in check.methods)
            ]
        except Exception as exc:
            logger.warning("inspection profile load failed (%s); using legacy vision", exc)
            checklist_checks = []

    try:
        if checklist_checks:
            vision_data = analyzer.analyze_images_with_checks(
                images, checklist_checks, session_id=session_id
            )
            mode = "checklist"
        else:
            vision_data = analyzer.analyze_images(images)
            mode = "freeform"

        enriched_q = vision_data.get("enriched_query", "")
        combined = f"{query} {enriched_q}".strip() if enriched_q else query

        trace_entry = {
            "node": "vision",
            "mode": mode,
            "check_count": len(checklist_checks),
            "images_count": len(images),
            "certifications_found": len(vision_data.get("certifications", [])),
            "description_length": len(vision_data.get("combined_description", "")), "duration_ms": int((time.time() - start_time) * 1000),
        }
        observations = vision_data.get("observations") or []
        if observations:
            trace_entry["observation_count"] = len(observations)

        logger.info(
            f"Vision node: analyzed {len(images)} images (mode={mode}), "
            f"found {len(vision_data.get('certifications', []))} certs, "
            f"{len(observations)} observations"
        )

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
