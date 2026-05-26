#!/usr/bin/env python3
"""Evaluate whether retrieval returns expected official regulation sources."""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_CASES_PATH = Path("data/regulation_eval/retrieval_cases.json")
DEFAULT_FAISS_META_PATH = Path("data/faiss/legal_chunks_meta.json")
DEFAULT_OUTPUT_DIR = Path("data/regulation_eval/results")

REQUIRED_CASE_FIELDS = {
    "id",
    "query",
    "market",
    "category",
    "risk",
    "expected_source_ids",
}


def load_cases(path: str | Path = DEFAULT_CASES_PATH) -> list[dict[str, Any]]:
    """Load curated retrieval evaluation cases."""
    case_path = Path(path)
    data = json.loads(case_path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError(f"retrieval cases must be a list: {case_path}")
    return data


def validate_cases(cases: list[dict[str, Any]]) -> None:
    """Validate retrieval eval case schema before running."""
    seen_ids: set[str] = set()
    for index, case in enumerate(cases):
        missing = REQUIRED_CASE_FIELDS - set(case)
        if missing:
            raise ValueError(f"case at index {index} missing fields: {sorted(missing)}")

        case_id = str(case["id"])
        if not case_id:
            raise ValueError(f"case at index {index} has empty id")
        if case_id in seen_ids:
            raise ValueError(f"duplicate case id: {case_id}")
        seen_ids.add(case_id)

        expected = case.get("expected_source_ids")
        if not isinstance(expected, list) or not expected or not all(isinstance(item, str) and item for item in expected):
            raise ValueError(f"case {case_id} expected_source_ids must be a non-empty list of strings")


def load_chunks_from_faiss_meta(meta_path: str | Path = DEFAULT_FAISS_META_PATH) -> list[dict[str, Any]]:
    """Load chunk metadata from a FAISS metadata JSON file."""
    path = Path(meta_path)
    if not path.exists():
        raise FileNotFoundError(f"FAISS metadata file not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    chunks = data.get("chunks", data) if isinstance(data, dict) else data
    if not isinstance(chunks, list):
        raise ValueError(f"FAISS metadata chunks must be a list: {path}")
    return chunks


def build_retriever_from_chunks(chunks: list[dict[str, Any]]):
    """Build a BM25-backed HybridRetriever from in-memory chunks."""
    from rag_service.retrieval.bm25_retriever import BM25Retriever
    from rag_service.retrieval.hybrid_retriever import HybridRetriever

    bm25 = BM25Retriever()
    retriever = HybridRetriever(bm25=bm25, faiss_retriever=None)
    retriever.load_chunks(chunks)
    return retriever


def build_retriever_from_faiss_meta(meta_path: str | Path = DEFAULT_FAISS_META_PATH):
    """Build an evaluation retriever from active FAISS chunk metadata."""
    return build_retriever_from_chunks(load_chunks_from_faiss_meta(meta_path))


def evaluate_cases(
    cases: list[dict[str, Any]],
    retriever,
    *,
    top_k: int = 10,
) -> list[dict[str, Any]]:
    """Run retrieval cases and compute per-case hit/rank metrics."""
    validate_cases(cases)
    results: list[dict[str, Any]] = []

    for case in cases:
        retrieved = retriever.retrieve(
            query=case["query"],
            product_category=case["category"],
            region=case["market"],
            regulatory_types=case.get("regulatory_types", [case["risk"]]),
            official_only=case.get("official_only", True),
            top_k=top_k,
        )
        returned_source_ids = _unique_source_ids(retrieved)
        expected_source_ids = list(case["expected_source_ids"])
        expected_set = set(expected_source_ids)

        rank = 0
        for index, source_id in enumerate(returned_source_ids, 1):
            if source_id in expected_set:
                rank = index
                break

        hit = rank > 0
        results.append(
            {
                "id": case["id"],
                "query": case["query"],
                "market": case["market"],
                "category": case["category"],
                "risk": case["risk"],
                "regulatory_types": case.get("regulatory_types", [case["risk"]]),
                "expected_source_ids": expected_source_ids,
                "returned_source_ids": returned_source_ids,
                "top_documents": [
                    {
                        "source_id": _source_id(item),
                        "doc_name": item.get("doc_name", ""),
                        "region": item.get("region", ""),
                        "score": item.get("score", item.get("rrf_score", 0.0)),
                    }
                    for item in retrieved[:top_k]
                ],
                "hit": hit,
                "rank": rank,
                "reciprocal_rank": round(1.0 / rank, 4) if rank else 0.0,
            }
        )

    return results


def summarize_results(results: list[dict[str, Any]]) -> dict[str, Any]:
    """Summarize retrieval evaluation results."""
    total = len(results)
    hits = sum(1 for result in results if result.get("hit"))
    reciprocal_sum = sum(float(result.get("reciprocal_rank", 0.0)) for result in results)
    summary = {
        "generated_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "total_cases": total,
        "hits": hits,
        "misses": [result["id"] for result in results if not result.get("hit")],
        "hit_rate": hits / total if total else 0.0,
        "mrr": reciprocal_sum / total if total else 0.0,
        "by_market": _group_summary(results, "market"),
        "by_category": _group_summary(results, "category"),
        "by_risk": _group_summary(results, "risk"),
    }
    return summary


def write_report(
    summary: dict[str, Any],
    results: list[dict[str, Any]],
    json_path: str | Path,
    md_path: str | Path,
) -> None:
    """Write JSON and Markdown retrieval eval reports."""
    json_output = Path(json_path)
    md_output = Path(md_path)
    json_output.parent.mkdir(parents=True, exist_ok=True)
    md_output.parent.mkdir(parents=True, exist_ok=True)

    json_output.write_text(
        json.dumps({"summary": summary, "results": results}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    md_output.write_text(_render_markdown(summary, results), encoding="utf-8")


def _group_summary(results: list[dict[str, Any]], key: str) -> dict[str, dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for result in results:
        grouped[str(result.get(key, ""))].append(result)

    output: dict[str, dict[str, Any]] = {}
    for group, items in sorted(grouped.items()):
        total = len(items)
        hits = sum(1 for item in items if item.get("hit"))
        mrr = sum(float(item.get("reciprocal_rank", 0.0)) for item in items) / total if total else 0.0
        output[group] = {
            "total": total,
            "hits": hits,
            "hit_rate": hits / total if total else 0.0,
            "mrr": mrr,
        }
    return output


def _unique_source_ids(results: list[dict[str, Any]]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for result in results:
        source_id = _source_id(result)
        if source_id and source_id not in seen:
            seen.add(source_id)
            ordered.append(source_id)
    return ordered


def _source_id(result: dict[str, Any]) -> str:
    metadata = result.get("metadata") if isinstance(result.get("metadata"), dict) else {}
    return str(
        result.get("source_id")
        or result.get("supplement_id")
        or metadata.get("supplement_id")
        or metadata.get("source_id")
        or ""
    )


def _render_markdown(summary: dict[str, Any], results: list[dict[str, Any]]) -> str:
    lines = [
        "# Regulation Retrieval Evaluation",
        "",
        f"- Generated at: {summary.get('generated_at', '')}",
        f"- Total cases: {summary['total_cases']}",
        f"- Hits: {summary['hits']}",
        f"- Hit rate: {summary['hit_rate']:.2%}",
        f"- MRR: {summary['mrr']:.4f}",
        "",
        "## By Market",
        "",
        "| Market | Cases | Hits | Hit Rate | MRR |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for market, stats in summary["by_market"].items():
        lines.append(f"| {market} | {stats['total']} | {stats['hits']} | {stats['hit_rate']:.2%} | {stats['mrr']:.4f} |")

    lines.extend(
        [
            "",
            "## Cases",
            "",
            "| Case | Market | Category | Risk | Hit | Rank | Expected | Returned |",
            "| --- | --- | --- | --- | --- | ---: | --- | --- |",
        ]
    )
    for result in results:
        expected = ", ".join(result.get("expected_source_ids", []))
        returned = ", ".join(result.get("returned_source_ids", [])[:5])
        lines.append(
            f"| {result['id']} | {result['market']} | {result['category']} | "
            f"{result['risk']} | {result['hit']} | {result['rank']} | {expected} | {returned} |"
        )
    lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Evaluate regulation retrieval against expected official source ids.")
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES_PATH)
    parser.add_argument("--faiss-meta", type=Path, default=DEFAULT_FAISS_META_PATH)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--label", default=datetime.now().strftime("%Y-%m-%d_registry_retrieval_eval"))
    parser.add_argument("--top-k", type=int, default=10)
    args = parser.parse_args(argv)

    cases = load_cases(args.cases)
    retriever = build_retriever_from_faiss_meta(args.faiss_meta)
    results = evaluate_cases(cases, retriever, top_k=args.top_k)
    summary = summarize_results(results)

    json_path = args.output_dir / f"{args.label}.json"
    md_path = args.output_dir / f"{args.label}.md"
    write_report(summary, results, json_path, md_path)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if summary["hits"] == summary["total_cases"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
