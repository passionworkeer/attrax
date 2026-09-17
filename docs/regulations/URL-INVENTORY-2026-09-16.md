# attrax 法规 URL 现状快照（2026-09-16）

> ⚠️ **本文件是历史快照，其中的 URL 与状态已被 2026-09-17 实测推翻。**
> 当时列出的 `human_view_status` 是手工填写的"浏览器能不能打开"，
> 与实际抓取能力无关：这批源里有 9 个 `source_url` 返回 403/404、
> 从未抓取成功过。当前状态见
> [`SOURCE-AUDIT-2026-09-17.md`](SOURCE-AUDIT-2026-09-17.md)
> 与 `data/regulation_sources/official_sources.json` 本身。

> 配套：`data/regulation_sources/official_sources.json`（35 个 cron 监控源）。
> 来源审计：把"机器抓端点"和"人类可读端点"显式分开，标注每个源的实际可读性。

## 总览

| 状态 | 数量 | 含义 |
|---|---|---|
| `ok` | 29 | 真实人类浏览器可读（含 EU 7 + CA 6 + UK 4 + NZ 2 + 新 10 区域） |
| `anti_bot` | 5 | US 5 个 eCFR 整站 Cloudflare 反爬，real Chrome 多数能过；watchdog 走 federalregister API 替代 |
| `waf_challenge_temporary` | 1 | EU 2023/988 GPSR：EUR-Lex 整站 AWS WAF 挑战，gpsr 偶发 WAF 慢/卡 |

35 个源覆盖 **16 个市场** × **7 种 source_type**：

| 市场 | 源数 | source_types |
|---|---|---|
| EU | 9 | eu_celex (8) + safety_gate (1) |
| US | 6 | ecfr_part (5) + cpsc_rss (1) |
| CA | 6 | canada_justice_xml |
| UK | 4 | gov_html |
| NZ | 2 | direct_url |
| CN | 2 | gov_html |
| JP | 1 | gov_html |
| KR | 1 | gov_html |
| AE | 1 | gov_html |
| SA | 1 | gov_html |
| BR | 1 | gov_html |
| IN | 1 | gov_html |

## source_type 抓取通道

| source_type | 抓取通道 | 落盘后缀 | 实际数据 |
|---|---|---|---|
| `eu_celex` | Cellar 内容协商：`Accept: application/rdf+xml` 信任路径（绕过 WAF） | `.rdf` | EU 法规 RDF + XHTML |
| `ecfr_part` | eCFR API（实际 406）→ fallback federalregister.gov 开放 API | `.json` | 美国联邦法规 JSON |
| `cpsc_rss` | CPSC Newsroom RSS feed | (无 raw file) | 召回事件信号流 |
| `canada_justice_xml` | Justice Laws XML 端点 | `.xml` | CA SOR/DORS 法规 |
| `gov_html` | 各国监管机构 HTML 页面 | `.html` | UK/CN/JP/KR/AE/SA/BR/IN GOV.UK/METI/MOTIE 等 |
| `direct_url` | 任意指定 URL | `.html` | NZ Product Safety |
| `safety_gate` | EU Safety Gate JSON API（`/api/v1/notifs/?format=json&language=en`） | `.xml` | EU 危险产品预警信号流 |

## 25 个原 cron 监控源 + 10 个新 gov_html 扩展

### EU 8 个（eu_celex，cron 抓 Cellar RDF）

| id | 监控 URL | human_view_url | status |
|---|---|---|---|
| `eu-2023-988-general-product-safety` | `https://publications.europa.eu/resource/celex/32023R0988` | `https://eur-lex.europa.eu/eli/reg/2023/988/oj` | waf_challenge_temporary |
| `eu-2009-48-toy-safety` | `https://publications.europa.eu/resource/celex/32009L0048` | `https://eur-lex.europa.eu/eli/dir/2009/48/oj` | ok |
| `eu-2011-65-rohs` | `https://publications.europa.eu/resource/celex/32011L0065` | `https://eur-lex.europa.eu/eli/dir/2011/65/oj` | ok |
| `eu-2012-19-weee` | `https://publications.europa.eu/resource/celex/32012L0019` | `https://eur-lex.europa.eu/eli/dir/2012/19/oj` | ok |
| `eu-2014-53-radio-equipment` | `https://publications.europa.eu/resource/celex/32014L0053` | `https://eur-lex.europa.eu/eli/dir/2014/53/oj` | ok |
| `eu-2014-30-emc` | `https://publications.europa.eu/resource/celex/32014L0030` | `https://eur-lex.europa.eu/eli/dir/2014/30/oj` | ok |
| `eu-2014-35-low-voltage` | `https://publications.europa.eu/resource/celex/32014L0035` | `https://eur-lex.europa.eu/eli/dir/2014/35/oj` | ok |
| `eu-2019-1020-market-surveillance` | `https://publications.europa.eu/resource/celex/32019R1020` | `https://eur-lex.europa.eu/eli/reg/2019/1020/oj` | ok |

**EUR-Lex 整站 AWS WAF**：所有 EU ELI 端点都过 CloudFront WAF challenge，真实 Chrome 多数能过（gpsr 偶发 WAF 临时慢/卡）。

### US 5 个（ecfr_part，watchdog 走 federalregister API）

| id | 监控 URL | human_view_url | status |
|---|---|---|---|
| `us-16-cfr-1307-phthalates` | `https://www.ecfr.gov/current/title-16/part-1307` | 同 | anti_bot |
| `us-16-cfr-1630-carpets-rugs` | `https://www.ecfr.gov/current/title-16/part-1630` | 同 | anti_bot |
| `us-16-cfr-1631-small-carpets-rugs` | `https://www.ecfr.gov/current/title-16/part-1631` | 同 | anti_bot |
| `us-16-cfr-1633-mattresses-open-flame` | `https://www.ecfr.gov/current/title-16/part-1633` | 同 | anti_bot |
| `us-16-cfr-1700-poison-prevention-packaging` | `https://www.ecfr.gov/current/title-16/part-1700` | 同 | anti_bot |

**eCFR 整站反爬**：Cloudflare 拦自动化爬虫（HTTP 200 但 body 是"Request Access"挑战页）。Real Chrome 多数能过；备选 GPO govinfo（JS SPA，渲染后才能看）。

### CA 6 个（canada_justice_xml）

`source_url` = `https://laws-lois.justice.gc.ca/eng/XML/SOR-XXX.xml`（机器抓 XML）
`human_view_url` = `https://laws-lois.justice.gc.ca/eng/regulations/SOR-XXX/`（去 `.xml` 加 `/`，人类 HTML 端点 16-22KB）

| id | human_view_url |
|---|---|
| `ca-consumer-chemicals-containers-regulations-2001` | `https://laws-lois.justice.gc.ca/eng/regulations/SOR-2001-269/` |
| `ca-surface-coating-materials-regulations` | `https://laws-lois.justice.gc.ca/eng/regulations/SOR-2016-193/` |
| `ca-phthalates-regulations` | `https://laws-lois.justice.gc.ca/eng/regulations/SOR-2016-188/` |
| `ca-childrens-sleepwear-regulations` | `https://laws-lois.justice.gc.ca/eng/regulations/SOR-2016-169/` |
| `ca-consumer-products-containing-lead-regulations` | `https://laws-lois.justice.gc.ca/eng/regulations/SOR-2018-83/` |
| `ca-corded-window-coverings-regulations` | `https://laws-lois.justice.gc.ca/eng/regulations/SOR-2019-97/` |

**CA 抓取特殊性**：`auto_ingest.py` 写死 `canada_justice_xml → .xml` 后缀，所以 `source_url` 必须保留 `.xml` 端点；人类跳转走 HTML 端点（去 `.xml` 加 `/`）。

### UK 4 个（gov_html）

| id | URL |
|---|---|
| `uk-weee-regulations-guidance` | `https://www.gov.uk/guidance/regulations-waste-electrical-and-electronic-equipment` |
| `uk-packaging-epr-who-is-affected` | `https://www.gov.uk/guidance/extended-producer-responsibility-for-packaging-who-is-affected-and-what-to-do` |
| `uk-reach-compliance-guidance` | `https://www.gov.uk/guidance/how-to-comply-with-reach-chemical-regulations` |
| `uk-hse-svhc-overview` | `https://www.hse.gov.uk/REACH/svhc-overview.htm` |

### NZ 2 个（direct_url）

| id | URL |
|---|---|
| `nz-product-safety-standards-2005` | `https://www.productsafety.govt.nz/for-businesses/making-sure-products-are-safe/mandatory-product-safety-standards/childrens-toy-standard/` |
| `nz-product-safety-standards-household-cots-2016` | `https://www.productsafety.govt.nz/for-businesses/making-sure-products-are-safe/mandatory-product-safety-standards/household-cot-standard` |

### EU 1 个（safety_gate，信号流）

| id | source URL | human_view_url |
|---|---|---|
| `eu-safety-gate-alerts` | `https://ec.europa.eu/safety-gate-alerts/api/v1/notifs/?format=json&language=en` | `https://ec.europa.eu/consumers/consumers_safety/safety_products/rapex/alerts/` |

### US 1 个（cpsc_rss，信号流）

| id | source URL | human_view_url |
|---|---|---|
| `us-cpsc-recalls-rss` | `https://www.cpsc.gov/Newsroom/RSS/Recalls` | `https://www.cpsc.gov/Recalls` |

### 10 个新 gov_html 扩展（东南亚/中东/拉美/南亚）

| id | 监控 URL | status |
|---|---|---|
| `cn-samr-product-recall` | `https://www.samr.gov.cn/` | anti_bot |
| `cn-cnca-ccc-updates` | `https://www.samr.gov.cn/cnca/` | anti_bot |
| `jp-meti-pse-list` | `https://www.meti.go.jp/policy/consumer/apc/` | ok |
| `kr-motie-kc-safety` | `https://www.motie.go.kr/` | ok |
| `ae-moiat-ecas` | `https://www.moiat.gov.ae/` | ok |
| `sa-saso-news` | `https://www.saso.gov.sa/` | ok |
| `br-inmetro-novidades` | `https://www.gov.br/inmetro/` | ok |
| `in-bis-crs` | `https://www.bis.gov.in/` | ok |

CN samr.gov.cn 整站反爬（curl 404 + 浏览器 JS 信任能过）；其他 gov_html 是直 HTML 端点。

## 数据治理（2026-09-16）

### 法规库 source_kind 治理（CLAUDE.md J08 / §4.4 layer 3）

`data/regulations/*/*.yaml` 共 44 篇，按 article text 真实可对照状态分：

| 状态 | 数量 | 含义 |
|---|---|---|
| `source_kind: unverified` | 22 | 假原文（多 article 同一段 KB 浓缩占位）/ 未对照原文；quote_matcher 拒收 verbatim |
| `<MISSING>` 字段 | 22 | 11 私有标准（GB/UL/ASTM 无原文）+ 11 标空或留待 A 路填实；quote_matcher 按 unverified 处理（缺席 metadata = 不可信） |
| `official_verbatim` | 0 | 真实逐字原文；待 A 路填实 |
| `official_summary` | 0 | 官方摘要；待 A 路填实 |
| `curated_summary` | 0 | 内部 KB 摘要；待 A 路填实 |

**20 篇假原文** 全部已标 `source_kind: unverified`（2026-09-16 治理），quote_matcher 验证：23/23 测试通过，引用走 KB `key_points` 通路不假装是原文逐字。

### watchdog 治理

- 12 个 `gov_html` 源的 raw file 1 个 = 100% 抓
- 35 源 `human_view_url` / `human_view_status` metadata 覆盖 100%
- 新 collectors：`gov_html.py`、`safety_gate.py`、`us_cpsc.py`、扩 `us_ecfr.py` / `eu.py`
- WAF UA rotation：`fetch_url` 自动 retry 切 fallback UA + Sec-Fetch headers（gov.uk / gov.au 等偶发 WAF 挑战时救命）
- 19 region dirs 覆盖：EU/US/UK/CN/AU/UN + CA/NZ/JP/KR/SA/AE/BR/IN/SG/MX/DE/FR/IT

## 相关源文件

- `data/regulation_sources/official_sources.json` — 35 源权威注册表
- `data/regulations/*/*.yaml` — 44 篇法规 YAML
- `data/kb/anchors/*.yaml` — 44 个 KB 锚点
- `data/regulation_supplements/2026-05-26_registry_official_sources/raw/` — 33 个原文 rdf/xml/html
- `data/regulation_supplements/auto-{date}/{source_id}/` — watchdog 每日抓取证据
- `scripts/watchdog/` — orchestrator + collectors + auto_ingest
- `app/api/regulations/updates/watchdog-source.ts` — 前端 live watchdog 接入
