#!/usr/bin/env python3
"""2026-09-19 全库接入批处理脚本的回归测试（去重 / 条款提取 / 锚点生成）。

覆盖：
- dedup：文书号分组（含 CN GB 分部号、跨区域不并组、日期式条目不并组）、
  引用号分组（CFR 后缀家族）、canonical 选择（锚点优先）、人工合并表幂等
- extract：条款标题分段、chunk 模式门槛、单法规总量截断、格式优先级
- generate：domain→applies_if 映射、GCC→[SA,AE]、数据集排除、
  GLOBAL 市场级不生成、public 缺 source_url 直接报错
"""
import sys
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts import dedup_regulations as dd
from scripts import extract_regulation_articles as ex
from scripts import generate_kb_anchors as ga


def _reg(rid, region, citation="", articles=None, domain=None, doc_files=None):
    return {"id": rid, "region": region, "official_citation": citation,
            "short_name": citation or rid, "articles": articles or [],
            "domain": domain, "doc_files": doc_files or [],
            "license": "public", "source_url": "https://example.com/law",
            "purchase_url": None}


class TestDedupGrouping:
    def test_number_key_groups_same_instrument(self):
        regs = {
            "EU-2003-88": _reg("EU-2003-88", "EU", "Directive 2003/88/EC"),
            "EU-2003-88_WORKING_TIME": _reg("EU-2003-88_WORKING_TIME", "EU", "x"),
        }
        plans = dd.plan_groups(regs, anchored=set())
        assert len(plans) == 1
        assert plans[0]["canonical"] == "EU-2003-88"

    def test_same_subpart_different_gb_standard_not_grouped(self):
        # GB 4806.2 与 GB 15092.2 同年同部号但是不同标准
        regs = {
            "CN-GB_4806-2-1994": _reg("CN-GB_4806-2-1994", "CN", "GB 4806.2"),
            "CN-GB_15092-2-1994": _reg("CN-GB_15092-2-1994", "CN", "GB 15092.2"),
        }
        assert dd.plan_groups(regs, anchored=set()) == []

    def test_cross_region_not_grouped(self):
        regs = {
            "EU-2014-90": _reg("EU-2014-90", "EU", "x"),
            "CN-GB_4706-90-2014": _reg("CN-GB_4706-90-2014", "CN", "y"),
        }
        assert dd.plan_groups(regs, anchored=set()) == []

    def test_full_date_entries_not_grouped(self):
        # Federal Register 每日刊：日期不是文书号
        regs = {
            "US-US_FEDERAL_REGISTER_2026-09-18": _reg("US-US_FEDERAL_REGISTER_2026-09-18", "US", "FR 2026-09-18"),
            "US-US_FEDERAL_REGISTER_2026-09-17": _reg("US-US_FEDERAL_REGISTER_2026-09-17", "US", "FR 2026-09-17"),
        }
        assert dd.plan_groups(regs, anchored=set()) == []

    def test_gb_version_years_are_distinct(self):
        regs = {
            "CN-GB_2099-3-1997": _reg("CN-GB_2099-3-1997", "CN", "GB 2099.3-1997"),
            "CN-GB_2099-3-2008": _reg("CN-GB_2099-3-2008", "CN", "GB 2099.3-2008"),
        }
        assert dd.plan_groups(regs, anchored=set()) == []

    def test_citation_groups_cfr_suffix_family(self):
        regs = {
            "US-CFR-TITLE16-PART1101": _reg("US-CFR-TITLE16-PART1101", "US", "US 16 CFR Part 1101"),
            "US-CFR-TITLE16-PART1101-2": _reg("US-CFR-TITLE16-PART1101-2", "US", "US 16 CFR Part 1101"),
            "US-CFR-TITLE16-PART1101-3": _reg("US-CFR-TITLE16-PART1101-3", "US", "US 16 CFR Part 1101"),
        }
        plans = dd.plan_citation_groups(regs, anchored=set())
        assert len(plans) == 1
        assert plans[0]["canonical"] == "US-CFR-TITLE16-PART1101"
        assert set(plans[0]["variants"]) == {"US-CFR-TITLE16-PART1101-2", "US-CFR-TITLE16-PART1101-3"}

    def test_generic_citation_not_grouped(self):
        regs = {
            "AU-A": _reg("AU-A", "AU", "legislation portal"),
            "AU-B": _reg("AU-B", "AU", "legislation portal"),
        }
        assert dd.plan_citation_groups(regs, anchored=set()) == []

    def test_anchor_wins_canonical(self):
        regs = {
            "EU-2009-48": _reg("EU-2009-48", "EU", "Directive 2009/48/EC", articles=[{"id": "art-1", "title": "t", "text": "x"}]),
            "EU-2009-48_TOY_SAFETY": _reg("EU-2009-48_TOY_SAFETY", "EU", "Directive 2009/48/EC toy"),
        }
        plans = dd.plan_groups(regs, anchored={"EU-2009-48"})
        assert plans[0]["canonical"] == "EU-2009-48"

    def test_merge_into_unions_doc_files(self):
        canonical = _reg("EU-2003-88", "EU", "Directive 2003/88/EC", doc_files=None)
        canonical["doc_files"] = ["eu/raw/a.html"]
        variant = _reg("EU-2003-88_WORKING_TIME", "EU", "x")
        variant["doc_files"] = ["eu/raw/a.html", "eu/raw/b.xhtml"]
        variant["source_url"] = "https://example.com"
        dd.merge_into(canonical, variant)
        assert canonical["doc_files"] == ["eu/raw/a.html", "eu/raw/b.xhtml"]
        assert "EU-2003-88_WORKING_TIME" in canonical["notes"]


class TestExtraction:
    def test_segment_articles_on_cn_headings(self):
        text = "第一章 总则\n第一条 为了安全。\n具体内容甲。\n第二条 适用范围。\n具体内容乙。"
        arts = ex.segment_articles(text)
        assert [a["title"] for a in arts] == ["第一章 总则", "第一条 为了安全。", "第二条 适用范围。"]
        assert "具体内容甲" in arts[1]["text"]

    def test_segment_articles_on_article_headings(self):
        text = "Article 1\nSubject matter.\nArticle 2\nScope."
        arts = ex.segment_articles(text)
        assert len(arts) == 2

    def test_chunk_mode_gate_requires_headings_or_size(self, tmp_path, monkeypatch):
        # 无条款标题的短文本（门户残渣）拒绝；长文本走 chunk
        portal = tmp_path / "portal.html"
        portal.write_text(
            "<html><body>" + "<p>navigation item entry link</p>" * 40 + "</body></html>",
            encoding="utf-8",
        )
        arts, info = ex.extract_file(portal)
        assert arts == []
        assert "portal-like" in info or "thin" in info

        big = tmp_path / "big.html"
        big.write_text("<html><body>" + "<p>body paragraph with real content</p>" * 400 + "</body></html>", encoding="utf-8")
        arts, info = ex.extract_file(big)
        assert arts and info == "html"

    def test_cap_articles_total_budget(self):
        segs = [{"title": f"t{i}", "text": "x" * 10_000} for i in range(10)]
        out, truncated = ex.cap_articles(segs)
        assert sum(len(a["text"]) for a in out) <= ex.MAX_TOTAL_CHARS
        assert truncated

    def test_format_priority_prefers_xhtml_over_html(self, tmp_path, monkeypatch):
        (tmp_path / "eu" / "raw").mkdir(parents=True)
        (tmp_path / "eu/raw/a.html").write_text("x", encoding="utf-8")
        (tmp_path / "eu/raw/b.xhtml").write_text("y", encoding="utf-8")
        monkeypatch.setattr(ex, "REGULATIONS_ROOT", tmp_path)
        order = []

        def fake_extract(path):
            order.append(path.suffix)
            if path.suffix == ".xhtml":
                return [{"title": "Article 1", "text": "y" * 500}], "xhtml"
            return [], "html"

        monkeypatch.setattr(ex, "extract_file", fake_extract)
        _, info = ex.extract_regulation({"doc_files": ["eu/raw/a.html", "eu/raw/b.xhtml"]})
        assert order[0] == ".xhtml"
        assert "b.xhtml" in info


class TestAnchorGeneration:
    def test_category_domain_maps_to_category(self):
        anchor = ga.build_anchor(_reg("US-CFR-TITLE16-PART1201", "US", "16 CFR 1201", domain="electronics"))
        assert anchor["applies_if"]["category"] == ["electronics"]
        assert anchor["source"] == "category"
        assert anchor["curation"] == "auto"

    def test_cross_domain_maps_to_market_level(self):
        anchor = ga.build_anchor(_reg("EU-2016-679", "EU", "GDPR", domain="数据保护"))
        assert anchor["applies_if"]["category"] == []
        assert anchor["applies_if"]["features_any"] == []
        assert anchor["source"] == "market"
        assert anchor["applies_if"]["markets"] == ["EU"]

    def test_feature_domain_maps_to_feature(self):
        anchor = ga.build_anchor(_reg("XX-WIFI-1", "SG", "Wireless rule", domain="wireless"))
        assert anchor["applies_if"]["features_any"] == ["wireless"]

    def test_gcc_maps_to_sa_ae(self):
        anchor = ga.build_anchor(_reg("GCC-TOY-1", "GCC", "GSO toys", domain="toy"))
        assert anchor["applies_if"]["markets"] == ["SA", "AE"]

    def test_global_market_level_allowed_with_cap(self):
        # GLOBAL 横切领域（WIPO 等）也生成市场级锚点，由扫描期 MAX_GENERATED_GLOBAL 封顶
        anchor = ga.build_anchor(_reg("GLOBAL-WIPO-MADRID", "GLOBAL", "Madrid Protocol", domain="商标专利"))
        assert anchor is not None
        assert anchor["source"] == "market"
        assert anchor["applies_if"]["markets"] == ["GLOBAL"]

    def test_global_category_anchor_allowed(self):
        anchor = ga.build_anchor(_reg("GLOBAL-IEC-62368", "GLOBAL", "IEC 62368-1", domain="electronics"))
        assert anchor is not None
        assert anchor["applies_if"]["markets"] == ["GLOBAL"]

    def test_dataset_ids_excluded(self):
        assert ga.build_anchor(_reg("US-US_FEDERAL_REGISTER_2026-09-18", "US", "FR daily", domain="electronics")) is None
        assert ga.build_anchor(_reg("US-openfda_device", "US", "openfda", domain="electronics")) is None

    def test_public_without_source_url_raises(self):
        reg = _reg("EU-X-1", "EU", "no url entry", domain="electronics")
        reg["source_url"] = None
        with pytest.raises(SystemExit):
            ga.build_anchor(reg)

    def test_key_articles_take_first_two(self):
        reg = _reg("JP-LAW-1", "JP", "日本法令", domain="toy")
        reg["articles"] = [{"id": f"art-{i}", "title": f"t{i}", "text": "x"} for i in range(1, 6)]
        anchor = ga.build_anchor(reg)
        assert anchor["key_articles"] == ["art-1", "art-2"]
