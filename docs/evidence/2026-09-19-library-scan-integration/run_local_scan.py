# 本地端到端真实扫描：起本地 RAG 服务后，用真实产品图发起一次
# electronics + EU/US 扫描，轮询到 ready，输出锚点选择统计与引用验证结果。
# 用法：rag_service/.venv/bin/python docs/evidence/2026-09-19-library-scan-integration/run_local_scan.py <image_path>
import json
import os
import sys
import time
from pathlib import Path

import httpx

BASE = "http://127.0.0.1:8001"
INTERNAL_SECRET = os.environ.get("RAG_INTERNAL_SECRET", "")
SECRET_HEADERS = {"X-Internal-Secret": INTERNAL_SECRET} if INTERNAL_SECRET else {}
IMAGE = sys.argv[1] if len(sys.argv) > 1 else str(
    Path(__file__).parents[3] / "data" / "backend" / "uploads"
)
CATEGORY = sys.argv[2] if len(sys.argv) > 2 else "electronics"
MARKETS = sys.argv[3] if len(sys.argv) > 3 else "EU,US"

image_path = Path(IMAGE)
if image_path.is_dir():
    image_path = sorted(image_path.glob("*/*.jpg"))[-1]

with httpx.Client(timeout=600) as client:
    with open(image_path, "rb") as f:
        resp = client.post(
            f"{BASE}/api/v1/scans",
            files={"images": (image_path.name, f, "image/jpeg")},
            data={"category": CATEGORY, "markets": MARKETS, "query": "扫描这个产品的合规风险"},
            headers=SECRET_HEADERS,
        )
    print("create:", resp.status_code)
    resp.raise_for_status()
    payload = resp.json().get("data") or resp.json()
    scan_id = payload["sessionId"]
    token = payload.get("accessToken") or ""
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    print("scan_id:", scan_id)

    start = time.time()
    status = ""
    while time.time() - start < 560:
        r = client.get(f"{BASE}/api/v1/scans/{scan_id}", headers=headers)
        r.raise_for_status()
        data = (r.json().get("data") or r.json())
        status = data.get("status")
        if status in {"ready", "degraded", "failed"}:
            break
        time.sleep(5)
    print(f"final status: {status} after {time.time()-start:.0f}s")

    result = data.get("result") or {}
    package = result.get("report_package") or result
    trace = package.get("auditMetadata", {}).get("agentTrace") or result.get("agent_trace") or []
    for entry in trace:
        if isinstance(entry, dict) and entry.get("node") == "generate":
            print("generate trace:", json.dumps(
                {k: entry.get(k) for k in
                 ("status", "provider", "anchor_regulations_count", "anchor_selection",
                  "article_texts_count", "llm_citations_count", "kb_anchor_backfill_count",
                  "duration_ms")}, ensure_ascii=False))

    citations = package.get("citations") or []
    from collections import Counter
    print("citations:", len(citations),
          "match_status:", dict(Counter(c.get("match_status") for c in citations if isinstance(c, dict))))
    gen_docs = sorted({c.get("doc_id") for c in citations if isinstance(c, dict) and str(c.get("doc_id", "")).startswith(("US-CFR", "US-47", "US-PLAW", "GLOBAL", "EU-2005", "EU-2011-83", "EU-2019-2161", "ETSI"))})
    print("新库来源引用:", gen_docs[:12])

    out = Path(__file__).parent / "local-scan-result.json"
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print("完整结果:", out)
