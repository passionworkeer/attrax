#!/usr/bin/env python3
"""Parse every file in regulation-raw into parsed/.

Output per source file:
    parsed/<market>/<stem>.md    human-readable (front-matter + articles)
    parsed/<market>/<stem>.json  structured (Doc as dict)

Plus:
    parsed/_index.json   one row per document
    parsed/_REPORT.md    parse-quality report, worst first
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from parse import extractors as X  # noqa: E402
from parse.model import Doc  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent
RAW = ROOT
OUT = ROOT / "parsed"
SKIP_DIRS = {"_tools", "parsed"}


def dispatch(path: Path, market: str) -> tuple[str, callable]:
    ext = path.suffix.lower()
    name = path.name
    if market == "eu" and ext == ".xhtml":
        return "eu_xhtml", X.eu_xhtml
    if market == "eu" and ext == ".pdf":
        return "eu_pdf", X.eu_pdf
    if market == "us" and ext == ".xml":
        head = path.read_bytes()[:4000]
        if b"CFRGRANULE" in head:
            return "us_cfr_xml", X.us_cfr_xml
        if b"<FEDREG" in head or b"<FRDOC" in head:
            return "fedreg_xml", X.fedreg_xml
        return "generic_xml", _generic_xml
    if market == "us" and ext == ".pdf":
        return "us_pdf", X.us_pdf
    if market == "us" and ext == ".json":
        return "json_doc", X.json_doc
    if market == "ca" and ext == ".xml":
        return "ca_xml", X.ca_xml
    if market == "jp" and ext == ".xml":
        return "jp_xml", X.jp_xml
    if market == "de" and ext == ".zip":
        return "de_zip", X.de_zip
    if market == "de" and ext == ".pdf":
        return "de_pdf", X.de_pdf
    if market == "es" and ext == ".xml":
        return "es_boe_xml", X.es_boe_xml
    if market == "cn" and "国家标准" in str(path):
        return "cn_gb_html", X.cn_gb_html
    if ext == ".pdf":
        return "generic_pdf", X.generic_pdf
    if ext == ".json":
        return "json_doc", X.json_doc
    if ext in (".html", ".htm", ".xhtml"):
        return "generic_html", X.generic_html
    if ext == ".xml":
        return "us_cfr_xml" if b"CFRGRANULE" in path.read_bytes()[:4000] else "generic_xml", _generic_xml
    return "skip", None


def _generic_xml(path: Path) -> Doc:
    from xml.etree import ElementTree as ET
    from parse.model import Article, clean_text
    warnings: list[str] = []
    try:
        root = ET.parse(str(path)).getroot()
    except Exception as e:
        return Doc(doc_id=path.stem, market="", title=path.stem,
                   source_path=str(path), source_format="xml", parser="generic_xml",
                   warnings=[f"parse failed: {e}"])
    from parse.extractors import xml_text
    txt = xml_text(root)
    return Doc(doc_id=path.stem, market="", title=path.stem,
               source_path=str(path), source_format="xml", parser="generic_xml",
               full_text=txt, warnings=warnings)


def parse_one(args: tuple[str, str, str]) -> dict:
    path_str, market, out_stem = args
    path = Path(path_str)
    try:
        parser_name, fn = dispatch(path, market)
        if fn is None:
            return {"file": str(path.relative_to(RAW)), "status": "skipped",
                    "parser": "skip", "warnings": ["unsupported extension"]}
        doc: Doc = fn(path)
        doc.market = market
        outdir = OUT / market
        outdir.mkdir(parents=True, exist_ok=True)
        (outdir / (out_stem + ".md")).write_text(doc.to_markdown(), encoding="utf-8")
        (outdir / (out_stem + ".json")).write_text(doc.to_json(), encoding="utf-8")
        return {
            "file": str(path.relative_to(RAW)),
            "status": "ok",
            "parser": parser_name,
            "doc_id": doc.doc_id,
            "title": doc.title[:160],
            "articles": doc.article_count,
            "text_chars": doc.text_chars,
            "out_md": str((outdir / (out_stem + ".md")).relative_to(ROOT)),
            "warnings": doc.warnings,
        }
    except Exception as e:
        return {
            "file": str(path.relative_to(RAW)) if path.is_absolute() else path_str,
            "status": "failed", "parser": "?",
            "warnings": [f"{type(e).__name__}: {e}", traceback.format_exc()[-400:]],
        }


def collect() -> list[tuple[str, str, str]]:
    """Return (path, market, output_stem).

    EU ships many acts as both PDF and XHTML with the same stem; those get a
    format suffix so the two parses do not overwrite each other. Stems that are
    unique stay clean (`<stem>.md`) so the common case is not noisy.
    """
    raw: list[tuple[str, str, str]] = []
    for p in sorted(RAW.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(RAW)
        if rel.parts[0] in SKIP_DIRS or p.name.startswith("_"):
            continue
        if p.suffix.lower() == ".md" and len(rel.parts) == 1:
            continue
        market = rel.parts[0] if len(rel.parts) > 1 else ""
        raw.append((str(p), market, p.stem))

    stem_counts = Counter(s for _, _, s in raw)
    jobs = []
    for path_str, market, stem in raw:
        out_stem = stem
        if stem_counts[stem] > 1:
            out_stem = f"{stem}.{Path(path_str).suffix.lstrip('.').lower()}"
        jobs.append((path_str, market, out_stem))
    return jobs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--market", nargs="*")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    jobs = collect()
    if args.market:
        want = set(args.market)
        jobs = [j for j in jobs if j[1] in want]
    if args.limit:
        jobs = jobs[:args.limit]

    print(f"parsing {len(jobs)} files -> {OUT}")

    results: list[dict] = []
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        futs = [pool.submit(parse_one, j) for j in jobs]
        for i, fut in enumerate(as_completed(futs), 1):
            results.append(fut.result())
            if i % 50 == 0 or i == len(jobs):
                ok = sum(1 for r in results if r["status"] == "ok")
                print(f"  ... {i}/{len(jobs)} done, {ok} ok")

    results.sort(key=lambda r: r["file"])
    (OUT / "_index.json").write_text(
        json.dumps({"generated": __import__("time").strftime("%Y-%m-%dT%H:%M:%S"),
                    "total": len(results), "results": results},
                   ensure_ascii=False, indent=1), encoding="utf-8")

    # ---- report ----
    by_parser: dict[str, list[dict]] = defaultdict(list)
    for r in results:
        by_parser[r.get("parser", "?")].append(r)

    def real_warnings(r: dict) -> list[str]:
        """'note:' entries are expected limitations, not parse problems."""
        return [w for w in r.get("warnings", []) if not w.startswith("note:")]

    lines = ["# 解析质量报告", "",
             f"处理源文件 **{len(results)}** 个，输出到 `parsed/`。", "",
             f"合计 **{sum(r.get('articles',0) for r in results if r.get('status')=='ok'):,}** 条条文、"
             f"**{sum(r.get('text_chars',0) for r in results if r.get('status')=='ok'):,}** 字符。", ""]
    lines += ["| 解析器 | 文件数 | 平均条文数 | 平均正文字符 | 有真实告警 |",
              "|:---|---:|---:|---:|---:|"]
    for p, rows in sorted(by_parser.items(), key=lambda kv: -len(kv[1])):
        oks = [r for r in rows if r.get("status") == "ok"]
        if not oks:
            lines.append(f"| `{p}` | {len(rows)} | — | — | — |")
            continue
        avg_a = sum(r.get("articles", 0) for r in oks) / len(oks)
        avg_c = sum(r.get("text_chars", 0) for r in oks) / len(oks)
        warn = sum(1 for r in oks if real_warnings(r))
        lines.append(f"| `{p}` | {len(rows)} | {avg_a:.1f} | {avg_c:,.0f} | {warn} |")
    lines.append("")

    failed = [r for r in results if r.get("status") == "failed"]
    if failed:
        lines += ["## 解析失败", "", "| 文件 | 错误 |", "|:---|:---|"]
        for r in failed:
            lines.append(f"| `{r['file']}` | {r['warnings'][0][:120]} |")
        lines.append("")

    warn_rows = [r for r in results if r.get("status") == "ok" and real_warnings(r)]
    if warn_rows:
        lines += [f"## 有真实告警的文档（{len(warn_rows)}）", "",
                  "| 文件 | 解析器 | 条文 | 字符 | 告警 |", "|:---|:---|---:|---:|:---|"]
        for r in sorted(warn_rows, key=lambda x: x.get("text_chars", 0))[:150]:
            lines.append(f"| `{r['file']}` | `{r['parser']}` | {r.get('articles',0)} | "
                         f"{r.get('text_chars',0):,} | {'; '.join(real_warnings(r))[:110]} |")
        lines.append("")

    note_rows = [r for r in results
                 if r.get("status") == "ok"
                 and any(w.startswith("note:") for w in r.get("warnings", []))]
    if note_rows:
        from collections import Counter as _C
        kinds = _C(w for r in note_rows for w in r["warnings"] if w.startswith("note:"))
        lines += [f"## 已知限制（{len(note_rows)} 个文档，非解析问题）", ""]
        for k, n in kinds.most_common():
            lines.append(f"- {k[5:]} — **{n}** 个文件")
        lines.append("")

    (OUT / "_REPORT.md").write_text("\n".join(lines), encoding="utf-8")

    ok = [r for r in results if r.get("status") == "ok"]
    total_arts = sum(r.get("articles", 0) for r in ok)
    total_chars = sum(r.get("text_chars", 0) for r in ok)
    print(f"\ndone: {len(ok)}/{len(results)} ok, "
          f"{total_arts:,} articles, {total_chars:,} chars")
    print(f"report -> {OUT/'_REPORT.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
