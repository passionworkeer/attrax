# 复核清单里 15 条 EUR-Lex 链接是否真实存在。
#
# 为什么需要单独一遍：curl 直接请求 eur-lex.europa.eu 时，**有效和编造的 ELI 都返回
# 202**（实测 /eli/reg/2016/679/oj 与 /eli/reg/2099/99999/oj 同为 202），所以
# probe-catalog-urls.py 的 "OK 202" 只证明主机可达，不证明文书存在。
#
# 这里改用 EU Publications Office 的 Cellar 解析端点按 CELEX 号复核：不带 Accept 头时
# 存在的资源返回 303（重定向到具体表述），不存在的返回 404（实测 32099R9999 -> 404）。
#
# ELI -> CELEX 的换算：/eli/reg/2016/679/oj -> 32016R0679，
# 年份四位，类型 reg=R / dir=L / dec=D，编号补零到四位。
# legal-content 形式直接取 uri=CELEX%3A... 的百分号解码值。
#
# 用法：
#   rag_service/.venv/bin/python verify-eu-eli.py \
#       ../../../data/regulations/_imports/attrax-docs-2026-09-19.json eu-eli-report.txt

import json
import re
import subprocess
import sys
import urllib.parse
from pathlib import Path

ELI = re.compile(r"eur-lex\.europa\.eu/eli/(reg|dir|dec)/(\d{4})/(\d+)/")
LEGACY = re.compile(r"eur-lex\.europa\.eu/legal-content/[A-Z]{2}/TXT/\?uri=(CELEX[%3A:].*)", re.I)
KIND = {"reg": "R", "dir": "L", "dec": "D"}


def celex_of(url: str) -> str | None:
    """把 EUR-Lex 链接换算成 Cellar 能解析的 CELEX 号；无法识别时返回 None。"""
    match = ELI.search(url)
    if match:
        kind, year, number = match.groups()
        return f"3{year}{KIND[kind]}{int(number):04d}"
    match = LEGACY.search(url)
    if match:
        # uri=CELEX%3A52022XC0330%2801%29 -> CELEX:52022XC0330(01) -> 52022XC0330(01)
        decoded = urllib.parse.unquote(match.group(1))
        return decoded.split(":", 1)[-1]
    return None


def probe(celex: str) -> str:
    # 括号必须百分号编码：CELEX 52022XC0330(01) 带原始括号请求返回 404，
    # 编码成 52022XC0330%2801%29 才返回 303（实测）。
    encoded = urllib.parse.quote(celex, safe="")
    result = subprocess.run(
        [
            "curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
            "--max-time", "30",
            f"https://publications.europa.eu/resource/celex/{encoded}",
        ],
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def main() -> int:
    catalog_path = Path(sys.argv[1])
    out_path = Path(sys.argv[2])
    entries = json.loads(catalog_path.read_text(encoding="utf-8"))["entries"]

    lines = ["# 目录条目 EUR-Lex 链接复核（Cellar CELEX 解析：303=存在 / 404=不存在）", ""]
    total, bad = 0, 0
    for entry in entries:
        url = entry.get("source_url", "")
        if "eur-lex.europa.eu" not in url:
            continue
        total += 1
        celex = celex_of(url)
        if not celex:
            lines.append(f"!! PARSE\t{entry['id']}\t无法解析 ELI -> CELEX\t{url}")
            bad += 1
            continue
        code = probe(celex)
        exists = code == "303"
        if not exists:
            bad += 1
        lines.append(f"{'OK  ' if exists else '!!  '}{code}\t{entry['id']}\t{celex}\t{url}")

    lines += ["", f"EUR-Lex 条目 {total} 条，存在 {total - bad} 条，异常 {bad} 条"]
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
