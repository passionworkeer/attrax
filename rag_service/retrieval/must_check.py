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


def apply_must_check(
    results: list[dict],
    category: str,
    all_chunks: list[dict],
) -> list[dict]:
    """
    Inject must-check regulations into results if not already present.

    Args:
        results: current retrieval results
        category: product category
        all_chunks: full chunk list for lookups

    Returns:
        Modified results with must-check items injected (with score boost)
    """
    must_checks = get_must_check_regulations(category)
    if not must_checks:
        return results

    existing_doc_names = {r.get("doc_name", "") for r in results}

    injected = []
    for mc in must_checks:
        doc_name = mc["doc_name"]
        if doc_name in existing_doc_names:
            continue

        # Find matching chunks in all_chunks
        matching = [
            c for c in all_chunks
            if doc_name.lower() in c.get("doc_name", "").lower()
            or doc_name.split()[0].lower() in c.get("doc_name", "").lower()
        ]

        if matching:
            top = matching[0]
            injected.append({
                "id": f"must_check_{doc_name}",
                "score": 0.95,  # High priority score
                "content": top.get("content", ""),
                "doc_name": doc_name,
                "article_no": top.get("article_no", ""),
                "region": mc["region"],
                "is_must_check": True,
                "must_check_reason": mc["reason"],
            })

    # Merge: must-check items first, then existing results
    combined = injected + results
    return combined[:50]
