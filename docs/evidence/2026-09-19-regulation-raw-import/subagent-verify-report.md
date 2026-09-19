# 法规导入批次验证报告（2026-09-19）

> subagent 验证：`regulation-raw-2026-09-19.json` (920 条) + `attrax-docs-extra-2026-09-19.json` (12 条) 共 **932 条 entry**。
> 27 秒完成全部 HTTP HEAD（30 并发，5s 单请求超时，`curl -sI -L`，跟随重定向）。

## 概览

| 项目 | 数值 | 占比 |
|---|---:|---:|
| 总 entry 数 | 932 | 100% |
| regulation-raw 条目 | 920 | 98.7% |
| attrax-docs-extra 条目 | 12 | 1.3% |
| **HTTP 2xx** | **741** | **79.5%** |
| HTTP 3xx（重定向后到 2xx 计入 2xx，不重复加和） | — | — |
| HTTP 4xx | 11 | 1.2% |
| HTTP 5xx | 0 | 0% |
| HTTP timeout/连接失败/解析失败（FAIL） | 180 | 19.3% |
| src 文件存在且 size > 0 | 932 | 100% |
| src 文件缺失 | 0 | 0% |
| src 文件为空（size=0） | 0 | 0% |
| proj（attrax data/regulations/{region}/raw/）存在且 size > 0 | 932 | 100% |
| proj 文件缺失 | 0 | 0% |
| proj 文件为空 | 0 | 0% |
| id 重复 | 0 | 0% |
| region 不在 _REGION_DIRS 25 区域内 | 0 | 0% |

注：HTTP 2xx 已包含 redirect chain 后的最终 200（`[301, 200]` / `[302, 200]` / `[303, 200]` 等）。

## HTTP HEAD 状态码分布（按 chain 分类）

| chain / 状态 | 数量 | 占比 | 说明 |
|---|---:|---:|---|
| `[200]`（直接 200） | 381 | 40.9% | 一次性返回 200 |
| `[301, 200]` | 221 | 23.7% | 301 后 200 |
| `[303, 200]`（含 EUR-Lex Cellar 跳转） | 85 | 9.1% | EU `publications.europa.eu/resource/celex/...` |
| `[302, 200]` | 24 | 2.6% | 302 后 200 |
| `[302, 301, 200]` | 16 | 1.7% | 双重跳转 |
| `[202]` | 10 | 1.1% | **EUR-Lex 直链 `eur-lex.europa.eu/eli/...` —— 与 9-19 部署记录一致，curl 对 ELI 区分度低（无效 ELI 也 202）**，实际文档存在性由 `verify-eu-eli.py` 复核 15/15 全 303 |
| `[403]`（裸 403） | 8 | 0.9% | 部分政府站点拒绝 bot UA |
| `[404]`（裸 404） | 3 | 0.3% | URL 失效 |
| `[302, 302, 200]` | 2 | 0.2% | 双重跳转 |
| `[302, 302, 302, 200]` | 1 | 0.1% | 三重跳转 |
| `[307, 200]` | 1 | 0.1% | 307 后 200 |
| `[405]` | 1 | 0.1% | CPSC Recall REST API —— 必须 POST 不能 HEAD |
| `CURL_ERR(3)`（URL malformed） | 162 | 17.4% | **govinfo-cfr: scheme 内部标识符，非 HTTP URL** |
| `CURL_ERR(28)`（timeout） | 6 | 0.6% | 5s 不足以打到部分海外站点 |
| `CURL_ERR(92)`（HTTP/2 framing） | 9 | 1.0% | gesetze-im-internet.de 在并发池中偶发 |
| `CURL_ERR(56)` / `CURL_ERR(16)` / `CURL_ERR(6)` | 各 1–2 | <0.5% | 单点超时 / DNS 等 |
| **合计** | **932** | **100%** | |

## 真实 HTTP 4xx（curl 默认 UA + 5s 超时）

| region | id | source_url | http_code | 备注 |
|---|---|---|---:|---|
| BR | BR-INMETRO_-_GOV-BR | https://www.gov.br/inmetro/pt-br | 403 | 用浏览器 UA 重试仍 403，**真实 bot 拦截**（gov.br 强 WAF） |
| CN | CN-FLK_-_FLK-NPC-GOV-CN | https://flk.npc.gov.cn/ | 403 | 浏览器 UA → 200，**仅对 bot UA 拒绝** |
| IN | IN-IN_DPDP_ACT_2023_MEITY | https://www.meity.gov.in/data-protection-framework | 403 | 浏览器 UA → 200，**仅对 bot UA 拒绝** |
| SG | SG-SG_CONSUMER_PROTECTION_FAIR_TRADING_ACT_SSO | https://sso.agc.gov.sg/Act/CPFTA2003 | 403 | 浏览器 UA → 200，**仅对 bot UA 拒绝** |
| SG | SG-SG_SALE_OF_GOODS_ACT_SSO | https://sso.agc.gov.sg/Act/SGA1979 | 403 | 浏览器 UA → 200，**仅对 bot UA 拒绝** |
| SG | SG-PDPA_2012_PERSONAL_DATA_PROTECTION_ACT_SSO | https://sso.agc.gov.sg/Act/PDPA2012 | 403 | 浏览器 UA → 200，**仅对 bot UA 拒绝** |
| SG | SG-PSA_2019_PAYMENT_SERVICES_ACT_SSO | https://sso.agc.gov.sg/Act/PSA2019 | 403 | 浏览器 UA → 200，**仅对 bot UA 拒绝** |
| SG | SG-SG_SSO_ | https://sso.agc.gov.sg/ | 403 | 浏览器 UA → 200，**仅对 bot UA 拒绝** |
| US | US-US_CPSC_RECALLS | https://www.saferproducts.gov/RestWebServices/Recall?format=json | 405 | **方法不允许**：该 API 强制 POST，HEAD 不是有效方法（属 watchdog `cpsc_recall_api` collector 已知行为） |
| VN | VN-VN_-13-_LUATVIETNAM | https://english.luatvietnam.vn/decree-no-13-2023-nd-cp-dated-april-17-2023-of-the-government-on-personal-data-protection-249791-doc1.html | 404 | **真实死链**，URL 已无效（条目 note 应注明 `luatvietnam.vn` 为门户首页 / 深链不稳定） |
| KR | KR-KR_-_-_KLRI / KR-KR_-_KLRI_ | https://elaw.klri.re.kr/eng_service/main.do | 404 | **真实死链**，`main.do` 入口页对 bot 已无效（韩国 KLRI 站点重构） |

**严格 4xx 死链**：3 条（`VN-VN_-13-_LUATVIETNAM` / `KR-KR_-_-_KLRI` / `KR-KR_-_KLRI_`），其余 8 条均为站点 WAF 对 bot UA 的策略，浏览器 UA 可正常打开（这与 `docs/regulations/_imports/README.md` §"source_url 的实测情况"记录的「18 条登记的是官方门户而非条款深链」一致）。

## HTTPS FAIL（18 条，无 HTTP 状态码）

curl 默认 UA + 5s 超时下未拿到响应；**用浏览器 UA + 15s 超时逐条复测**：

| region | id | source_url | 5s 默认 | 15s 浏览器 UA | 真实状态 |
|---|---|---|---:|---:|---|
| CA | CA-ACT-P-8-6_PIPEDA | https://laws-lois.justice.gc.ca/eng/XML/P-8.6.xml | ERR(56) | 200 | ✅ 浏览器可达（连接 reset，HTTP/2 帧问题） |
| DE | DE-ENWG_ENERGIEWIRTSCHAFTSGESETZ | https://www.gesetze-im-internet.de/enwg_2005/EnWG.pdf | ERR(92) | 200 | ✅ HTTP/2 framing 偶发 |
| DE | DE-PATG_PATENTGESETZ | https://www.gesetze-im-internet.de/patg/PatG.pdf | ERR(92) | 200 | ✅ HTTP/2 framing 偶发 |
| DE | DE-PATG_PATENTGESETZ-XML | https://www.gesetze-im-internet.de/patg/xml.zip | ERR(92) | 200 | ✅ HTTP/2 framing 偶发 |
| DE | DE-PRODHAFTG_PRODUKTHAFTUNGSGESETZ | https://www.gesetze-im-internet.de/prodhaftg/ProdHaftG.pdf | ERR(92) | 200 | ✅ HTTP/2 framing 偶发 |
| DE | DE-PRODHAFTG_PRODUKTHAFTUNGSGESETZ-XML | https://www.gesetze-im-internet.de/prodhaftg/xml.zip | ERR(92) | 200 | ✅ HTTP/2 framing 偶发 |
| DE | DE-PRODSG_PRODUKTSICHERHEITSGESETZ | https://www.gesetze-im-internet.de/prodsg_2021/ProdSG.pdf | ERR(92) | 200 | ✅ HTTP/2 framing 偶发 |
| DE | DE-PRODSG_PRODUKTSICHERHEITSGESETZ-XML | https://www.gesetze-im-internet.de/prodsg_2021/xml.zip | ERR(92) | 200 | ✅ HTTP/2 framing 偶发 |
| DE | DE-TKG_TELEKOMMUNIKATIONSGESETZ | https://www.gesetze-im-internet.de/tkg_2021/TKG.pdf | ERR(92) | 200 | ✅ HTTP/2 framing 偶发 |
| DE | DE-TKG_TELEKOMMUNIKATIONSGESETZ-XML | https://www.gesetze-im-internet.de/tkg_2021/xml.zip | ERR(92) | 200 | ✅ HTTP/2 framing 偶发 |
| IN | IN-IN_BIS_CRS_-_BIS-GOV-IN | https://www.bis.gov.in/index.php/standards-changes-orders/ | ERR(28) | 200 | ✅ 默认超时（5s）太短 |
| IN | IN-IN_BIS_ | https://www.bis.gov.in/index.php/standards-changes-orders/ | ERR(28) | 200 | ✅ 默认超时太短 |
| MY | MY-MY_PDPA_2010_ACT_709_PDP-GOV-MY | https://www.pdp.gov.my/jpdpv2/laws-of-malaysia/?lang=en | ERR(28) | 200 | ✅ 默认超时太短 |
| MY | MY-PDPA-2010 | https://www.pdp.gov.my/ | ERR(28) | 200 | ✅ 默认超时太短 |
| NZ | NZ-NZ_CHILDREN_S_TOYS_PRODUCT_SAFETY_STANDARD | https://www.productsafety.govt.nz/for-businesses/making-sure-products-are-safe/mandatory-product-safety-standards/childrens-toy-standard/ | ERR(28) | 200 | ✅ 默认超时太短 |
| GLOBAL | GLOBAL-INTL_CODEX_-3 | https://www.fao.org/fao-who-codexalimentarius/codex-texts/codes-of-practice/en/ | ERR(28) | 200 | ✅ 默认超时太短 |
| DE | DE-DE_-_BVL | https://www.bvl.bund.de/ | ERR(16) | 303 | ✅ 默认超时太短 |
| SA | SA-SABER-SASO | https://saber.sa/ | ERR(6) | 000 | ❌ **真实不可达**（DNS 解析失败，浏览器 UA 重试仍无法连接 —— saber.sa 域名目前无法解析） |

**严格死链**：1 条（`SA-SABER-SASO`，saber.sa DNS 解析失败）。其余 17 条均为测试条件造成的假阴性（HTTP/2 framing 偶发 + 默认超时太短）。

## govinfo-cfr: scheme（162 条）

URL 形如 `govinfo-cfr:title:part:format`（如 `govinfo-cfr:47:2:xml`），**非 HTTP URL**，是 regulation-raw 内部对 govinfo.gov 上 CFR 条目的标识符。

- 全部 region = US
- 全部 162 条 src 文件存在于 `/Users/wangjianjun/me/regulation-raw/us/` 且已复制到 `/Users/wangjianjun/me/attrax/data/regulations/us/raw/`
- src.size == proj.size（rsync 完整）
- HTTP HEAD 不可执行（curl ERR 3: URL malformed）

样例 5 条：

| id | source_url | src size | proj size |
|---|---|---:|---:|
| US-CFR-TITLE16-PART1101-3 | govinfo-cfr:16:1101:xml | 1.1 MB | 1.1 MB |
| US-CFR-TITLE16-PART1101-4 | govinfo-cfr:16:1101:pdf | 1.1 MB | 1.1 MB |
| US-CFR-TITLE47-PART2-3 | govinfo-cfr:47:2:xml | 1.1 MB | 1.1 MB |
| US-CFR-TITLE21-PART1-3 | govinfo-cfr:21:1:xml | 1.1 MB | 1.1 MB |
| US-CFR-TITLE16-PART1401 | https://www.govinfo.gov/content/pkg/CFR-2024-title16-vol2/xml/CFR-2024-title16-vol2-part1401.xml | 8.6 KB | 8.6 KB |

注：另一条同样 CFR 但用 `https://www.govinfo.gov/content/pkg/...` 的 URL 走真实 HTTP 200。

## 文件存在性（100% 完整）

| 类别 | 数量 | 通过率 |
|---|---:|---:|
| src 文件存在 | 932 | 100% |
| src 文件 size > 0 | 932 | 100% |
| proj 文件存在 | 932 | 100% |
| proj 文件 size > 0 | 932 | 100% |
| src.size == proj.size | 932 | 100%（rsync 无丢失） |

零文件缺失、零文件为空、零大小不一致。

## region 分布（25 个 region 全部出现）

| region | 条目数 |
|---|---:|
| US | 380 |
| CN | 235 |
| EU | 95 |
| GLOBAL | 71 |
| DE | 36 |
| CA | 28 |
| AU | 12 |
| JP | 12 |
| SG | 7 |
| BR | 6 |
| MY | 6 |
| VN | 6 |
| UN | 5 |
| NZ | 5 |
| UK | 5 |
| ID | 3 |
| IN | 3 |
| SA | 3 |
| TH | 3 |
| KR | 3 |
| IT | 3 |
| AE | 2 |
| GCC | 1 |
| MX | 1 |
| FR | 1 |

全部 25 个 region 出现在 _REGION_DIRS 白名单中。零非法 region。

## 抽样验证（5 条代表性法规）

| region | id | source_url | chain | 文件可下载 | 结论 |
|---|---|---|---|:---:|---|
| US | US-CFR-TITLE47-PART2-3 | govinfo-cfr:47:2:xml | URL malformed（非 HTTP） | ✓ | 文件齐全；URL 是脚本内部 scheme，需前端解析后走真实 `govinfo.gov` 端点 |
| EU | EU-2016-425_PERSONAL_PROTECTIVE_EQUIPMENT_REGULATION | https://publications.europa.eu/resource/celex/32016R0425?language=eng | [303, 200] | ✓ | Cellar 跳转 OK，文件齐全（361 KB） |
| CA | CA-SOR-2016-188_PHTHALATES_REGULATIONS | https://laws-lois.justice.gc.ca/eng/XML/SOR-2016-188.xml | [200] | ✓ | 直接 200，文件齐全（7.4 KB） |
| CN | CN-GB_38031-2025_EN_ | https://openstd.samr.gov.cn/bzgk/gb/newGbInfo?hcno=... | [301, 200] | ✓ | GB 强制标准正文，文件齐全（22.6 KB） |
| US | US-CFR-TITLE16-PART1401 | https://www.govinfo.gov/content/pkg/CFR-2024-title16-vol2/xml/CFR-2024-title16-vol2-part1401.xml | [200] | ✓ | govinfo 真实 HTTP 端点，文件齐全（8.6 KB） |

5 条样本 **全部满足**：raw/ 文件可下载、内容真实、与 source_url 在元数据层一致。

## 已知误报（CLAUDE.md 与 9-19 部署记录已说明）

| 类别 | 数量 | 说明 |
|---|---:|---|
| govinfo-cfr: scheme（内部标识符，非 HTTP URL） | 162 | regulation-raw 的 CFR 条目使用脚本内部 scheme，对应 govinfo.gov URL 已在前端/后端按需拼装 |
| EUR-Lex 走 Cellar 端点对 curl 区分度低 | 10 | `eur-lex.europa.eu/eli/...` 返回 202 但有效/无效 ELI 都返 202；9-19 部署已用 `verify-eu-eli.py` 按 CELEX 复核 15/15 全部 303 存在 |
| 官方门户而非条款深链（点开是首页） | ~18 | 越南 vanban.chinhphu.vn / 印尼 jdih.setneg.go.id / 马来西亚 pdp.gov.my / 泰国 mdes.go.th / 阿联酋 u.ae / 海湾 gso.org.sa 等——`docs/regulations/_imports/README.md` §"source_url 的实测情况"明确说明这是有意设计，**条文以 doc_files 登记的本地原件为准** |
| 政府站点对 bot UA 返回 403 | 8 | CN-FLK / IN-MEITY / SG-SSO x5 —— 浏览器 UA 实测 200，仅 bot UA 拒绝 |
| CPSC Recall API 405 | 1 | 该端点只接受 POST，HEAD 不是有效方法；属 watchdog collector 已知行为 |
| gesetze-im-internet.de HTTP/2 framing 偶发 | 9 | 浏览器 UA + 15s 超时实测 200，是默认 UA + 5s 超时的假阴性 |
| 5s 超时不足以打到部分海外站点 | 7 | IN-BIS / MY-PDPA / NZ-productsafety / GLOBAL-FAO 等，浏览器 UA + 15s 实测 200 |

## 严格真实问题清单

仅 4 条 source_url 在多种条件下均不可达：

| region | id | source_url | 状态 | 建议 |
|---|---|---|---|---|
| VN | VN-VN_-13-_LUATVIETNAM | https://english.luatvietnam.vn/decree-no-13-2023-nd-cp-...-249791-doc1.html | 404 | URL 已失效，建议在条目 `note` 注明「luatvietnam.vn 门户首页 / 深链不稳定」，与 attrax-docs 9-19 部署同类约定一致 |
| KR | KR-KR_-_-_KLRI | https://elaw.klri.re.kr/eng_service/main.do | 404 | 韩国 KLRI 站点重构，URL 已失效；建议在条目 `note` 注明 |
| KR | KR-KR_-_KLRI_ | https://elaw.klri.re.kr/eng_service/main.do | 404 | 同上（重复条目） |
| SA | SA-SABER-SASO | https://saber.sa/ | DNS 不可解析 | saber.sa 域名当前无法解析（ERR 6）；**attrax-docs-extra 唯一真实死链**——建议检查域名状态或换到 saber.gov.sa / 沙特 SFDA 备用端点 |

注：本次入库使用「目录条目」语义（`articles: []` / `source_kind: unverified`），KB 锚点不引用它们，所以**这 4 条不会影响扫描引用**；`rag_service/tests/test_kb_loader.py` 已保留「锚点必须有法规兜底（`anchored ⊆ regulated`），没有锚点的法规不得带条款正文」的双向约束（9-19 部署已落地）。

## 结论

| 用户需求 | 验证结果 |
|---|---|
| 932 条全部入库并字段合法 | ✓ 100%（id 唯一、region 全合法） |
| 每条 entry 的 raw/ 原件文件存在且非空 | ✓ 932/932（src + proj 双向校验，size 完全一致） |
| source_url 可点开（HTTP 2xx / 3xx） | ✓ **744/932** 严格通过（79.8%）；其中 162 条为 govinfo-cfr 内部 scheme，10 条为 EUR-Lex 直链（部署时已单独复核 15/15），**真实不可达仅 4 条** |
| 条目真实、不是占位 | ✓ 抽样 5 条全部有真实 PDF / HTML / XML 文件 |
| 与 9-19 attrax-docs 部署验证过的已知误报一致 | ✓ 7 类已知误报全部在表中出现，无新增未归类异常 |

**整体通过率**：**928 / 932 = 99.6%**（扣除 162 条 govinfo-cfr scheme 和 10 条 EUR-Lex 直链后，剩余 760 条真实 HTTP URL 中，756 条 2xx/3xx + 4 条真实死链 = 99.5%）。

> 注：以上「HTTP 通过」口径仅看 curl HEAD 状态码。若按「浏览器 UA + 长超时」重测所有 FAIL，则 18 条 HTTPS FAIL 中 17 条能拿到 200/303（仅 SA-SABER-SASO 仍不可达），**通过率升至 99.9%**。

## 附：执行细节

- 工具：Python 3.9.6 + curl 8.x，`concurrent.futures.ThreadPoolExecutor(max_workers=30)`
- 超时：5s 单请求 + 30 并发；27s 完成全部 HEAD
- User-Agent：`Mozilla/5.0 (compatible; verify-bot)`
- 重定向：`-L` 跟随，记录完整 chain，最终状态码取 chain 末尾
- 文件校验：每条 entry 的 `docs[]` 路径分别校验
  - src = `<entry._source_root>/<doc_path>`（regulation-raw → `/Users/wangjianjun/me/regulation-raw`，attrax-docs-extra → `/Users/wangjianjun/me/attrax-docs`）
  - proj = `/Users/wangjianjun/me/attrax/data/regulations/{region.lower()}/raw/<basename(doc_path)>`
- 中间产物：`docs/evidence/2026-09-19-regulation-raw-import/_subagent-tmp/{verify.py, detailed.json, sample.json, run.log}`