#!/usr/bin/env python3
"""
must_check.py - Mandatory regulation injection by product category

Certain product categories require specific regulations regardless of query.
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
        {"doc_name": "Battery Regulation (EU) 2023/1542", "region": "EU", "reason": "电池安全"},
        {"doc_name": "UN 38.3 Transport Testing", "region": "US", "reason": "锂电池运输测试"},
        {"doc_name": "GB 31241 便携式电子产品用锂电池", "region": "CN", "reason": "中国锂电池安全标准"},
    ],
    "cosmetic": [
        {"doc_name": "Cosmetics Regulation (EC) 1223/2009", "region": "EU", "reason": "化妆品安全"},
    ],
    "textile": [
        {"doc_name": "EU Textile Labelling Regulation", "region": "EU", "reason": "纺织品标签"},
    ],
    "food_contact": [
        {"doc_name": "FCM Regulation (EU) 10/2011", "region": "EU", "reason": "食品接触材料"},
    ],
}


def get_must_check_regulations(category: str) -> list[dict]:
    """Get mandatory regulations for a product category."""
    return CATEGORY_REGULATIONS.get(category.lower(), [])


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
