#!/usr/bin/env python3
"""Vision AB 测试：用 5 张不同复杂度图片对比 MiniMax-M3 vs DeepSeek deepseek-flash。

输出每张图的：HTTP、elapsed、stop_reason、chars、JSON 合法、识别准确度（人评）。

用法：python3 scripts/benchmark_vision.py
"""
import base64
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any, Dict, List, Tuple

PROJECT_ROOT = Path(__file__).parent.parent
RAG_ENV = PROJECT_ROOT / "rag_service" / ".env"
FIXTURE_ROOT = PROJECT_ROOT / "tests" / "fixtures" / "regression-package-20260914"


def _load_env(path: Path) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if not path.exists():
        return out
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip()
    return out


def _opener():
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


OPENER = _opener()


# ── MiniMax 与生产 vision 节点同款 prompt（Anker / LEGO / 烧水壶三产品不同复杂度）

VISION_PROMPT = """你是产品视觉取证助手。只记录图片中可观察到的事实；不要给出法规结论、认证结论、价格或上市建议。

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

硬性规则（双向对齐不同模型的偏差）：
- "图片未展示/看不清标志"只写入 unreadable_or_missing_evidence，绝不能写成"缺少认证"或"不合规"。
- 不得由充电盒、电池仓或 USB 接口推断为充电宝、电源适配器或移动电源；宁可使用更宽泛的产品类型。
- 只有完整、清晰可见的标志才可写入 visible_certification_marks 和 visible_marks；文字提及或猜测不算可见标志。
  关键：宁可不写也不要推测——只写你在这张图的像素里实际看到的标志图形/文字。如果标志本身模糊、仅被部分遮挡、或你对其真实性有任何怀疑，不要写入。
- 产品类型识别：能从外形、接口形状、按钮位置、显示屏、连接方式等物理特征推断时，给出最具体的产品类型（如"墙壁充电器"、"便携式蓝牙耳机"、"智能电热水壶"），而不是直接说"无法识别"。只有在完全没有可见特征、或多种产品类型无法区分时，才用"无法识别具体产品类型"。
- 不确定的产品类型使用"无法识别具体产品类型"，并在 questions_needed 中说明需要哪张补拍图。
- visible_marks 每个元素只写一个标志；不得用整块铭牌作为多个标志的共同框。
- bbox 是归一化坐标（0.0-1.0），只有肉眼可定位的标志才填；看不清的位置不要乱填坐标。"""


def _b64_image(path: Path) -> Tuple[str, str]:
    data = path.read_bytes()
    mt = "image/jpeg"
    if data.startswith(b"\x89PNG"):
        mt = "image/png"
    elif data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        mt = "image/webp"
    return base64.b64encode(data).decode("ascii"), mt


def post_anthropic(base: str, api_key: str, body: Dict[str, Any], timeout: float) -> Tuple[int, Any, float]:
    raw = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"{base.rstrip('/')}/messages",
        data=raw,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
            "x-api-key": api_key,
        },
        method="POST",
    )
    start = time.time()
    try:
        with OPENER.open(req, timeout=timeout) as r:
            text = r.read().decode("utf-8", errors="replace")
            return r.status, json.loads(text), time.time() - start
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace") if e.fp else ""
        try:
            return e.code, json.loads(body_text), time.time() - start
        except Exception:
            return e.code, body_text, time.time() - start


def post_openai(base: str, api_key: str, body: Dict[str, Any], timeout: float) -> Tuple[int, Any, float]:
    raw = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"{base.rstrip('/')}/chat/completions",
        data=raw,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    start = time.time()
    try:
        with OPENER.open(req, timeout=timeout) as r:
            text = r.read().decode("utf-8", errors="replace")
            return r.status, json.loads(text), time.time() - start
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace") if e.fp else ""
        try:
            return e.code, json.loads(body_text), time.time() - start
        except Exception:
            return e.code, body_text, time.time() - start


def extract_anthropic(data: Any) -> Tuple[str, str]:
    if not isinstance(data, dict):
        return "", ""
    blocks = data.get("content") or []
    parts = [b.get("text", "") for b in blocks if isinstance(b, dict) and b.get("type") == "text"]
    return "".join(parts), str(data.get("stop_reason") or "")


def extract_openai(data: Any) -> Tuple[str, str]:
    if not isinstance(data, dict):
        return "", ""
    choices = data.get("choices") or []
    if not choices:
        return "", ""
    msg = choices[0].get("message") or {}
    return (msg.get("content") or ""), str(choices[0].get("finish_reason") or "")


def strip_fence(text: str) -> str:
    """Mirror rag_service _parse_vision_text fence stripping."""
    text = (text or "").strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    if text.lower().startswith("json"):
        text = text[4:].lstrip()
    return text


def run_minimax(env: Dict[str, str], image_path: Path, timeout: float = 120.0) -> Dict[str, Any]:
    api_key = env.get("MINIMAX_API_KEY") or ""
    base = env.get("MINIMAX_BASE_URL") or "https://api.minimaxi.com/anthropic/v1"
    b64, mime = _b64_image(image_path)
    messages = [{
        "role": "user",
        "content": [
            {"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}},
            {"type": "text", "text": VISION_PROMPT},
        ],
    }]
    body = {
        "model": "MiniMax-M3",
        "max_tokens": 1536,
        "temperature": 0.1,
        "messages": messages,
    }
    status, data, elapsed = post_anthropic(base, api_key, body, timeout=timeout)
    text, stop = extract_anthropic(data)
    text_clean = strip_fence(text)
    parsed = None
    err = None
    try:
        parsed = json.loads(text_clean)
    except Exception as exc:
        err = f"{type(exc).__name__}: {exc}"
    return {
        "provider": "MiniMax-M3",
        "endpoint": "Anthropic /messages",
        "status": status, "elapsed_s": round(elapsed, 1), "stop_reason": stop,
        "chars_raw": len(text), "chars_clean": len(text_clean),
        "json_ok": parsed is not None, "parse_err": err, "parsed": parsed,
    }


def run_deepseek(env: Dict[str, str], image_path: Path, timeout: float = 120.0) -> Dict[str, Any]:
    api_key = env.get("DEEPSEEK_API_KEY") or ""
    base = env.get("DEEPSEEK_BASE_URL") or "https://api.deepseek.com"
    model = env.get("DEEPSEEK_MODEL") or "deepseek-flash"
    b64, mime = _b64_image(image_path)
    openai_messages = [{
        "role": "user",
        "content": [
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
            {"type": "text", "text": VISION_PROMPT},
        ],
    }]
    body = {
        "model": model,
        "max_tokens": 16384,
        "temperature": 0.1,
        "thinking": {"type": "disabled"},
        "messages": openai_messages,
    }
    status, data, elapsed = post_openai(base, api_key, body, timeout=timeout)
    text, stop = extract_openai(data)
    text_clean = strip_fence(text)
    parsed = None
    err = None
    try:
        parsed = json.loads(text_clean)
    except Exception as exc:
        err = f"{type(exc).__name__}: {exc}"
    return {
        "provider": f"DeepSeek {model}",
        "endpoint": "OpenAI /chat/completions",
        "status": status, "elapsed_s": round(elapsed, 1), "stop_reason": stop,
        "chars_raw": len(text), "chars_clean": len(text_clean),
        "json_ok": parsed is not None, "parse_err": err, "parsed": parsed,
    }


def main() -> int:
    env = _load_env(RAG_ENV)
    if not env.get("MINIMAX_API_KEY") or not env.get("DEEPSEEK_API_KEY"):
        print("ERROR: MINIMAX_API_KEY / DEEPSEEK_API_KEY missing", file=sys.stderr)
        return 1

    images = [
        ("Anker-A2332 充电器 EU (正面整体)",
         FIXTURE_ROOT / "01-Anker-A2332-充电器-EU" / "01-正反面整体.jpg"),
        ("Anker-A2332 充电器 EU (铭牌近照)",
         FIXTURE_ROOT / "01-Anker-A2332-充电器-EU" / "02-铭牌标签近照.jpg"),
        ("Xiaomi 烧水壶 EU (整机整体)",
         FIXTURE_ROOT / "02-Xiaomi-Smart-Kettle-2-Pro-EU" / "01-整机整体照.jpg"),
        ("Xiaomi 烧水壶 EU (铭牌近照)",
         FIXTURE_ROOT / "02-Xiaomi-Smart-Kettle-2-Pro-EU" / "02-铭牌与合规标志近照.jpg"),
        ("LEGO 76429 玩具 US (附件分开展示)",
         FIXTURE_ROOT / "03-LEGO-76429-玩具-US" / "03-附件与主体分开展示.jpg"),
    ]

    print(f"{'image':<48} {'provider':<22} {'http':>4} {'elapsed':>8} {'chars':>6} {'json_ok':>8}")
    print("-" * 110)

    all_rows: List[Dict[str, Any]] = []
    for label, path in images:
        if not path.exists():
            print(f"{label:<48} MISSING: {path}")
            continue
        mm = run_minimax(env, path)
        ds = run_deepseek(env, path)
        all_rows.append({"label": label, "minimax": mm, "deepseek": ds})
        for r in (mm, ds):
            print(f"{label:<48} {r['provider']:<22} {r['status']:>4} {r['elapsed_s']:>6}s {r['chars_raw']:>6} {str(r['json_ok']):>8}")
        print()

    print("=" * 110)
    print("产物对比（识别准确度）：")
    print("=" * 110)
    for row in all_rows:
        print(f"\n## {row['label']}")
        for who in ("minimax", "deepseek"):
            r = row[who]
            p = r["parsed"] or {}
            print(f"  [{r['provider']}] elapsed={r['elapsed_s']}s json_ok={r['json_ok']}")
            print(f"    product_type       = {p.get('product_type', '?')}")
            print(f"    identity_confidence= {p.get('identity_confidence', '?')}")
            print(f"    core_features      = {p.get('core_features', [])[:3]}")
            print(f"    visible_marks      = {p.get('visible_certification_marks', [])}")
            print(f"    unreadable         = {p.get('unreadable_or_missing_evidence', [])[:2]}")
            print(f"    issues             = {p.get('issues', [])[:2]}")

    # 汇总
    mm_ok = sum(1 for row in all_rows if row["minimax"]["json_ok"])
    ds_ok = sum(1 for row in all_rows if row["deepseek"]["json_ok"])
    mm_total_t = sum(row["minimax"]["elapsed_s"] for row in all_rows)
    ds_total_t = sum(row["deepseek"]["elapsed_s"] for row in all_rows)
    mm_chars = sum(row["minimax"]["chars_raw"] for row in all_rows)
    ds_chars = sum(row["deepseek"]["chars_raw"] for row in all_rows)
    print()
    print("=" * 110)
    print("汇总：")
    print(f"  MiniMax: {mm_ok}/{len(all_rows)} JSON 合法, 总耗时 {mm_total_t}s, 总 chars {mm_chars}")
    print(f"  DeepSeek: {ds_ok}/{len(all_rows)} JSON 合法, 总耗时 {ds_total_t}s, 总 chars {ds_chars}")
    print(f"  速度比 (MiniMax / DeepSeek): {mm_total_t / max(ds_total_t, 0.1):.2f}x")
    return 0


if __name__ == "__main__":
    sys.exit(main())
