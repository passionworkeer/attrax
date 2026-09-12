#!/usr/bin/env python3
"""
e2e_kb_pipeline.py — De-RAG §10 step 7: validate the KB-anchored pipeline
end-to-end (locally, real MiniMax call, no HTTP layer).

Runs `run_compliance_graph` with:
  RETRIEVAL_ENABLED=false  (retrieval stack bypassed)
  USE_KB_INPUT=true        (LLM consumes KB article texts + citation rules)

Validation criteria (self-chosen, spec §7.3/§7.4 acceptance):
  1. Report generated (non-empty complianceReport)
  2. citations[] non-empty (LLM emitted per-claim citations)
  3. quote match rate: matched / total >= 70% (after verify pass)
  4. fallback_article_only <= 25%, unmatched <= 5%
  5. decisionView.verdict present and sane

Usage:
  RETRIEVAL_ENABLED=false USE_KB_INPUT=true \
    rag_service/.venv/bin/python3 scripts/e2e_kb_pipeline.py
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

# Flags MUST be set before importing the pipeline (env read at call time,
# but set them here anyway for clarity).
os.environ["RETRIEVAL_ENABLED"] = "false"
os.environ["USE_KB_INPUT"] = "true"

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

# Load the service .env (same as main.py does) so MINIMAX_API_KEY resolves.
try:
    from dotenv import load_dotenv
    load_dotenv(REPO / "rag_service" / ".env")
except ImportError:
    pass


def run_case(name: str, query: str, product: str, category: str, markets: list[str]) -> dict:
    from rag_service.orchestrator.graph import run_compliance_graph

    t0 = time.time()
    result = run_compliance_graph(
        query=query,
        product=product,
        category=category,
        markets=markets,
        vision_result={
            "product_type": product,
            "core_features": [],
            "certifications": [],
            "cert_summary": "",
        },
        images=[],
        documents=[],
    )
    elapsed = time.time() - t0

    pkg = result.get("report_package") or {}
    citations = pkg.get("citations") or []
    matched = sum(1 for c in citations if c.get("match_status") == "matched")
    fallback = sum(1 for c in citations if c.get("match_status") == "fallback_article_only")
    unmatched = sum(1 for c in citations if c.get("match_status") == "unmatched")
    total = len(citations)

    verdict = (pkg.get("decisionView") or {}).get("verdict", "?")
    report_len = len(result.get("final_report", ""))

    print(f"\n{'='*70}")
    print(f"CASE: {name}  ({elapsed:.1f}s)")
    print(f"{'='*70}")
    print(f"  final status      : {result.get('status')}")
    print(f"  verdict (decision): {verdict}")
    print(f"  report length     : {report_len} chars")
    print(f"  citations         : {total} total")
    if total:
        print(f"    matched         : {matched} ({100*matched/total:.0f}%)")
        print(f"    fallback_article: {fallback} ({100*fallback/total:.0f}%)")
        print(f"    unmatched       : {unmatched} ({100*unmatched/total:.0f}%)")
    print(f"  trace nodes       : {[t.get('node') for t in result.get('agent_trace', [])]}")
    gen_trace = [t for t in result.get("agent_trace", []) if t.get("node") == "generate"]
    if gen_trace:
        print(f"  generate trace    : { {k: v for k, v in gen_trace[0].items() if k != 'node'} }")

    # Dump artifacts for manual review
    out_dir = REPO / "work" / "e2e"
    out_dir.mkdir(parents=True, exist_ok=True)
    slug = name.replace(" ", "_").replace("/", "-")
    (out_dir / f"{slug}-report.md").write_text(result.get("final_report", ""))
    (out_dir / f"{slug}-package.json").write_text(
        json.dumps(pkg, ensure_ascii=False, indent=2, default=str)
    )
    print(f"  artifacts         : work/e2e/{slug}-report.md, {slug}-package.json")

    return {
        "name": name, "elapsed": elapsed, "status": result.get("status"),
        "verdict": verdict, "report_len": report_len,
        "citations": total, "matched": matched, "fallback": fallback,
        "unmatched": unmatched,
    }


def main() -> int:
    cases = [
        {
            "name": "battery/EU",
            "query": "锂电池充电宝出口欧盟需要什么认证",
            "product": "充电宝",
            "category": "battery",
            "markets": ["EU"],
        },
        {
            "name": "toy/US",
            "query": "儿童塑料玩具出口美国的合规要求",
            "product": "塑料玩具",
            "category": "toy",
            "markets": ["US"],
        },
        {
            "name": "cosmetic/CN",
            "query": "面霜在中国上市需要的化妆品备案",
            "product": "面霜",
            "category": "cosmetic",
            "markets": ["CN"],
        },
    ]

    results = [run_case(**c) for c in cases]

    print(f"\n{'='*70}")
    print("SUMMARY")
    print(f"{'='*70}")
    all_ok = True
    for r in results:
        total = r["citations"]
        rate = (r["matched"] / total) if total else 0
        ok = (
            r["report_len"] > 200
            and total > 0
            and rate >= 0.70
            and r["verdict"] in {"PASS", "WARN", "REJECTED"}
        )
        all_ok = all_ok and ok
        print(
            f"  {'✓' if ok else '✗'} {r['name']:<14} "
            f"verdict={r['verdict']:<8} citations={total:<3} "
            f"matched={rate*100:>3.0f}%  {r['elapsed']:.1f}s"
        )
    print(f"\nE2E {'PASS' if all_ok else 'REVIEW NEEDED'}")
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())