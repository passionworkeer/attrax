#!/usr/bin/env python3
"""
migrate_must_check_to_kb.py — Migrate must_check.py dict → data/kb/anchors/*.yaml

Spec: docs/plans/2026-09-11-de-rag-evidence-spec.md §7.1

Generates one YAML per unique (regulation, region) anchor — 44 files derived from
must_check.py's CATEGORY_REGULATIONS + FEATURE_REGULATIONS.

Initial content (key_articles, key_points, license, source_url) is curated in this
script as a one-time seed. After the first run, edits happen to YAMLs directly.

Usage:
    rag_service/.venv/bin/python3 scripts/migrate_must_check_to_kb.py
        # Generate missing YAMLs (skip if file exists)

    rag_service/.venv/bin/python3 scripts/migrate_must_check_to_kb.py --force
        # Regenerate all YAMLs (overwrite)

    rag_service/.venv/bin/python3 scripts/migrate_must_check_to_kb.py --verify
        # Verify: count files, schema integrity, must_check.py coverage

Exit codes:
    0 — success (default or --verify all checks pass)
    1 — failure (--verify detected drift, or write error)
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

import yaml  # noqa: E402

from rag_service.retrieval.must_check import (  # noqa: E402
    CATEGORY_REGULATIONS,
    FEATURE_REGULATIONS,
)


# ────────────────────────────────────────────────────────────────────────────
# Enrichment data per regulation (44 entries from §5.3 of the spec)
#
# Each entry maps a (region, doc_name) pair to:
#   - regulation_id: stable system ID (used for cross-references)
#   - official_citation: display string (matches user's legal citation)
#   - license: public | private_with_summary (see spec §6)
#   - source_url: official URL (public) or purchase_url (private)
#   - key_articles: list of article IDs (empty for private)
#   - key_points: 3-8 factual bullets (LLM-assisted; needs human review)
#   - risk_hint, est_cost: optional, populated when stable
#
# verified_by = "llm-assisted" + verification_status = "needs_human_review"
# is the honest default — these are populated from general knowledge and must
# be confirmed against official texts before being relied on for compliance
# advice. See spec §14.
# ────────────────────────────────────────────────────────────────────────────

TODAY = date(2026, 9, 11).isoformat()

ENRICHMENT: dict[str, dict] = {
    # ── EU (13, all public) ────────────────────────────────────────────────
    "EU::RoHS Directive 2011/65/EU": {
        "regulation_id": "EU-2011-65",
        "official_citation": "Directive 2011/65/EU",
        "short_name": "RoHS (有害物质限制)",
        "license": "public",
        "source_url": "https://eur-lex.europa.eu/eli/dir/2011/65/oj",
        "key_articles": ["art-4", "art-6", "art-7", "annex-2"],
        "key_points": [
            "限制电子电气设备中铅、汞、镉、六价铬、PBB、PBDE 等 10 类有害物质",
            "投放欧盟市场需附 CE 标志 + DoC (符合性声明)",
            "Annex II 列具体限值与豁免清单 (e.g. 焊料铅豁免至 2026 阶段收尾)",
            "由各成员国市场监管机构执行,违规处罚因国而异"
        ],
        "risk_hint": "CE/DoC 不全或 Annex III 申报缺失 → 海关扣留 + 市场禁售",
        "est_cost": "测试 ¥3K-10K + 文件准备 ¥2K-5K",
    },
    "EU::EMC Directive 2014/30/EU": {
        "regulation_id": "EU-2014-30",
        "official_citation": "Directive 2014/30/EU",
        "short_name": "EMC (电磁兼容)",
        "license": "public",
        "source_url": "https://eur-lex.europa.eu/eli/dir/2014/30/oj",
        "key_articles": ["art-6", "art-7", "art-8", "annex-1"],
        "key_points": [
            "确保电子设备在正常使用环境中不产生不可接受的电磁干扰,且能承受外部干扰",
            "CE 标志 + DoC + 技术文档 (含 EMC 测试报告) 是投放前提",
            "EN 55032 / EN 55035 / EN 61000 系列协调标准是常用合规依据",
            "本指令不适用于 2014/53/EU (RED) 覆盖的无线电设备"
        ],
        "risk_hint": "无 EMC 测试报告 → CE 标志无效,海关/平台可下架",
        "est_cost": "测试 ¥5K-15K / 4-6 周",
    },
    "EU::LVD Directive 2014/35/EU": {
        "regulation_id": "EU-2014-35",
        "official_citation": "Directive 2014/35/EU",
        "short_name": "LVD (低电压安全)",
        "license": "public",
        "source_url": "https://eur-lex.europa.eu/eli/dir/2014/35/oj",
        "key_articles": ["art-3", "art-6", "art-7", "annex-1", "annex-2"],
        "key_points": [
            "适用于额定电压 50-1000V AC 或 75-1500V DC 的电气设备",
            "Annex I 列主要安全目标 (电气/热/机械/辐射等危险防护)",
            "Annex II 列出不适用设备 (如医疗、电梯、汽车电气等专项指令覆盖)",
            "投放市场需 CE 标志 + DoC + 技术文档"
        ],
        "risk_hint": "电气安全测试缺失 → 产品撤市 + 制造商法律责任",
        "est_cost": "测试 ¥8K-25K / 4-8 周",
    },
    "EU::ErP Directive 2009/125/EC": {
        "regulation_id": "EU-2009-125",
        "official_citation": "Directive 2009/125/EC",
        "short_name": "ErP (生态设计)",
        "license": "public",
        "source_url": "https://eur-lex.europa.eu/eli/dir/2009/125/oj",
        "key_articles": ["art-4", "art-5", "art-6", "art-15"],
        "key_points": [
            "框架指令,按产品类别的具体实施条例 (e.g. 1275/2008 待机功耗、2019/1782 外置电源等)",
            "要求能源相关产品符合生态设计要求 (能效、材料、可修复性等)",
            "需提供符合性技术文档并加贴 CE 标志",
            "数据库 EPREL (European Product Registry for Energy Labelling) 需注册"
        ],
        "risk_hint": "未满足具体实施条例 → 整批产品禁入欧盟",
        "est_cost": "检测 ¥5K-20K + 注册 ¥2K-5K",
    },
    "EU::RED Directive 2014/53/EU": {
        "regulation_id": "EU-2014-53",
        "official_citation": "Directive 2014/53/EU",
        "short_name": "RED (无线电设备指令)",
        "license": "public",
        "source_url": "https://eur-lex.europa.eu/eli/dir/2014/53/oj",
        "key_articles": ["art-3", "art-6", "art-7", "art-8", "art-10", "art-11", "annex-i", "annex-ii"],
        "key_points": [
            "覆盖 9 kHz - 3000 GHz 无线电设备 (蓝牙/Wi-Fi/NFC/4G/5G 等)",
            "Art. 3.2 (频谱使用) + Art. 3.3 系列 (EMC/LVD/健康安全) 必须满足",
            "CE 标志 + DoC + Notified Body 评估 (部分类别需第三方)",
            "需指定 EU 授权代表 (欧盟外制造商强制)",
            "2024 年起部分条款已被 (EU) 2022/2380 (通用充电器指令) 修订"
        ],
        "risk_hint": "无 RED 测试报告或未指定欧盟代表 → 整批设备下架",
        "est_cost": "测试 ¥15K-50K + 欧盟代表 ¥3K-8K/年",
    },
    "EU::Toy Safety Directive 2009/48/EC": {
        "regulation_id": "EU-2009-48",
        "official_citation": "Directive 2009/48/EC",
        "short_name": "EU Toy Safety Directive",
        "license": "public",
        "source_url": "https://eur-lex.europa.eu/eli/dir/2009/48/oj",
        "key_articles": ["art-4", "art-5", "art-6", "art-10", "art-11", "annex-ii"],
        "key_points": [
            "14 岁以下玩具安全 (机械物理/易燃/化学迁移/电气/卫生)",
            "EN 71 系列协调标准是合规证据 (EN 71-1/-2/-3 等)",
            "需 CE 标志 + DoC + 技术文档",
            "化学要求严格 (CMR/致敏香料 55 项禁用清单),与 REACH 联动"
        ],
        "risk_hint": "无 EN 71 报告 → 产品被海关/平台下架,极端情况触发 RAPEX",
        "est_cost": "测试 ¥10K-30K / 4-8 周",
    },
    "EU::REACH (EC) 1907/2006": {
        "regulation_id": "EU-1907-2006",
        "official_citation": "Regulation (EC) No 1907/2006",
        "short_name": "REACH (化学品注册)",
        "license": "public",
        "source_url": "https://eur-lex.europa.eu/eli/reg/2006/1907/oj",
        "key_articles": ["art-7", "art-8", "art-9", "art-33", "annex-xvii"],
        "key_points": [
            "化学品/混合物/物品中 SVHC (高关注物质) 含量 > 0.1% w/w 需向 ECHA 通报并告知下游",
            "Annex XVII 列出限用物质 (e.g. 邻苯二甲酸盐、重金属、偶氮染料)",
            "需做 SVHC 筛查 (ICP-MS/XRF 等) 并保留测试证书 10 年",
            "Candidate List (候选清单) 通常每年 1-2 次更新"
        ],
        "risk_hint": "SVHC 超标未通报 → 产品召回 + 处罚 + 平台下架",
        "est_cost": "筛查 ¥5K-15K + 持续合规维护",
    },
    "EU::GPSR (EU) 2023/988 通用产品安全法规": {
        "regulation_id": "EU-2023-988",
        "official_citation": "Regulation (EU) 2023/988",
        "short_name": "GPSR (通用产品安全)",
        "license": "public",
        "source_url": "https://eur-lex.europa.eu/eli/reg/2023/988/oj",
        "key_articles": ["art-7", "art-9", "art-15", "art-17", "art-22"],
        "key_points": [
            "替代 2001/95/EC 通用产品安全指令,2024-12-13 生效",
            "所有消费品均适用 (专项指令未覆盖的),线上线下销售均需合规",
            "要求制造商/进口商/分销商履行尽职调查 + 产品追溯 + 事故报告",
            "欧盟外制造商必须指定单一授权代表 (Single Point of Contact)",
            "产品需附完整制造商联系信息 + 安全使用说明 (本地语言)"
        ],
        "risk_hint": "未指定授权代表 → 欧盟市场禁售 + 罚款最高 €400K 或 4% 营业额",
        "est_cost": "合规体系搭建 ¥10K-30K + 授权代表 ¥5K-15K/年",
    },
    "EU::Battery Regulation (EU) 2023/1542": {
        "regulation_id": "EU-2023-1542",
        "official_citation": "Regulation (EU) 2023/1542",
        "short_name": "EU Battery Regulation 2023/1542",
        "license": "public",
        "source_url": "https://eur-lex.europa.eu/eli/reg/2023/1542/oj",
        "key_articles": ["art-7", "art-38", "art-39", "art-77", "art-85"],
        "key_points": [
            "替代 2006/66/EC,涵盖所有类型电池 (便携/工业/汽车/LMT/SLMT)",
            "投放市场需 CE 标志 + DoC + 经济运营者 (REMS) 注册",
            "电池护照 (digital product passport) 强制实施:"
            "  - 工业电池 >2 kWh 自 2027-02-18 起"
            "  - LMT (轻型运输工具) 自 2028-08-18 起",
            "回收效率 + 再生材料含量配额逐年提高 (Co/Ni/Li/Pb)",
            "碳足迹声明分阶段强制 (Art. 7)"
        ],
        "risk_hint": "无 CE/护照/REMS 注册 → 整批电池禁入欧盟",
        "est_cost": "认证 ¥15K-40K + 护照系统集成 ¥20K-100K",
    },
    "EU::Cosmetics Regulation (EC) 1223/2009": {
        "regulation_id": "EU-1223-2009",
        "official_citation": "Regulation (EC) No 1223/2009",
        "short_name": "EU Cosmetics Regulation",
        "license": "public",
        "source_url": "https://eur-lex.europa.eu/eli/reg/2009/1223/oj",
        "key_articles": ["art-10", "art-11", "art-13", "art-16", "art-18", "art-19", "annex-i", "annex-ii", "annex-iii"],
        "key_points": [
            "上市前需完成 CPNP (Cosmetic Products Notification Portal) 通报",
            "需准备 PIF (Product Information File) 含安全评估 + 配方 + 微生物/稳定性测试",
            "Annex II (禁用清单) / Annex III (限用清单) 必须逐项核查",
            "需指定欧盟境内的 responsible person (责任人)",
            "产品标签需含 INCI 全成分 + 批号 + 保质期/PAO + 责任人地址 (本地语言)"
        ],
        "risk_hint": "无 CPNP 通报/PIF 不全 → 产品禁售 + 处罚 + RAPEX 召回",
        "est_cost": "通报 + PIF 准备 ¥10K-30K + 安全评估 ¥8K-25K",
    },
    "EU::EU Textile Labelling Regulation 1007/2011": {
        "regulation_id": "EU-1007-2011",
        "official_citation": "Regulation (EU) No 1007/2011",
        "short_name": "EU Textile Labelling",
        "license": "public",
        "source_url": "https://eur-lex.europa.eu/eli/reg/2011/1007/oj",
        "key_articles": ["art-5", "art-7", "art-9", "annex-i", "annex-v"],
        "key_points": [
            "纤维名称必须按 Annex I 用官方语言标注 (e.g. cotton/cotton)",
            "多纤维产品按重量降序 + 非纺织部件需单独标注",
            "标签须持久 (缝合/烫印/挂签),购买前可见",
            "皮革/毛皮动物来源需明示 (Annex V)"
        ],
        "risk_hint": "纤维名称错误或缺失 → 海关扣留 + 处罚",
        "est_cost": "标签设计 ¥2K-5K + 纤维检测 ¥1K-3K",
    },
    "EU::FCM Framework Regulation (EC) 1935/2004": {
        "regulation_id": "EU-1935-2004",
        "official_citation": "Regulation (EC) No 1935/2004",
        "short_name": "FCM Framework (食品接触材料)",
        "license": "public",
        "source_url": "https://eur-lex.europa.eu/eli/reg/2004/1935/oj",
        "key_articles": ["art-3", "art-5", "art-15", "art-16"],
        "key_points": [
            "框架法规,适用于所有与食品接触的材料/制品 (塑料/金属/玻璃/陶瓷/纸等)",
            "材料不能向食品迁移危害人体健康的物质,不能改变食品成分/感官",
            "需附 DoC + 标签标识 (e.g. 'for food contact' 或刀叉符号)",
            "塑料类需额外符合 (EU) 10/2011; 陶瓷符合 84/500/EEC"
        ],
        "risk_hint": "无 DoC 或迁移超标 → 产品召回 + 处罚",
        "est_cost": "迁移测试 ¥5K-15K + DoC ¥2K-5K",
    },
    "EU::FCM Regulation (EU) 10/2011": {
        "regulation_id": "EU-10-2011",
        "official_citation": "Regulation (EU) No 10/2011",
        "short_name": "FCM Plastics (塑料食品接触)",
        "license": "public",
        "source_url": "https://eur-lex.europa.eu/eli/reg/2011/10/oj",
        "key_articles": ["art-5", "art-8", "art-13", "art-14", "art-15", "art-17", "annex-i", "annex-ii", "annex-iii", "annex-v"],
        "key_points": [
            "塑料食品接触材料的专门规则 (总体迁移 ≤ 10 mg/dm²,特定迁移按 Annex I)",
            "需做 Overall Migration (OM) + Specific Migration (SM) 测试",
            "Annex I 列授权物质 (单体/添加剂),需在 Union List 内",
            "Functional Barrier 概念 (Art. 13) 允许多层塑料未授权物质在 Barrier 后",
            "需附书面 DoC 声明符合性"
        ],
        "risk_hint": "OM/SM 超标 → 召回 + 处罚 + 平台下架",
        "est_cost": "全套迁移测试 ¥15K-40K / 6-10 周",
    },
    # ── US (12) ─────────────────────────────────────────────────────────────
    "US::FCC Part 15 Radio Frequency Devices": {
        "regulation_id": "US-FCC-15",
        "official_citation": "47 CFR Part 15",
        "short_name": "FCC Part 15 (RF devices)",
        "license": "public",
        "source_url": "https://www.ecfr.gov/current/title-47/chapter-I/subchapter-A/part-15",
        "key_articles": ["section-15-101", "section-15-201", "section-15-247", "section-15-249"],
        "key_points": [
            "覆盖无意辐射体 (15B) 和有意辐射体 (15C, 如蓝牙/Wi-Fi/ZigBee)",
            "需 FCC 认可的实验室出具测试报告",
            "大多数无意/低功率有意辐射体走 SDoC (Supplier's Declaration of Conformity) 程序",
            "FCC ID 仅适用高功率/特定设备 (15C 需认证)",
            "标记要求: 含 FCC ID 或 SDoC 声明 + 责任方联系信息"
        ],
        "risk_hint": "无 FCC 测试 → 海关扣留 + 处罚最高 $10 万/违规产品",
        "est_cost": "SDoC 测试 ¥5K-15K + FCC ID 认证 ¥10K-30K",
    },
    "US::Prop 65 (California)": {
        "regulation_id": "US-CA-Prop-65",
        "official_citation": "California Health and Safety Code §25249.5 et seq.",
        "short_name": "California Prop 65",
        "license": "public",
        "source_url": "https://oehha.ca.gov/proposition-65",
        "key_articles": ["section-25249-5", "section-25249-6"],
        "key_points": [
            "适用于加州销售的所有产品,清单含 900+ 化学品 (铅/镉/邻苯等)",
            "需对暴露途径 (摄入/接触/吸入) 提供清晰合理的警示标签 ('WARNING' 或 'CAUTION')",
            "清单每年至少更新 1 次 (OEHHA 维护)",
            "化学检测需确认含量低于 NSRL/MADL 或标注警示",
            "律师提交通知 (60-day notice) 是常见起诉前置程序"
        ],
        "risk_hint": "未警告或超标 → 民事和解单次 $10K-$100K+,集体诉讼风险",
        "est_cost": "筛查 + 检测 ¥5K-20K",
    },
    "US::UL 60335 Household Appliance Safety": {
        "regulation_id": "US-UL-60335",
        "official_citation": "UL 60335-1 / UL 60335-2 series",
        "short_name": "UL 60335 (家电安全, 私有标准)",
        "license": "private_with_summary",
        "purchase_url": "https://www.shopulstandards.com/ProductDetail.aspx?UniqueKey=36741",
        "key_articles": [],
        "key_points": [
            "美国家用电器事实标准 (UL 60335-1 通用要求 + UL 60335-2-XX 系列专项)",
            "FCC 法律并不强制 UL,但 Amazon/Home Depot 等平台普遍要求 UL/ETL 列名",
            "UL 列名流程: 送样 → UL 测试 → 工厂检查 (4 次/年) → 颁证",
            "对应 IEC 60335 国际版,差异主要在北美电气 (120V/60Hz) 与接地要求",
            "对应协调标准为 UL 60335-1 (北美) + IEC 60335-1 (国际)"
        ],
        "risk_hint": "无 UL/ETL 列名 → Amazon 等北美主流电商平台强制下架",
        "est_cost": "UL 列名 $20K-$60K + 年审 $5K-$15K",
    },
    "US::FCC Part 15/18 Communications Equipment": {
        "regulation_id": "US-FCC-15-18",
        "official_citation": "47 CFR Part 15 & Part 18",
        "short_name": "FCC Part 15/18 (通信 + ISM 设备)",
        "license": "public",
        "source_url": "https://www.ecfr.gov/current/title-47/chapter-I/subchapter-A",
        "key_articles": ["section-15-101", "section-18-101", "section-18-301"],
        "key_points": [
            "Part 15 覆盖数字/无线设备;Part 18 覆盖 ISM 频段设备 (微波炉/工业加热等)",
            "需在 FCC 认可实验室测试 EMC/RF",
            "大多数 Part 15/18 设备可走 SDoC;Part 18 ISM 通常 SDoC",
            "标记需含 FCC ID 或 SDoC 声明"
        ],
        "risk_hint": "无 FCC 测试 → 处罚 + 海关扣留",
        "est_cost": "SDoC 测试 ¥8K-20K",
    },
    "US::ASTM F963 Toy Safety Standard": {
        "regulation_id": "US-ASTM-F963",
        "official_citation": "ASTM F963-23",
        "short_name": "ASTM F963 (玩具安全, 私有标准)",
        "license": "private_with_summary",
        "purchase_url": "https://www.astm.org/f0963-23.html",
        "key_articles": [],
        "key_points": [
            "美国玩具安全事实标准,CPSIA (15 USC §2056b) 引用为强制性安全标准",
            "涵盖机械物理性能 (跌落/挤压/锐边/小部件) + 易燃 + 化学 (8 种重金属迁移)",
            "需在 CPSC 认可的实验室测试并出报告",
            "ASTM 会员每年更新版次 (现行 F963-23)",
            "CPSIA 要求 CPC (Children's Product Certificate) + 测试报告归档 5 年"
        ],
        "risk_hint": "无 ASTM F963 测试 + CPC → 强制召回 + CPSC 处罚",
        "est_cost": "全套测试 $5K-$15K + CPC 准备",
    },
    "US::CPSIA Children Product Safety": {
        "regulation_id": "US-CPSIA",
        "official_citation": "15 USC §2056a et seq. (Pub.L. 110-314)",
        "short_name": "CPSIA (儿童产品安全法)",
        "license": "public",
        "source_url": "https://www.cpsc.gov/Regulations-Laws--Standards/Statues/Childrens-Products",
        "key_articles": ["section-2056a", "section-2056b", "section-2057c"],
        "key_points": [
            "适用于 12 岁以下儿童产品",
            "总铅含量限值 (基材 100 ppm, 表面涂层 90 ppm),邻苯二甲酸盐 (DEHP/DBP/BBP 等 8 种) 限值 0.1%",
            "需 ASTM F963 测试 + CPSC 认可第三方实验室",
            "需 CPC (Children's Product Certificate) + 测试报告归档",
            "Tracking label (永久产品追踪标识) 必须可见且不易脱落"
        ],
        "risk_hint": "无 CPC 或超标 → CPSC 强制召回 + 民事处罚",
        "est_cost": "CPC + 测试 ¥10K-25K",
    },
    "US::CPSC General Product Safety": {
        "regulation_id": "US-CPSC-General",
        "official_citation": "15 USC §2051 et seq. (Consumer Product Safety Act)",
        "short_name": "CPSA (消费品安全法)",
        "license": "public",
        "source_url": "https://www.cpsc.gov/Regulations-Laws--Standards/Statues",
        "key_articles": ["section-2051", "section-2056"],
        "key_points": [
            "美国消费品安全的基础法律,覆盖所有非专项立法产品",
            "禁止产品存在不合理伤害风险",
            "重大产品危害需 24h 内向 CPSC 报告 (Section 15)",
            "可与 CPSIA/Federal Hazardous Substances Act 等专项法联动"
        ],
        "risk_hint": "未报告产品危害 → 处罚 + 强制召回",
        "est_cost": "合规体系维护 (持续)",
    },
    "US::49 CFR 173.185 Lithium Battery Transport": {
        "regulation_id": "US-49-CFR-173-185",
        "official_citation": "49 CFR §173.185",
        "short_name": "49 CFR 173.185 (锂电池运输)",
        "license": "public",
        "source_url": "https://www.ecfr.gov/current/title-49/subtitle-B/chapter-I/subchapter-C/part-173/subpart-E/section-173.185",
        "key_articles": ["section-173-185"],
        "key_points": [
            "美国锂电池 (含锂离子/锂金属/锂聚合物) 陆运/海运/空运的统一规则",
            "空运额外遵循 IATA DGR (UN 3480/3481 条款)",
            "锂离子电池 UN 38.3 测试报告强制",
            "包装/标记/单件重量/数量限制按电池类型和运输方式分级",
            "需提交 Shipper's Declaration for Dangerous Goods (空运/海运)"
        ],
        "risk_hint": "无 UN 38.3 报告 → 航空公司/船公司拒收 + 处罚",
        "est_cost": "UN 38.3 测试 ¥30K-80K / 6-12 周",
    },
    "US::MoCRA Modernization of Cosmetics Act": {
        "regulation_id": "US-MoCRA",
        "official_citation": "21 USC §364-364H (Pub.L. 117-9)",
        "short_name": "MoCRA (化妆品现代化法案)",
        "license": "public",
        "source_url": "https://www.fda.gov/cosmetics/cosmetics-laws-regulations/modernization-cosmetics-regulation-act-2022-mocra",
        "key_articles": ["section-364", "section-364d"],
        "key_points": [
            "2022 年通过,自 2023-12-29 起分阶段实施",
            "强制要求: 设施注册 + 产品列名 (FDA VCRP 现代化版)",
            "安全证明 (Safety Substantiation) 必须归档,记录 GMP",
            "化妆品不良反应报告 (Serious Adverse Event) 15 个工作日内报告 FDA",
            "色素添加剂 (Color Additives) 与禁用成分必须符合 FD&C Act"
        ],
        "risk_hint": "未注册/未列名 → FDA 警告信 + 强制召回 + 进口扣留",
        "est_cost": "注册 + 列名 + 安全评估 $5K-$20K",
    },
    "US::TFPIA Textile Fiber Products Identification Act": {
        "regulation_id": "US-TFPIA",
        "official_citation": "15 USC §70 et seq.",
        "short_name": "TFPIA (纺织纤维标识)",
        "license": "public",
        "source_url": "https://www.ftc.gov/enforcement/statutes/textile-fiber-products-identification-act",
        "key_articles": ["section-70", "section-70a"],
        "key_points": [
            "要求纺织纤维制品 (含服装/家纺) 标注纤维成分 + 制造商/经销商身份",
            "FTC 维护通用纤维名称表 (Generic Fiber Names)",
            "广告与标签需与实际成分一致",
            "16 CFR Part 303 实施细则规定标签格式与例外"
        ],
        "risk_hint": "标签错误 → FTC 处罚 + 海关扣留",
        "est_cost": "标签设计 + 验证 $1K-$3K",
    },
    "US::FDA 21 CFR 174-190 Food Contact Substances": {
        "regulation_id": "US-21-CFR-174",
        "official_citation": "21 CFR Parts 174-190",
        "short_name": "FDA 21 CFR 174-190 (FCM)",
        "license": "public",
        "source_url": "https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-174",
        "key_articles": ["part-174", "part-175", "part-176", "part-177", "part-178", "part-180", "part-181", "part-182", "part-184", "part-186", "part-189", "part-190"],
        "key_points": [
            "美国食品接触材料 (FCN) 法规框架,涵盖涂层/聚合物/橡胶/纸/粘合剂等",
            "Indirect Food Additives 需满足 Part 174-179 物质清单或有效 FCN (Food Contact Notification)",
            "间接添加剂特定迁移限值与测试条件按法规要求",
            "需出具符合性声明 + 良好生产规范 (21 CFR Part 211 适用药物, FCM 按 GMP)",
            "Recycled Plastics 需 FCN (21 CFR §174.5)"
        ],
        "risk_hint": "未授权物质或迁移超标 → FDA 警告信 + 召回",
        "est_cost": "FCN 申请 $20K-$50K 或迁移测试 $10K-$30K",
    },
    "US::UL/ETL Listing (Marketplace-required)": {
        "regulation_id": "US-UL-ETL",
        "official_citation": "UL/ETL Listing (第三方实验室认证)",
        "short_name": "UL/ETL 列名 (平台强制)",
        "license": "private_with_summary",
        "purchase_url": "https://www.ul.com/services/certification/ul-listing-and-classification",
        "key_articles": [],
        "key_points": [
            "UL 与 ETL (Intertek) 均为 NRTL (国家认可测试实验室),北美 NRTL 认证并行",
            "Amazon 等北美电商平台强制要求电气产品 UL/ETL 列名",
            "对应 UL 标准 (e.g. UL 1088 用于装饰灯、UL 982 用于家用食物处理机等)",
            "包含产品测试 + 工厂首次检查 (Follow-up Service)",
            "需每年维护 (季度/年审)"
        ],
        "risk_hint": "无 UL/ETL 列名 → Amazon/Walmart 等强制下架",
        "est_cost": "$8K-$30K + 年审 $2K-$8K",
    },
    # ── CN (12) ─────────────────────────────────────────────────────────────
    "CN::CCC认证 中国强制性产品认证": {
        "regulation_id": "CN-CCC",
        "official_citation": "强制性产品认证制度 (CNCA 实施规则)",
        "short_name": "CCC 认证 (中国强制)",
        "license": "public",
        "source_url": "https://www.samr.gov.cn/cnca/",
        "key_articles": ["实施规则-CNCA-C09-01"],
        "key_points": [
            "适用于 CNCA 公布的强制性产品目录 (21 大类, e.g. 电线电缆、家电、玩具、安全玻璃等)",
            "需在 CNCA 指定认证机构申请 + CQC/CGC 等机构测试",
            "需工厂检查 (初始 + 获证后监督)",
            "证书有效期 5 年 (部分类别 3 年), 每年监督",
            "证书变更需变更申请,新设计/新工厂均需重新申请"
        ],
        "risk_hint": "无 CCC 目录内产品未认证 → 处罚 + 平台下架 + 海关扣留",
        "est_cost": "测试 ¥15K-40K + 申请费 ¥5K-15K + 工厂检查 ¥10K-30K",
    },
    "CN::GB 4943.1 电子产品安全要求": {
        "regulation_id": "CN-GB-4943-1",
        "official_citation": "GB 4943.1-2022",
        "short_name": "GB 4943.1 (信息技术设备, 私有标准)",
        "license": "private_with_summary",
        "purchase_url": "https://openstd.samr.gov.cn/bzgk/std/lookup?bid=GB%204943.1-2022",
        "key_articles": [],
        "key_points": [
            "对应 IEC 62368-1 音视频/信息技术设备安全要求",
            "适用于 600V 以下电子电气设备 (电源适配器、笔记本、手机充电器等)",
            "GB 4943.1-2022 替代 GB 4943.1-2011 + GB 8898-2011",
            "CCC 目录内的产品需配合 CCC 认证申请",
            "GB 标准由 SAC 维护,正式版本需购买纸质/电子版"
        ],
        "risk_hint": "未满足 GB 4943.1 → CCC 申请失败 + 平台下架",
        "est_cost": "测试 ¥10K-30K (含 CCC 流程)",
    },
    "CN::GB 4706 家用电器安全通用要求": {
        "regulation_id": "CN-GB-4706",
        "official_citation": "GB 4706.1 + 专项系列 (GB 4706.X)",
        "short_name": "GB 4706 (家用电器, 私有标准)",
        "license": "private_with_summary",
        "purchase_url": "https://openstd.samr.gov.cn/",
        "key_articles": [],
        "key_points": [
            "对应 IEC 60335-1 家用电器安全,GB 4706.1 通用 + GB 4706.2~XX 各类专项",
            "CCC 强制目录内的家电产品 (电饭锅/微波炉/空调等) 必须通过",
            "测试项目涵盖电气/机械/热/辐射等危险防护",
            "GB 标准由 SAC 标准化技术委员会维护",
            "对应协调标准 GB 4706.1-2005 + 专项"
        ],
        "risk_hint": "未通过 GB 4706 → 不可获得 CCC,禁止销售",
        "est_cost": "测试 ¥15K-40K",
    },
    "CN::CCC认证 信息技术设备": {
        "regulation_id": "CN-CCC-IT",
        "official_citation": "CCC 实施规则 (信息技术设备)",
        "short_name": "CCC 认证 (信息技术设备)",
        "license": "public",
        "source_url": "https://www.samr.gov.cn/cnca/",
        "key_articles": ["实施规则-CNCA-C09-01"],
        "key_points": [
            "3C 数字类 (计算机/打印机/服务器/数码相机等) 的 CCC 实施规则",
            "依据 GB 4943.1 测试",
            "需 CNCA 指定认证机构 (CQC 等) 出证",
            "工厂检查 + 抽样测试 + 证后监督",
            "证书有效期 5 年"
        ],
        "risk_hint": "目录内 IT 设备无 CCC → 海关/平台拦截 + 处罚",
        "est_cost": "测试 ¥20K-50K",
    },
    "CN::GB 6675 玩具安全国家标准": {
        "regulation_id": "CN-GB-6675",
        "official_citation": "GB 6675.1-2014 + 6675.2-2014 + 6675.3-2014 + 6675.4-2014",
        "short_name": "GB 6675 (玩具安全, 私有标准)",
        "license": "private_with_summary",
        "purchase_url": "https://openstd.samr.gov.cn/",
        "key_articles": [],
        "key_points": [
            "GB 6675 系列对应 ISO 8124 + EN 71 等玩具安全标准",
            "GB 6675.1 基本规范 + GB 6675.2 机械物理性能 + GB 6675.3 易燃性能 + GB 6675.4 化学迁移",
            "3C 玩具目录 (电玩具/童车/塑胶玩具等) 强制 CCC",
            "非 3C 目录内玩具仍需符合 GB 6675 (GB 强制性标准)",
            "化学要求涵盖 8 种重金属迁移 + 邻苯"
        ],
        "risk_hint": "玩具无 GB 6675 合规 → 强制下架 + SAMR 处罚",
        "est_cost": "全套测试 ¥15K-35K",
    },
    "CN::GB 5296 消费品使用说明": {
        "regulation_id": "CN-GB-5296",
        "official_citation": "GB 5296.1-2012 + GB 5296.2-... 系列",
        "short_name": "GB 5296 (消费品使用说明, 私有标准)",
        "license": "private_with_summary",
        "purchase_url": "https://openstd.samr.gov.cn/",
        "key_articles": [],
        "key_points": [
            "GB 5296 系列规定消费品使用说明 (产品标签/说明书) 的基本要求",
            "GB 5296.1 通用要求 + GB 5296.2~7 各类产品专项",
            "GB 5296.4 (纺织品) + GB 5296.5 (玩具) + GB 5296.6 (灯具) 等",
            "标识内容必须真实/准确/齐全,使用中文",
            "需标注产品名称/型号/规格/成分/制造商 + 警示语"
        ],
        "risk_hint": "标签缺失或信息不全 → 处罚 + 平台下架",
        "est_cost": "标签设计 + 翻译 ¥3K-8K",
    },
    "CN::GB 31241 便携式电子产品用锂电池": {
        "regulation_id": "CN-GB-31241",
        "official_citation": "GB 31241-2022",
        "short_name": "GB 31241 (便携锂电池, 私有标准)",
        "license": "private_with_summary",
        "purchase_url": "https://openstd.samr.gov.cn/",
        "key_articles": [],
        "key_points": [
            "适用于便携式电子产品用锂离子电池 (手机/笔记本/电动工具/平衡车等)",
            "CCC 目录内的电池产品 (充电宝/平衡车等) 必须通过",
            "测试项目: 安全 (过充/短路/跌落/挤压/热冲击) + 性能 (容量/循环)",
            "GB 31241-2022 替代 2014 版,新增高海拔模拟等",
            "对应 IEC 62133-2 协调"
        ],
        "risk_hint": "无 GB 31241 → 3C 申请失败 + 平台下架 + 安全事故风险",
        "est_cost": "测试 ¥20K-50K",
    },
    "CN::化妆品监督管理条例 CSAR": {
        "regulation_id": "CN-CSAR",
        "official_citation": "国务院令第727号《化妆品监督管理条例》",
        "short_name": "化妆品监督管理条例 (CSAR)",
        "license": "public",
        "source_url": "https://www.gov.cn/zhengce/content/2020-06/29/content_5524019.htm",
        "key_articles": ["第17条", "第20条", "第32条", "第37条"],
        "key_points": [
            "2021-01-01 起施行,取代《化妆品卫生监督条例》(1990)",
            "国家药监局 (NMPA) 主管,省级局负责备案/注册",
            "特殊化妆品 (染发/烫发/美白/防晒/防脱发/新功效) 实行注册管理,普通化妆品备案",
            "需提交产品配方/生产工艺/质量标准/安全评估资料",
            "原料符合《已使用化妆品原料目录》(2021版) 或按新原料注册"
        ],
        "risk_hint": "无备案/注册 → NMPA 处罚 + 平台下架 + 召回",
        "est_cost": "备案 ¥3K-10K + 注册 ¥20K-100K",
    },
    "CN::GB 18401 国家纺织产品基本安全技术规范": {
        "regulation_id": "CN-GB-18401",
        "official_citation": "GB 18401-2010",
        "short_name": "GB 18401 (纺织安全, 私有标准)",
        "license": "private_with_summary",
        "purchase_url": "https://openstd.samr.gov.cn/",
        "key_articles": [],
        "key_points": [
            "国家纺织产品安全基本技术规范,强制标准",
            "分 A/B/C 三类 (婴幼儿/直接接触皮肤/非直接接触),甲醛/可萃取重金属/pH 等要求逐级放宽",
            "A 类婴幼儿用品要求最严,不可检出芳香胺染料",
            "需在 NMPA 认可实验室测试并保留报告",
            "GB 18401-2010 现行,2025 年新版修订征求意见中"
        ],
        "risk_hint": "无 GB 18401 报告 → 处罚 + 平台下架",
        "est_cost": "全套测试 ¥3K-8K/产品",
    },
    "CN::GB 5296.4 纺织品和服装使用说明": {
        "regulation_id": "CN-GB-5296-4",
        "official_citation": "GB 5296.4-2012",
        "short_name": "GB 5296.4 (纺织品标签, 私有标准)",
        "license": "private_with_summary",
        "purchase_url": "https://openstd.samr.gov.cn/",
        "key_articles": [],
        "key_points": [
            "GB 5296 系列的纺织分支,规定纺织品和服装的使用说明 (标签)",
            "需标注纤维成分 + 含量百分比 + 维护方式 + 制造商/经销商",
            "需 GB/T 8685-2008 规定的图形符号表示洗涤/熨烫/晾干等",
            "中文标注强制,与英文/其他语种并列可",
            "吊牌 + 缝制标签 + 包装标注均合规"
        ],
        "risk_hint": "标签不合规 → 处罚 + 退货",
        "est_cost": "标签设计 ¥2K-5K",
    },
    "CN::GB 4806 食品接触材料系列标准": {
        "regulation_id": "CN-GB-4806",
        "official_citation": "GB 4806.1~.16 系列",
        "short_name": "GB 4806 (食品接触材料, 私有标准)",
        "license": "private_with_summary",
        "purchase_url": "https://openstd.samr.gov.cn/",
        "key_articles": [],
        "key_points": [
            "GB 4806 系列对应中国 FCM 国家强制标准 (2026 年版)",
            "GB 4806.1 通则 + GB 4806.2~.16 各材料专项 (塑料/金属/玻璃/陶瓷/纸/粘合剂等)",
            "GB 4806.7 (塑料) 对应 EU 10/2011,GB 4806.9 (金属) 限制元素迁移",
            "需出具 DoC (符合性声明) + 测试报告",
            "产品接触面需标识 '食品接触用' 或刀叉符号"
        ],
        "risk_hint": "未满足 GB 4806 → 召回 + 市场监管处罚",
        "est_cost": "全套测试 ¥10K-25K",
    },
    "CN::SRRC 无线电型号核准": {
        "regulation_id": "CN-SRRC",
        "official_citation": "《无线电发射设备管理规定》(工信部令)",
        "short_name": "SRRC 型号核准 (无线电)",
        "license": "public",
        "source_url": "https://www.miit.gov.cn/",
        "key_articles": ["工信部无[2021]129号"],
        "key_points": [
            "工信部 (MIIT) 主管,适用于在中国销售/使用的无线电发射设备",
            "包括蓝牙/Wi-Fi/2.4G/5G/GSM/4G/5G 模块等所有无线电发射设备",
            "需 SRRC 认可实验室测试 + 工信部无线电",
            "型号核准证后获 + 工厂检查 + 证后监督",
            "证书有效期 5 年"
        ],
        "risk_hint": "无 SRRC → 处罚 + 海关扣留 + 平台下架",
        "est_cost": "测试 ¥10K-30K + 申请 ¥5K-10K",
    },
    # ── UK (5, all public) ───────────────────────────────────────────────────
    "UK::UKCA Marking Requirements": {
        "regulation_id": "UK-UKCA-General",
        "official_citation": "UKCA Marking Requirements (gov.uk)",
        "short_name": "UKCA Marking (通用)",
        "license": "public",
        "source_url": "https://www.gov.uk/guidance/using-the-ukca-marking",
        "key_articles": [],
        "key_points": [
            "2021-01-01 起 UK 市场替代 CE,Brexit 后英国市场准入标识",
            "适用 21 类产品 (电气/玩具/医疗器械/机械等)",
            "标注要求: UKCA 标志 + DoC + 技术文档",
            "UK 境外的制造商必须指定 UK 授权代表",
            "2024-12-31 前 CE 标志可继续使用 UK 市场;2025 起部分产品 UKCA 强制"
        ],
        "risk_hint": "UK 市场无 UKCA/CE → 海关扣留 + 处罚",
        "est_cost": "测试 ¥10K-40K + UK 授权代表 ¥5K-15K/年",
    },
    "UK::UKCA Marking for Appliances": {
        "regulation_id": "UK-UKCA-Appliance",
        "official_citation": "UKCA Marking for Appliances",
        "short_name": "UKCA Marking (家电)",
        "license": "public",
        "source_url": "https://www.gov.uk/government/publications/appliances-regulations-2016",
        "key_articles": [],
        "key_points": [
            "对应 EN 60335-2 系列协调标准",
            "UK 认可实验室测试 + UK 认可的第三方 (Approved Body) 评估",
            "标注 UKCA 标志 + UK Approved Body 编号 + DoC",
            "制造商或 UK 授权代表对 DoC 负责",
            "技术文档保留 10 年"
        ],
        "risk_hint": "无 UKCA → UK 市场禁售",
        "est_cost": "测试 ¥15K-40K",
    },
    "UK::Batteries and Accumulators (UK Retained)": {
        "regulation_id": "UK-Batteries",
        "official_citation": "The Batteries and Accumulables (Placing on the Market) Regulations 2008 (UK Retained)",
        "short_name": "UK 电池法规 (Retained EU)",
        "license": "public",
        "source_url": "https://www.legislation.gov.uk/uksi/2008/2164/contents",
        "key_articles": [],
        "key_points": [
            "英国脱欧后保留的 2006/66/EC 等效规则 (UK Retained EU Law)",
            "含便携/工业/汽车电池分类管理",
            "收集/回收/再利用率要求与原 EU 指令并行",
            "UK 厂家需注册为电池生产者",
            "后续将逐步与 EU 2023/1542 趋同"
        ],
        "risk_hint": "无 UK 电池注册 → UK 销售受限",
        "est_cost": "注册 + 维护 £3K-10K/年",
    },
    "UK::UK Cosmetics Regulation (Retained 1223/2009)": {
        "regulation_id": "UK-Cosmetics",
        "official_citation": "UK Cosmetics Regulation (Retained 1223/2009)",
        "short_name": "UK Cosmetics Regulation",
        "license": "public",
        "source_url": "https://www.legislation.gov.uk/uksi/2013/1478/contents",
        "key_articles": [],
        "key_points": [
            "英国脱欧后保留的 1223/2009 等效规则",
            "需 OPSS (Office for Product Safety & Standards) 通报 (UK SCPN portal)",
            "需指定 UK Responsible Person",
            "Safety Report + PIF + 配方公开义务",
            "禁用/限用清单与 EU 1223/2009 同步"
        ],
        "risk_hint": "无 UK 通报 → UK 销售禁 + OPSS 警告",
        "est_cost": "通报 + PIF £3K-10K",
    },
    "UK::UKCA Radio Equipment Regulations 2017": {
        "regulation_id": "UK-UKCA-Radio",
        "official_citation": "Radio Equipment Regulations 2017 (S.I. 2017/1206)",
        "short_name": "UK Radio Equipment Regs 2017",
        "license": "public",
        "source_url": "https://www.legislation.gov.uk/uksi/2017/1206/contents",
        "key_articles": [],
        "key_points": [
            "UK 无线设备法规 (对应 EU RED 2014/53/EU)",
            "UK 认可实验室测试 + UK Approved Body (部分类别)",
            "UKCA 标志 + UK Approved Body 编号 + DoC",
            "英国境外制造商需指定 UK 授权代表",
            "频谱使用需与 OFCOM 规则一致"
        ],
        "risk_hint": "无 UK 无线认证 → UK 市场禁售 + OFCOM 处罚",
        "est_cost": "测试 £10K-30K + UK 代表 £3K-8K/年",
    },
    # ── AU (1, public) ───────────────────────────────────────────────────────
    "AU::RCM Compliance 无线电通信标识": {
        "regulation_id": "AU-RCM",
        "official_citation": "ACMA RCM Marking Requirements",
        "short_name": "RCM (澳新合规标志)",
        "license": "public",
        "source_url": "https://www.acma.gov.au/standards/regulatory-compliance-mark-rcm",
        "key_articles": [],
        "key_points": [
            "ACMA 监管的 Regulatory Compliance Mark,适用于澳新 (AU/NZ) 市场",
            "涵盖无线电/EMC/电信/电磁辐射等",
            "供应商需在 ERAC (Electrical Regulatory Authorities Council) 注册为 responsible supplier",
            "贴 RCM 标志 + 供应商联系信息 + DoC",
            "Underlying 无线/EMC 标准仍需 AS/NZS 协调标准测试 (AS/NZS 4268 等, 私有)"
        ],
        "risk_hint": "无 RCM + 未注册 → ACMA 处罚 + 召回",
        "est_cost": "注册 AUD A$1K + AS/NZS 测试 AUD A$5K-15K",
    },
    # ── UN (1, public) ───────────────────────────────────────────────────────
    "UN::UN 38.3 Transport Testing": {
        "regulation_id": "UN-38-3",
        "official_citation": "UN Manual of Tests and Criteria, Part III, Subsection 38.3",
        "short_name": "UN 38.3 (锂电池运输)",
        "license": "public",
        "source_url": "https://unece.org/transport/dangerous-goods/un-manual-tests-and-criteria",
        "key_articles": ["section-38-3"],
        "key_points": [
            "UN 推荐锂电池运输测试标准,全球航空/海运/陆运通用强制",
            "8 项测试 (T1-T8): 高度模拟/热冲击/振动/冲击/外部短路/撞击/过充/强制放电",
            "需 UN 认可实验室测试,报告全球互认",
            "UN 3480 (锂离子电池单独运输) + UN 3481 (装在设备内或与设备一起)",
            "测试通过后方可依据 IATA/IMO/ADR 等危险品规则运输"
        ],
        "risk_hint": "无 UN 38.3 报告 → 航空公司/船公司/陆运公司拒收 + 罚款",
        "est_cost": "测试 ¥30K-80K / 6-12 周",
    },
}


def _entry_key(region: str, doc_name: str) -> str:
    return f"{region}::{doc_name}"


def _filename(region: str, regulation_id: str, primary_source: str) -> str:
    """Generate a stable filename for the KB YAML.

    regulation_id already encodes the region (e.g. EU-2023-1542, CN-GB-6675),
    so the filename is {regulation_id}-{primary_source}.yaml.
    """
    safe_source = re.sub(r"[^a-z0-9]+", "-", primary_source.lower()).strip("-")
    return f"{regulation_id}-{safe_source}.yaml"


# ────────────────────────────────────────────────────────────────────────────
# must_check parsing — extract triggers per (regulation, region)
# ────────────────────────────────────────────────────────────────────────────


def _parse_must_check() -> dict[tuple[str, str], dict]:
    """Return {(region, doc_name): {category_triggers, feature_triggers, reason}}.

    Dedup by (region, doc_name) keeps each unique anchor exactly once. Category
    and feature triggers are aggregated (a regulation triggered from both
    sources gets both listed).
    """
    anchors: dict[tuple[str, str], dict] = {}
    for category, entries in CATEGORY_REGULATIONS.items():
        for e in entries:
            region = str(e.get("region", "")).strip().upper()
            doc_name = str(e.get("doc_name", "")).strip()
            key = (region, doc_name)
            slot = anchors.setdefault(
                key, {"categories": set(), "features": set(), "reason": e.get("reason", "")}
            )
            slot["categories"].add(category)
    for feature, entries in FEATURE_REGULATIONS.items():
        for e in entries:
            region = str(e.get("region", "")).strip().upper()
            doc_name = str(e.get("doc_name", "")).strip()
            key = (region, doc_name)
            slot = anchors.setdefault(
                key, {"categories": set(), "features": set(), "reason": e.get("reason", "")}
            )
            slot["features"].add(feature)
            # Feature reason preferred when category has none
            if not slot["reason"]:
                slot["reason"] = e.get("reason", "")
    return anchors


# ────────────────────────────────────────────────────────────────────────────
# YAML generation
# ────────────────────────────────────────────────────────────────────────────


def _resolve_primary_source(categories: set, features: set) -> str:
    """Pick a stable filename suffix from triggers.

    Prefers the most specific category (battery/toy/cosmetic) over feature. If
    only features are present, use the first feature (alphabetical for
    determinism).
    """
    categories_sorted = sorted(categories)
    features_sorted = sorted(features)
    if categories_sorted:
        return categories_sorted[0]
    if features_sorted:
        return features_sorted[0]
    return "anchor"


def _build_yaml(
    region: str,
    doc_name: str,
    trigger: dict,
    enrichment: dict | None,
) -> dict:
    """Build a single KB YAML payload."""
    if enrichment is None:
        raise ValueError(f"Missing enrichment for ({region!r}, {doc_name!r})")
    categories = sorted(trigger["categories"])
    features = sorted(trigger["features"])
    primary_source = _resolve_primary_source(trigger["categories"], trigger["features"])
    markets = [region]
    if not region:
        markets = ["GLOBAL"]

    payload = {
        "id": f"KB-{primary_source}-{region or 'GLOBAL'}-{enrichment['regulation_id']}",
        "regulation_id": enrichment["regulation_id"],
        "doc_name": doc_name,
        "official_citation": enrichment["official_citation"],
        "short_name": enrichment.get("short_name", doc_name),
        "source": "category" if trigger["categories"] else "feature",
        "primary_source": primary_source,
        "applies_if": {
            "category": categories,
            "features_any": features,
            "markets": markets,
        },
        "key_articles": enrichment.get("key_articles", []),
        "key_points": enrichment.get("key_points", []),
        "risk_hint": enrichment.get("risk_hint", ""),
        "est_cost": enrichment.get("est_cost", ""),
        "license": enrichment["license"],
    }
    if enrichment["license"] == "public":
        payload["source_url"] = enrichment["source_url"]
    else:
        payload["purchase_url"] = enrichment["purchase_url"]
    payload["last_verified"] = TODAY
    payload["verified_by"] = "llm-assisted"
    payload["verification_status"] = "needs_human_review"
    payload["schema_version"] = 1
    return payload


# ────────────────────────────────────────────────────────────────────────────
# Entry points
# ────────────────────────────────────────────────────────────────────────────


def generate(force: bool = False) -> list[Path]:
    anchors = _parse_must_check()
    out_dir = REPO / "data" / "kb" / "anchors"
    out_dir.mkdir(parents=True, exist_ok=True)

    written: list[Path] = []
    missing_enrichment = []
    for (region, doc_name), trigger in anchors.items():
        key = _entry_key(region, doc_name)
        enrichment = ENRICHMENT.get(key)
        if enrichment is None:
            missing_enrichment.append(key)
            continue
        primary_source = _resolve_primary_source(
            trigger["categories"], trigger["features"]
        )
        path = out_dir / _filename(region, enrichment["regulation_id"], primary_source)
        if path.exists() and not force:
            continue
        payload = _build_yaml(region, doc_name, trigger, enrichment)
        path.write_text(
            yaml.safe_dump(
                payload,
                allow_unicode=True,
                sort_keys=False,
                width=120,
            )
        )
        written.append(path)
    if missing_enrichment:
        sys.stderr.write(
            f"WARNING: {len(missing_enrichment)} anchors without enrichment:\n"
            + "\n".join(f"  - {k}" for k in missing_enrichment)
            + "\n"
        )
    return written


def verify() -> int:
    anchors = _parse_must_check()
    out_dir = REPO / "data" / "kb" / "anchors"

    failures: list[str] = []
    yaml_files = sorted(out_dir.glob("*.yaml"))
    if len(yaml_files) != len(anchors):
        failures.append(
            f"File count mismatch: {len(yaml_files)} YAML files vs {len(anchors)} must_check anchors"
        )

    covered_keys: set[tuple[str, str]] = set()
    required_fields = {
        "id", "regulation_id", "official_citation", "applies_if",
        "license", "last_verified", "schema_version",
    }
    for path in yaml_files:
        try:
            data = yaml.safe_load(path.read_text())
        except Exception as e:
            failures.append(f"{path.name}: YAML parse error: {e}")
            continue
        for f in required_fields:
            if f not in data:
                failures.append(f"{path.name}: missing field {f}")
        if data.get("schema_version") != 1:
            failures.append(f"{path.name}: schema_version != 1 (got {data.get('schema_version')})")
        if data.get("verification_status") not in ("verified", "needs_human_review"):
            failures.append(f"{path.name}: invalid verification_status")
        license = data.get("license")
        if license not in ("public", "private_with_summary"):
            failures.append(f"{path.name}: invalid license {license!r}")
        elif license == "public" and not data.get("source_url"):
            failures.append(f"{path.name}: public license missing source_url")
        elif license == "private_with_summary" and not data.get("purchase_url"):
            failures.append(f"{path.name}: private_with_summary missing purchase_url")
        # Recover (region, doc_name) from applies_if.markets + doc_name to
        # confirm coverage of every must_check anchor.
        markets = (data.get("applies_if") or {}).get("markets", [])
        region = markets[0] if markets and markets[0] != "GLOBAL" else ""
        doc_name = data.get("doc_name", "")
        covered_keys.add((region, doc_name))

    must_check_keys = set((r, n) for (r, n) in anchors.keys())
    missing = must_check_keys - covered_keys
    if missing:
        failures.append(
            f"{len(missing)} must_check anchors not represented in YAMLs:\n"
            + "\n".join(f"  - ({r!r}, {n!r})" for r, n in sorted(missing))
        )

    if failures:
        sys.stderr.write("VERIFY FAILED:\n")
        for f in failures:
            sys.stderr.write(f"  - {f}\n")
        return 1
    print(
        f"VERIFY OK: {len(yaml_files)} YAML files, "
        f"{len(anchors)} must_check anchors covered, schema v1 consistent"
    )
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    g = p.add_mutually_exclusive_group()
    g.add_argument(
        "--force",
        action="store_true",
        help="Regenerate all YAML files, overwriting existing ones",
    )
    g.add_argument(
        "--verify",
        action="store_true",
        help="Verify integrity (count, schema, coverage); do not write",
    )
    args = p.parse_args()

    if args.verify:
        return verify()
    written = generate(force=args.force)
    print(
        f"Generated {len(written)} YAML files in data/kb/anchors/. "
        f"Use --verify to check integrity."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())