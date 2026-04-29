#!/usr/bin/env python3
"""
fix_decompressed.py - 用解压后的 HTML 重新填充 processed JSON 的 rawText
"""
import sys
sys.stdout.reconfigure(encoding="utf-8")

import os
import re
import json
from pathlib import Path

CN_DIR     = Path(r"E:\desktop\火鹰合规\attrax\data\corpus\cn")
PROC_DIR   = Path(r"E:\desktop\火鹰合规\attrax\data\corpus\processed")

MAPPING = [
    {
        "decompressed": CN_DIR / "中国GB 44495-2024汽车整车信息安全技术要求（标准简介）_decompressed.html",
        "json":         PROC_DIR / "CN_中国GB_44495-2024汽车整车信息安全技术要求_标准简介__html.json",
    },
    {
        "decompressed": CN_DIR / "中国《两用物项出口管制条例》（2024）说明（中国法律观察站）_decompressed.html",
        "json":         PROC_DIR / "CN_中国_两用物项出口管制条例__2024_说明_中国法律观察站__html.json",
    },
    {
        "decompressed": CN_DIR / "中国《境外投资管理办法》（商务部令2014年第3号）_decompressed.html",
        "json":         PROC_DIR / "CN_中国_境外投资管理办法__商务部令2014年第3号__html.json",
    },
]


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
        "rawText": text[:100_000],
        "tables": tables,
        "totalChars": len(text),
    }


def main():
    print("=" * 60)
    print("  修复 3 个解压后的乱码 HTML → processed JSON")
    print("=" * 60)

    for item in MAPPING:
        decompressed = item["decompressed"]
        json_path    = item["json"]

        if not decompressed.exists():
            print(f"  [MISSING] 解压文件不存在: {decompressed.name}")
            continue
        if not json_path.exists():
            print(f"  [MISSING] JSON 不存在: {json_path.name}")
            continue

        # 解析解压后的 HTML
        parsed = parse_html(str(decompressed))
        raw_len = len(parsed["rawText"])

        if raw_len < 100:
            print(f"  [WARN] 解析后文本过短 ({raw_len} chars): {decompressed.name}")
            continue

        # 读取现有 JSON，更新 rawText
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        old_len = len(data.get("rawText", ""))
        data["rawText"]      = parsed["rawText"]
        data["tables"]       = parsed["tables"]
        data["totalChars"]   = parsed["totalChars"]

        # 更新 sourcePath 指向解压后的文件（保持一致）
        data["sourcePath"] = str(decompressed)
        data["note"] = "rawText extracted from gzip-decompressed HTML (original was garbled)"

        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        print(f"  FIXED: {json_path.name}")
        print(f"    old rawText: {old_len} chars → new: {raw_len:,} chars")

    # 最终验证
    print()
    print("  验证：processed 中是否还有 rawText < 100 的文件（排除 Screenshot）")
    empty = 0
    for jf in sorted(PROC_DIR.glob("*.json")):
        if jf.name.startswith("Screenshot_Pending"):
            continue
        with open(jf, "r", encoding="utf-8") as f:
            d = json.load(f)
        if len(d.get("rawText", "")) < 100:
            empty += 1
            print(f"    STILL EMPTY: {jf.name}")
    print(f"  空文件数: {empty}")


if __name__ == "__main__":
    main()
