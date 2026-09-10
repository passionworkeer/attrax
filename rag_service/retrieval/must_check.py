#!/usr/bin/env python3
"""
must_check.py - Mandatory regulation injection by product category / feature

Two orthogonal sources of mandatory regulations:

1. ``CATEGORY_REGULATIONS`` — keyed by product category (what the user picked).
2. ``FEATURE_REGULATIONS`` — keyed by product *features* detected by the vision
   node (battery / wireless / mains / children). Cross-cutting features apply
   regardless of category: a bluetooth speaker classified "electronics" needs
   RED; a bluetooth *toy* needs RED too. Category alone cannot express that.

2026-09-10 (A+B hybrid decision): this matrix is the PRIMARY source of truth
for report coverage. The corpus (FAISS/BM25) provides supporting citations,
not the checklist itself. ``build_anchor_list`` merges category + feature
entries, filters by target markets, and is passed to the generator as the
must-cover checklist. See docs: first-principles review 2026-09-10.

Region conventions: market codes (EU/US/UK/CN/AU/SA/AE...) mean "applies when
that market is a target". "UN" means transport/global regimes that apply to
every market (UN 38.3, IATA DGR) and are always included.
"""

# Mandatory regulations per product category
# Covers 7 markets with available corpus: EU, US, UK, CN, AU, SA, AE
CATEGORY_REGULATIONS = {
    "electronics": [
        # EU
        {"doc_name": "RoHS Directive 2011/65/EU", "region": "EU", "reason": "有害物质限制"},
        {"doc_name": "EMC Directive 2014/30/EU", "region": "EU", "reason": "电磁兼容性"},
        {"doc_name": "LVD Directive 2014/35/EU", "region": "EU", "reason": "低电压安全"},
        # US
        {"doc_name": "FCC Part 15 Radio Frequency Devices", "region": "US", "reason": "美国射频合规"},
        {"doc_name": "Prop 65 (California)", "region": "US", "reason": "加州65号提案化学品"},
        # CN
        {"doc_name": "CCC认证 中国强制性产品认证", "region": "CN", "reason": "中国强制认证"},
        {"doc_name": "GB 4943.1 电子产品安全要求", "region": "CN", "reason": "中国安规标准"},
        # UK
        {"doc_name": "UKCA Marking Requirements", "region": "UK", "reason": "英国合规标识"},
        # AU
        {"doc_name": "RCM Compliance 无线电通信标识", "region": "AU", "reason": "澳大利亚通信合规"},
    ],
    "appliance": [
        # EU
        {"doc_name": "LVD Directive 2014/35/EU", "region": "EU", "reason": "低电压安全"},
        {"doc_name": "ErP Directive 2009/125/EC", "region": "EU", "reason": "能源相关产品生态设计"},
        {"doc_name": "EMC Directive 2014/30/EU", "region": "EU", "reason": "电磁兼容性"},
        # US
        {"doc_name": "UL 60335 Household Appliance Safety", "region": "US", "reason": "美国家电安全标准"},
        # CN
        {"doc_name": "GB 4706 家用电器安全通用要求", "region": "CN", "reason": "中国家电安全标准"},
        # UK
        {"doc_name": "UKCA Marking for Appliances", "region": "UK", "reason": "英国家电合规"},
    ],
    "3c": [
        # EU
        {"doc_name": "RoHS Directive 2011/65/EU", "region": "EU", "reason": "有害物质限制"},
        {"doc_name": "EMC Directive 2014/30/EU", "region": "EU", "reason": "电磁兼容性"},
        {"doc_name": "RED Directive 2014/53/EU", "region": "EU", "reason": "无线电设备指令"},
        # US
        {"doc_name": "FCC Part 15/18 Communications Equipment", "region": "US", "reason": "美国通信设备合规"},
        # CN
        {"doc_name": "CCC认证 信息技术设备", "region": "CN", "reason": "中国3C认证"},
    ],
    "toy": [
        # EU
        {"doc_name": "Toy Safety Directive 2009/48/EC", "region": "EU", "reason": "玩具安全"},
        {"doc_name": "REACH (EC) 1907/2006", "region": "EU", "reason": "化学品注册评估授权限制"},
        # US
        {"doc_name": "ASTM F963 Toy Safety Standard", "region": "US", "reason": "美国玩具安全标准"},
        {"doc_name": "CPSIA Children Product Safety", "region": "US", "reason": "儿童产品安全改善法"},
        # CN
        {"doc_name": "GB 6675 玩具安全国家标准", "region": "CN", "reason": "中国玩具安全标准"},
    ],
    "home": [
        # EU
        {"doc_name": "GPSR (EU) 2023/988 通用产品安全法规", "region": "EU", "reason": "通用产品安全"},
        {"doc_name": "REACH (EC) 1907/2006", "region": "EU", "reason": "化学品限制"},
        # US
        {"doc_name": "CPSC General Product Safety", "region": "US", "reason": "美国消费品安全"},
        # CN
        {"doc_name": "GB 5296 消费品使用说明", "region": "CN", "reason": "消费品标识标准"},
    ],
    "battery": [
        {"doc_name": "Battery Regulation (EU) 2023/1542", "region": "EU", "reason": "电池投放市场/CE/护照（替代 2006/66/EC）"},
        {"doc_name": "UN 38.3 Transport Testing", "region": "UN", "reason": "锂电池运输强制测试（全球）"},
        {"doc_name": "49 CFR 173.185 Lithium Battery Transport", "region": "US", "reason": "美国锂电池运输规则"},
        {"doc_name": "GB 31241 便携式电子产品用锂电池", "region": "CN", "reason": "中国锂电池安全标准"},
        {"doc_name": "Batteries and Accumulators (UK Retained)", "region": "UK", "reason": "英国电池法规"},
    ],
    "cosmetic": [
        {"doc_name": "Cosmetics Regulation (EC) 1223/2009", "region": "EU", "reason": "化妆品安全 + CPNP 通报 + PIF"},
        {"doc_name": "MoCRA Modernization of Cosmetics Act", "region": "US", "reason": "美国化妆品现代化法案（设施注册+产品列名）"},
        {"doc_name": "化妆品监督管理条例 CSAR", "region": "CN", "reason": "中国化妆品注册备案"},
        {"doc_name": "UK Cosmetics Regulation (Retained 1223/2009)", "region": "UK", "reason": "英国化妆品法规 + SCPN 通报"},
    ],
    "textile": [
        {"doc_name": "EU Textile Labelling Regulation 1007/2011", "region": "EU", "reason": "纺织品纤维标签"},
        {"doc_name": "TFPIA Textile Fiber Products Identification Act", "region": "US", "reason": "美国纤维成分标识 + FTC 护理标签"},
        {"doc_name": "GB 18401 国家纺织产品基本安全技术规范", "region": "CN", "reason": "中国纺织品安全类别（A/B/C 类）"},
        {"doc_name": "GB 5296.4 纺织品和服装使用说明", "region": "CN", "reason": "中国纺织品标识标准"},
    ],
    "food_contact": [
        {"doc_name": "FCM Framework Regulation (EC) 1935/2004", "region": "EU", "reason": "食品接触材料框架法规"},
        {"doc_name": "FCM Regulation (EU) 10/2011", "region": "EU", "reason": "塑料食品接触材料迁移限值"},
        {"doc_name": "FDA 21 CFR 174-190 Food Contact Substances", "region": "US", "reason": "美国食品接触物质"},
        {"doc_name": "GB 4806 食品接触材料系列标准", "region": "CN", "reason": "中国食品接触材料安全标准"},
    ],
}

# Feature-keyed regulations. Keys are matched against vision core_features
# text (and product/query as fallback) using FEATURE_KEYWORDS below. Order of
# the dict defines report ordering for a matched feature.
FEATURE_REGULATIONS: dict[str, list[dict]] = {
    "battery": [
        {"doc_name": "UN 38.3 Transport Testing", "region": "UN", "reason": "含锂电池：运输测试（全球强制）"},
        {"doc_name": "Battery Regulation (EU) 2023/1542", "region": "EU", "reason": "含电池：欧盟电池法规 + CE + 电池护照"},
        {"doc_name": "49 CFR 173.185 Lithium Battery Transport", "region": "US", "reason": "含锂电池：美国运输规则"},
        {"doc_name": "GB 31241 便携式电子产品用锂电池", "region": "CN", "reason": "含锂电池：中国安全标准"},
    ],
    "wireless": [
        {"doc_name": "RED Directive 2014/53/EU", "region": "EU", "reason": "含无线功能：欧盟无线电设备指令（CE-RED）"},
        {"doc_name": "FCC Part 15 Radio Frequency Devices", "region": "US", "reason": "含无线功能：美国 FCC ID 认证"},
        {"doc_name": "SRRC 无线电型号核准", "region": "CN", "reason": "含无线功能：中国型号核准"},
        {"doc_name": "UKCA Radio Equipment Regulations 2017", "region": "UK", "reason": "含无线功能：英国无线电设备法规"},
        {"doc_name": "RCM Compliance 无线电通信标识", "region": "AU", "reason": "含无线功能：澳大利亚 ACMA/RCM"},
    ],
    "mains": [
        {"doc_name": "LVD Directive 2014/35/EU", "region": "EU", "reason": "市电供电：低电压安全（CE-LVD）"},
        {"doc_name": "UL/ETL Listing (Marketplace-required)", "region": "US", "reason": "市电供电：美国电商平台普遍要求 UL/ETL"},
        {"doc_name": "CCC认证 中国强制性产品认证", "region": "CN", "reason": "市电供电：中国强制认证"},
        {"doc_name": "UKCA Marking Requirements", "region": "UK", "reason": "市电供电：英国合规标识"},
    ],
    "children": [
        {"doc_name": "Toy Safety Directive 2009/48/EC", "region": "EU", "reason": "儿童产品：按玩具指令评估边界"},
        {"doc_name": "CPSIA Children Product Safety", "region": "US", "reason": "儿童产品：CPC 证书 + 铅/邻苯测试"},
        {"doc_name": "GB 6675 玩具安全国家标准", "region": "CN", "reason": "儿童产品：中国安全标准"},
    ],
}

# Keyword → feature. Matching is substring on lowercase text. Keep keywords
# conservative (precision over recall): "充电宝" does NOT imply battery in a
# power-bank sense for an earphone charging case — but the case itself houses
# a lithium cell, so UN 38.3 still applies; "充电"/"charging" is included for
# exactly that reason (vision describes cases as 有线充电盒/锂电池供电).
FEATURE_KEYWORDS: dict[str, list[str]] = {
    "battery": [
        "锂电池", "锂离子", "电池供电", "电池仓", "电池盒", "充电宝", "移动电源",
        "battery", "lithium", "li-ion", "rechargeable", "充电",
    ],
    "wireless": [
        "蓝牙", "无线", "wifi", "wi-fi", "2.4g", "5g频段", "射频", "nfc",
        "bluetooth", "wireless", "radio", "rf module",
    ],
    "mains": [
        "插电", "市电", "电源适配器", "适配器供电", "ac供电", "交流供电", "220v", "110v",
        "mains", "ac powered", "power adapter", "plug-in",
    ],
    "children": [
        "儿童", "孩子", "婴幼儿", "小孩", "早教",
        "kids", "children", "child", "toddler", "infant",
    ],
}

# Markets where "UN" transport regimes apply: everywhere. Kept as a constant
# so market filtering has one explicit exception rule.
ALWAYS_INCLUDE_REGIONS = {"UN"}


def get_must_check_regulations(category: str) -> list[dict]:
    """Get mandatory regulations for a product category."""
    return CATEGORY_REGULATIONS.get(category.lower(), [])


def detect_features(*text_sources: str) -> list[str]:
    """Detect product features from free text (vision core_features etc.).

    Args:
        *text_sources: any number of strings scanned jointly (e.g. joined
            core_features, product name). Order-independent.

    Returns:
        Sorted list of matched feature keys ("battery", "wireless", ...).
        Empty list when nothing matches — the caller then falls back to
        category-only anchors.
    """
    haystack = " ".join(t for t in text_sources if t).lower()
    if not haystack.strip():
        return []
    matched = [
        feature
        for feature, keywords in FEATURE_KEYWORDS.items()
        if any(kw in haystack for kw in keywords)
    ]
    return sorted(matched)


def get_feature_regulations(features: list[str]) -> list[dict]:
    """Regulations triggered by detected product features (no market filter)."""
    out: list[dict] = []
    for feature in features:
        out.extend(FEATURE_REGULATIONS.get(feature, []))
    return out


def build_anchor_list(
    category: str,
    markets: list[str],
    features: list[str] | None = None,
) -> list[dict]:
    """Build the must-cover checklist passed to the generator.

    Merges category regulations + feature-triggered regulations, de-dupes by
    (doc_name, region), and filters to the target markets. Entries whose
    region is ``UN`` (global transport regimes) are always kept.

    Returns a NEW list; never mutates the module-level matrices.
    """
    target = {str(m).strip().upper() for m in markets if m}
    entries = [
        (entry, "category") for entry in get_must_check_regulations(category)
    ]
    if features:
        entries.extend((entry, "feature") for entry in get_feature_regulations(features))

    seen: set[tuple[str, str]] = set()
    anchors: list[dict] = []
    for entry, source in entries:
        region = str(entry.get("region", "")).strip().upper()
        doc_name = str(entry.get("doc_name", "")).strip()
        key = (doc_name.lower(), region)
        if key in seen:
            continue
        if region not in ALWAYS_INCLUDE_REGIONS and target and region not in target:
            continue
        seen.add(key)
        anchors.append({
            "doc_name": doc_name,
            "region": region,
            "reason": entry.get("reason", ""),
            "source": source,
        })
    return anchors


def _find_matching_chunk(mc: dict, all_chunks: list[dict]) -> dict | None:
    """Find the best chunk for a must-check entry using precise fields.

    Previous logic did substring matching on ``doc_name`` (and even matched
    ``doc_name.split()[0]``), which caused false positives — e.g. ``RoHS``
    matching any document whose name started with ``RoHS`` regardless of
    market. This prefers, in order:

      1. Exact ``source_id`` match (most reliable when chunks carry it).
      2. Exact ``doc_name`` match (case-insensitive, equality not substring).
      3. ``source_file`` basename match.
      4. Containment fallback: chunk doc_name contains the target doc_name
         AND region matches. Only triggered when the target carries a
         region, so cross-market false positives are prevented.

    Returns the first matching chunk, or ``None``.
    """
    target_doc = mc.get("doc_name", "").strip().lower()
    target_sid = str(mc.get("source_id", "")).strip()
    target_file = str(mc.get("source_file", "")).strip().lower()
    target_region = str(mc.get("region", "")).strip().lower()

    if target_sid:
        for c in all_chunks:
            if str(c.get("source_id", "")).strip() == target_sid:
                return c
    if target_doc:
        for c in all_chunks:
            if str(c.get("doc_name", "")).strip().lower() == target_doc:
                return c
    if target_file:
        for c in all_chunks:
            cfile = str(c.get("source_file", "")).strip().lower()
            if cfile and (
                cfile == target_file
                or cfile.endswith("/" + target_file)
                or cfile.endswith("\\" + target_file)
            ):
                return c
    # Containment fallback (region-scoped to prevent cross-market false hits).
    if target_doc and target_region:
        for c in all_chunks:
            c_doc = str(c.get("doc_name", "")).strip().lower()
            c_region = str(c.get("region", "")).strip().lower()
            if c_doc and c_region == target_region and target_doc in c_doc:
                return c
    return None


def apply_must_check(
    results: list[dict],
    category: str,
    all_chunks: list[dict],
) -> list[dict]:
    """
    Inject must-check regulations into results if not already present.

    Matching is precise (source_id / exact doc_name / source_file, with a
    region-scoped containment fallback). Injected items are tagged
    ``is_must_check=True`` and interleaved into the existing RRF ranking
    instead of being force-prepended, so a high-scoring retrieval result
    is not demoted below a must-check item that is merely "also relevant".
    The injection still guarantees coverage: any must-check doc missing
    from the result set is added, preserving the must-check semantics.

    Immutability: inputs are not mutated; a new list is returned.

    Args:
        results: current retrieval results (sorted by rrf_score desc)
        category: product category
        all_chunks: full chunk list for lookups

    Returns:
        New list with must-check items merged in. Capped at 50 entries.
    """
    must_checks = get_must_check_regulations(category)
    if not must_checks:
        return list(results)

    existing_doc_names = {
        str(r.get("doc_name", "")).strip().lower()
        for r in results
        if r.get("doc_name")
    }

    injected: list[dict] = []
    for mc in must_checks:
        doc_name = mc["doc_name"]
        if doc_name.strip().lower() in existing_doc_names:
            continue

        top = _find_matching_chunk(mc, all_chunks)
        if top is None:
            continue

        injected.append({
            "id": f"must_check_{doc_name}",
            # Injection score sits above typical RRF scores (max ~0.08) so
            # the item is guaranteed to surface, but interleaving means a
            # strongly-retrieved chunk with rrf_score>0.5 still ranks above
            # a borderline must-check item.
            "rrf_score": 0.5,
            "score": 0.5,
            "content": top.get("content", ""),
            "doc_name": doc_name,
            "article_no": top.get("article_no", ""),
            "region": mc["region"],
            "source_id": top.get("source_id", ""),
            "is_must_check": True,
            "must_check_reason": mc["reason"],
        })

    if not injected:
        # Preserve the historical 50-cap even when nothing was injected.
        return list(results)[:50]

    # Interleave by score (stable sort preserves existing ordering among
    # ties, so the original retrieval ranking is not reshuffled beyond
    # the insertion points).
    combined = sorted(
        list(results) + injected,
        key=lambda r: r.get("rrf_score", r.get("score", 0.0)),
        reverse=True,
    )
    return combined[:50]
