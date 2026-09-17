# 02 · 法规与知识库

## 核心要点（30 秒读完）

- **法规数据**：44 篇 YAML，按市场分（EU 13 / US 12 / CN 12 / UK 5 / AU 1 / UN 1）；33 篇 public（含逐字法条全文）+ 11 篇 private_with_summary（KB 摘要 + 官方购买链接）。
- **KB 锚点**：44 个 YAML，每个对应一篇法规，定义 `applies_if`（market / category / features_any 三层触发）。
- **加载机制**：`kb_loader.py` 与 `article_loader.py` 都用 `(mtime_ns, size)` stamp 自失效缓存，watchdog 03:00 自动改 YAML 后长跑进程无需重启即可用上新法条。
- **source_kind 治理**：`official_verbatim / official_summary / curated_summary` 三种允许 LLM 引用并进入「已对照原文」状态；`unverified` 会被强制降级为「仅对照摘要」。
- **触发逻辑**：`must_check.py:build_anchor_list` 做品类 + 特征 + 市场三段叠加，UN 类（如 UN 38.3 锂电池运输）始终命中。

> 数据快照日期：2026-09-17。44 篇现行法规 + 44 个 KB 锚点 YAML + 35 个 watchdog 监控源（注册表随 watchdog 每日运行可能更新）。

## 全文书表

线上扫描引擎（`rag_service`）按「用户选择的市场 + 视觉识别的品类 + 检测到的硬特征」激活法规锚点。法规全文落在 [`data/regulations/{region}/*.yaml`](file:///Users/wangjianjun/me/attrax/data/regulations)，每个市场目录下一组：

| Region | 法规数 | 目录 |
|---|---:|---|
| `eu/` | 13 | EU 指令/法规（GPSR、玩具、RoHS、RED、EMC、LVD、电池、REACH、化妆品、FCM、塑料 FCM、纺织品纤维名称、ErP） |
| `us/` | 12 | CPSC、CPSIA、Prop 65、FCC Part 15/15-18、FDA 21 CFR 174、MoCRA、49 CFR 173-185、TFPIA、ASTM F963、UL 60335、UL/ETL |
| `cn/` | 12 | CCC、CCC-IT、CSAR、SRRC、GB 6675/18401/4706/4806/4943.1/31241/5296/5296.4 |
| `uk/` | 5 | UKCA 通用 / 家电 / Radio、UK Batteries、UK Cosmetics |
| `au/` | 1 | RCM |
| `un/` | 1 | UN 38.3 锂电池运输 |
| **合计** | **44** | |

授权性质：

- **public**（33 篇）：政府公开法律法规指令，包含逐条法条全文 / 官方结构化条款，`articles[]` 字段非空。
- **private_with_summary**（11 篇）：行业或国标版权标准（GB、UL、ASTM），系统内置权威 KB 提炼摘要 + 官方购买 / 标准信息公开系统查阅链接，`articles[]` 为空（与 KB 锚点的 `key_points` 一起提供"非逐字但可追溯"的合规要点）。

> 完整编号 ID、官方代号、人类可访问链接见仓库自带 [`docs/regulations/ONLINE-REGULATIONS-AND-DAILY-SOURCES-2026-09-16.md`](file:///Users/wangjianjun/me/attrax/docs/regulations/ONLINE-REGULATIONS-AND-DAILY-SOURCES-2026-09-16.md)。

## 文件结构（一篇法规的 YAML 形如）

`data/regulations/eu/EU-2023-1542.yaml`（EU 电池新规 2023/1542）：

```yaml
id: EU-2023-1542
title: Regulation (EU) 2023/1542 ... (batteries)
region: eu                    # 目录名一致
official_citation: "Regulation (EU) 2023/1542"
source_kind: official_verbatim  # / official_summary / curated_summary / unverified
source_url: https://eur-lex.europa.eu/eli/reg/2023/1542/oj
last_verified: "2026-09-12"
checksum_sha256: <hex>
articles:
  - id: art-1
    title: Subject matter and scope
    text: |
      This Regulation lays down rules on...（逐字法条正文）
  - id: art-7
    title: Due diligence obligations
    text: |
      ...
```

> `source_kind` 治理（`rag_service/retrieval/article_loader.py:VERBATIM_ALLOWED_SOURCE_KINDS`）：只有 `official_verbatim / official_summary / curated_summary` 允许 LLM 引用并进入「已对照原文」状态；`unverified`（即只读摘要未对照原文）的引用会被 `quote_matcher` 从 `matched` 降级到 `fallback_article_only`，前端 CitationChip 显示「摘要对照」。

## KB 锚点（`data/kb/anchors/`）

44 个 YAML，一篇法规一个，文件名 = `{regulation_id}.yaml`。例 [`data/kb/anchors/EU-2023-1542.yaml`](file:///Users/wangjianjun/me/attrax/data/kb/anchors)：

```yaml
regulation_id: EU-2023-1542
doc_name: EU Battery Regulation
applies_if:
  markets: [EU]                # 触发该锚点的目标市场；GLOBAL 视为全部
  category: [battery, electronics, appliance, 3c, home, cosmetic, food_contact,
             textile, toy, other]   # 触发该锚点的品类；可多个
  features_any: [battery]      # 触发该锚点的硬特征（电池 / 无线 / 市电 / 儿童）
key_articles: [art-1, art-7, art-8]   # 法规库内要抓全文的条款 ID
key_points:
  - "适用范围：所有类电池，含工业与便携式..."
  - "生产者责任：2025 年起须提交电池护照 (battery passport)..."
risk_hint: |
  含电池产品出口欧盟需关注电池护照与回收 EPR 义务。
```

### `applies_if` 三层触发

由 [`rag_service/retrieval/must_check.py:build_anchor_list`](file:///Users/wangjianjun/me/attrax/rag_service/retrieval/must_check.py) 统一处理：

1. **markets**：扫描请求里用户选的目标市场（白名单 16 个，`ALLOWED_MARKETS`）。`UN` 类（仅 `UN-38-3`）始终命中。
2. **category**：视觉识别给出的 10 大品类（规范形式单数，见 `lib/types.ts:PRODUCT_CATEGORIES`；KB anchor 全部用单数）。BFF 层 `ALLOWED_CATEGORIES` 额外容忍复数输入。
3. **features_any**：`FEATURE_KEYWORDS` 在核心特征 + 产品描述里做 substring 命中，命中即追加该特征的全部锚点。

最终列表按 `(doc_name.lower, region)` 去重；与目标市场不符的 region 直接跳过（`UN` 例外）。

> 特征关键词映射（`must_check.py:FEATURE_KEYWORDS`）：电池→`["锂电池", "锂离子", ..., "lithium", "li-ion", ...]`、无线→`["蓝牙", "无线", "wifi", ..., "bluetooth", "wireless", ...]`、市电→`["插电", "市电", ..., "mains", "ac powered", ...]`、儿童→`["儿童", "孩子", ..., "kids", "children", ...]`。**持续运营**：增删关键字需要直接改 Python（不在 YAML），其余都走 YAML。

## 加载与缓存（自失效）

`rag_service/retrieval/kb_loader.py:_load_all`：

- 启动一次完整 YAML 解析，结果存模块级 `_cache: dict[reg_id, payload]`。
- 每次进入点调用 `_library_stamp()` 对 `data/kb/anchors/*.yaml` 做 `glob + stat`，得到 `{path: (mtime_ns, size)}`。
- 当 stamp 变化（即有文件被 watchdog 自动改写）→ 自动重建缓存；不变 → 命中缓存。
- 任何读路径都**不应**主动调 `invalidate_cache()`（文档明确警告：会让 5 分钟一次的 `/ready` 探针触发每次全量重解析，约 288 次/天无效重解析）。

`rag_service/retrieval/article_loader.py` 同形态的缓存，且多一层：

- `_cache_generation` 计数器：仅当真实检测到磁盘文件 stamp 变化时才 tick。
- `verifier.py:_sync_article_cache` 在每次 verify 节点前比对当前 generation；不匹配就清空本地 `(doc_id, article_id) → text` 缓存。
- 用途：watchdog 03:00 自动改 YAML 后，长跑 rag-service 进程也立刻用上新的法条正文，不会继续按旧正文做引用验证。

> 老的 `must_check.py` 在 2026-09-11 spec 落地后只保留特征检测与「KB → must_check 旧形 entry」的 shim；`CATEGORY_REGULATIONS / FEATURE_REGULATIONS` 这两个大 dict 是导入期从 KB YAML 重新算出来的反向兼容字典。

## KB → Pipeline 的数据流

```
User Upload
   ↓
VisionAnalyzer (MiniMax → DeepSeek fallback)
   ↓ vision_result.{category, core_features, observations[]}
must_check.build_anchor_list(category, markets, features)
   ↓ anchors[]
ReportGenerator.generate(...)  ← rag_service/generate/report_generator.py
   ↓ 把锚点的 doc_name / region / key_articles 注入 system prompt
   ↓ LLM 输出 report_package.citations[] + decisionView + riskFindings
quote_matcher.match_citations(...)
   ↓ deterministic 比对 citations[].quote_span + article_text
   ↓ 写入 citations[].match_status: matched | fallback_article_only | unmatched
   ↓ 写入 auditMetadata.verificationMode = "kb_exact_quote"
   ↓ 构建 report_package.evidencePack（去重）
ResultPage 渲染
   ↓ CitationChip 显示「已对照原文 / 仅对照摘要 / 引用错误」三态
   ↓ DocViewer 提供 /api/v1/regulations/{docId}（法规原文）
```

## 用户怎么主动查法规

- 法规更新列表：`GET /api/regulations/updates`（BFF 转发 watchdog 增量）。前端 `app/regulations/page.tsx`。
- 单条法规原文：`GET /api/regulations/[docId]` → RAG `/api/v1/regulations/{doc_id}`（`rag_service/main.py:get_regulation`）。授权 `private_with_summary` 的法规 `articles[]` 故意为空，前端 DocViewer 走「metadata-only」视图。
- 报告内引用：结果页里每个 CitationChip 点击打开 DocViewer，对应文章高亮（`quote_span` 由 `quote_matcher` 提供 `[start, end)`）。

## 关键文件清单

- [`data/regulations/regulations_index.json`](file:///Users/wangjianjun/me/attrax/data/regulations/regulations_index.json)：法规索引，由 `auto_ingest.py` 重建。
- [`data/regulations/{eu,us,cn,uk,au,un}/*.yaml`](file:///Users/wangjianjun/me/attrax/data/regulations)：44 篇法规原文（public 含 articles；private 含 key_points 由 KB 提供）。
- [`data/kb/anchors/*.yaml`](file:///Users/wangjianjun/me/attrax/data/kb/anchors)：44 个 KB 锚点。
- [`rag_service/retrieval/kb_loader.py`](file:///Users/wangjianjun/me/attrax/rag_service/retrieval/kb_loader.py)：KB 加载与查询（自失效缓存）。
- [`rag_service/retrieval/article_loader.py`](file:///Users/wangjianjun/me/attrax/rag_service/retrieval/article_loader.py)：法规原文加载（自失效缓存 + generation tick）。
- [`rag_service/retrieval/must_check.py`](file:///Users/wangjianjun/me/attrax/rag_service/retrieval/must_check.py)：特征检测 + anchor list 拼接。
- [`rag_service/pipeline/nodes/generator.py`](file:///Users/wangjianjun/me/attrax/rag_service/pipeline/nodes/generator.py)：把锚点 + key_points 注入 LLM prompt。
- [`rag_service/verify/quote_matcher.py`](file:///Users/wangjianjun/me/attrax/rag_service/verify/quote_matcher.py)：确定性引用验证 + 高亮 span。

## 常见操作

| 需求 | 做法 |
|---|---|
| 加一篇法规 | 1. 落 `data/regulations/{region}/{id}.yaml`（含 `articles[]` 或留空） 2. 落 `data/kb/anchors/{id}.yaml`（含 `applies_if`、`key_articles`、`key_points`） 3. 加 watchdog 监控源到 `data/regulation_sources/official_sources.json` |
| 加一个触发关键字 | 改 `rag_service/retrieval/must_check.py:FEATURE_KEYWORDS`（代码而非 YAML） |
| 修正法条正文 | 直接覆盖 YAML 文件，长跑进程下次 verify 自动清缓存，无需重启 |
| 把法规状态标为废止 | watchdog 自动判定（Federal Register 中 action 含 "removal/revocation/revoke"）→ `status: repealed`，不再硬删 |
| 校对引用是否真正对齐原文 | 看 `auditMetadata.verificationMode = "kb_exact_quote"` + 每条 citation 的 `match_status` 字段 |