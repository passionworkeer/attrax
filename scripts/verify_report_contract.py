#!/usr/bin/env python3
"""用真实的 MiniMax API 验证新闭合契约 prompt 是否改善 JSON 完整性。

跑 3 次相同 prompt，比较：旧 prompt / 新 prompt（闭合契约）+ max_tokens=8192。
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any, Dict, Tuple

PROJECT_ROOT = Path(__file__).parent.parent
RAG_ENV = PROJECT_ROOT / "rag_service" / ".env"


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


def extract_text(data: Any) -> Tuple[str, str]:
    if not isinstance(data, dict):
        return "", ""
    blocks = data.get("content") or []
    parts = [b.get("text", "") for b in blocks if isinstance(b, dict) and b.get("type") == "text"]
    return "".join(parts), str(data.get("stop_reason") or "")


SYSTEM_PROMPT = """你是跨境电商合规与商业化专家。你会基于检索到的法规/成本语料，一次性生成四个前端场景需要的内容。

核心原则：
1. 你的输出服务于"是否可以推进下一步"的决策，而不是替代认证机构、律师或实验室。
2. 严格区分三类信息：视觉观察、法规证据、商业估算。
3. 只使用给定来源文档和用户上传文档中的法规/成本事实，不要编造法规条款。
4. 信息不足时必须写明"暂无充分依据"。
5. 合规报告、成本利润、排期路线图、AI 决策视图必须互相一致。
6. 每个法规事实在 complianceReport 内标注来源，格式为 [法规名称/条款]。直接输出 JSON，不要输出 Markdown 代码围栏或额外解释。

JSON 结构：
{
  "complianceReport": "markdown string",
  "profitReport": {"markdown": "string", "keyConclusion": "string"},
  "roadmap": {"totalDays": 56, "items": [{"id": "1", "title": "string", "description": "string", "type": "apply", "status": "pending"}]},
  "decisionView": {"verdict": "PASS|WARN|REJECTED|UNKNOWN", "riskLevel": "CRITICAL|HIGH|MEDIUM|LOW", "summary": "string", "nodes": [{"id": "vision", "severity": "critical|high|medium|info", "label": "string"}]}
}

来源文档：
[1] (EU) 2023/1542 Art. 77 — 电池生产者责任延伸
[2] IEC 62133-2:2017 — 含碱性或非酸性电解质的蓄电池和蓄电池组
[3] UN 38.3 — 锂电池运输安全
[4] EN 62368-1:2014 — 音视频与信息技术设备安全
[5] EN 301 489-1 V2.2.3 — 电磁兼容标准
[6] (EU) 2014/53 RED — 无线电设备指令
[7] (EU) 2023/988 — 通用产品安全法规
[8] GB 4943.1-2022 — 信息技术设备安全"""

PRODUCT = "蓝牙耳机（带充电盒，3.7V 锂电池，无线充电功能）"
MARKET = "EU"
QUERY = "这款蓝牙耳机出口欧盟需要什么认证？详细说明每条法规的具体要求、检测项目、文档要求和时间。"


USER_OLD = f"""产品类型：{PRODUCT}
目标市场：{MARKET}
用户问题：{QUERY}

请基于上述证据输出审阅报告，首先输出reviewClaims及其引用，再输出合规报告、合规排期路线图与AI决策视图。
没有成本输入时profitReport.markdown仅写'未提供成本数据，本报告不作利润预测'，不要展开利润报告。
输出必须是可解析 JSON，不要使用 Markdown 代码围栏。
为避免响应截断：整个 JSON 控制在 12000 个字符以内，每项判断保持简短，
complianceReport 与 profitReport.markdown 各不超过 1200 个汉字，
roadmap.items 最多 5 项，decisionView.nodes 最多 6 项；每条 citation 必须有 claim；
优先保证所有 JSON 字段闭合。"""

USER_NEW = f"""产品类型：{PRODUCT}
目标市场：{MARKET}
用户问题：{QUERY}

【输出预算与闭合契约】本次输出预算为 8192 tokens（约 14000 字符），尽量填满以输出更完整的报告。
- 所有 JSON 对象与数组必须在末尾闭合（最后一个 `}}` 和 `]` 都必须有），缺一个字符下游解析器会直接拒收并丢失整份报告。
- 如果不确定完整内容的长度，**先闭合 JSON 框架再回头补字段值**；不要因为想写更长内容而省略末尾的闭合括号。
- 字段填充顺序：先 complianceReport → reviewClaims → profitReport → roadmap → decisionView，最后再补 citations。
- 严禁使用 Markdown 代码围栏（```json ... ```）包裹 JSON。

请基于上述证据输出审阅报告，首先输出reviewClaims及其引用，再输出合规报告、合规排期路线图与AI决策视图。
没有成本输入时profitReport.markdown仅写'未提供成本数据，本报告不作利润预测'，不要展开利润报告。
为避免响应截断：整个 JSON 控制在 12000 个字符以内，每项判断保持简短，
complianceReport 与 profitReport.markdown 各不超过 1200 个汉字，
roadmap.items 最多 5 项，decisionView.nodes 最多 6 项；每条 citation 必须有 claim。"""


def run(env: Dict[str, str], label: str, user_prompt: str, max_tokens: int) -> Dict[str, Any]:
    api_key = env.get("MINIMAX_API_KEY") or os.environ.get("MINIMAX_API_KEY", "")
    base = env.get("MINIMAX_BASE_URL") or os.environ.get("MINIMAX_BASE_URL", "https://api.minimaxi.com/anthropic/v1")
    body = {
        "model": "MiniMax-M3",
        "max_tokens": max_tokens,
        "temperature": 0.2,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_prompt}],
    }
    status, data, elapsed = post_anthropic(base, api_key, body, timeout=240.0)
    text, stop = extract_text(data)
    try:
        parsed = json.loads(text)
        ok = True
        err = None
    except Exception as exc:
        parsed = None
        ok = False
        err = f"{type(exc).__name__}: {exc}"
    # 检测：闭合检查
    opens = text.count("{")
    closes = text.count("}")
    open_brackets = text.count("[")
    close_brackets = text.count("]")
    balanced = opens == closes and open_brackets == close_brackets
    print(f"--- {label} (max_tokens={max_tokens}) ---")
    print(f"  http={status} elapsed={elapsed:.1f}s stop={stop!r}")
    print(f"  chars={len(text)} json_ok={ok} balanced={balanced} (braces={opens}/{closes} brackets={open_brackets}/{close_brackets})")
    if not ok:
        print(f"  parse_err={err}")
    return {
        "label": label, "chars": len(text), "elapsed": round(elapsed, 1),
        "stop": stop, "json_ok": ok, "balanced": balanced,
        "max_tokens": max_tokens, "status": status,
    }


def main() -> int:
    env = _load_env(RAG_ENV)
    if not env.get("MINIMAX_API_KEY"):
        print("ERROR: MINIMAX_API_KEY missing", file=sys.stderr)
        return 1

    rows = [
        run(env, "OLD prompt + max=6144", USER_OLD, 6144),
        run(env, "NEW prompt + max=8192", USER_NEW, 8192),
    ]

    print()
    print("=" * 90)
    print(f"{'label':<32} {'http':>4} {'elapsed':>7} {'stop':<14} {'chars':>6} {'json_ok':>8} {'balanced':>9}")
    print("-" * 90)
    for r in rows:
        print(f"{r['label']:<32} {r['status']:>4} {r['elapsed']:>5}s   {r['stop']:<14} {r['chars']:>6} {str(r['json_ok']):>8} {str(r['balanced']):>9}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
