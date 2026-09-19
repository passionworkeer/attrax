#!/usr/bin/env python3
"""
test_anchor_selection.py - 扫描期生成锚点上限选择（2026-09-19 全库接入）

覆盖：
- curated 锚点永远全量通过；生成锚点按池（品类/市场/GLOBAL）封顶
- 排序确定性：同一输入两次选择结果一致；标题命中产品词的优先后仍受上限约束
- bound_generated_article_texts 只裁生成锚点的条款正文，curated 原文不动；
  预算耗尽后丢弃而非截断为空
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rag_service.retrieval.anchor_selection import (
    MAX_GENERATED_CATEGORY,
    MAX_GENERATED_GLOBAL,
    MAX_GENERATED_MARKET_PER_MARKET,
    bound_anchor_set,
    bound_generated_article_texts,
)


def _curated(regulation_id: str, region: str = "US") -> dict:
    return {"doc_name": f"Curated {regulation_id}", "region": region, "source": "category",
            "regulation_id": regulation_id, "short_name": reg_id_name(regulation_id),
            "curation": ""}


def _auto(regulation_id: str, region: str = "US", source: str = "category") -> dict:
    return {"doc_name": f"Auto {regulation_id}", "region": region, "source": source,
            "regulation_id": regulation_id, "short_name": reg_id_name(regulation_id),
            "curation": "auto"}


def reg_id_name(regulation_id: str) -> str:
    return f"Regulation {regulation_id}"


class TestBoundAnchorSet:
    def test_curated_always_kept(self):
        anchors = [_curated(f"C-{i}") for i in range(30)]
        out, stats = bound_anchor_set(anchors, product="玩具")
        assert [a["regulation_id"] for a in out] == [f"C-{i}" for i in range(30)]
        assert stats == {"curated": 30, "generated_available": 0, "generated_selected": 0}

    def test_generated_category_pool_capped(self):
        anchors = [_curated("C-1")] + [_auto(f"G-{i:03d}") for i in range(50)]
        out, stats = bound_anchor_set(anchors, product="电子产品")
        generated = [a for a in out if a["curation"] == "auto"]
        assert len(generated) <= MAX_GENERATED_CATEGORY
        assert stats["generated_available"] == 50
        assert stats["generated_selected"] == len(generated)
        # 确定性：同输入同输出
        out2, _ = bound_anchor_set(anchors, product="电子产品")
        assert out == out2

    def test_market_pool_capped_per_market(self):
        anchors = ([_auto(f"EU-{i:03d}", "EU", "market") for i in range(10)]
                   + [_auto(f"US-{i:03d}", "US", "market") for i in range(10)])
        out, stats = bound_anchor_set(anchors, product="x")
        by_market: dict[str, int] = {}
        for a in out:
            by_market[a["region"]] = by_market.get(a["region"], 0) + 1
        assert by_market["EU"] <= MAX_GENERATED_MARKET_PER_MARKET
        assert by_market["US"] <= MAX_GENERATED_MARKET_PER_MARKET

    def test_global_pool_capped_and_mixed_pools_independent(self):
        anchors = ([_auto(f"GL-{i:03d}", "GLOBAL") for i in range(10)]
                   + [_auto(f"UN-{i:03d}", "UN") for i in range(4)]
                   + [_auto(f"US-{i:03d}", "US") for i in range(30)]
                   + [_auto(f"US-M{i:03d}", "US", "market") for i in range(5)])
        out, _ = bound_anchor_set(anchors, product="电源适配器")
        pools: dict[str, int] = {"global": 0, "category": 0, "market": 0}
        for a in out:
            if a["region"] in {"GLOBAL", "UN"}:
                pools["global"] += 1
            elif a["source"] == "market":
                pools["market"] += 1
            else:
                pools["category"] += 1
        assert pools["global"] <= MAX_GENERATED_GLOBAL
        assert pools["category"] <= MAX_GENERATED_CATEGORY
        assert pools["market"] <= MAX_GENERATED_MARKET_PER_MARKET

    def test_product_token_ranking_prefers_title_hits(self):
        anchors = [
            {"doc_name": "Generic rule", "region": "US", "source": "category",
             "regulation_id": "G-001", "short_name": "Generic", "curation": "auto"},
            {"doc_name": "Lithium Battery Rule", "region": "US", "source": "category",
             "regulation_id": "G-002", "short_name": "锂电池安全", "curation": "auto"},
        ]
        out, _ = bound_anchor_set(anchors, product="锂电池 充电宝")
        generated = [a for a in out if a["curation"] == "auto"]
        assert generated and generated[0]["regulation_id"] == "G-002"


class TestBoundArticleTexts:
    def test_curated_text_untouched(self):
        anchors = [_curated("C-1"), _auto("G-1")]
        texts = {"C-1#art-1": "x" * 999_999, "G-1#art-1": "y" * 100}
        out = bound_generated_article_texts(texts, anchors)
        assert out["C-1#art-1"] == "x" * 999_999
        assert out["G-1#art-1"] == "y" * 100

    def test_generated_text_clipped_and_budgeted(self):
        anchors = [_auto(f"G-{i}") for i in range(30)]
        texts = {f"G-{i}#art-1": "z" * 999_999 for i in range(30)}
        out = bound_generated_article_texts(texts, anchors)
        assert len(out) <= 30
        total = sum(len(v) for v in out.values())
        assert total <= 40_000 + 30 * 100  # 预算 + 每条截断标记的余量
        for key, value in out.items():
            assert len(value) <= 2_500 + 100
