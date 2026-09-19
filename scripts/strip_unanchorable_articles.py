# 清除非锚点条目的正文：Federal Register 每日刊 / 召回数据集 / GLOBAL 横切领域
# 这些条目按设计不生成 KB 锚点（generate_kb_anchors 排除），带正文会违反
# 库不变量「无锚点法规不得有 articles」。清空后保持元数据展示行。
# 用法：python3 scripts/strip_unanchorable_articles.py [--apply]
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
REGULATIONS_ROOT = REPO_ROOT / "data" / "regulations"
ANCHORS_DIR = REPO_ROOT / "data" / "kb" / "anchors"
STRIP_DATE = "2026-09-19"

_FULL_DATE = re.compile(r"(?<![0-9])(19[89]\d|20\d{2})[-_]\d{2}[-_]\d{2}(?![0-9])")
_DATASET_ID = re.compile(r"FEDERAL_REGISTER_|_recalls|openfda|_recall_|RECALLS_|_latest_", re.IGNORECASE)


def main() -> int:
    parser = argparse.ArgumentParser(description="清空非锚点条目的 articles")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    anchored = set()
    for path in ANCHORS_DIR.glob("*.yaml"):
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and data.get("regulation_id"):
            anchored.add(str(data["regulation_id"]))

    stripped = 0
    for path in sorted(REGULATIONS_ROOT.glob("*/*.yaml")):
        reg = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(reg, dict) or not reg.get("id"):
            continue
        reg_id = str(reg["id"])
        if reg_id in anchored or not reg.get("articles"):
            continue
        if not (_FULL_DATE.search(reg_id) or _DATASET_ID.search(reg_id)):
            continue
        chars = sum(len(a.get("text") or "") for a in reg["articles"])
        print(f"  {reg_id}: 清空 {len(reg['articles'])} 条 / {chars} 字符")
        stripped += 1
        if args.apply:
            reg["articles"] = []
            note = f"{STRIP_DATE} 清空正文：该条目属数据集/每日刊/无锚点类别，不参与扫描引用，正文不入库（保持库不变量）。"
            notes = reg.get("notes") or ""
            reg["notes"] = (notes + ("\n" if notes else "") + note).strip()
            reg["source_kind"] = "unverified"
            path.write_text(
                yaml.safe_dump(reg, allow_unicode=True, sort_keys=False, width=200),
                encoding="utf-8",
            )

    print(f"\n共 {stripped} 条{'（已写入）' if args.apply else '（dry-run）'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
