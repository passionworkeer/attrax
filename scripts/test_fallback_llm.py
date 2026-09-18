#!/usr/bin/env python3
"""对比实测 MiniMax 主通道与 DeepSeek 降级通道（报告生成 + 视觉）。

直接 urllib 调两个 provider 的真实 API，绕过本地 RAG 服务，
验证降级链路能产出可解析的 JSON、统计输出字符数与延迟。

用法：
  python3 scripts/test_fallback_llm.py            # 全跑
  python3 scripts/test_fallback_llm.py report    # 只跑报告生成
  python3 scripts/test_fallback_llm.py vision    # 只跑视觉

不写盘、不污染 data/backend/，输出纯文本到 stdout。
"""
import argparse
import base64
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

PROJECT_ROOT = Path(__file__).parent.parent
RAG_ENV = PROJECT_ROOT / "rag_service" / ".env"


def _load_env_file(path: Path) -> Dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip()
    return out


def _no_proxy_opener() -> urllib.request.OpenerDirector:
    """Mirror rag_service/pipeline/nodes/vision.py: bypass system proxies
    explicitly on the opener instead of mutating os.environ (P1-8)."""
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


_OPENER = _no_proxy_opener()


def _post(url: str, body: bytes, headers: dict, timeout: float) -> Tuple[int, Any, float]:
    """Return (status, json_or_text, elapsed_seconds)."""
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    start = time.time()
    try:
        with _OPENER.open(req, timeout=timeout) as r:
            text = r.read().decode("utf-8", errors="replace")
            try:
                return r.status, json.loads(text), time.time() - start
            except Exception:
                return r.status, text, time.time() - start
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace") if e.fp else ""
        try:
            return e.code, json.loads(body_text), time.time() - start
        except Exception:
            return e.code, body_text, time.time() - start


def _extract_text_anthropic(data: dict) -> Tuple[str, str]:
    """Return (concatenated_text, stop_reason). Anthropic shape: content[].text."""
    blocks = data.get("content") or []
    parts = []
    for b in blocks:
        if isinstance(b, dict) and b.get("type") == "text":
            parts.append(b.get("text") or "")
    return "".join(parts), str(data.get("stop_reason") or "")


def _extract_text_openai(data: dict) -> Tuple[str, str]:
    """Return (concatenated_text, finish_reason). OpenAI shape: choices[].message.content."""
    choices = data.get("choices") or []
    if not choices:
        return "", ""
    msg = choices[0].get("message") or {}
    return (msg.get("content") or ""), str(choices[0].get("finish_reason") or "")


# ── Report generation ─────────────────────────────────────────────────────

REPORT_SYSTEM_PROMPT = """你是跨境电商合规专家。根据用户上传的产品图片，生成精准的合规报告。

**核心工作流：** 1) 确认产品类型；2) 审查相关法规；3) 输出合规报告；4) 标注来源。

**报告结构（中文输出）：**

## [产品名] 合规要求（针对该产品）
## [产品名] 禁止/限制项目
## [产品名] 合规建议
## 法规引用

来源文档：
[1] (EU) 2023/1542 Art. 77 — 电池生产者责任延伸
[2] IEC 62133-2:2017 — 含碱性或非酸性电解质的蓄电池和蓄电池组
[3] UN 38.3 — 锂电池运输安全

硬性输出要求（不可违反）：
- 整个 JSON 控制在 12000 个字符以内
- complianceReport 不超过 1200 个汉字
- 严禁使用 Markdown 代码围栏（```）包裹 JSON
- 输出必须是可解析的 JSON，不要输出任何额外解释"""

REPORT_USER_PROMPT = """产品类型：蓝牙耳机（带充电盒，3.7V 锂电池）
目标市场：EU
用户问题：这款蓝牙耳机出口欧盟需要什么认证？

请基于来源文档生成 JSON 格式的合规报告。"""

REPORT_JSON_SCHEMA = """{
  "complianceReport": "markdown string（中文，含 [来源] 标注）",
  "profitReport": {"markdown": "string", "keyConclusion": "string"},
  "roadmap": {"totalDays": 56, "items": [{"id": "1", "title": "string", "description": "string", "type": "apply", "status": "pending"}]},
  "decisionView": {"verdict": "PASS|WARN|REJECTED|UNKNOWN", "riskLevel": "CRITICAL|HIGH|MEDIUM|LOW", "summary": "string", "nodes": [{"id": "vision", "severity": "critical|high|medium|info", "label": "string"}]}
}"""


def test_report(minimax_key: str, minimax_base: str, deepseek_key: str, deepseek_anthropic_base: str, deepseek_model: str) -> Dict[str, Any]:
    """Run MiniMax vs DeepSeek on the same report prompt and return side-by-side stats."""
    # Force the JSON schema into the system prompt so both providers have the
    # same instruction set (mirrors what generate_report_package builds).
    system = REPORT_SYSTEM_PROMPT + "\n\nJSON schema (required):\n" + REPORT_JSON_SCHEMA

    results = []

    # ── MiniMax (primary, Anthropic-compatible /messages) ──
    body = json.dumps({
        "model": "MiniMax-M3",
        "max_tokens": 6144,
        "temperature": 0.2,
        "system": system,
        "messages": [{"role": "user", "content": REPORT_USER_PROMPT}],
    }).encode("utf-8")
    status, data, elapsed = _post(
        f"{minimax_base.rstrip('/')}/messages",
        body,
        {
            "Authorization": f"Bearer {minimax_key}",
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
            "x-api-key": minimax_key,
        },
        timeout=240.0,
    )
    text, stop_reason = ("", "")
    parsed = None
    parse_err = None
    if isinstance(data, dict):
        text, stop_reason = _extract_text_anthropic(data)
        try:
            parsed = json.loads(text)
        except Exception as exc:
            parse_err = f"{type(exc).__name__}: {exc}"
    results.append({
        "provider": "MiniMax-M3 (primary)",
        "endpoint": "Anthropic /messages",
        "max_tokens": 6144,
        "status": status,
        "elapsed_s": round(elapsed, 1),
        "stop_reason": stop_reason,
        "output_chars": len(text),
        "json_parse_ok": parsed is not None,
        "json_parse_err": parse_err,
        "first_200": text[:200],
    })

    # ── DeepSeek (fallback, Anthropic-compatible /messages) ──
    body = json.dumps({
        "model": deepseek_model,
        "max_tokens": 16384,
        "temperature": 0.2,
        "reasoning": {"effort": "none"},
        "system": system,
        "messages": [{"role": "user", "content": REPORT_USER_PROMPT}],
    }).encode("utf-8")
    status, data, elapsed = _post(
        f"{deepseek_anthropic_base.rstrip('/')}/messages",
        body,
        {
            "Authorization": f"Bearer {deepseek_key}",
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
            "x-api-key": deepseek_key,
        },
        timeout=240.0,
    )
    text, stop_reason = ("", "")
    parsed = None
    parse_err = None
    if isinstance(data, dict):
        text, stop_reason = _extract_text_anthropic(data)
        try:
            parsed = json.loads(text)
        except Exception as exc:
            parse_err = f"{type(exc).__name__}: {exc}"
    results.append({
        "provider": f"DeepSeek {deepseek_model} (fallback)",
        "endpoint": "Anthropic /messages",
        "max_tokens": 16384,
        "status": status,
        "elapsed_s": round(elapsed, 1),
        "stop_reason": stop_reason,
        "output_chars": len(text),
        "json_parse_ok": parsed is not None,
        "json_parse_err": parse_err,
        "first_200": text[:200],
    })

    return {"results": results}


# ── Vision ────────────────────────────────────────────────────────────────

VISION_PROMPT = """你是产品视觉取证助手。只记录图片中可观察到的事实。

返回一个 JSON 对象：
{
  "product_type": "一个具体产品类型",
  "identity_confidence": "high|medium|low",
  "core_features": ["最多 4 条可见特征"],
  "visible_certification_marks": ["仅图片中实际清晰可见的 CE/FCC/UKCA 等标志"],
  "visible_marks": [{"mark": "CE", "bbox": {"x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0}}],
  "unreadable_or_missing_evidence": [],
  "questions_needed": [],
  "observations": [{"check_id": "ce_mark", "visibility": "present_readable", "observed_text": "CE", "description": "位于铭牌右下角", "bbox": {"x": 0.7, "y": 0.8, "w": 0.05, "h": 0.03}}]
}

硬性规则：visibility 只能取 present_readable / present_unreadable / not_in_view / occluded / absent_in_visible_scope。"""


def _b64_image(path: Path) -> tuple[str, str]:
    data = path.read_bytes()
    mt = "image/jpeg"
    if data.startswith(b"\x89PNG"):
        mt = "image/png"
    elif data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        mt = "image/webp"
    return base64.b64encode(data).decode("ascii"), mt


def test_vision(image_path: Path, minimax_key: str, minimax_base: str, deepseek_key: str, deepseek_base: str, deepseek_model: str) -> Dict[str, Any]:
    if not image_path.exists():
        return {"error": f"image not found: {image_path}"}
    b64, mime = _b64_image(image_path)

    results = []
    messages = [{
        "role": "user",
        "content": [
            {"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}},
            {"type": "text", "text": VISION_PROMPT},
        ],
    }]

    # ── MiniMax (primary, Anthropic /messages) ──
    body = json.dumps({
        "model": "MiniMax-M3",
        "max_tokens": 1536,
        "temperature": 0.1,
        "messages": messages,
    }).encode("utf-8")
    status, data, elapsed = _post(
        f"{minimax_base.rstrip('/')}/messages",
        body,
        {
            "Authorization": f"Bearer {minimax_key}",
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
            "x-api-key": minimax_key,
        },
        timeout=120.0,
    )
    text, stop_reason = ("", "")
    parsed = None
    parse_err = None
    if isinstance(data, dict):
        text, stop_reason = _extract_text_anthropic(data)
        try:
            parsed = json.loads(text)
        except Exception as exc:
            parse_err = f"{type(exc).__name__}: {exc}"
    results.append({
        "provider": "MiniMax-M3 (primary)",
        "endpoint": "Anthropic /messages",
        "max_tokens": 1536,
        "status": status,
        "elapsed_s": round(elapsed, 1),
        "stop_reason": stop_reason,
        "output_chars": len(text),
        "json_parse_ok": parsed is not None,
        "json_parse_err": parse_err,
        "first_200": text[:200],
    })

    # ── DeepSeek (fallback, OpenAI /chat/completions) ──
    openai_messages = [{
        "role": "user",
        "content": [
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
            {"type": "text", "text": VISION_PROMPT},
        ],
    }]
    body = json.dumps({
        "model": deepseek_model,
        "max_tokens": 16384,
        "temperature": 0.1,
        "thinking": {"type": "disabled"},
        "messages": openai_messages,
    }).encode("utf-8")
    status, data, elapsed = _post(
        f"{deepseek_base.rstrip('/')}/chat/completions",
        body,
        {"Authorization": f"Bearer {deepseek_key}", "Content-Type": "application/json"},
        timeout=120.0,
    )
    text, finish_reason = ("", "")
    parsed = None
    parse_err = None
    if isinstance(data, dict):
        text, finish_reason = _extract_text_openai(data)
        try:
            parsed = json.loads(text)
        except Exception as exc:
            parse_err = f"{type(exc).__name__}: {exc}"
    results.append({
        "provider": f"DeepSeek {deepseek_model} (fallback)",
        "endpoint": "OpenAI /chat/completions",
        "max_tokens": 16384,
        "status": status,
        "elapsed_s": round(elapsed, 1),
        "stop_reason": finish_reason,
        "output_chars": len(text),
        "json_parse_ok": parsed is not None,
        "json_parse_err": parse_err,
        "first_200": text[:200],
    })

    return {"results": results}


# ── Output formatting ─────────────────────────────────────────────────────


def _fmt_report(results: List[Dict[str, Any]]) -> str:
    lines = ["=" * 100, "  报告生成对比（Anthropic /messages）", "=" * 100, ""]
    header = f"{'provider':<38} {'http':<5} {'elapsed':<9} {'stop':<10} {'chars':>7} {'json_ok':>8}"
    lines.append(header)
    lines.append("-" * len(header))
    for r in results:
        lines.append(
            f"{r['provider']:<38} {str(r['status']):<5} {str(r['elapsed_s']) + 's':<9} "
            f"{r['stop_reason'][:10]:<10} {r['output_chars']:>7} {str(r['json_parse_ok']):>8}"
        )
    lines.append("")
    for r in results:
        lines.append(f"--- {r['provider']} ---")
        lines.append(f"  output_chars   = {r['output_chars']}")
        lines.append(f"  json_parse_ok  = {r['json_parse_ok']}")
        if r["json_parse_err"]:
            lines.append(f"  parse_error    = {r['json_parse_err']}")
        lines.append(f"  first_200      = {r['first_200']!r}")
        lines.append("")
    return "\n".join(lines)


def _fmt_vision(results: List[Dict[str, Any]]) -> str:
    lines = ["=" * 100, "  视觉对比", "=" * 100, ""]
    header = f"{'provider':<38} {'http':<5} {'elapsed':<9} {'stop':<10} {'chars':>7} {'json_ok':>8}"
    lines.append(header)
    lines.append("-" * len(header))
    for r in results:
        lines.append(
            f"{r['provider']:<38} {str(r['status']):<5} {str(r['elapsed_s']) + 's':<9} "
            f"{r['stop_reason'][:10]:<10} {r['output_chars']:>7} {str(r['json_parse_ok']):>8}"
        )
    lines.append("")
    for r in results:
        lines.append(f"--- {r['provider']} ---")
        lines.append(f"  output_chars   = {r['output_chars']}")
        lines.append(f"  json_parse_ok  = {r['json_parse_ok']}")
        if r["json_parse_err"]:
            lines.append(f"  parse_error    = {r['json_parse_err']}")
        lines.append(f"  first_200      = {r['first_200']!r}")
        lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", nargs="?", default="all", choices=["all", "report", "vision"])
    parser.add_argument("--image", type=Path, default=None)
    args = parser.parse_args()

    env = _load_env_file(RAG_ENV)
    minimax_key = env.get("MINIMAX_API_KEY") or os.environ.get("MINIMAX_API_KEY", "")
    minimax_base = env.get("MINIMAX_BASE_URL") or os.environ.get("MINIMAX_BASE_URL", "https://api.minimaxi.com/anthropic/v1")
    deepseek_key = env.get("DEEPSEEK_API_KEY") or os.environ.get("DEEPSEEK_API_KEY", "")
    deepseek_base = env.get("DEEPSEEK_BASE_URL") or os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    deepseek_anthropic_base = env.get("DEEPSEEK_ANTHROPIC_BASE_URL") or os.environ.get("DEEPSEEK_ANTHROPIC_BASE_URL", "https://api.deepseek.com/anthropic/v1")
    deepseek_model = env.get("DEEPSEEK_MODEL") or os.environ.get("DEEPSEEK_MODEL", "deepseek-flash")

    if not minimax_key:
        print("ERROR: MINIMAX_API_KEY not set in rag_service/.env", file=sys.stderr)
        return 2
    if not deepseek_key:
        print("ERROR: DEEPSEEK_API_KEY not set in rag_service/.env", file=sys.stderr)
        return 2

    print(f"image       = {args.image or '(auto-pick)'}")
    print(f"minimax     = {minimax_base} ({minimax_key[:8]}...)")
    print(f"deepseek    = {deepseek_anthropic_base} / {deepseek_base} ({deepseek_key[:8]}...)")
    print(f"model       = {deepseek_model}")
    print()

    if args.mode in ("all", "report"):
        out = test_report(minimax_key, minimax_base, deepseek_key, deepseek_anthropic_base, deepseek_model)
        print(_fmt_report(out["results"]))

    if args.mode in ("all", "vision"):
        img = args.image
        if img is None:
            # auto-pick the first Anker image from the regression fixture
            fixture_root = PROJECT_ROOT / "tests" / "fixtures" / "regression-package-20260914"
            for p in fixture_root.rglob("*.jpg"):
                img = p
                break
        print(f"vision image = {img}")
        out = test_vision(img, minimax_key, minimax_base, deepseek_key, deepseek_base, deepseek_model)
        if "error" in out:
            print(f"ERROR: {out['error']}")
            return 3
        print(_fmt_vision(out["results"]))

    return 0


if __name__ == "__main__":
    sys.exit(main())
