# 法规库全量校验 + 死链修复（2026-09-19）

> 对本地（1049 条）与生产服务器 aliyun-sz（1052 条）法规库做全量真实性校验，修复全部 15 条不可达 source_url。
> 修复后本地 1048 条（KR 去重 -1），全部 source_url 真实、有来源、可打开（或经外部网络确认站点反爬而非死链）。

## 一、校验结果（修复前）

### 本地文件完整性

| 维度 | 结果 |
|---|---|
| YAML 存在 + 可解析 + id 与文件名一致 + region 合法 + id 唯一 | 1049 / 1049（100%） |
| raw 文件 size 一致（src vs proj，双方存在时） | 999 / 999（100%） |
| 无 source_url 的 11 条 | 均为 `private_with_summary` 私有标准（purchase_url 已登记），非缺陷 |

### source_url HTTP 可达性（876 条真实 URL，60 并发，4 轮 fallback，38s）

| 轮次 | 数量 | 说明 |
|---|---:|---|
| R1：curl 默认 UA HEAD 直通 | 787 | |
| R2：浏览器 UA 救回 | 51 | 站点对 bot UA 拒绝 |
| R3：GET / HTTP/1.1 救回 | 18 | 含 gesetze-im-internet HTTP/2 framing |
| R4：HEAD 变体救回 | 5 | |
| **DEAD（4 轮仍不可达）** | **15** | 见修复记录 |
| SKIP：非 HTTP URL | 173 | 162 条 govinfo-cfr 内部 scheme + 11 条无 URL |

### 内容真实性抽样（30 条 = 20 随机 + 5 EUR-Lex + 5 govinfo-cfr）

YAML 可解析 / id 一致 / article_count 一致 / region 合法：30 / 30。raw 文件存在且首字节为有效内容（XML / PDF / HTML）：25 / 25（其余 5 条为目录元数据条目，无 raw 属预期）。govinfo-cfr 5 条全部命中真实 CFR 文件。

### 服务器对账（aliyun-sz）

见 `server-diff/diff-report.md`。要点：服务器 1052 条 = 本地 1049 + 3 条 watchdog 自动入库（UK-Packaging-EPR / UK-REACH / UK-WEEE）；本地独有 0；md5 抽样 70 条不一致 0；raw 计数 24 region 完全一致；零字节 0；watchdog 进程运行中；生产 API 200。

## 二、15 条 DEAD 逐条修复记录

修复原则：先实测候选 URL 再改（不盲改）；换 URL 仅限确认新 URL 200 或经外部网络确认页面真实存在；站点反爬（WAF / bot challenge）不是死链，保留 URL + note 说明；`last_verified` 统一推进到 2026-09-19。

### A. 换 URL（8 条，新 URL 全部实测 200；KLRI 误判修正后保留原 URL，见对抗审核）

| id | 旧 URL | 新 URL | 验证依据 |
|---|---|---|---|
| CN-CCC | samr.gov.cn/cnca/（404） | `https://www.samr.gov.cn/` | curl 200；CNCA 并入 SAMR 主站 |
| CN-CCC-IT | 同上 | `https://www.samr.gov.cn/` | 同上；与 CN-CCC 是不同法规共用门户 |
| CN-CSAR | gov.cn/zhengce/...content_5524019.htm（404，邻近 ID 全 404） | `https://www.gov.cn/gongbao/content/2020/content_5525087.htm` | curl 200；国务院公报 2020 年第 19 号，国务院令 727 号权威原文 |
| KR-KLRI-ELAW（合并自 KR-KR_-_-_KLRI + KR-KR_-_KLRI_） | 首轮 HEAD 判死（该站 HEAD 恒 404）——**对抗审核复核 GET 200（165KB 英文门户 "Statutes of the Republic of Korea"），误判修正，保留原 URL** `https://elaw.klri.re.kr/eng_service/main.do`；eng_service 下其余路径（index.do 等）确已失效 | 两轮实测：HEAD 404 / GET 200 |
| KR-MOTIE-KC | motie.go.kr/motie/ms/sa/safetyConfirmation/...（404） | `https://www.motie.go.kr/` | curl 200 |
| UK-UKCA-Appliance | gov.uk/government/publications/appliances-regulations-2016（404） | `https://www.gov.uk/guidance/using-the-ukca-marking` | curl 200；UKCA 官方指南页 |
| AE-MoIAT-ECAS | moiat.gov.ae/en/services/standardization-and-conformity/ecas（子路径 404） | `https://moiat.gov.ae/en/services` | curl 200 |
| SA-SASO-Saber | saso.gov.sa/en/news-and-events/news/（子路径 404） | `https://www.saso.gov.sa/en/` | curl 200 |
| BR-INMETRO | gov.br/inmetro/pt-br/assuntos/noticias（已下线；gov.br 全站对 curl 403） | `https://www.gov.br/inmetro/pt-br` | WebFetch 外部网络确认官方首页（标题 Instituto Nacional de Metrologia...） |

### B. 保留 URL + note（6 条，站点反爬/网络层，URL 本身有效）

| id | 现象 | 处理 |
|---|---|---|
| US-CPSC-General | URL 拼写错误 "Statues"（雕像）→ "Statutes"（法规）；cpsc.gov 对 curl 全 403（Akamai） | **修 typo** 为 `.../Statutes`；WebFetch 外部网络确认页面真实（"Statutes \| CPSC.gov"，含 CPSA/CPSIA/FHSA 等全部法规列表）+ note |
| JP-METI-PSE | METI bot 缓解，默认 curl 无响应 | URL 保留（METI 官方 PSE 页）；完整浏览器请求头实测 202 + note |
| UN-38-3 | unece.org Cloudflare bot challenge（本地 + 数据中心 fetch 均 403） | URL 保留（UN Manual 权威页）+ note |
| AU-RCM | acma.gov.au（Akamai）对自动化探测不响应（本地 + 数据中心超时） | URL 保留（ACMA 官方 RCM 页）+ note；搜索引擎缓存显示 RCM 指南 2025-03 仍更新 |
| SA-SABER-SASO | 本机 DNS 对 saber.sa 无解析 | URL 保留；WebFetch 外部网络实测打开 SABER 官方平台（SASO 监管、DGA 注册号 20250414462）+ note 说明属本地解析器问题 |
| KR-KR_-_LAW-GO-KR | 未在 DEAD 清单（law.go.kr 快照正常） | 未改动 |

### C. 重复登记去重（1 组执行，2 组评估保留）

- **KR-KR_-_-_KLRI + KR-KR_-_KLRI_**（"国家法令信息中心 英文"同物异名，各带一份 **md5 完全相同**（256e5e2e…）的门户快照）→ 合并为 `KR-KLRI-ELAW`（干净 id，doc_files 保留一份，删除重复 raw）。合并前 grep 确认无任何代码 / KB 锚点引用旧 id。
- **CN-CCC + CN-CCC-IT**：评估为**不同法规**（CCC 总目录 vs 信息技术设备实施规则，articles 内容不同），保留两条，note 互相说明共用 SAMR 门户。
- **部分政府门户 R2 救回条目**：URL 相同但法规不同，属正常共用官方门户，不动。

## 三、修复后验证

| 检查 | 结果 |
|---|---|
| 本地索引重建（`AutoIngestor._rebuild_index()`） | count **1048**（1049 − 1 去重） |
| 修复条目 source_url 逐条核对 | 全部为新 URL / 修正后 URL |
| 旧 id KR-KR_-_-_KLRI / KR-KR_-_KLRI_ | 已从索引移除 |
| `pytest rag_service/tests/test_kb_loader.py`（锚点 ⊆ 法规等库不变量） | **26 passed** |
| `pytest scripts/watchdog/tests/test_import_regulation_docs.py` | **15 passed** |

修复后口径：**876 条真实 URL 中 0 条死链**——861 条 HTTP 实测可达 + 15 条已处理（8 换 URL 实测 200 / 1 误判修正保留原 URL（GET 200）/ 6 确认站点反爬保留原 URL）。

## 三·五、对抗审核（提交前执行）

独立 subagent 对本批次做对抗性审查（先验证后报告，产物在 `verify-artifacts/review/`：check_yaml.py / check_index.py / server-ids.txt / klri-eng-main.html）。结论：YAML 语法 1048/1048、索引全量对账零不一致、diff 严格限于 source_url/last_verified/notes、9 条旧 URL 的"404"声称 7/8 GET 复核属实、服务器 15 文件 md5 一致、报告数字全部吻合。**抓出并已修正的问题**：

1. **KR-KLRI 误判（必修，已修）**：`elaw.klri.re.kr/eng_service/main.do` 首轮被 HEAD 判死，实际该站 HEAD 恒 404 / GET 200（英文门户正文 165KB）。根因是 verify.py 的 R1/R2/R4 轮全用 HEAD + R3 GET 轮 15s 超时。已把 KR-KLRI-ELAW 的 source_url 改回原深链并修正 note（去重合并本身保留——两份 raw md5 相同是实证）。首轮推荐的根域 `elaw.klri.re.kr/` 实为 673B JS 跳转壳（跳韩文站），劣于原链。
2. **KB 锚点漏改（建议，已同批修）**：`data/kb/anchors/` 下 10 个锚点文件的 source_url 仍携旧死链（审核确认锚点 source_url 无任何运行时消费者——kb_loader/must_check/article_loader/前端 evidence-pack 均不读它——但按"消灭死链"目标同步修齐）：CN-CCC-electronics / CN-CCC-IT-3c / CN-CSAR-cosmetic / KR-MOTIE-KC-electronics / UK-UKCA-Appliance-appliance / AE-MoIAT-ECAS-electronics / SA-SASO-Saber-electronics / BR-INMETRO-electronics 同步换新 URL；US-CPSC-General-home 修 Statues→Statutes；US-CPSIA-toy 修 Statues/Childrens-Products→Statutes/Childrens-Products。
3. **服务器孤儿 raw（部署时清理）**：服务器 `kr/raw/KR_国家法令信息中心_KLRI_英文.html`（与保留份 md5 相同的重复快照）——gitignore 域，无引用无风险，部署时顺手 rm。
4. **导入重跑注意（记录）**：`_imports/regulation-raw-2026-09-19.json` 清单仍含两条旧 KR entry；重跑 `import_regulation_docs.py --copy-docs` 会因目标文件不存在走 created 路径复活它们（带旧 URL）。清单是导入输入的历史快照不篡改；如需重跑导入，人工跳过这两条。

审核后复验：索引重建 count 1048（KR-KLRI-ELAW → main.do）、kb_loader + import 回归 **41 passed**、全库 grep 旧 URL 残留仅剩合法豁免（notes 变更记录 / raw 网页快照 / _imports 清单快照 / watchdog 源修复历史叙述）。

## 四、产物

- `verify-artifacts/`：verify.py（校验脚本，可重用）、detailed.json（1049 条逐条结果）、sample.json（30 条抽样）、summary.json、run.log、verify-server-index.py（服务器索引核对脚本）、review/（对抗审查脚本与证据：check_yaml.py / check_index.py / server-ids.txt / klri-eng-main.html——旧 URL GET 200 的原始证据）
- `server-diff/`：服务器对账全套（diff-report.md 为主报告）

> 注：subagent 初次把产物写到了 `.next/standalone/docs/...` 构建副本下，已挪回本目录并清理。
