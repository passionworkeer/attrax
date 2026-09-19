# 2026-09-19 attrax-docs 法规目录导入 — 验证证据

本目录保存把 `/Users/wangjianjun/me/attrax-docs` 的地区法规原件目录导入法规库、并把
`/regulations` 页面数据从 61 条扩到 124 条之后的**真实运行记录**，以及对抗性审查
（同日）之后的重跑结果。

## 目录内容

| 文件 | 用途 |
|------|------|
| `verify-regulations-catalog.mjs` | 端到端脚本：打三个 BFF 接口断言条目数/区域数，再用 Playwright 打开 `/regulations` 逐 tab 截图并断言页面数字 |
| `api-summary.json` | 脚本运行时抓下的接口快照（124 条档案的 21 区域分布、14 个领域分布、42 条近期动态的 16 市场分布） |
| `probe-catalog-urls.py` | 重新探测清单里 63 条 `source_url`（`python3 probe-catalog-urls.py ../../../data/regulations/_imports/attrax-docs-2026-09-19.json url-probe-report.txt`，需要 curl） |
| `url-probe-report.txt` | 63 条 `source_url` 的 curl 结果（浏览器 UA、跟随跳转）。**注意它只证明主机可达**，见下 |
| `verify-eu-eli.py` / `eu-eli-report.txt` | 15 条 EUR-Lex 链接的单独复核：按 CELEX 号打 EU Publications Office 的 Cellar 解析端点（303=存在） |
| `mutate-orphan-anchor-test.py` | 变异验证：构造一个「有条款正文但没有任何 KB 锚点」的法规，确认 `test_kb_loader.py` 的新断言真的会失败 |
| `screenshot-archive.png` / `screenshot-updates.png` / `screenshot-sources.png` | 三个 tab 的页面截图（本地 dev:3001） |
| `production-deploy.md` | 生产上线记录：BUILD_ID / commit、数据同步流程、公网核验表、部署后真实扫描冒烟 |

## 怎么复现

```bash
npm run dev -- -p 3001
node docs/evidence/2026-09-19-regulations-catalog-import/verify-regulations-catalog.mjs
rag_service/.venv/bin/python docs/evidence/2026-09-19-regulations-catalog-import/verify-eu-eli.py \
  data/regulations/_imports/attrax-docs-2026-09-19.json \
  docs/evidence/2026-09-19-regulations-catalog-import/eu-eli-report.txt
```

## 实测结果（2026-09-19 对抗性审查后重跑）

- 档案接口：`total=124`、`markets=21`、`withArticles=36`；新区域 VN 6 / ID 5 / MY 3 /
  SG 2 / TH 1 / GCC 1 / GLOBAL 4 条
- 抓取源接口：37 条不变（本次未新增监控源）
- 近期动态接口：`matching=42`（原 30 条编辑卡片 + 12 条区域补充卡片，覆盖 16 个市场）
- 页面：档案 tab 徽标 124、列表渲染 124 张卡片；越南筛选 6 张、卡片带领域标签；
  近期动态 tab 42 张卡片、其中含越南条目的 2 张；新西兰筛选渲染「未找到相关法规」空态
- `verify-eu-eli.py`：15 条 EUR-Lex 全部返回 303（文书存在）

## URL 实测的口径（重要）

curl 直接请求 `eur-lex.europa.eu` 时，有效的 ELI 与编造的 ELI **都返回 202**
（实测 `/eli/reg/2016/679/oj` 与 `/eli/reg/2099/99999/oj` 同为 202），所以
`url-probe-report.txt` 里的 `OK 202` 只说明主机可达。EUR-Lex 的 15 条改用 Cellar
端点按 CELEX 复核，全部返回 303，确属真实文书。

另外 18 条 `source_url` 登记的是官方门户而非条款深链（越南 vanban.chinhphu.vn、
印尼 jdih.setneg.go.id、马来西亚 pdp.gov.my、泰国 mdes.go.th、阿联酋 u.ae、
海湾 gso.org.sa、越南 tcvn.gov.vn、luatvietnam.vn、UL / IEC 官网），点「原文」
到达门户首页；条文以 `doc_files` 登记的本地原件为准。其中 UN R155/R156、
EU-2019-452、AE-LABOR-33-2021 在条目 `note` 里写明了原因。

## 对抗性审查修掉的内容（同日）

- 脚本 `--copy-docs` 在 YAML 已存在时完全不复制原件，使文档承诺的「删掉 `raw/` 后重跑
  同一条命令恢复」失效 → 已拆成「写 YAML」「复制原件」两步，并加回归测试
- 清单字段未 strip 导致 `region: " us "` 在校验通过后于 `run()` 抛未捕获 `KeyError`
  （崩在索引重建之前，留下文件与索引不一致）
- `docs` 路径可用 `../` 越出原件目录；同区域重名原件会被静默覆盖 → 均改为校验期拒绝
- `MY-DATA-SHARING-2025` 的编号 Act 862 → **Act 864**（862 是 2024 年财政法）
- 4 组重复/张冠李戴的原件登记（EU-2019-452、MY-PDPA-2010、两条 GLOBAL 标准）已去重，
  `doc_files` 从 72 条引用收敛到 68 份唯一原件，孤儿副本已删除
- `test_kb_loader.py` 放宽成单向 `anchored ⊆ regulated` 之后补上反向约束：没有锚点的
  法规不得带条款正文（变异验证见 `mutate-orphan-anchor-test.py`）

## 本次没有做的事

- 没有为目录条目建 KB anchor，也没有写条款正文（`articles: []`、`source_kind: unverified`）：
  它们只出现在 `/regulations` 列表，不进入扫描检索与引用流程。
- 没有改 `data/regulation_sources/official_sources.json`：抓取源登记的是 watchdog 每天真实
  巡检的通道，新增未验证的源会谎报巡检覆盖。
- `raw/` 原件（68 份约 46MB）不入版本控制，也不随 tarball 部署（`build-deploy-tarball.sh`
  会删掉 `standalone/data`）；生产机上的法规库用 additive rsync 同步 YAML 与索引，
  原件不复制过去（没有运行时代码读 `doc_files`）。
