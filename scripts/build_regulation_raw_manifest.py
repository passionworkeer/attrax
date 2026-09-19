#!/usr/bin/env python3
# 把 regulation-raw 的三份 manifest（_manifest.json / _manifest_bulk.json / _manifest_discovery.json）
# 转换为 attrax 的 _imports/* 目录条目 manifest：
#   1. 只保留 status == ok 的记录（已抓到原文的）
#   2. 只保留 market ∈ _REGION_DIRS 的区域（其它区域不入库）
#   3. intl 按 name 关键词拆分为 GLOBAL（ETSI / WIPO / IEC 等技术标准）或 UN（UNECE / WTO / Codex 等）
#   4. 用文件名 + region 前缀生成唯一 id；中文文件名做归一化；重名自动加 -N
#   5. domain 用关键词分类器推断（10 品类英文 + 通用合规中文）；无关键词归 other
#   6. source_url 来自抓取 URL；docs 来自相对路径（raw_root 之下，校验越界拒绝）
#
# 用法：
#   python3 scripts/build_regulation_raw_manifest.py --raw-root /Users/wangjianjun/me/regulation-raw \
#       --out data/regulations/_imports/regulation-raw-2026-09-19.json
#
# 生成的 manifest 喂给 scripts/import_regulation_docs.py --catalog <out> --copy-docs 即可入库。

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from datetime import date, datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.watchdog.auto_ingest import _REGION_DIRS  # noqa: E402

# intl 拆分的关键词（UN 优先于 GLOBAL）
UN_KEYWORDS = (
    "un r", "unece", "un manual", "codex alimentarius",
    "wto ", "wto.", "unctad", "unido", "imo ",
    "wipo lex",
)
GLOBAL_KEYWORDS = (
    "etsi ", "iec ", "iso ", "ieee ", "itu ",
    "wipo ", "nist ",
)
# 任何含 un 的 r155/r156/regulations 名也归 UN
UN_NUMBERED = re.compile(r"\bun[\s_-]*r?\s*\d{2,3}\b", re.IGNORECASE)

# 区域到 attrax region 的直接映射（regulation-raw market 已经是 _REGION_DIRS 的 key 时直传）
# market 已被转小写后比较，所以集合存小写形式
DIRECT_MARKETS = {k.lower() for k in _REGION_DIRS.keys()}

# domain 分类器：先英文 10 品类，再通用合规中文，最后 other
CATEGORY_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("toy",          ("toy", "toys", "play", "玩具")),
    ("battery",      ("battery", "batteries", "电池")),
    ("wireless",     ("wireless", "radio equipment", "short range device",
                      "无线电", "短距离")),
    ("cosmetic",     ("cosmetic", "化妆品")),
    ("textile",      ("textile", "textile fibre", "textile fiber",
                      "纺织")),
    ("food_contact", ("food contact", "fcm", "plastic food",
                      "食品接触")),
    ("electronics",  ("emc", "electromagnetic", "lvd", "low voltage",
                      "rohs", "reach", "ecfr", "cfr",
                      "harmonised", "ce marking", "ce mark",
                      "电磁", "低电压", "有害物质")),
    ("appliance",    ("household appliance", "电器安全", "家电")),
    ("computer",     ("computer", "software update", "ota ", "3c ")),
    ("home",         ("家居", "furniture")),
]

CIVIL_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("数据保护", ("personal data", "data protection", "privacy",
               "pdpl", "pdpa", "pdp ", "数据保护", "隐私", "个人信息")),
    ("消费者保护",  ("consumer protection", "consumer rights",
                  "consumer act", "消费者")),
    ("网络安全",    ("cybersecurity", "cyber resilience", "network security",
                  "网络安全", "信息安全")),
    ("劳动法",      ("labour", "labor ", "manpower", "employment act",
                  "劳动")),
    ("投资准入",    ("foreign investment", "outbound investment",
                  "investment screening", "fdi ", "firma",
                  "境外投资", "外资")),
    ("反垄断",      ("antitrust", "antimonopoly", "competition law",
                  "反垄断", "竞争法")),
    ("出口管制",    ("export control", "dual-use", "两用", "出口管制")),
    ("海关税务",    ("customs", "tariff", "vat ", "iOSS", "OSS ",
                  "海关", "税收")),
    ("计量",        ("legal metrology", "metrology", "计量")),
    ("能源",        ("energy labelling", "ecodesign", "energy star",
                  "能源")),
    ("环境",        ("environment", "waste", "weee", "rohs",
                  "环境")),
    ("商标专利",    ("patent", "trademark", "pct ",
                  "马德里", "专利", "商标")),
    ("医疗器械",    ("medical device", "mdr ", "ivdr ",
                  "医疗器械")),
    ("支付服务",    ("payment services", "psa ", "支付服务")),
    ("产品安全",    ("product safety", "general product safety",
                  "产品安全", "gpsr")),
    ("电信",        ("telecom", "broadband", "radio spectrum",
                  "电信", "频谱")),
    ("海关商贸",    ("trade", "commerce", "商贸", "商业")),
]

ID_MAX_LEN = 60
ID_INVALID = re.compile(r"[^A-Za-z0-9_\-]")


def map_market_to_region(market: str, name: str) -> str | None:
    if market == "intl" or market == "in":
        if market == "in":
            return "IN"
        low = (name or "").lower()
        if UN_NUMBERED.search(name or "") or any(k in low for k in UN_KEYWORDS):
            return "UN"
        return "GLOBAL"
    if market in DIRECT_MARKETS:
        return market.upper()
    return None


def normalize_id_stem(text: str) -> str:
    # 文件名 stem → id suffix
    text = text.strip()
    # 替换 _ 为 - 再保留英文/数字/-/_
    out = ID_INVALID.sub("-", text.replace(" ", "-"))
    out = re.sub(r"-+", "-", out).strip("-")
    if not out:
        out = "X"
    if len(out) > ID_MAX_LEN:
        out = out[:ID_MAX_LEN].rstrip("-")
    return out.upper()


def infer_domain(name: str) -> str:
    low = (name or "").lower()
    # 先 10 品类（合规扫描引用）
    for cat, kws in CATEGORY_RULES:
        if any(k in low for k in kws):
            return cat
    # 再通用合规
    for domain, kws in CIVIL_RULES:
        if any(k in low for k in kws):
            return domain
    return "other"


def make_id(region: str, stem: str, seen: set[str]) -> str:
    norm = normalize_id_stem(stem)
    prefix = f"{region}-"
    # 原始文件名/标题已以区域前缀开头（如 "EU-765-2008_..."、"US-CFR-..."），去掉冗余
    if norm.startswith(prefix):
        norm = norm[len(prefix):]
    base = f"{region}-{norm}"
    candidate = base
    suffix = 2
    while candidate in seen:
        candidate = f"{base}-{suffix}"
        suffix += 1
    seen.add(candidate)
    return candidate


def load_records(raw_root: Path) -> list[dict]:
    recs: list[dict] = []
    for fname in ("_manifest.json", "_manifest_bulk.json", "_manifest_discovery.json"):
        path = raw_root / fname
        if not path.exists():
            print(f"[warn] 缺失 manifest: {path}", file=sys.stderr)
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, list):
            recs.extend(payload)
        else:
            recs.extend(payload.get("results", []))
    return recs


def main() -> int:
    parser = argparse.ArgumentParser(description="regulation-raw → attrax manifest")
    parser.add_argument("--raw-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    raw_root: Path = args.raw_root.resolve()
    if not raw_root.exists():
        print(f"raw_root 不存在: {raw_root}", file=sys.stderr)
        return 2

    recs = load_records(raw_root)
    print(f"载入原始记录: {len(recs)}")

    # 计算原始抓取口径统计（在 _REGION_DIRS 过滤之前）：所有抓到的市场集合大小
    # + 去重 path 数。注意用原始 market 字段（未被 map_market_to_region 过滤），
    # 这样 ar / es / ie / tw 等 _REGION_DIRS 外的市场也计入 marketsCovered。
    raw_markets: set[str] = set()
    raw_paths: set[str] = set()
    for r in recs:
        if r.get("status") != "ok":
            continue
        mkt = (r.get("market") or "").strip().lower()
        if mkt:
            raw_markets.add(mkt.upper())
        rel = (r.get("path") or "").strip()
        if rel:
            raw_paths.add(rel.replace("\\", "/"))

    seen_ids: set[str] = set()
    entries: list[dict] = []
    skipped: dict[str, int] = Counter()
    by_market: dict[str, int] = Counter()
    by_region: dict[str, int] = Counter()

    for r in recs:
        if r.get("status") != "ok":
            skipped["status!=ok"] += 1
            continue
        market = (r.get("market") or "").strip().lower()
        region = map_market_to_region(market, r.get("name", ""))
        if not region:
            skipped[f"market_not_in_dirs:{market}"] += 1
            continue

        rel_path = (r.get("path") or "").strip()
        if not rel_path:
            skipped["no_path"] += 1
            continue
        # 校验路径在 raw_root 之内（防御性，原 manifest 来自本地抓取应该满足）
        resolved = (raw_root / rel_path).resolve()
        if raw_root != resolved and raw_root not in resolved.parents:
            skipped["path_out_of_root"] += 1
            continue
        source_file = raw_root / rel_path
        if not source_file.exists():
            skipped["source_missing"] += 1
            continue

        stem = Path(rel_path).stem
        entry_id = make_id(region, stem, seen_ids)
        domain = infer_domain(r.get("name", ""))

        entries.append({
            "id": entry_id,
            "region": region,
            "domain": domain,
            "official_citation": (r.get("name") or "")[:200],
            "short_name": (r.get("name") or entry_id)[:120],
            "language": "en",
            "source_url": r.get("url") or "",
            "docs": [rel_path.replace("\\", "/")],
        })
        by_market[market] += 1
        by_region[region] += 1

    print(f"纳入: {len(entries)} 条")
    print(f"按区域分布: {dict(sorted(by_region.items()))}")
    print(f"跳过: {dict(skipped)}")

    catalog = {
        "manifest_version": 1,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "title": "regulation-raw 全量目录（2026-09-19 抓取）",
        "source_root": str(raw_root),
        "url_verified_at": date.today().isoformat(),
        "sources": [
                "regulation-raw/_manifest.json",
                "regulation-raw/_manifest_bulk.json",
                "regulation-raw/_manifest_discovery.json",
        ],
        "meta": {
            # 原始抓取口径（不过滤 _REGION_DIRS）：覆盖多少市场、抓到多少原文。
            # /regulations 页面副标题与「抓取覆盖」卡片用这两个数字，
            # 区别于 entries.length（已入库的 attrax 合规子集）。
            "marketsCovered": len(raw_markets),
            "totalRawFiles": len(raw_paths),
        },
        "entries": entries,
    }

    if args.dry_run:
        print("[dry-run] 不写入")
        return 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"已写入: {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())