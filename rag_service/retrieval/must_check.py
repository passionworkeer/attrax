#!/usr/bin/env python3
"""
must_check.py - Mandatory regulation injection by product category

Certain product categories require specific regulations regardless of query.
"""

# Mandatory regulations per product category
CATEGORY_REGULATIONS = {
    "electronics": [
        {"doc_name": "RoHS Directive 2011/65/EU", "region": "EU", "reason": "有害物质限制"},
        {"doc_name": "EMC Directive 2014/30/EU", "region": "EU", "reason": "电磁兼容性"},
        {"doc_name": "LVD Directive 2014/35/EU", "region": "EU", "reason": "低电压安全"},
    ],
    "battery": [
        {"doc_name": "Battery Regulation (EU) 2023/1542", "region": "EU", "reason": "电池安全"},
    ],
    "toy": [
        {"doc_name": "Toy Safety Directive 2009/48/EC", "region": "EU", "reason": "玩具安全"},
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
