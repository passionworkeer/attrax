# 法规库批量扩展（2026-09-19）

## 目标

把 `/Users/wangjianjun/me/regulation-raw`（1621 条原始抓取记录 / 568MB / 70 个市场）与
`/Users/wangjianjun/me/attrax-docs` 中未登记的 12 份有效法规原件导入 attrax 法规库，
让 `/regulations` 页面显示全部条目。

## 入库结果

- **入库前**：法规库 124 条（21 个区域）
- **入库后**：法规库 **1049 条**（25 个区域）
- **新增合计**：925 条 YAML + 932 份原件（gitignored 的 `data/regulations/{region}/raw/`）

### attrax-docs 增量（`attrax-docs-extra-2026-09-19.json`，12 条）

5 条新增（7 条已存在跳过，原始 9-19 批次已覆盖 EMC/LVD/RoHS/RED/REACH 与 MY-PDPA-2010 锚点）：

| id | 区域 | domain |
|---|---|---|
| `EU-2016-679-GDPR` | EU | 数据保护 |
| `EU-2009-48-TOY` | EU | toy |
| `EU-2023-1542-INTERP` | EU | battery |
| `EU-2021-821-FDI` | EU | 投资准入 |
| `SA-SABER-SASO` | SA | 产品安全 |

跳过的 7 条（已存在）：`EU-2014-30` / `EU-2023-988` / `EU-2014-35` / `EU-1907-2006` /
`EU-2014-53` / `EU-2011-65` / `MY-PDPA-2010`。

剩余 14 份 `attrax-docs` 文件（`具体/` 合规分析、`google gemini/` UL 报告、
`all法规/` 清单）未纳入 — 它们是分析/参考材料不是法规原件。

### regulation-raw 全量（`regulation-raw-2026-09-19.json`，920 条）

| 区域 | 新增 | 主要内容 |
|---|---:|---|
| US | 380 | CFR / US Code / 公法 / 召回数据 / Federal Register |
| CN | 235 | 国家标准（GB） / 部门规章 |
| EU | 85 | EUR-Lex Cellar CELEX 编号系列 |
| GLOBAL | 71 | ETSI / IEC / ISO / WIPO 等国际标准 |
| DE | 36 | gesetze-im-internet.de 法律全文（XML + PDF） |
| CA | 28 | Department of Justice Canada XML + HTML |
| AU | 12 | legislation.gov.au |
| JP | 12 | e-Gov 法令 API v1 XML |
| SG | 12 | Singapore Statutes Online |
| UK | 11 | GOV.UK 指南页（legislation.gov.uk 被 WAF 拦截） |
| BR / VN / MY / NZ / IN / ID / SA / TH / KR / AE / IT / MX / GCC / UN / FR | 60 | 各市场官网杂项 |

`intl` 原始市场 489 + 51 = 540 条，按名称关键词拆分为：
- 含 `UN R / UNECE / WTO / Codex / UNCTAD` 关键词 → `UN`（9 条）
- 其余（ETSI / IEC / ISO / IEEE / ITU / WIPO / NIST 等技术标准）→ `GLOBAL`（71 条）

跳过 113 条 `status!=ok`（WAF 拦截 / 404 / JS 空壳）+ 49 个不在 `_REGION_DIRS` 的市场
（`ar / bd / be / bn / ch / cl / co / cy / dk / ee / es / fi / gh / gr / hk / hr / ie / jo /
kh / kz / la / lb / lu / lv / mn / mt / ng / nl / no / np / om / pa / ph / pk / pl / pt /
qa / rs / ru / se / si / sk / tr / tw / tz / za`），共 588 条不纳入。

## 脚本

`scripts/build_regulation_raw_manifest.py`（新增）—— 把 regulation-raw 的三份 manifest
（`_manifest.json` / `_manifest_bulk.json` / `_manifest_discovery.json`）转换为
attrax 的 `_imports/regulation-raw-2026-09-19.json` 格式：

- 仅保留 `status == ok`
- 仅保留 `market ∈ _REGION_DIRS`
- `intl` / `in` 按名称关键词拆分为 `GLOBAL` 或 `UN`
- 文件名 stem 归一化为 ASCII / 去特殊字符 / 去重区域前缀
- `domain` 用关键词分类器（10 品类英文 + 通用合规中文 + `other` fallback）

`scripts/import_regulation_docs.py`（既有）—— 跑两次：

1. `--catalog data/regulations/_imports/attrax-docs-extra-2026-09-19.json --copy-docs`
   → 5 新增 + 7 跳过 + 12 份原件
2. `--catalog data/regulations/_imports/regulation-raw-2026-09-19.json --copy-docs`
   → 920 新增 + 0 跳过 + 920 份原件

每次跑完自动调 `AutoIngestor._rebuild_index()` 重建 `regulations_index.json`。

## 验证

| 检查 | 结果 |
|---|---|
| `pytest rag_service/tests/test_kb_loader.py`（库不变量 anchored ⊆ regulated + 锚点 1:1 法规） | **26/26 passed** |
| `pytest scripts/watchdog/tests/test_import_regulation_docs.py`（导入脚本回归） | **15/15 passed** |
| `regulations_index.json` count | **1049** |
| 本地 dev `/regulations` 副标题（动态 i18n） | "当前 **1049** 篇法规档案（覆盖 **25** 个区域）+ 37 个抓取源 + 42 条近期动态" |
| 本地 dev `/regulations` 顶部统计 | 法规档案 **1049** / 抓取源 **37** / 高优先级 **28** / 覆盖市场 **25** |
| 本地 dev `/api/regulations/archive?market=us` | matching=**400** / has_CFR=**true** / has_US_CPSC=**true** |

dev server 第一次启动时 `/api/regulations/archive` 因 `unstable_cache` 缓存了 124 条，
重启 dev server 后重新读到 1049 条。生产部署不受此影响（生产 nextjs standalone 启动时
首请求会读取最新 `regulations_index.json`）。

## 部署注意

CLAUDE.md §"部署"已记录：法规库要 **additive rsync + 在服务器上重建索引**（不能
拷本地索引，服务器可能有 watchdog 自动入库的 UK 法规）。本次新增全部在 `_REGION_DIRS`
25 个区域内，部署脚本走 additive rsync 即可，本地索引需要 **不** 打包上传，由服务器
独立重建。