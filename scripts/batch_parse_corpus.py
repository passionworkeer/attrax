#!/usr/bin/env python3
"""
batch_parse_corpus.py - 批量解析整个语料库

将 corpus/ 目录下所有文件解析为统一格式 JSON，输出到 corpus/processed/
并生成 corpus/corpus_index.json 统一索引

用法:
    python scripts/batch_parse_corpus.py
    python scripts/batch_parse_corpus.py --region eu/regulations/pdfs
"""

import os
import sys
import json
import re
import glob
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Any

# ─── PDF Parser ────────────────────────────────────────────────────────────────

def parse_pdf(file_path: str) -> dict:
    """解析 PDF 文件，提取文本 + 表格 + 元数据"""
    import pdfplumber

    pages_data = []
    raw_text_parts = []
    all_tables = []
    total_chars = 0
    page_count = 0

    try:
        with pdfplumber.open(file_path) as pdf:
            page_count = len(pdf.pages)
            for i, page in enumerate(pdf.pages):
                text = page.extract_text() or ""
                raw_text_parts.append(text)
                total_chars += len(text)

                tables = []
                page_tables = page.extract_tables()
                if page_tables:
                    for t in page_tables:
                        cleaned = _clean_pdf_table(t)
                        if cleaned:
                            tables.append(cleaned)
                            all_tables.append(cleaned)

                # 提取页内关键词（法律条款相关）
                section_hints = _extract_section_hints(text)

                pages_data.append({
                    "pageNumber": i + 1,
                    "charCount": len(text),
                    "hasText": len(text.strip()) > 50,
                    "hasTables": len(tables) > 0,
                    "sectionHints": section_hints[:5],
                    "textPreview": text[:200].replace('\n', ' ').strip() if text else "",
                })

    except Exception as e:
        return {"error": f"PDF parse failed: {e}", "fileName": os.path.basename(file_path)}

    raw_text = "\n\n".join(raw_text_parts)

    return {
        "fileName": os.path.basename(file_path),
        "sourcePath": file_path,
        "sourceType": "pdf",
        "pageCount": page_count,
        "totalChars": total_chars,
        "hasTables": len(all_tables) > 0,
        "tableCount": len(all_tables),
        "pages": pages_data,
        "rawText": raw_text,
        "metadata": _extract_metadata(raw_text, "pdf"),
    }


def _clean_pdf_table(table: list) -> Optional[list]:
    """清理 pdfplumber 表格结果"""
    if not table or not table[0]:
        return None
    cleaned = []
    for row in table:
        if not row:
            continue
        cells = [str(c).strip() if c else "" for c in row]
        if any(c for c in cells if c):
            cleaned.append(cells)
    return cleaned if len(cleaned) > 1 else None


def _extract_section_hints(text: str) -> List[str]:
    """提取文本中的法律条款提示"""
    hints = []
    # EU Article pattern
    article_matches = re.findall(r'(?:Article|Art\.|Art\.?)\s*(\d+[a-zA-Z]?)', text[:3000])
    for m in article_matches[:3]:
        hints.append(f"Article {m}")

    # Chinese 条 pattern
    tiao_matches = re.findall(r'第[一二三四五六七八九十百\d]+条', text[:3000])
    for m in tiao_matches[:3]:
        if m not in hints:
            hints.append(m)

    # Chapter/Section patterns
    chapter_matches = re.findall(r'(?:Chapter|CHAPTER|Section|SECTION)\s+[IVX\d]+', text[:3000])
    for m in chapter_matches[:3]:
        if m not in hints:
            hints.append(m)

    return hints


# ─── DOCX Parser ────────────────────────────────────────────────────────────────

def parse_docx(file_path: str) -> dict:
    """解析 DOCX 文件，提取段落 + 表格"""
    from docx import Document

    paragraphs_data = []
    all_tables = []
    total_chars = 0

    try:
        doc = Document(file_path)
        for i, para in enumerate(doc.paragraphs):
            text = para.text.strip()
            if text:
                total_chars += len(text)
                paragraphs_data.append({
                    "index": i,
                    "text": text,
                    "charCount": len(text),
                    "sectionHint": _get_para_section_hint(text),
                })

        for table in doc.tables:
            rows = []
            for row in table.rows:
                cells = [cell.text.strip() for cell in row.cells]
                if any(cells):
                    rows.append(cells)
            if rows:
                all_tables.append(rows)

    except Exception as e:
        return {"error": f"DOCX parse failed: {e}", "fileName": os.path.basename(file_path)}

    raw_text = "\n".join(p["text"] for p in paragraphs_data)

    return {
        "fileName": os.path.basename(file_path),
        "sourcePath": file_path,
        "sourceType": "docx",
        "pageCount": None,
        "paragraphCount": len(paragraphs_data),
        "totalChars": total_chars,
        "hasTables": len(all_tables) > 0,
        "tableCount": len(all_tables),
        "paragraphs": paragraphs_data[:50],  # 前50段作为摘要
        "rawText": raw_text,
        "metadata": _extract_metadata(raw_text, "docx"),
    }


def _get_para_section_hint(text: str) -> Optional[str]:
    """判断段落是否可能是章节标题"""
    if len(text) < 5 or len(text) > 100:
        return None
    # 数字标题 pattern
    if re.match(r'^[0-9]+[.、][^\n]{3,50}', text):
        return "numbered_heading"
    # 中文标题 pattern
    if re.match(r'^[一二三四五六七八九十]+[、.][^\n]{3,50}', text):
        return "chinese_heading"
    return None


# ─── HTML Parser ───────────────────────────────────────────────────────────────

def parse_html(file_path: str) -> dict:
    """解析 HTML 文件，提取正文 + 表格"""
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
    except UnicodeDecodeError:
        try:
            with open(file_path, "r", encoding="gbk", errors="ignore") as f:
                content = f.read()
        except Exception:
            with open(file_path, "r", encoding="latin-1", errors="ignore") as f:
                content = f.read()

    # 移除噪音
    content = re.sub(r'<script[^>]*>.*?</script>', '', content, flags=re.DOTALL | re.IGNORECASE)
    content = re.sub(r'<style[^>]*>.*?</style>', '', content, flags=re.DOTALL | re.IGNORECASE)
    for noisy in ['nav', 'sidebar', 'footer', 'header', 'menu', 'advertisement', 'ad-']:
        content = re.sub(rf'<[^>]+class="[^"]*{noisy}[^"]*"[^>]*>.*?</[^>]+>', '', content, flags=re.DOTALL | re.IGNORECASE)

    # 提取纯文本
    text = re.sub(r'<[^>]+>', ' ', content)
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
                cleaned = [re.sub(r'<[^>]+>', '', c).strip() for c in cells]
                if any(cleaned):
                    table_data.append(cleaned)
        if table_data:
            tables.append(table_data)

    return {
        "fileName": os.path.basename(file_path),
        "sourcePath": file_path,
        "sourceType": "html",
        "pageCount": 1,
        "totalChars": len(text),
        "hasTables": len(tables) > 0,
        "tableCount": len(tables),
        "tables": tables,
        "rawText": text[:50000],  # HTML 可能很长，截断到 50k
        "metadata": _extract_metadata(text, "html"),
    }


# ─── Metadata Extractor ────────────────────────────────────────────────────────

def _extract_metadata(text: str, source_type: str) -> dict:
    """从文本中提取市场/产品/法规类型元数据"""
    text_lower = text.lower()

    # 市场检测
    markets = []
    if any(k in text for k in ["欧盟", "EU", "CE marking", "GDPR", "REACH", "GPSR"]):
        markets.append("EU")
    if any(k in text for k in ["美国", "FCC", "CPSIA", "COPPA", "FDA", "IRA"]):
        markets.append("US")
    if any(k in text for k in ["英国", "UKCA", "NSI Act"]):
        markets.append("UK")
    if any(k in text for k in ["中国", "出口管制", "商务部", "发改委", "GB ", "CCC"]):
        markets.append("CN")
    if any(k in text for k in ["新加坡", "Singapore", "PDPA", "MAS"]):
        markets.append("SG")
    if any(k in text for k in ["越南", "Vietnam", "Vietnamese"]):
        markets.append("VN")
    if any(k in text for k in ["马来西亚", "Malaysia", "PDPA"]):
        markets.append("MY")
    if any(k in text for k in ["印尼", "Indonesia", "PDP Law"]):
        markets.append("ID")
    if any(k in text for k in ["沙特", "Saudi", "SABER", "SFDA"]):
        markets.append("SA")
    if any(k in text for k in ["阿联酋", "UAE", "Central Bank"]):
        markets.append("AE")

    # 法规类型
    reg_types = []
    if any(k in text_lower for k in ["product safety", "产品安全", "GPSR", "UL", "IEC"]):
        reg_types.append("product_safety")
    if any(k in text_lower for k in ["chemical", "REACH", "RoHS", "SVHC", "化学品"]):
        reg_types.append("chemical")
    if any(k in text_lower for k in ["data protection", "GDPR", "PDPA", "个人信息"]):
        reg_types.append("data_privacy")
    if any(k in text_lower for k in ["EMC", "electromagnetic", "电磁兼容"]):
        reg_types.append("EMC")
    if any(k in text_lower for k in ["battery", "lithium", "电池", "新电池法"]):
        reg_types.append("battery")
    if any(k in text_lower for k in ["export control", "出口管制", "两用物项"]):
        reg_types.append("export_control")
    if any(k in text_lower for k in ["toy", "EN 71", "玩具"]):
        reg_types.append("toy_safety")
    if any(k in text_lower for k in ["investment", "ODI", "境外投资", "FIRRMA"]):
        reg_types.append("investment")

    # 产品类
    products = []
    if any(k in text for k in ["充电宝", "移动电源", "power bank", "portable battery"]):
        products.append("充电宝/移动电源")
    if any(k in text for k in ["乒乓球拍", "table tennis"]):
        products.append("乒乓球拍")
    if any(k in text for k in ["锂电池", "lithium battery", "锂离子电池"]):
        products.append("锂电池")
    if any(k in text for k in ["玩具", "toy", "儿童产品"]):
        products.append("玩具")
    if any(k in text for k in ["纺织品", "textile", "fabric"]):
        products.append("纺织品")
    if any(k in text for k in ["医疗器械", "medical device", "IVD"]):
        products.append("医疗器械")

    return {
        "detectedMarkets": markets,
        "regulatoryTypes": reg_types,
        "productCategories": products,
        "charCount": len(text),
    }


# ─── Format Detector ──────────────────────────────────────────────────────────

def detect_format(file_path: str) -> Optional[str]:
    ext = os.path.splitext(file_path)[1].lower()
    return {".pdf": "pdf", ".html": "html", ".htm": "html", ".docx": "docx"}.get(ext)


def parse_file(file_path: str) -> dict:
    fmt = detect_format(file_path)
    if fmt == "pdf":
        return parse_pdf(file_path)
    elif fmt == "docx":
        return parse_docx(file_path)
    elif fmt == "html":
        return parse_html(file_path)
    else:
        return {"error": f"Unsupported format: {file_path}"}


# ─── Main Batch Processor ──────────────────────────────────────────────────────

def main():
    base_dir = Path("E:/desktop/火鹰合规/attrax/data/corpus")
    output_dir = base_dir / "processed"
    output_dir.mkdir(exist_ok=True)

    # 区域定义
    regions = {
        "eu/regulations/pdfs": "EU_Regulations_PDF",
        "eu/regulations/html": "EU_Regulations_HTML",
        "eu/products": "EU_Products",
        "eu/uk": "UK",
        "us": "US",
        "cn": "CN",
        "asia/malaysia": "MY",
        "asia/thailand": "TH",
        "asia/singapore": "SG",
        "asia/indonesia": "ID",
        "asia/vietnam": "VN",
        "middle_east/saudi": "SA",
        "middle_east/uae": "AE",
        "intl/wipo": "WIPO",
        "intl/un": "UN",
        "reference": "Reference",
        "screenshot_pending": "Screenshot_Pending",
    }

    all_results = []
    stats = {
        "total": 0,
        "success": 0,
        "failed": 0,
        "by_region": {},
    }

    for region_key, region_label in regions.items():
        region_dir = base_dir / region_key
        if not region_dir.exists():
            continue

        stats["by_region"][region_key] = {"total": 0, "success": 0, "failed": 0}

        for ext in ["*.pdf", "*.html", "*.htm", "*.docx"]:
            for file_path in region_dir.glob(ext):
                file_name = file_path.name
                stats["total"] += 1
                stats["by_region"][region_key]["total"] += 1

                # 输出文件路径
                safe_name = re.sub(r'[^\w一-鿿\-]', '_', file_name)
                safe_name = safe_name[:100]
                output_file = output_dir / f"{region_label}_{safe_name}.json"

                print(f"  [{region_label}] {file_name}...", end=" ", flush=True)

                try:
                    result = parse_file(str(file_path))

                    # 保存到文件
                    with open(output_file, "w", encoding="utf-8") as f:
                        json.dump(result, f, ensure_ascii=False, indent=2)

                    # 加入索引
                    entry = {
                        "region": region_key,
                        "regionLabel": region_label,
                        "fileName": file_name,
                        "sourcePath": str(file_path),
                        "outputPath": str(output_file),
                        "sourceType": result.get("sourceType", "unknown"),
                        "pageCount": result.get("pageCount"),
                        "paragraphCount": result.get("paragraphCount"),
                        "totalChars": result.get("totalChars", 0),
                        "hasTables": result.get("hasTables", False),
                        "tableCount": result.get("tableCount", 0),
                        "metadata": result.get("metadata", {}),
                        "error": result.get("error"),
                    }

                    if "error" not in result:
                        stats["success"] += 1
                        stats["by_region"][region_key]["success"] += 1
                        print(f"OK ({result.get('totalChars', 0):,} chars)")
                    else:
                        stats["failed"] += 1
                        stats["by_region"][region_key]["failed"] += 1
                        print(f"FAILED: {result['error']}")

                    all_results.append(entry)

                except Exception as e:
                    stats["failed"] += 1
                    stats["by_region"][region_key]["failed"] += 1
                    print(f"ERROR: {e}")
                    all_results.append({
                        "region": region_key,
                        "regionLabel": region_label,
                        "fileName": file_name,
                        "sourcePath": str(file_path),
                        "error": str(e),
                    })

    # 生成统一索引
    index = {
        "version": "1.0",
        "created": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "stats": stats,
        "files": all_results,
    }

    index_file = base_dir / "corpus_index.json"
    with open(index_file, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    # 打印统计
    print()
    print("=" * 60)
    print("  解析完成")
    print("=" * 60)
    print(f"  总文件: {stats['total']}")
    print(f"  成功:   {stats['success']}")
    print(f"  失败:   {stats['failed']}")
    print()
    print("  按区域:")
    for rk, rs in stats["by_region"].items():
        if rs["total"] > 0:
            ok_mark = "OK" if rs["failed"] == 0 else "PARTIAL"
            print(f"    [{rs['success']}/{rs['total']} {ok_mark}] {rk}")
    print()
    print(f"  输出目录: {output_dir}")
    print(f"  索引文件: {index_file}")


if __name__ == "__main__":
    main()