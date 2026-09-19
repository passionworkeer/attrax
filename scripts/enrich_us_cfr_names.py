# US CFR 条目名称补全：从 raw XML 的 FDSYS/TITLE 提取 part 主题，
# 写进 short_name（保留 official_citation 不变）。
# 背景：regulation-raw 导入的 US-CFR-* 条目 short_name 只有 "US 16 CFR Part N"，
# 无主题词 —— 扫描期锚点排序（品类关键词打分）与 /regulations 展示都无法感知主题。
# 用法：python3 scripts/enrich_us_cfr_names.py [--apply]
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
REGULATIONS_ROOT = REPO_ROOT / "data" / "regulations"
ENRICH_DATE = "2026-09-19"

_TITLE_RE = re.compile(
    r"<FDSYS>.*?<TITLE>(.*?)</TITLE>.*?</FDSYS>", re.DOTALL
)


def part_subject(xml_text: str) -> str:
    m = _TITLE_RE.search(xml_text)
    if not m:
        return ""
    subject = re.sub(r"\s+", " ", m.group(1)).strip()
    # 形如 "PART 1103—BAN OF LEAD-CONTAINING PAINT..."：去掉 "PART N—" 前缀取主题
    subject = re.sub(r"^PART\s+\d+\s*[—-]+\s*", "", subject)
    return subject


def main() -> int:
    parser = argparse.ArgumentParser(description="US CFR short_name 主题补全")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    changed = 0
    for path in sorted(REGULATIONS_ROOT.glob("us/US-CFR-*.yaml")):
        reg = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(reg, dict):
            continue
        current = str(reg.get("short_name") or "")
        if current != str(reg.get("official_citation") or "") and "—" not in current and " - " not in current:
            # 已含主题的跳过（幂等）
            if not re.fullmatch(r"US \d+ CFR Part [\dA-Za-z]+", current):
                continue
        subject = ""
        for rel in reg.get("doc_files") or []:
            raw = REGULATIONS_ROOT / rel
            if not raw.exists() or raw.suffix.lower() != ".xml":
                continue
            subject = part_subject(raw.read_text(encoding="utf-8", errors="surrogateescape"))
            if subject:
                break
        if not subject:
            continue
        citation = str(reg.get("official_citation") or "")
        new_name = f"{citation} — {subject}"
        if new_name == current:
            continue
        print(f"  {reg['id']}: {current!r} -> {new_name!r}")
        changed += 1
        if args.apply:
            reg["short_name"] = new_name
            path.write_text(
                yaml.safe_dump(reg, allow_unicode=True, sort_keys=False, width=200),
                encoding="utf-8",
            )

    print(f"\n共 {changed} 条{'（已写入）' if args.apply else '（dry-run）'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
