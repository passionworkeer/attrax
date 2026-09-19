# 全库 KB 锚点生成：为法规库中没有锚点的条目生成 data/kb/anchors/*.yaml，
# 使 2026-09-19 批量导入的法规进入扫描的 must-check 检索范围。
#
# 映射规则：
#   - domain ∈ 10 个产品品类 → applies_if.category = [domain]
#   - domain ∈ 特征（wireless 等）→ applies_if.features_any = [domain]
#   - 其它横切领域（数据保护/消费者保护/出口管制/...）→ 市场级锚点（category/features 留空，
#     该市场扫描一律纳入）
#   - 市场映射：region 直接作 market；GCC → [SA, AE]；GLOBAL → [GLOBAL]（随 UN 一起
#     ALWAYS_INCLUDE，受扫描期上限约束）；VN/ID/IN/MY/TH/NZ 先建锚点但产品未开放这些
#     市场，扫描选不到
#
# 排除：Federal Register 每日刊、召回/执法数据集等“非法规正文”条目（无稳定文书身份）。
# 生成锚点带 curation: auto 标记：扫描期受数量上限约束、报告里标注“库自动接入”。
# key_articles 取解析出的前两条（文档序通常先是范围/定义条款）。
# 用法：python3 scripts/generate_kb_anchors.py [--apply]
# 默认 dry-run 只打印计划。

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

REGULATIONS_ROOT = REPO_ROOT / "data" / "regulations"
ANCHORS_DIR = REPO_ROOT / "data" / "kb" / "anchors"
GENERATE_DATE = "2026-09-19"

CATEGORY_DOMAINS = {
    "electronics", "toy", "battery", "textile", "cosmetic",
    "food_contact", "appliance", "3c", "home", "other",
}
FEATURE_DOMAINS = {"wireless", "mains", "children"}

REGION_MARKET_OVERRIDES = {"GCC": ["SA", "AE"]}
# 产品未开放的市场的法规也建锚点（market = 自身 region），扫描市场过滤天然拦住；
# GLOBAL 横切领域（WIPO/技术标准等）同样建 GLOBAL 市场级锚点，由扫描期
# MAX_GENERATED_GLOBAL 上限约束（最多 3 条/次，按领域优先级排序）

# 非法规正文条目：日期式期刊（Federal Register 每日刊）与数据集抓取
_FULL_DATE = re.compile(r"(?<![0-9])(19[89]\d|20\d{2})[-_]\d{2}[-_]\d{2}(?![0-9])")
_DATASET_ID = re.compile(r"FEDERAL_REGISTER_|_recalls|openfda|_recall_|RECALLS_|_latest_", re.IGNORECASE)

DOMAIN_LABELS = {
    "electronics": "电子产品", "toy": "玩具", "battery": "电池",
    "textile": "纺织", "cosmetic": "化妆品", "food_contact": "食品接触材料",
    "appliance": "家用电器", "3c": "3C 信息技术", "home": "家居",
    "other": "其他品类", "wireless": "无线功能", "mains": "市电供电", "children": "儿童适用",
}


def load_anchored_ids() -> set[str]:
    anchored: set[str] = set()
    for path in ANCHORS_DIR.glob("*.yaml"):
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and data.get("regulation_id"):
            if str(data["regulation_id"]) in anchored:
                raise SystemExit(f"锚点 regulation_id 重复: {data['regulation_id']} ({path.name})")
            anchored.add(str(data["regulation_id"]))
    return anchored


def market_level(domain: str) -> bool:
    return domain not in CATEGORY_DOMAINS and domain not in FEATURE_DOMAINS


def anchor_source(domain: str) -> str:
    if domain in CATEGORY_DOMAINS:
        return "category"
    if domain in FEATURE_DOMAINS:
        return "feature"
    return "market"


def build_anchor(reg: dict) -> dict | None:
    reg_id = str(reg.get("id") or "")
    region = str(reg.get("region") or "").strip().upper()
    domain = str(reg.get("domain") or "").strip()
    if not reg_id or not region:
        return None
    if _FULL_DATE.search(reg_id) or _DATASET_ID.search(reg_id):
        return None

    markets = REGION_MARKET_OVERRIDES.get(region, [region])
    source = anchor_source(domain)
    is_market_level = market_level(domain)
    if is_market_level:
        applies = {"category": [], "features_any": [], "markets": markets}
    elif domain in CATEGORY_DOMAINS:
        applies = {"category": [domain], "features_any": [], "markets": markets}
    else:
        applies = {"category": [], "features_any": [domain], "markets": markets}

    articles = reg.get("articles") or []
    key_articles = [a["id"] for a in articles[:2] if isinstance(a, dict) and a.get("id")]

    short_name = str(reg.get("short_name") or reg_id)
    domain_label = DOMAIN_LABELS.get(domain, domain or "通用")
    if is_market_level:
        point0 = f"{short_name}：{domain_label}领域法规，适用于 {('/'.join(markets))} 市场相关经营行为（库自动接入，按市场匹配）。"
    else:
        point0 = f"{short_name}：{domain_label}领域法规，按品类/市场匹配纳入（库自动接入）。"
    key_points = [point0, "本条目由 2026-09-19 法规库批量接入自动生成，适用性与具体义务以原文条款为准，需人工复核。"]

    license_value = str(reg.get("license") or "public")
    if license_value == "public" and not reg.get("source_url"):
        raise SystemExit(f"public 条目缺 source_url，无法生成锚点: {reg_id}")

    slug = "market" if is_market_level else (domain if domain else "general")
    return {
        "id": f"KB-{slug}-{region}-{reg_id}",
        "regulation_id": reg_id,
        "doc_name": str(reg.get("official_citation") or short_name),
        "official_citation": str(reg.get("official_citation") or short_name),
        "short_name": short_name,
        "source": source,
        "primary_source": slug,
        "domain": domain,
        "applies_if": applies,
        "key_articles": key_articles,
        "key_points": key_points,
        "curation": "auto",
        "license": license_value,
        "source_url": reg.get("source_url"),
        "purchase_url": reg.get("purchase_url"),
        "last_verified": GENERATE_DATE,
        "verified_by": "auto-generate",
        "verification_status": "needs_human_review",
        "schema_version": 1,
        "_filename": f"{reg_id}-{slug}.yaml",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="全库 KB 锚点生成")
    parser.add_argument("--apply", action="store_true", help="写入锚点文件（默认 dry-run）")
    args = parser.parse_args()

    anchored = load_anchored_ids()
    print(f"既有锚点 {len(anchored)} 个")

    plan: list[dict] = []
    skipped: dict[str, int] = {}
    for path in sorted(REGULATIONS_ROOT.glob("*/*.yaml")):
        reg = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(reg, dict) or not reg.get("id"):
            continue
        reg_id = str(reg["id"])
        if reg_id in anchored:
            skipped["already-anchored"] = skipped.get("already-anchored", 0) + 1
            continue
        anchor = build_anchor(reg)
        if anchor is None:
            skipped["dataset-or-daily"] = skipped.get("dataset-or-daily", 0) + 1
            continue
        plan.append(anchor)

    from collections import Counter
    by_kind = Counter((a["source"], a["applies_if"]["markets"][0]) for a in plan)
    print(f"计划生成 {len(plan)} 个锚点；跳过 {skipped}")
    for (source, market), n in sorted(by_kind.items()):
        print(f"  {source:9s} {market:7s} {n}")

    if not args.apply:
        print("(dry-run，加 --apply 写入)")
        return 0

    for anchor in plan:
        target = ANCHORS_DIR / anchor["_filename"]
        if target.exists():
            raise SystemExit(f"锚点文件已存在: {target}")
        payload = {k: v for k, v in anchor.items() if k != "_filename"}
        target.write_text(yaml.safe_dump(payload, allow_unicode=True, sort_keys=False, width=160), encoding="utf-8")
    print(f"已写入 {len(plan)} 个锚点到 {ANCHORS_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
