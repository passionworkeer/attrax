# 法规数据源审计（2026-09-17）

对 `data/regulation_sources/official_sources.json` 全量注册表做实测审计：
每个源的 `source_url` 都从生产机（aliyun-sz，阿里云深圳）真实抓取一遍，
走各自 collector 的完整代码路径（不是 HEAD 探测）。

**结论：审计前 35 个源里 9 个从未抓取成功过。** 它们在 2026-09-16 上线，
`human_view_status` 手工填的是"浏览器能不能打开"，而 watchdog 实际请求的是
深链端点，返回 403/404，每个 pass 都在失败。所有代码都没发现这件事 ——
失败只写进 `errors.json`，没有告警、没有断言、没人看。

审计后：**37 个源，30 个每次可抓，6 个如实标记为不可追踪，1 个标记为不可达。**

---

## 一、现状盘点

### 1.1 按市场

| 市场 | 源数 | source_type | 可抓取 | 状态 |
|------|-----:|-------------|-------:|------|
| EU | 9 | eu_celex(8) + safety_gate(1) | 8 | Safety Gate API 已下线，标记不可达 |
| US | 8 | ecfr_part(5) + cpsc_recall_api(1) + openfda_recalls(2) | 8 | 全部可抓 |
| CA | 6 | canada_justice_xml(6) | 6 | 全部可抓 |
| UK | 4 | gov_html(4) | 4 | 全部可抓 |
| CN | 2 | gov_html(2) | 0 | 200 但只有 JS 空壳，标记 shell_only |
| NZ | 2 | direct_url(2) | 2 | 全部可抓 |
| JP | 1 | gov_html(1) | 1 | 可抓（已改端点） |
| KR | 1 | gov_html(1) | 0 | JS 空壳，标记 shell_only |
| AE | 1 | gov_html(1) | 0 | JS 空壳，标记 shell_only |
| SA | 1 | gov_html(1) | 0 | JS 空壳，标记 shell_only |
| BR | 1 | gov_html(1) | 1 | 可抓（已改端点） |
| IN | 1 | gov_html(1) | 0 | JS 空壳，标记 shell_only |

### 1.2 唯一域名数

37 个源分布在 **16 个唯一域名** 上：

```
publications.europa.eu          8   EU Cellar RDF（A 级）
laws-lois.justice.gc.ca         6   Canada Justice XML（A 级）
www.ecfr.gov                    5   eCFR（C 级，机器走 federalregister.gov API）
www.gov.uk                      3   GOV.UK 指南页（B 级）
api.fda.gov                     2   OpenFDA 设备/食品召回（A 级，新增）
www.productsafety.govt.nz       2   NZ 强制标准（B 级）
www.samr.gov.cn                 2   CN SAMR（B 级，JS 空壳）
www.saferproducts.gov           1   CPSC 召回 REST（A 级，替代被封的 cpsc.gov RSS）
www.gov.br                      1   BR INMETRO（B 级，可抓）
www.meti.go.jp                  1   JP METI（B 级，可抓）
www.hse.gov.uk                  1   UK HSE SVHC（B 级）
ec.europa.eu                    1   Safety Gate（门户可读，API 已下线）
www.motie.go.kr                 1   KR MOTIE（B 级，JS 空壳）
www.moiat.gov.ae                1   AE MoIAT（B 级，JS 空壳）
www.saso.gov.sa                 1   SA SASO（B 级，JS 空壳）
www.bis.gov.in                  1   IN BIS（B 级，JS 空壳）
```

域名数与审计前同为 16，但构成变了：去掉 `www.cpsc.gov`（403 封禁）和
`www.cnca.gov.cn`（404），加入 `api.fda.gov` 和 `www.saferproducts.gov`。

**一个域名承载多个源是常态**：EU 8 个源同走 Cellar，CA 6 个源同走 Justice
Laws。好处是通道维护一次覆盖多条法规；代价是上游改版时整批一起坏 ——
EU 和 CA 两批目前都是健康的。

### 1.3 权威度分级

| 等级 | 定义 | 源数 | 抓取通道 |
|------|------|-----:|---------|
| **A 一手官方 + 机器可读** | 官方发布的开放 API / RDF / XML，无需密钥、无反爬 | 22 | Cellar RDF(8)、Federal Register API(5)、Canada Justice XML(6)、SaferProducts REST(1)、OpenFDA JSON(2) |
| **B 官方网页** | 政府网站 HTML，需剥离导航壳 | 14 | gov_html(12) / direct_url(2)。其中 6 个实测为 JS 空壳（`shell_only`），实际只有 8 个可抓 |
| **C 有硬阻碍** | 站点封数据中心 IP，或数据 API 已下线 | 1 | Safety Gate（`unreachable`） |

判定依据是**实测**，不是站点类型。例如 eCFR 官方站自身是 Cloudflare 反爬
（C 级），但联邦公报的开放 API 提供同样的法规变更信号（A 级）—— 所以
`source_type` 是 `ecfr_part`，实际通道是 federalregister.gov。

---

## 二、审计前的 9 个失效源（已修复）

生产机 `errors.json` 原样记录（2026-09-16 pass）：

```
us-cpsc-recalls-rss        HTTP 403 Forbidden
eu-safety-gate-alerts      HTTP 404
cn-samr-product-recall     HTTP 404 Not Found
cn-cnca-ccc-updates        HTTP 404 Not Found
jp-meti-pse-list           HTTP 403 Forbidden
kr-motie-kc-safety         HTTP 404 Not Found
ae-moiat-ecas              HTTP 404 Not Found
sa-saso-news               HTTP 404 NOT FOUND
br-inmetro-novidades       HTTP 404 Not Found
```

| 源 | 原 URL | 实测 | 处理 |
|----|--------|------|------|
| `us-cpsc-recalls-rss` | cpsc.gov/Newsroom/RSS/Recalls | 403（Chrome UA / 完整 fallback 头 / curl 全部 403） | **换通道**：SaferProducts.gov RestWebServices JSON，新增 `cpsc_recall_api` collector。同样数据、无密钥、无挑战 |
| `eu-safety-gate-alerts` | ec.europa.eu/safety-gate-alerts/api/v1/notifs/ | 404 | **标记不可达**：见下方调查 |
| `cn-samr-product-recall` | samr.gov.cn/cjcx/zhxx/cxjj/ | 404 | 换到 samr.gov.cn/xw/zj/（200）→ 但正文只有 24 字符，转 **shell_only** |
| `cn-cnca-ccc-updates` | cnca.gov.cn/cmservice/cnca/notice/list.html | 404 | CNCA 职能已并入市场监管总局；换到总局认证监管司页（200）→ 正文 53 字符，转 **shell_only** |
| `jp-meti-pse-list` | meti.go.jp/policy/consumer_appliance/pse/index.html | 403 | 换到 METI 英文消费者政策栏目（200，3577 字符）→ **可抓** |
| `kr-motie-kc-safety` | motie.go.kr/motie/ms/sa/safetyConfirmation/... | 404 | 换到 MOTIE 公告栏目（200）→ 正文 38 字符，转 **shell_only** |
| `ae-moiat-ecas` | moiat.gov.ae/en/services/standardization-and-conformity/ecas | 404 | 换到 moiat.gov.ae/en（200）→ 正文 44 字符，转 **shell_only** |
| `sa-saso-news` | saso.gov.sa/en/news-and-events/news/ | 404 | 换到 saso.gov.sa/en/（200）→ 正文 224 字符，转 **shell_only** |
| `br-inmetro-novidades` | gov.br/inmetro/pt-br/assuntos/noticias | 404 | 换到 gov.br/inmetro/pt-br（200，7288 字符）→ **可抓** |

### 2.1 第二层问题：可达 ≠ 可追踪

修完 URL 之后暴露出更隐蔽的一层：6 个源返回 200，但剥离导航壳后只剩
页面标题或面包屑（24–224 字符）。这些站点用 JavaScript 注入正文，
标准库的 `html.parser` 拿不到内容。

后果比不追踪更糟：摘要**永远不变**，看起来"这个源一直没变化"，
实际是根本没看到内容。

| 源 | 抓到的实际内容 | 字符数 |
|----|--------------|-------:|
| `cn-samr-product-recall` | `总局 你的位置: 首页 > 新闻 > 总局 总局` | 24 |
| `in-bis-crs` | `- Bureau of Indian Standards` | 28 |
| `kr-motie-kc-safety` | `보도·참고자료 < 보도자료 < 알림·뉴스 < 산업통상부` | 38 |
| `ae-moiat-ecas` | `Ministry of Industry and Advanced Technology` | 44 |
| `cn-cnca-ccc-updates` | 页面标题片段 | 53 |
| `sa-saso-news` | 页面标题 + 少量导航 | 224 |

作为对照，真正可抓的 HTML 源在 3.5 KB（JP METI）到 178 KB（NZ）之间，
所以 `check_sources.py` 用 500 字符作分界线，且**只对 HTML 类源生效**
（JSON API 返回少量记录是正常的，误报会训练运维忽略告警）。

这 6 个源标 `fetch_status: "shell_only"`，orchestrator 跳过它们。
**要真正覆盖这 5 个市场（CN/KR/AE/SA/IN），需要引入 JS 渲染**
—— watchdog 目前刻意只用标准库（见 `scripts/watchdog/__init__.py` 的设计说明），
加 Playwright 是一个独立的架构决定，留给运维判断。

### 2.2 Safety Gate：API 已下线

原端点和所有候选替代端点都探测过：

| 端点 | 结果 |
|------|------|
| `/safety-gate-alerts/api/v1/notifs/` | 404 |
| `/safety-gate-alerts/api/v1/notifs` | 404 |
| `/safety-gate-alerts/api/v2/notifs/` | 404 |
| `/safety-gate-alerts/public/api/v1/notifs/` | 404 |
| `/safety-gate-alerts/public/api/notifs/` | 404 |
| `/safety-gate-alerts/public/api/menu/list/`（SPA bundle 里唯一的 API 路径） | 404 |
| `/safety-gate-alerts/screen/api/v1/notifs` | 200 但 `text/html`（SPA 外壳） |
| `/safety-gate-alerts/screen/webReport/api/v1/notifs` | 200 但 `text/html`（SPA 外壳） |

门户 `ec.europa.eu/safety-gate/` 人工可读（200）。数据 API 已无机器可达入口，
标 `fetch_status: "unreachable"`。

---

## 三、被硬封的端点（不作为抓取源）

这些端点从生产机（深圳）实测**即使带完整浏览器请求头也返回 403**，
连人类页面也封 —— 是数据中心 IP 段级别的封禁，UA 轮换救不了。
对应的 collector 已删除，不留在代码里当死代码。

| 目标 | URL | 实测 |
|------|-----|------|
| UK legislation.gov.uk | `/uksi/2024/1234/data.xml`、`/uksi/2024/1234/contents` | 403（无头请求是 202 空 body） |
| AU TGA | `tga.gov.au/news/safety-alerts/recalls/feed` | 403 |
| AU ACCC | `productsafety.gov.au/recalls/feed` | 403 |
| EU Cellar SPARQL | `publications.europa.eu/sparql` → `op.europa.eu/sparql` | Azure WAF JS 挑战 |
| Health Canada 召回门户 | `recalls-rappels.canada.ca/` | 连接超时 |
| govinfo.gov（CFR bulk） | — | JS SPA，标准库抓不到 |

**这不是说这些源没价值**，是说在当前基础设施上抓不到。
如果以后换机房或加代理，这些端点值得重试；重试前先跑
`check_sources.py` 确认，不要凭"浏览器能打开"就加回注册表。

---

## 四、新增源（全部实测可抓）

| 源 id | 通道 | 市场 | 权威度 | 实测 |
|-------|------|------|--------|------|
| `us-cpsc-recalls-api` | SaferProducts.gov RestWebServices JSON | US | A | 200，16784 字符（45 天窗口） |
| `us-fda-device-recalls` | OpenFDA device recall | US | A | 200，30417 字符 |
| `us-fda-food-enforcement` | OpenFDA food enforcement | US | A | 200，1485 字符 |

`us-fda-food-enforcement` 补上了一个空白：`food_contact` 品类此前
**完全没有召回信号**。

### 4.1 新增过程中修掉的三个 bug

这三个都是"看起来能用、实际在骗人"的类型，值得记下来：

1. **没有显式排序**：OpenFDA 默认返回档案库的任意切片。实测 device 端点
   默认返回 2003 年的记录、food 端点返回 2016 年的记录 —— 30 天窗口过滤后
   全部丢弃，摘要为空。空摘要和"真的没有召回"完全无法区分。
   修复：显式 `sort`。

2. **排序字段必须按端点声明**：device 端点没有 `recall_initiation_date` 字段，
   对它排序是 HTTP 500（不是空结果）。device 用 `event_date_initiated`，
   food 用 `recall_initiation_date`。修复：`sort` 作为条目字段声明。

3. **`product_classification` 只存在于 drug/food 形状**：device 端点没有
   风险分级字段，用它检索返回空。`search` 改为可选、默认不过滤。

修复后 `us-fda-device-recalls` 从"359 字符、2003 年的单条记录"变成
"30417 字符、当前召回"。

---

## 五、配套工具

### 5.1 `check_sources.py`（新增）

```bash
PYTHONPATH=. rag_service/.venv/bin/python -m scripts.watchdog.check_sources
```

把每个条目走**真实 collector** 抓一遍（不是 HEAD 探测），所以
"能抓到但解析器拒绝"也会被抓出来。报告 `ok` / `304` / `thin` / `TIME` / `FAIL`，
并主动列出需要处理的源。退出码 0/3/1。

这是本次审计沉淀下来的守卫：改注册表后跑一次，定期对生产跑一次，
就不会再出现 9 个源烂了几个月没人知道的情况。

### 5.2 结构不变量测试

`scripts/watchdog/tests/test_check_sources.py` 里的
`test_shipped_registry_source_types_all_have_collectors` 断言注册表里
每个 `source_type` 都有已注册的 collector。写这条时立刻抓到了两个漏网的：
`canada_justice_xml` 和 `direct_url` 一直默默依赖 `collect_generic` 兜底，
从没被显式注册。现在都注册了，注册表是"有哪些 source_type"的完整答案。

---

## 六、仍然存在的覆盖缺口

| 缺口 | 说明 |
|------|------|
| CN / KR / AE / SA / IN 无有效追踪 | 5 个市场的政府站全是 JS 渲染，需要 headless browser 才能抓 |
| EU 召回信号丢失 | Safety Gate API 下线，无替代 |
| UK 立法正文无源 | legislation.gov.uk 封数据中心 IP；目前只有 4 个 GOV.UK 指南页 |
| AU / CA 召回信号缺失 | TGA / ACCC / Health Canada 均被封；CA 有 6 个司法部法规源但无召回流 |
| DE / FR / IT / SG / MX 无任何源 | 16 个声明市场里这 5 个既无监控源 |
| 库内 44 篇 `source_kind` 为 unverified | 与数据源无关，是法规正文质量问题，见 `2026-09-14-judge-review-and-optimization-plan.md` §4.4 |

---

## 七、复现方法

```bash
# 本地
PYTHONPATH=. rag_service/.venv/bin/python -m scripts.watchdog.check_sources --json

# 生产机（权威结果 —— 可达性随机房变化）
ssh aliyun-sz "cd /opt/attrax && PYTHONPATH=. .venv/bin/python -m scripts.watchdog.check_sources"
```

本次审计的完整实测输出（审计后）：

```
checked 30 source(s): 30 healthy, 0 thin, 0 failed
```

（30 = 37 个条目去掉 6 个 `shell_only` 和 1 个 `unreachable`。）
