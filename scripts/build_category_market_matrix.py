#!/usr/bin/env python3
"""Generate a category × market coverage matrix from processed corpus metadata.

Reads data/corpus/processed/*.json, aggregates the `metadata.productCategories`
× `metadata.detectedMarkets` (or fallback to top-level `region`), and writes:

  - data/regulation_reports/category_market_matrix.json (machine-readable)
  - data/regulation_reports/category_market_matrix.md   (human-readable)

The matrix exposes coverage gaps that the existing registry-based
`report_regulation_coverage.py` cannot see (registry only tracks source
availability, not product-category applicability).
"""
from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_PROCESSED_DIR = Path("data/corpus/processed")
DEFAULT_REPORT_DIR = Path("data/regulation_reports")


def load_processed(path: Path) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for f in sorted(path.glob("*.json")):
        try:
            out.append(json.loads(f.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError) as exc:
            print(f"warn: skipping {f.name}: {exc}")
    return out


def extract_categories(doc: dict[str, Any]) -> list[str]:
    md = doc.get("metadata") or {}
    cats = md.get("productCategories") or md.get("product_categories") or []
    if not isinstance(cats, list):
        return []
    return [str(c) for c in cats if c]


def extract_markets(doc: dict[str, Any]) -> list[str]:
    md = doc.get("metadata") or {}
    markets = md.get("detectedMarkets") or []
    if markets:
        return [str(m) for m in markets if m]
    region = doc.get("region")
    return [region] if region else []


def build_matrix(docs: list[dict[str, Any]]) -> dict[str, Any]:
    cat_counter: Counter[str] = Counter()
    market_counter: Counter[str] = Counter()
    cell: dict[tuple[str, str], list[str]] = defaultdict(list)

    for doc in docs:
        cats = extract_categories(doc)
        markets = extract_markets(doc)
        title = doc.get("title") or doc.get("id") or doc.get("fileName") or "(untitled)"
        for c in cats:
            cat_counter[c] += 1
        for m in markets:
            market_counter[m] += 1
        for c in cats:
            for m in markets:
                cell[(c, m)].append(title)

    matrix: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    for (cat, market), titles in sorted(cell.items()):
        matrix[cat][market] = {"count": len(titles), "titles": titles}

    return {
        "categories": dict(cat_counter),
        "markets": dict(market_counter),
        "matrix": {c: dict(m) for c, m in matrix.items()},
    }


def write_markdown(payload: dict[str, Any], path: Path, total_docs: int) -> None:
    cats = sorted(payload["categories"].keys())
    markets = sorted(payload["markets"].keys())
    matrix = payload["matrix"]

    lines: list[str] = []
    lines.append("# Category × Market Coverage Matrix")
    lines.append("")
    lines.append(f"- Generated at: {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    lines.append(f"- Total processed documents: {total_docs}")
    lines.append(f"- Distinct categories: {len(cats)}")
    lines.append(f"- Distinct markets: {len(markets)}")
    lines.append("")

    lines.append("## Coverage per category")
    lines.append("")
    lines.append("| Category | Documents | Markets covered |")
    lines.append("| --- | ---: | --- |")
    for cat in cats:
        covered = sorted(matrix.get(cat, {}).keys())
        lines.append(f"| {cat} | {payload['categories'][cat]} | {', '.join(covered) if covered else '—'} |")
    lines.append("")

    lines.append("## Coverage per market")
    lines.append("")
    lines.append("| Market | Documents | Categories covered |")
    lines.append("| --- | ---: | --- |")
    for market in markets:
        covered_cats = sorted(c for c, mk in matrix.items() if market in mk)
        lines.append(f"| {market} | {payload['markets'][market]} | {', '.join(covered_cats) if covered_cats else '—'} |")
    lines.append("")

    lines.append("## Sparse cells (≤2 documents) — coverage gaps")
    lines.append("")
    sparse = sorted(
        (
            (c, m, data["count"], data["titles"])
            for c, mk in matrix.items()
            for m, data in mk.items()
            if data["count"] <= 2
        ),
        key=lambda x: (x[2], x[0], x[1]),
    )
    if sparse:
        lines.append("| Category | Market | Count | Titles |")
        lines.append("| --- | --- | ---: | --- |")
        for cat, market, count, titles in sparse:
            shown = "; ".join(titles[:3])
            if len(titles) > 3:
                shown += f" (+{len(titles) - 3} more)"
            lines.append(f"| {cat} | {market} | {count} | {shown} |")
    else:
        lines.append("- None — all category × market cells have ≥3 documents.")
    lines.append("")

    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--processed-dir", type=Path, default=DEFAULT_PROCESSED_DIR)
    parser.add_argument("--report-dir", type=Path, default=DEFAULT_REPORT_DIR)
    args = parser.parse_args()

    args.report_dir.mkdir(parents=True, exist_ok=True)
    docs = load_processed(args.processed_dir)
    if not docs:
        raise SystemExit(f"No processed documents found in {args.processed_dir}")

    payload = build_matrix(docs)

    json_path = args.report_dir / "category_market_matrix.json"
    json_path.write_text(
        json.dumps(
            {
                "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "totalDocs": len(docs),
                **payload,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    md_path = args.report_dir / "category_market_matrix.md"
    write_markdown(payload, md_path, len(docs))

    print(f"Wrote {json_path}")
    print(f"Wrote {md_path}")
    print(f"  Categories: {len(payload['categories'])}")
    print(f"  Markets: {len(payload['markets'])}")
    sparse = sum(1 for v in payload["matrix"].values() for d in v.values() if d["count"] <= 2)
    print(f"  Sparse cells (≤2 docs): {sparse}")


if __name__ == "__main__":
    main()