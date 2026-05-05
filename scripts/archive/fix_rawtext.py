#!/usr/bin/env python3
"""
fix_rawtext.py - 修复 processed/ 中缺少 rawText 的 JSON 文件

从 sourcePath 读取源文件，重新解析，写入 rawText 字段。
跳过 Screenshot_Pending 目录的扫描件。
"""
import os
import sys
import json
import re
from pathlib import Path

PROCESSED_DIR = Path(r"E:\desktop\火鹰合规\attrax\data\corpus\processed")


def parse_html(file_path: str) -> dict:
    """解析 HTML，提取正文文本。"""
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

    # 移除 script/style
    content = re.sub(r"<script[^>]*>.*?</script>", "", content, flags=re.DOTALL | re.IGNORECASE)
    content = re.sub(r"<style[^>]*>.*?</style>", "", content, flags=re.DOTALL | re.IGNORECASE)
    # 移除 nav/footer/header 噪音
    for noisy in ["nav", "sidebar", "footer", "header", "menu", "advertisement", "ad-"]:
        content = re.sub(
            rf'<[^>]+class="[^"]*{noisy}[^"]*"[^>]*>.*?</[^>]+>',
            "", content, flags=re.DOTALL | re.IGNORECASE,
        )

    # 提取纯文本
    text = re.sub(r"<[^>]+>", " ", content)
    text = re.sub(r"\s+", " ", text).strip()

    # 提取表格
    tables = []
    table_matches = re.findall(r"<table[^>]*>(.*?)</table>", content, re.DOTALL | re.IGNORECASE)
    for tm in table_matches:
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", tm, re.DOTALL | re.IGNORECASE)
        table_data = []
        for row in rows:
            cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.DOTALL | re.IGNORECASE)
            if cells:
                cleaned = [re.sub(r"<[^>]+>", "", c).strip() for c in cells]
                if any(cleaned):
                    table_data.append(cleaned)
        if table_data:
            tables.append(table_data)

    return {
        "rawText": text[:100_000],  # 截断到 100k
        "tables": tables,
        "totalChars": len(text),
    }


def parse_docx(file_path: str) -> dict:
    """解析 DOCX，提取段落文本和表格。"""
    import zipfile
    from xml.etree import ElementTree as ET

    paragraphs = []
    tables = []

    try:
        with zipfile.ZipFile(file_path, "r") as z:
            # 读取 document.xml
            if "word/document.xml" not in z.namelist():
                return {"rawText": "", "tables": [], "totalChars": 0, "error": "No document.xml"}

            doc_xml = z.read("word/document.xml")
            root = ET.fromstring(doc_xml)

            # 命名空间
            ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}

            # 提取段落
            for para in root.iter(f"{{{ns['w']}}}p"):
                texts = []
                for run in para.iter(f"{{{ns['w']}}}t"):
                    if run.text:
                        texts.append(run.text)
                if texts:
                    paragraphs.append("".join(texts))

            # 提取表格
            for table in root.iter(f"{{{ns['w']}}}tbl"):
                table_data = []
                for row in table.iter(f"{{{ns['w']}}}tr"):
                    cells = []
                    for cell in row.iter(f"{{{ns['w']}}}tc"):
                        cell_texts = []
                        for t in cell.iter(f"{{{ns['w']}}}t"):
                            if t.text:
                                cell_texts.append(t.text)
                        cells.append("".join(cell_texts))
                    if any(cells):
                        table_data.append(cells)
                if table_data:
                    tables.append(table_data)

    except Exception as e:
        return {"rawText": "", "tables": [], "totalChars": 0, "error": str(e)}

    raw_text = "\n\n".join(paragraphs)
    return {
        "rawText": raw_text[:100_000],
        "tables": tables,
        "totalChars": len(raw_text),
        "paragraphCount": len(paragraphs),
    }


def fix_file(json_path: Path) -> bool:
    """修复单个 JSON 文件。返回 True 表示修复成功。"""
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # 已有足够 rawText 的跳过
    if len(data.get("rawText", "")) >= 100:
        return False

    source_path = data.get("sourcePath", "")
    if not source_path or not os.path.exists(source_path):
        print(f"  SKIP (source not found): {json_path.name}")
        return False

    source_type = data.get("sourceType", "")
    if source_type == "html":
        parsed = parse_html(source_path)
    elif source_type == "docx":
        parsed = parse_docx(source_path)
    elif source_type == "pdf":
        # PDF 用 pdfplumber，这里简化处理
        print(f"  SKIP (PDF needs pdfplumber): {json_path.name}")
        return False
    else:
        print(f"  SKIP (unknown type: {source_type}): {json_path.name}")
        return False

    # 更新数据
    data["rawText"] = parsed["rawText"]
    if "tables" in parsed:
        data["tables"] = parsed["tables"]
    if "totalChars" in parsed:
        data["totalChars"] = parsed["totalChars"]
    if "paragraphCount" in parsed:
        data["paragraphCount"] = parsed["paragraphCount"]

    # 写回
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    text_len = len(parsed["rawText"])
    print(f"  FIXED ({text_len:,} chars): {json_path.name}")
    return True


def main():
    fixed = 0
    skipped = 0
    failed = 0

    print("=" * 60)
    print("  修复 rawText 缺失的 JSON 文件")
    print("=" * 60)

    for json_file in sorted(PROCESSED_DIR.glob("*.json")):
        # 跳过 Screenshot_Pending
        if json_file.name.startswith("Screenshot_Pending"):
            continue

        with open(json_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        raw_text = data.get("rawText", "")
        if len(raw_text) >= 100:
            skipped += 1
            continue

        try:
            if fix_file(json_file):
                fixed += 1
            else:
                failed += 1
        except Exception as e:
            print(f"  ERROR: {json_file.name}: {e}")
            failed += 1

    print()
    print(f"  Fixed: {fixed}, Skipped (already ok): {skipped}, Failed: {failed}")

    # 验证
    print()
    print("  验证...")
    empty_count = 0
    for json_file in sorted(PROCESSED_DIR.glob("*.json")):
        if json_file.name.startswith("Screenshot_Pending"):
            continue
        with open(json_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        if len(data.get("rawText", "")) < 100:
            empty_count += 1
            print(f"  STILL EMPTY: {json_file.name}")

    print(f"  Empty files remaining (non-screenshot): {empty_count}")
    print(f"  Target: 0")


if __name__ == "__main__":
    main()
