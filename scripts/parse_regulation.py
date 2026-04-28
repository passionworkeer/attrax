#!/usr/bin/env python3
"""
parse_regulation.py - 法规文档解析管线演示脚本
演示 PDF/HTML/DOCX 三种格式的解析逻辑

用法:
    python scripts/parse_regulation.py <文件路径> [--format pdf|html|docx]
    python scripts/parse_regulation.py --batch <目录路径>

输出:
    解析后的结构化 JSON + 可读文本摘要
"""

import os
import sys
import json
import re
import argparse
from pathlib import Path
from typing import Optional

# ─── PDF Parser ────────────────────────────────────────────────────────────────

def parse_pdf(file_path: str) -> dict:
    """解析 PDF 文件，支持文本类和表格提取"""
    import pdfplumber

    pages = []
    raw_text_parts = []
    has_tables = False

    with pdfplumber.open(file_path) as pdf:
        for i, page in enumerate(pdf.pages):
            text = page.extract_text() or ""
            raw_text_parts.append(text)

            tables = []
            page_tables = page.extract_tables()
            if page_tables:
                has_tables = True
                for t in page_tables:
                    cleaned = _clean_table(t)
                    if cleaned:
                        tables.append(cleaned)

            pages.append({
                "pageNumber": i + 1,
                "text": text,
                "tables": tables
            })

    raw_text = "\n\n".join(raw_text_parts)

    return {
        "fileName": os.path.basename(file_path),
        "sourceType": "pdf",
        "pageCount": len(pages),
        "pages": pages,
        "metadata": {
            "pageCount": len(pages),
            "hasTables": has_tables,
        },
        "rawText": raw_text,
        "summary": _summarize_text(raw_text)
    }


# ─── HTML Parser ───────────────────────────────────────────────────────────────

def parse_html(file_path: str) -> dict:
    """解析 HTML 文件，提取正文和表格"""
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
    except UnicodeDecodeError:
        with open(file_path, "r", encoding="gbk", errors="ignore") as f:
            content = f.read()

    import re
    # 移除 script/style
    content = re.sub(r'<script[^>]*>.*?</script>', '', content, flags=re.DOTALL | re.IGNORECASE)
    content = re.sub(r'<style[^>]*>.*?</style>', '', content, flags=re.DOTALL | re.IGNORECASE)
    # 移除导航/页眉/页脚（常见类名）
    for noisy_class in ['nav', 'sidebar', 'footer', 'header', 'menu', 'comment']:
        content = re.sub(rf'<[^>]+class="[^"]*{noisy_class}[^"]*"[^>]*>.*?</[^>]+>', '', content, flags=re.DOTALL | re.IGNORECASE)
    # 移除所有 HTML 标签
    text = re.sub(r'<[^>]+>', ' ', content)
    # 合并空白
    text = re.sub(r'\s+', ' ', text).strip()

    # 提取表格
    tables = []
    table_matches = re.findall(r'<table[^>]*>(.*?)</table>', content, re.DOTALL | re.IGNORECASE)
    for tm in table_matches:
        rows = re.findall(r'<tr[^>]*>(.*?)</tr>', tm, re.DOTALL | re.IGNORECASE)
        table_data = []
        for row in rows:
            cells = re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', row, re.DOTALL | re.IGNORECASE)
            if cells:
                cleaned_cells = [re.sub(r'<[^>]+>', '', c).strip() for c in cells]
                table_data.append(cleaned_cells)
        if table_data:
            tables.append(table_data)

    return {
        "fileName": os.path.basename(file_path),
        "sourceType": "html",
        "pageCount": 1,
        "pages": [{"text": text, "tables": tables}],
        "metadata": {"tableCount": len(tables)},
        "rawText": text,
        "summary": _summarize_text(text)
    }


# ─── DOCX Parser ────────────────────────────────────────────────────────────────

def parse_docx(file_path: str) -> dict:
    """解析 DOCX 文件，提取段落和表格"""
    from docx import Document

    doc = Document(file_path)
    paragraphs = []
    tables = []

    for para in doc.paragraphs:
        text = para.text.strip()
        if text:
            paragraphs.append(text)

    for table in doc.tables:
        rows = []
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells]
            rows.append(cells)
        if rows:
            tables.append(rows)

    raw_text = "\n\n".join(paragraphs)

    return {
        "fileName": os.path.basename(file_path),
        "sourceType": "docx",
        "pageCount": None,
        "paragraphCount": len(paragraphs),
        "pages": [{"text": raw_text, "tables": tables}],
        "metadata": {
            "paragraphCount": len(paragraphs),
            "tableCount": len(tables),
        },
        "rawText": raw_text,
        "summary": _summarize_text(raw_text)
    }


# ─── Helpers ───────────────────────────────────────────────────────────────────

def _clean_table(table: list) -> Optional[list]:
    """清理 pdfplumber 表格结果"""
    if not table or not table[0]:
        return None
    cleaned = []
    for row in table:
        if not row:
            continue
        cells = [str(c).strip() if c else "" for c in row]
        if any(cells):
            cleaned.append(cells)
    return cleaned if len(cleaned) > 1 else None


def _summarize_text(text: str) -> dict:
    """从文本中提取摘要信息"""
    # 检测市场关键词
    market_keywords = {
        "EU": ["欧盟", "EU", "CE", "REACH", "RoHS", "GDPR", "RED", "LVD", "EMC", "GPSR"],
        "US": ["美国", "FCC", "CPSIA", "COPPA", "FDA", "EPA", "ASTM", "UL", "IRA"],
        "UK": ["英国", "UKCA", "BSI", "NSI Act"],
        "China": ["中国", "出口管制", "反垄断", "ODI", "商务部"],
        "Asia": ["新加坡", "越南", "马来西亚", "印尼", "泰国", "阿联酋", "沙特", "UAE"],
    }

    detected_markets = [m for m, kws in market_keywords.items() if any(k in text for k in kws)]

    # 检测产品类关键词
    product_keywords = ["电子产品", "电池", "充电宝", "锂电池", "纺织品", "玩具",
                       "化妆品", "医疗器械", "食品", "汽车", "电机", "电线"]
    detected_products = [p for p in product_keywords if p in text]

    # 提取章节标题（假设格式: 阿拉伯数字 + 顿号/点）
    headings = re.findall(r'(?:^|\n)(.{2,30}(?:第[一二三四五六七八九十\d]+[条款节章]|[0-9]+\.[0-9]+[^\n]*))', text)

    return {
        "detectedMarkets": detected_markets,
        "detectedProducts": detected_products,
        "topHeadings": headings[:10],
        "charCount": len(text),
        "wordCount": len(text.split()),
    }


def detect_format(file_path: str) -> str:
    """根据扩展名自动检测格式"""
    ext = os.path.splitext(file_path)[1].lower()
    mapping = {".pdf": "pdf", ".html": "html", ".htm": "html", ".docx": "docx"}
    return mapping.get(ext, "unknown")


def parse_file(file_path: str, fmt: Optional[str] = None) -> dict:
    """统一解析入口"""
    if not os.path.exists(file_path):
        return {"error": f"File not found: {file_path}"}

    fmt = fmt or detect_format(file_path)

    parsers = {"pdf": parse_pdf, "html": parse_html, "docx": parse_docx}

    if fmt not in parsers:
        return {"error": f"Unsupported format: {fmt}. Use pdf, html, or docx."}

    result = parsers[fmt](file_path)
    return result


def print_report(result: dict):
    """打印可读格式的报告"""
    if "error" in result:
        print(f"ERROR: {result['error']}")
        return

    print(f"\n{'='*60}")
    print(f"  File: {result['fileName']} [{result['sourceType'].upper()}]")
    print(f"{'='*60}")

    summary = result.get("summary", {})
    print(f"\n  Basic Info")
    print(f"  - char count: {summary.get('charCount', 'N/A'):,}")
    print(f"  - word count: {summary.get('wordCount', 'N/A'):,}")

    markets = summary.get("detectedMarkets", [])
    products = summary.get("detectedProducts", [])
    print(f"\n  Markets: {', '.join(markets) if markets else 'none detected'}")
    print(f"  Products: {', '.join(products) if products else 'none detected'}")

    headings = summary.get("topHeadings", [])
    if headings:
        print(f"\n  Sections:")
        for h in headings[:5]:
            print(f"     - {h}")

    metadata = result.get("metadata", {})
    if metadata.get("hasTables"):
        print(f"\n  Tables: YES")
    if metadata.get("tableCount"):
        print(f"  Table count: {metadata['tableCount']}")
    if metadata.get("paragraphCount"):
        print(f"  Paragraph count: {metadata['paragraphCount']}")
    if result.get("pageCount"):
        print(f"  Pages: {result['pageCount']}")

    print(f"\n  Text preview (first 500 chars):")
    raw = result.get("rawText", "")[:500]
    print(f"  {raw}")
    print()


# ─── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="解析法规文档: PDF / HTML / DOCX")
    parser.add_argument("file", nargs="?", help="要解析的文件路径")
    parser.add_argument("--batch", metavar="DIR", help="批量解析目录")
    parser.add_argument("--format", "-f", choices=["pdf", "html", "docx"], help="指定格式")
    parser.add_argument("--output", "-o", metavar="FILE", help="输出 JSON 文件路径")
    parser.add_argument("--verbose", "-v", action="store_true", help="详细输出")

    args = parser.parse_args()

    if args.batch:
        files = []
        for ext in ["*.pdf", "*.html", "*.htm", "*.docx"]:
            files.extend(Path(args.batch).glob(ext))
        if not files:
            print(f"No files found in {args.batch}")
            return
        results = []
        for f in files:
            print(f"Parsing: {f.name}")
            try:
                r = parse_file(str(f))
                if "error" not in r:
                    results.append(r)
                    if args.verbose:
                        print_report(r)
            except Exception as e:
                print(f"  ERROR: {e}")
        if args.output:
            with open(args.output, "w", encoding="utf-8") as out:
                json.dump(results, out, ensure_ascii=False, indent=2)
            print(f"Saved {len(results)} results to {args.output}")
        return

    if not args.file:
        parser.print_help()
        return

    result = parse_file(args.file, args.format)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as out:
            json.dump(result, out, ensure_ascii=False, indent=2)
        print(f"Saved to {args.output}")

    print_report(result)


if __name__ == "__main__":
    main()
