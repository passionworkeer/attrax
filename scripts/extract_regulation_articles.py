# 法规原件条款提取：把 data/regulations/{region}/raw/ 下的官方原件解析成 YAML 的 articles[]。
#   - XML / XHTML / HTML：lxml 或 BeautifulSoup 取线性文本
#   - PDF：pdfplumber 逐页取文本
#   - zip / json：跳过（数据集或压缩包，不是法规正文）
# 分段策略：统一按“条款标题行”切段（第X条 / Article N / §N.N / Section N / 第X章 等），
# 无标题时按固定字符数切块。上限：单条 12000 字符、单法规 32000 字符、60 条；
# 总文本不足 300 字符的原件视为解析失败，保持 articles 为空。
# source_kind 写 official_verbatim（文本直接来自已归档的官方原件，未改写），
# 解析来源写进 notes。用法：python3 scripts/extract_regulation_articles.py [--apply] [--redo] [--limit N]
# 默认 dry-run 只统计。--redo 重提取本脚本先前写入的条目（notes 含机器解析标记者）；
# 人工整理过的条目（无该标记）永远不动。重跑幂等：articles 整体覆盖写。

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
REGULATIONS_ROOT = REPO_ROOT / "data" / "regulations"
EXTRACT_DATE = "2026-09-19"

MIN_TOTAL_CHARS = 300
# 无条款标题的线性文本（chunk 模式）容易是门户/导航页残渣：只有正文量足够大才接受
MIN_CHUNK_MODE_CHARS = 6000
MAX_ARTICLE_CHARS = 12000
MAX_TOTAL_CHARS = 32000
MAX_ARTICLES = 60
CHUNK_CHARS = 4000

# 条款标题行（行首匹配）。章/附件标题也作为切段边界。
_HEADING_PATTERNS = [
    re.compile(r"^第[一二三四五六七八九十百零〇\d]+条"),
    re.compile(r"^第[一二三四五六七八九十百零〇\d]+章"),
    re.compile(r"^附件[一二三四五六七八九十\d]?|^附录[一二三四五六七八九十\d]?|^附则"),
    re.compile(r"^Article\s+(\d+[A-Z]?)\b", re.IGNORECASE),
    re.compile(r"^§\s*\d+(\.\d+)*\.?"),
    re.compile(r"^(?:SECTION|Section)\s+\d+", re.IGNORECASE),
    re.compile(r"^Regulation\s+\d+", re.IGNORECASE),
    re.compile(r"^Rule\s+\d+", re.IGNORECASE),
    re.compile(r"^CHAPTER\s+[IVXLC\d]+", re.IGNORECASE),
    re.compile(r"^Annex\s+[IVXLC\d]+", re.IGNORECASE),
]
_HEADING_RE = re.compile("|".join(p.pattern for p in _HEADING_PATTERNS), re.IGNORECASE)


def is_heading_line(line: str) -> bool:
    return bool(_HEADING_RE.match(line.strip()))


def linear_text_from_xml(raw: str) -> str:
    from lxml import etree
    parser = etree.XMLParser(resolve_entities=False, no_network=True, recover=True, huge_tree=True)
    tree = etree.fromstring(raw.encode("utf-8", "surrogateescape"), parser=parser)
    if tree is None:
        return ""
    lines = [t.strip() for t in tree.itertext() if t and t.strip()]
    return "\n".join(lines)


def linear_text_from_html(raw: str) -> str:
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(raw, "lxml")
    for tag in soup(["script", "style", "noscript", "nav", "svg", "iframe"]):
        tag.decompose()
    return soup.get_text("\n")


def linear_text_from_pdf(path: Path) -> str:
    import pdfplumber
    pages: list[str] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages[:200]:
            pages.append(page.extract_text() or "")
    return "\n".join(pages)


def segment_articles(text: str) -> list[dict]:
    lines = [ln.strip() for ln in text.splitlines()]
    segments: list[dict] = []
    current_title = ""
    current_lines: list[str] = []

    def flush():
        if not current_lines:
            return
        body = "\n".join(current_lines).strip()
        if not body:
            return
        segments.append({"title": current_title[:200] or body[:60], "text": body})

    for ln in lines:
        if ln and is_heading_line(ln):
            flush()
            current_title = ln
            current_lines = [ln]
        else:
            current_lines.append(ln)
    flush()

    # 过短段落并入前一段（导航碎片、孤立标题残留）；带条款标题的短条款保留独立
    merged: list[dict] = []
    for seg in segments:
        if merged and len(seg["text"]) < 80 and not is_heading_line(seg["title"]):
            merged[-1]["text"] += "\n" + seg["text"]
            continue
        merged.append(seg)
    return merged


def chunk_articles(text: str) -> list[dict]:
    # 无条款标题的线性文本：按段落边界切固定块
    paragraphs = [ln for ln in text.splitlines() if ln.strip()]
    chunks: list[dict] = []
    buf: list[str] = []
    size = 0
    for para in paragraphs:
        if size + len(para) > CHUNK_CHARS and buf:
            chunks.append({"title": buf[0][:60], "text": "\n".join(buf)})
            buf, size = [], 0
        buf.append(para)
        size += len(para) + 1
    if buf:
        chunks.append({"title": buf[0][:60], "text": "\n".join(buf)})
    return chunks


def extract_file(path: Path) -> tuple[list[dict], str]:
    ext = path.suffix.lower()
    if ext in {".zip", ".json"}:
        return [], f"skip {ext}"
    try:
        if ext == ".xml":
            text = linear_text_from_xml(path.read_text(encoding="utf-8", errors="surrogateescape"))
            handler = "xml"
        elif ext in {".html", ".xhtml", ".htm"}:
            text = linear_text_from_html(path.read_text(encoding="utf-8", errors="surrogateescape"))
            handler = "html"
        elif ext == ".pdf":
            text = linear_text_from_pdf(path)
            handler = "pdf"
        else:
            return [], f"skip {ext}"
    except Exception as exc:
        return [], f"error {exc!r}"

    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if len(text) < MIN_TOTAL_CHARS:
        return [], f"thin ({len(text)} chars)"
    articles = segment_articles(text)
    heading_hits = sum(1 for a in articles if is_heading_line(a["title"]))
    if heading_hits < 2:
        if len(text) < MIN_CHUNK_MODE_CHARS:
            return [], f"portal-like ({len(text)} chars, no article headings)"
        articles = chunk_articles(text)
    return articles, handler


# 原件格式优先级：结构化官方格式在前，HTML 最后（门户页/研究报告混在 html 里）
FORMAT_PRIORITY = {".xhtml": 0, ".xml": 1, ".pdf": 2, ".html": 3, ".htm": 3}


def extract_regulation(reg: dict) -> tuple[list[dict], str]:
    # 按格式优先级尝试 doc_files，取第一个解析出足够条款正文的原件
    files = sorted(
        (rel for rel in reg.get("doc_files") or []),
        key=lambda rel: FORMAT_PRIORITY.get(Path(rel).suffix.lower(), 9),
    )
    for rel in files:
        path = REGULATIONS_ROOT / rel
        if not path.exists():
            continue
        articles, info = extract_file(path)
        total = sum(len(a["text"]) for a in articles)
        if articles and total >= MIN_TOTAL_CHARS:
            return articles, f"{rel} ({info}, {total} chars)"
    return [], "no usable raw"


def cap_articles(articles: list[dict]) -> tuple[list[dict], bool]:
    out: list[dict] = []
    total = 0
    truncated = False
    for seg in articles:
        if len(out) >= MAX_ARTICLES or total >= MAX_TOTAL_CHARS:
            truncated = True
            break
        text = seg["text"][:MAX_ARTICLE_CHARS]
        if total + len(text) > MAX_TOTAL_CHARS:
            text = text[: MAX_TOTAL_CHARS - total]
            truncated = True
        if not text.strip():
            continue
        out.append({"id": f"art-{len(out) + 1}", "title": seg["title"] or f"第 {len(out)+1} 段", "text": text})
        total += len(text)
        if len(out) == MAX_ARTICLES or total >= MAX_TOTAL_CHARS:
            truncated = truncated or len(articles) > MAX_ARTICLES
            break
    return out, truncated


def main() -> int:
    parser = argparse.ArgumentParser(description="法规原件条款提取")
    parser.add_argument("--apply", action="store_true", help="写回 YAML（默认 dry-run）")
    parser.add_argument("--redo", action="store_true", help="重提取本脚本此前写入的条目")
    parser.add_argument("--limit", type=int, default=0, help="只处理前 N 个（调试）")
    args = parser.parse_args()

    paths = sorted(REGULATIONS_ROOT.glob("*/*.yaml"))
    if args.limit:
        paths = paths[: args.limit]

    stats = {"extracted": 0, "unchanged": 0, "no_raw": 0, "failed": 0}
    for path in paths:
        reg = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(reg, dict) or not reg.get("id"):
            continue
        machine_note = "机器解析原件入库" in (reg.get("notes") or "")
        if reg.get("articles") and not (args.redo and machine_note):
            stats["unchanged"] += 1
            continue
        if not reg.get("doc_files"):
            stats["no_raw"] += 1
            continue
        raw_articles, info = extract_regulation(reg)
        if not raw_articles:
            stats["failed"] += 1
            print(f"  [no-articles] {reg['id']}: {info}")
            continue
        articles, truncated = cap_articles(raw_articles)
        total = sum(len(a["text"]) for a in articles)
        print(f"  [ok] {reg['id']}: {len(articles)} 条 / {total} 字符 ← {info}" + ("（截断）" if truncated else ""))
        stats["extracted"] += 1
        if not args.apply:
            continue

        reg["articles"] = articles
        reg["source_kind"] = "official_verbatim"
        note = (f"{EXTRACT_DATE} 机器解析原件入库：{info}，生成 {len(articles)} 条共 {total} 字符"
                + ("，超出上限已截断" if truncated else "")
                + "；解析文本未人工复核，引用以官方原件为准。")
        notes = reg.get("notes") or ""
        reg["notes"] = (notes + ("\n" if notes else "") + note).strip()
        path.write_text(yaml.safe_dump(reg, allow_unicode=True, sort_keys=False, width=200), encoding="utf-8")

    print(f"\n统计: {stats}")
    if not args.apply:
        print("(dry-run，加 --apply 写回)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
