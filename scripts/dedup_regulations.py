# 跨批次法规条目去重：
#   1. 按 region + 文书号（年份-编号，兼容 编号-年份 两种顺序）自动分组
#   2. 叠加人工合并表（同 URL 但无文书号的跨批次重复，如 UK watchdog 4 组）
#   3. 每组选一个 canonical（优先：已有 KB 锚点 > 已有 articles > id 最短），
#      合并 doc_files / source_url / notes，删除其余变体 YAML
#   4. --apply 时重建 regulations_index.json 并输出变更清单 JSON（供服务器同步删除用）
#
# 安全阀：组内成员在文书号之外还带有互不相同的 4 位年份（标准版本号，如 GB 2099.3-1997
# 与 -2008 是两版标准）时跳过该组不合并。
# 用法：python3 scripts/dedup_regulations.py [--apply]
#        默认 dry-run，只打印分组与归并计划。

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

REGULATIONS_ROOT = REPO_ROOT / "data" / "regulations"
ANCHORS_DIR = REPO_ROOT / "data" / "kb" / "anchors"
REPORT_PATH = REPO_ROOT / "docs" / "evidence" / "2026-09-19-library-scan-integration" / "dedup-report.json"
MERGE_DATE = "2026-09-19"

# 人工合并表：variant -> canonical。两条来自不同导入批次但指向同一官方来源、
# 又没有可机读文书号的条目，在这里显式声明（保留 canonical，删除 variant）。
MANUAL_MERGES: dict[str, str] = {
    "UK-UK_EPR_-_GOV-UK": "UK-Packaging-EPR",
    "UK-UK_REACH_-_GOV-UK": "UK-REACH",
    "UK-UK_HSE_SVHC_-_HSE-GOV-UK": "UK-SVHC",
    "UK-UK_WEEE_-_GOV-UK": "UK-WEEE",
}

# 匹配 id 里的 (20xx|19xx)-编号 或 编号-(20xx|19xx)
_YEAR_FIRST = re.compile(r"(?<![0-9])(19[89]\d|20\d{2})[-_](\d{1,4})(?![0-9])")
_NUM_FIRST = re.compile(r"(?<![0-9])(\d{1,4})[-_](19[89]\d|20\d{2})(?![0-9])")
_ANY_YEAR = re.compile(r"(?<![0-9])(19[89]\d|20\d{2})(?![0-9])")
# CN GB 标准号：GB_4806-1-1994 → 标准号 (4806, 1) + 年份 1994。
# 标准号含分部号，必须整段比较：GB 4806.2 与 GB 15092.2 同年同部号但是不同标准。
_CN_GB = re.compile(r"GB[_-](\d+(?:[-_]\d+)*?)[-_](19[89]\d|20\d{2})(?![0-9])")
# id 含完整日期（YYYY-MM-DD）的是期刊式条目（如 Federal Register 每日刊），日期不是文书号
_FULL_DATE = re.compile(r"(?<![0-9])(19[89]\d|20\d{2})[-_](\d{2})[-_](\d{2})(?![0-9])")


def load_yaml_region(reg: dict) -> str:
    return str(reg.get("region") or "").strip().upper()


def load_library() -> dict[str, dict]:
    regs: dict[str, dict] = {}
    for path in sorted(REGULATIONS_ROOT.glob("*/*.yaml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or not data.get("id"):
            raise SystemExit(f"无法解析或缺少 id: {path}")
        if data["id"] in regs:
            raise SystemExit(f"重复 id: {data['id']} ({path})")
        data["_path"] = str(path)
        regs[data["id"]] = data
    return regs


def load_anchored_ids() -> set[str]:
    anchored: set[str] = set()
    for path in ANCHORS_DIR.glob("*.yaml"):
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and data.get("regulation_id"):
            anchored.add(str(data["regulation_id"]))
    return anchored


def instrument_key(reg_id: str, region: str) -> tuple | None:
    if region == "CN" or reg_id.startswith("CN-GB"):
        m = _CN_GB.search(reg_id)
        if m:
            nums = tuple(int(x) for x in re.split(r"[-_]", m.group(1)))
            return ("CN-GB", nums, int(m.group(2)))
        return None
    m = _YEAR_FIRST.search(reg_id)
    if m:
        return (region, int(m.group(1)), int(m.group(2)))
    m = _NUM_FIRST.search(reg_id)
    if m:
        return (region, int(m.group(2)), int(m.group(1)))
    return None


def version_years(reg_id: str, key: tuple) -> set[str]:
    # 文书号年份之外的其它 4 位年份（标准版本年）。用于识别“同号不同版”。
    key_years = {str(part) for part in key if isinstance(part, int) and 1900 <= part <= 2099}
    return {m.group(1) for m in _ANY_YEAR.finditer(reg_id)} - key_years


def canonical_rank(reg: dict, anchored: set[str]) -> tuple[int, int, int]:
    has_anchor = 1 if reg["id"] in anchored else 0
    has_articles = 1 if reg.get("articles") else 0
    return (has_anchor, has_articles, -len(reg["id"]))


def plan_citation_groups(regs: dict[str, dict], anchored: set[str]) -> list[dict]:
    # 同区域 + 归一化引用号相同的条目视为同一文书（CFR 一个 part 从 xml/pdf/
    # 内部 scheme 多个 URL 重复登记成 -2/-3/-4 后缀家族）。引用号过短或纯通用
    # 词（无数字无 CJK）的组跳过，避免把不同法规并进同一门户标题。
    groups: dict[tuple[str, str], list[str]] = {}
    for reg_id, reg in regs.items():
        cite = _normalize_citation(str(reg.get("official_citation") or ""))
        if not cite:
            continue
        groups.setdefault((load_yaml_region(reg), cite), []).append(reg_id)

    plans: list[dict] = []
    for key in sorted(groups):
        members = sorted(groups[key])
        if len(members) < 2:
            continue
        members.sort(key=lambda rid: (canonical_rank(regs[rid], anchored), rid), reverse=True)
        plans.append({"key": f"cite:{key[0]}:{key[1][:40]}", "canonical": members[0],
                      "variants": members[1:],
                      "citations": {m: regs[m].get("official_citation", "") for m in members}})
    return plans


def _normalize_citation(cite: str) -> str:
    import re as _re
    norm = _re.sub(r"[^0-9a-z一-鿿]+", "", cite.lower())
    if len(norm) < 8:
        return ""
    if not any(ch.isdigit() for ch in norm) and not any("一" <= ch <= "鿿" for ch in norm):
        return ""
    return norm


def plan_groups(regs: dict[str, dict], anchored: set[str]) -> list[dict]:
    groups: dict[tuple, list[str]] = {}
    for reg_id, reg in regs.items():
        if _FULL_DATE.search(reg_id):
            continue
        key = instrument_key(reg_id, load_yaml_region(reg))
        if key:
            groups.setdefault(key, []).append(reg_id)

    plans: list[dict] = []
    for key in sorted(groups, key=str):
        members = sorted(groups[key])
        if len(members) < 2:
            continue
        vyears = [version_years(m, key) for m in members]
        if any(vyears) and not all(v == vyears[0] for v in vyears):
            # 组内“版本年”不一致：同号不同版（如 GB 2099.3-1997 vs -2008），不合并
            continue
        members.sort(key=lambda rid: (canonical_rank(regs[rid], anchored), rid), reverse=True)
        canonical = members[0]
        variants = members[1:]
        plans.append({"key": "-".join(map(str, key)), "canonical": canonical,
                      "variants": variants,
                      "citations": {m: regs[m].get("official_citation", "") for m in members}})
    return plans


def merge_into(canonical: dict, variant: dict) -> list[str]:
    changes: list[str] = []
    files = list(canonical.get("doc_files") or [])
    for f in variant.get("doc_files") or []:
        if f not in files:
            files.append(f)
            changes.append(f"doc_files += {f}")
    if files != (canonical.get("doc_files") or []):
        canonical["doc_files"] = files
    if not canonical.get("source_url") and variant.get("source_url"):
        canonical["source_url"] = variant["source_url"]
        changes.append(f"source_url = {variant['source_url']}")
    if variant.get("language") and not canonical.get("language"):
        canonical["language"] = variant["language"]
    note = f"{MERGE_DATE} 去重：合并同法规异名条目 {variant['id']}（{variant.get('official_citation', '')}）。"
    notes = canonical.get("notes") or ""
    canonical["notes"] = (notes + ("\n" if notes else "") + note).strip()
    changes.append(f"merge {variant['id']}")
    return changes


def dump_yaml(reg: dict) -> str:
    payload = {k: v for k, v in reg.items() if k != "_path"}
    return yaml.safe_dump(payload, allow_unicode=True, sort_keys=False, width=120)


def main() -> int:
    parser = argparse.ArgumentParser(description="跨批次法规条目去重")
    parser.add_argument("--apply", action="store_true", help="执行归并（默认 dry-run）")
    args = parser.parse_args()

    regs = load_library()
    anchored = load_anchored_ids()

    # 人工合并表校验：两端必须都存在（幂等：已合并过的 variant 静默跳过）
    for variant, canonical in MANUAL_MERGES.items():
        if variant not in regs:
            continue
        if canonical not in regs:
            raise SystemExit(f"人工合并表 canonical 不存在: {canonical}")

    auto_plans = plan_groups(regs, anchored)
    citation_plans = plan_citation_groups(regs, anchored)
    auto_variant_ids = {v for p in auto_plans for v in p["variants"]}
    citation_plans = [p for p in citation_plans if p["canonical"] not in auto_variant_ids]
    manual_plans = []
    for variant, canonical in sorted(MANUAL_MERGES.items()):
        if variant not in regs:
            continue
        if variant in auto_variant_ids:
            raise SystemExit(f"{variant} 同时出现在自动分组与人工合并表，先解决冲突")
        manual_plans.append({"key": "manual", "canonical": canonical, "variants": [variant],
                             "citations": {variant: regs[variant].get("official_citation", ""),
                                           canonical: regs[canonical].get("official_citation", "")}})

    all_plans = auto_plans + citation_plans + manual_plans
    removed_files: list[str] = []
    change_log: list[dict] = []

    print(f"自动分组 {len(auto_plans)} 组 + 人工合并 {len(manual_plans)} 组")
    for plan in all_plans:
        print(f"\n[{plan['key']}] canonical={plan['canonical']}  variants={plan['variants']}")
        for rid, cite in plan["citations"].items():
            print(f"    {rid}: {cite}")

    if not args.apply:
        print("\n(dry-run，加 --apply 执行)")
        return 0

    for plan in all_plans:
        canonical = regs[plan["canonical"]]
        changes: list[str] = []
        for vid in plan["variants"]:
            changes.extend(merge_into(canonical, regs[vid]))
        Path(canonical["_path"]).write_text(dump_yaml(canonical), encoding="utf-8")
        for vid in plan["variants"]:
            removed_files.append(Path(regs[vid]["_path"]).name)
            Path(regs[vid]["_path"]).unlink()
        change_log.append({"canonical": plan["canonical"], "variants": plan["variants"], "changes": changes})
        print(f"applied: {plan['canonical']} <- {plan['variants']}")

    from scripts.watchdog.auto_ingest import AutoIngestor
    AutoIngestor._rebuild_index()

    index = json.loads((REGULATIONS_ROOT / "regulations_index.json").read_text(encoding="utf-8"))
    print(f"\n索引重建完成 count={index['count']}")

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(
        {"date": MERGE_DATE, "groups": change_log, "removed_yaml_files": sorted(removed_files),
         "index_count": index["count"]},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"变更清单已写入 {REPORT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
