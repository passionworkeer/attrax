#!/usr/bin/env python3
"""
run_eval.py - P7 Evaluation Runner for rag-service.

Usage:
    python eval/run_eval.py                        # Full run
    python eval/run_eval.py --dry-run              # First 3 cases, no API calls
    python eval/run_eval.py --html                 # Generate HTML report
    python eval/run_eval.py --generate-tests       # Generate test_set.json only
    python eval/run_eval.py --limit 20             # Run only first 20 cases
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

# Fix Windows console encoding for Chinese output
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# Project root for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

try:
    import httpx
except ImportError:
    httpx = None

from eval.metrics import generate_test_set, compute_all_metrics

# ── Config ────────────────────────────────────────────────────────────────────

DEFAULT_URL = "http://localhost:8000"
TIMEOUT_PER_CASE = 120  # seconds


def _load_url() -> str:
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except Exception:
        pass
    return os.environ.get("RAG_SERVICE_URL", DEFAULT_URL)


# ── Color helpers ─────────────────────────────────────────────────────────────

try:
    from colorama import just_fix_windows_console, Fore, Style

    just_fix_windows_console()
    _R = Fore.RED
    _G = Fore.GREEN
    _Y = Fore.YELLOW
    _C = Fore.CYAN
    _B = Fore.BLUE
    _RST = Style.RESET_ALL
except Exception:
    _R = _G = _Y = _C = _B = _RST = ""


def _color_score(score: float) -> str:
    if score >= 0.8:
        return f"{_G}{score:.3f}{_RST}"
    if score >= 0.5:
        return f"{_Y}{score:.3f}{_RST}"
    return f"{_R}{score:.3f}{_RST}"


def _fmt_status(status: str) -> str:
    if status == "PASS":
        return f"{_G}{status}{_RST}"
    if status == "WARN":
        return f"{_Y}{status}{_RST}"
    return f"{_R}{status}{_RST}"


# ── Mock /scan response (dry-run) ────────────────────────────────────────────

_MOCK_RESPONSES = [
    {
        "status": "WARN",
        "report": (
            "根据REACH法规(EC) No 1907/2006第67条及附件XVII，铅、镉、汞、六价铬不得超过0.1%(重量比)。"
            "含铅量超过0.1%的电子产品将被海关扣押，建议使用无铅焊料替代含铅焊料。"
            "此外，根据RoHS指令2011/65/EU，铅的限值为0.1%，镉为0.01%。"
        ),
        "agent_trace": [],
        "loop_count": 1,
    },
    {
        "status": "PASS",
        "report": (
            "蓝牙耳机出口欧盟须通过FCC认证(意图发射器)。"
            "EMC指令2014/30/EU要求辐射发射符合EN 55014-1，抗扰度符合EN 55014-2。"
            "建议进行预合规测试确保不超过传导发射限值。"
        ),
        "agent_trace": [],
        "loop_count": 1,
    },
    {
        "status": "REJECTED",
        "report": "未找到足够的合规信息来回答此问题。",
        "agent_trace": [],
        "loop_count": 0,
    },
]


def _mock_scan(question: str, market: str) -> dict:
    idx = hash(question) % len(_MOCK_RESPONSES)
    return _MOCK_RESPONSES[idx]


# ── Retrieve docs from agent_trace ───────────────────────────────────────────

def _extract_docs(agent_trace: list[dict]) -> list[dict]:
    """Pull documents out of agent_trace node entries."""
    docs = []
    for node in agent_trace:
        if isinstance(node, dict) and node.get("documents"):
            nd = node["documents"]
            if nd and isinstance(nd[0], dict):
                docs.extend(nd)
    return docs


# ── HTML report ───────────────────────────────────────────────────────────────

def _render_html(results: list[dict], summary: dict, output_path: str) -> None:
    rows = ""
    for r in results:
        fid = _color_score(r["metrics"]["faithfulness"]["score"])
        ar = _color_score(r["metrics"]["answer_relevancy"]["score"])
        cp = _color_score(r["metrics"]["context_precision"]["score"])
        cr = _color_score(r["metrics"]["context_recall"]["score"])
        status = _fmt_status(r.get("scan_status", "WARN"))
        error_cell = f"<td>{r.get('error', '')}</td>" if r.get("error") else "<td>-</td>"
        rows += f"<tr><td>{r['id']}</td><td>{r['question'][:60]}...</td>"
        rows += f"<td>{r['market']}</td><td>{status}</td>"
        rows += f"<td>{fid}</td><td>{ar}</td><td>{cp}</td><td>{cr}</td>{error_cell}</tr>"

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>RAG&#35780;&#20272;&#25253;&#21578; {datetime.now().strftime('%Y-%m-%d')}</title>
<style>
  body {{ font-family: sans-serif; margin: 2rem; }}
  h1 {{ color: #333; }}
  table {{ border-collapse: collapse; width: 100%; margin-top: 1rem; }}
  th, td {{ border: 1px solid #ddd; padding: 8px; font-size: 0.9em; }}
  th {{ background: #4a90d9; color: white; }}
  tr:nth-child(even) {{ background: #f9f9f9; }}
  .summary {{ background: #e8f4f8; padding: 1rem; border-radius: 6px; margin-bottom: 1rem; }}
</style>
</head>
<body>
<h1>RAG-Service P7 &#35780;&#20272;&#25253;&#21578;</h1>
<div class="summary">
  <strong>&#36816;&#34892;&#26102;&#38388;&#65306;</strong>{summary['run_time']} &nbsp;
  <strong>&#24635;&#29992;&#20363;&#65306;</strong>{summary['total']} &nbsp;
  <strong>&#25104;&#21151;&#29575;&#65306;</strong>{summary['success_rate']} &nbsp;
  <strong>&#24179;&#22343;&#20998;&#65306;</strong>{summary['avg_faithfulness']:.3f}
</div>
<table>
  <thead>
    <tr><th>ID</th><th>&#38382;&#39064;</th><th>&#24066;&#22330;</th><th>&#29366;&#24577;</th>
        <th>Faithfulness</th><th>Answer Relevancy</th>
        <th>Context Precision</th><th>Context Recall</th><th>&#38169;&#35823;</th>
    </tr>
  </thead>
  <tbody>{rows}
  </tbody>
</table>
</body>
</html>"""
    Path(output_path).write_text(html, encoding="utf-8")
    print(f"{_C}[HTML] {_RST}Report saved to {output_path}")


# ── Console summary ────────────────────────────────────────────────────────────

def _print_summary(results: list[dict], elapsed: float) -> None:
    total = len(results)
    success = sum(1 for r in results if not r.get("error"))

    keys = ["faithfulness", "answer_relevancy", "context_precision", "context_recall"]
    avgs = {}
    for k in keys:
        scores = [r["metrics"][k]["score"] for r in results if not r.get("error")]
        avgs[k] = sum(scores) / len(scores) if scores else 0.0

    statuses = [r.get("scan_status", "WARN") for r in results]
    pass_n = statuses.count("PASS")
    warn_n = statuses.count("WARN")
    reject_n = statuses.count("REJECTED")

    print()
    print(f"{_B}{'─' * 70}{_RST}")
    print(f"{_B}  RAG-Service P7 评估摘要{_RST}")
    print(f"{_B}{'─' * 70}{_RST}")
    print(f"  {'用例总数':<20} {total}")
    print(f"  {'成功 / 失败':<20} {success} / {total - success}")
    print(f"  {'PASS / WARN / REJECTED':<20} {pass_n} / {warn_n} / {reject_n}")
    print(f"  {'运行时间':<20} {elapsed:.1f}s  ({elapsed / total:.1f}s/case)")
    print(f"{_B}{'─' * 70}{_RST}")
    print(f"  {'Metric':<25} {'Avg Score':<15} {'Min':<10} {'Max'}")
    print(f"{_B}{'─' * 70}{_RST}")
    for k in keys:
        scores = [r["metrics"][k]["score"] for r in results if not r.get("error")]
        if scores:
            mn, mx = min(scores), max(scores)
            print(f"  {k:<25} {_color_score(avgs[k]):<15} {_color_score(mn):<10} {_color_score(mx)}")
    print(f"{_B}{'─' * 70}{_RST}")
    print(f"\n{_B}Per-case results{_RST}")
    print(f"{'ID':<12} {'Mkt':<5} {'Status':<10} {'Faith':<10} {'AR':<10} {'CP':<10} {'CR':<10} Error")
    print(f"{'─' * 90}")
    for r in results:
        fid = _color_score(r["metrics"]["faithfulness"]["score"])
        ar = _color_score(r["metrics"]["answer_relevancy"]["score"])
        cp = _color_score(r["metrics"]["context_precision"]["score"])
        cr = _color_score(r["metrics"]["context_recall"]["score"])
        st = _fmt_status(r.get("scan_status", "?"))
        err = r.get("error", "")[:30]
        print(f"{r['id']:<12} {r['market']:<5} {st:<10} {fid:<10} {ar:<10} {cp:<10} {cr:<10} {err}")


# ── Single case evaluation ─────────────────────────────────────────────────────

def _eval_case(
    case: dict,
    client: httpx.Client | None,
    base_url: str,
    dry_run: bool,
    timeout: int,
) -> dict:
    q = case["question"]
    market = case["market"]
    gt = case["ground_truth_answer"]
    start = time.time()

    if dry_run:
        resp = _mock_scan(q, market)
        # In dry-run: use ground truth as pseudo-doc so metrics are meaningful
        docs = [{"content": gt, "doc_name": case["source_document"]}]
        agent_trace = []
    else:
        try:
            assert client is not None, "httpx not installed"
            r = client.post(
                f"{base_url}/scan",
                json={
                    "query": q,
                    "product": case.get("category", ""),
                    "category": case.get("category", ""),
                    "markets": [market],
                    "vision_result": {"mock": True, "case_id": case["id"]},
                },
                timeout=timeout,
            )
            r.raise_for_status()
            resp = r.json()
        except Exception as e:
            return {
                "id": case["id"], "question": q, "market": market,
                "scan_status": "ERROR", "error": str(e), "metrics": {},
            }
        agent_trace = resp.get("agent_trace", [])
        docs = _extract_docs(agent_trace)

    answer = resp.get("report", "")
    metrics = compute_all_metrics(
        question=q, answer=answer,
        retrieved_docs=docs, ground_truth_answer=gt,
    )

    return {
        "id": case["id"], "question": q, "market": market,
        "scan_status": resp.get("status", "WARN"),
        "agent_trace": agent_trace,
        "report": answer[:300],
        "metrics": metrics,
        "elapsed": round(time.time() - start, 2),
    }


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description="RAG P7 Evaluation Runner")
    ap.add_argument("--dry-run", action="store_true", help="Use mock responses, no API calls")
    ap.add_argument("--html", action="store_true", help="Generate HTML report")
    ap.add_argument("--generate-tests", action="store_true", help="Generate test_set.json and exit")
    ap.add_argument("--limit", type=int, default=0, help="Limit number of test cases (0 = all)")
    ap.add_argument("--test-set", default="", help="Path to test_set.json")
    ap.add_argument("--corpus-dir", default="", help="Path to processed corpus dir")
    ap.add_argument("--output-dir", default="eval/results", help="Output directory for results")
    args = ap.parse_args()

    eval_dir = Path(__file__).parent
    test_set_path = Path(args.test_set) if args.test_set else eval_dir / "test_set.json"

    # Generate tests if requested
    if args.generate_tests:
        corpus = args.corpus_dir or str(eval_dir.parent / "data/corpus/processed")
        print(f"{_C}[gen-tests] Generating from corpus: {corpus}{_RST}")
        cases = generate_test_set(output_path=str(test_set_path), corpus_dir=corpus)
        print(f"{_G}[OK]  {_RST}{len(cases)} test cases written to {test_set_path}")
        return

    # Load test set
    if not test_set_path.exists():
        print(f"{_R}[ERROR]{_RST} test_set.json not found at {test_set_path}")
        print(f"  Run with --generate-tests first.")
        sys.exit(1)

    with open(test_set_path, encoding="utf-8") as f:
        cases = json.load(f)
    if args.limit > 0:
        cases = cases[: args.limit]

    print(f"{_C}[INFO]{_RST} Loaded {len(cases)} test cases from {test_set_path}")
    print(f"{_C}[INFO]{_RST} Mode: {'DRY-RUN (mock)' if args.dry_run else 'LIVE'}")

    # HTTP client
    base_url = _load_url()
    client: httpx.Client | None = None

    if not args.dry_run:
        if httpx is None:
            print(f"{_R}[ERROR]{_RST} httpx not installed. Use --dry-run.")
            sys.exit(1)
        try:
            client = httpx.Client(timeout=TIMEOUT_PER_CASE)
            r = client.get(f"{base_url}/health")
            print(f"{_G}[OK]  {_RST}Service healthy at {base_url}")
        except Exception as e:
            print(f"{_Y}[WARN]{_RST} Could not reach {base_url}: {e}")
            print(f"       Falling back to dry-run.")
            args.dry_run = True
            client = None

    # Run evaluation
    results: list[dict] = []
    t0 = time.time()

    for i, case in enumerate(cases, 1):
        print(f"\r{_C}[{i}/{len(cases)}]{_RST} {case['id']} ... ", end="", flush=True)
        result = _eval_case(case, client, base_url, args.dry_run, TIMEOUT_PER_CASE)
        results.append(result)
        fid = result["metrics"].get("faithfulness", {}).get("score", 0.0)
        err = result.get("error", "")[:40]
        print(f"\r{_C}[{i}/{len(cases)}]{_RST} {case['id']} "
              f"{_fmt_status(result.get('scan_status','?')):<10}"
              f"faith={_color_score(fid):<10} err={err}")

    elapsed = time.time() - t0

    # Console summary
    _print_summary(results, elapsed)

    # JSON output
    Path(args.output_dir).mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    json_path = Path(args.output_dir) / f"eval_{ts}.json"
    ok_scores = [r for r in results if not r.get("error")]
    summary = {
        "run_time": datetime.now().isoformat(),
        "total": len(results),
        "success_count": len(ok_scores),
        "elapsed_seconds": round(elapsed, 2),
        "mode": "dry-run" if args.dry_run else "live",
        "base_url": base_url,
        "success_rate": f"{len(ok_scores) / len(results):.1%}",
        "avg_faithfulness": round(sum(r["metrics"].get("faithfulness", {}).get("score", 0.0) for r in ok_scores) / len(ok_scores), 4) if ok_scores else 0.0,
    }
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({"summary": summary, "results": results}, f, ensure_ascii=False, indent=2)
    print(f"\n{_C}[JSON]{_RST} Results saved to {json_path}")

    if args.html:
        html_path = Path(args.output_dir) / f"eval_{ts}.html"
        _render_html(results, summary, str(html_path))

    print(f"\n{_G}[DONE]{_RST} {len(results)} cases in {elapsed:.1f}s.")


if __name__ == "__main__":
    main()
