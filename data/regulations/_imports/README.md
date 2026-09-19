# 法规目录导入清单（attrax-docs）

`/regulations` 页面的「法规档案」列表由 `data/regulations/{region}/*.yaml` 汇总成
`regulations_index.json` 提供。除了扫描用的锚定法规（带 `articles`、被 KB anchor 引用），
这里还登记**目录条目**：有引用、区域、领域和官方链接，但没有条款正文、不参与扫描引用。

## 清单文件

- `attrax-docs-2026-09-19.json` — 63 条目录条目。来源：
  - `attrax-docs/` 各区域法规原件目录（PDF / HTML 共 68 份唯一原件）
  - 《出海合规法规文件清单》xlsx（49 条 · 14 区域）
  - 《法规分类表》xlsx（86 份文件 · 地区 × 领域）
  - 《出海合规法律法规政策清单》docx（八大领域清单表）+ `(1).docx`（研究报告）

顶层字段：`source_root`（原件目录，绝对路径）、`entries`。
每条 entry 包含 `id` / `region` / `domain`（领域分类）/ `official_citation` /
`short_name` / `source_url` / `docs`（原件相对 `source_root` 的路径）/ 可选 `note` /
可选 `license`、`purchase_url`（缺省 `public` / `null`）。

## 导入脚本

```bash
python3 scripts/import_regulation_docs.py --dry-run          # 只校验清单
python3 scripts/import_regulation_docs.py --copy-docs        # 写 YAML + 复制原件 + 重建索引
python3 scripts/import_regulation_docs.py --force --copy-docs  # 覆盖已有 YAML（会重置 last_verified 与 notes）
```

- 逐条写 `data/regulations/{region}/{id}.yaml`；已存在的文件默认跳过（`--force` 覆盖）。
- 原件复制到 `data/regulations/{region}/raw/`，路径写进 YAML 的 `doc_files`。
  这些副本**不入版本控制**（见 `.gitignore`）。**YAML 与原件是两条独立的线**：
  YAML 已存在时仍会补齐缺失的原件，所以删掉 `raw/` 之后单跑 `--copy-docs`
  （不带 `--force`）即可恢复，不会改写任何 YAML。
- 结束时调用 `scripts/watchdog/auto_ingest.py` 的 `AutoIngestor._rebuild_index()`，
  索引格式与 watchdog 自动入库保持一致（含 `domain` 字段）。
- 清单校验：`region` 必须在库目录映射内、`id` 前缀与 region 一致、`docs` 路径不得越出
  `source_root`、同区域不得有重名原件（`copy_docs` 只取文件名，重名会静默互相覆盖）；
  `id` / `region` 等字段的首尾空白会被 strip 后使用。
- 回归测试：`scripts/watchdog/tests/test_import_regulation_docs.py`。

## 把新增条目同步到生产机

生产机的 `/regulations` 读 `/opt/attrax/data/regulations/regulations_index.json`（不是
`.next/standalone/data` —— 部署 tarball 会删掉那一份）。所以新增目录条目后要做两步：

```bash
# 1. additive 同步 YAML（--ignore-existing：绝不覆盖服务器上 watchdog 自动入库的条目；
#    原件 raw/ 不同步，运行时没有任何代码读 doc_files）
rsync -a --ignore-existing --exclude 'raw/' data/regulations/ aliyun-sz:/opt/attrax/data/regulations/

# 2. 在服务器上用自己的 YAML 树重建索引（不能直接拷本地索引——本地没有服务器上
#    watchdog 自动入库的那些法规，拷过去会把它们从档案页抹掉）
ssh aliyun-sz 'cd /opt/attrax && PYTHONPATH=. .venv/bin/python -c \
  "from scripts.watchdog.auto_ingest import AutoIngestor; AutoIngestor._rebuild_index()"'
```

2026-09-19 实测：同步 63 条后服务器档案为 127 条 = 本地 124 条 + 服务器独有的 3 条
自动入库 UK 法规（`UK-REACH` / `UK-WEEE` / `UK-Packaging-EPR`）。

## source_url 的实测情况

清单里的 `source_url` 在 2026-09-19 全部用 curl 实测过。两类结果需要分开看：

- **各国政府站点 30 条**：实测 200，页面标题与条目相符。
- **EUR-Lex 15 条**：curl 对 `eur-lex.europa.eu` 的有效 ELI 和编造 ELI **都返回 202**，
  所以 202 只证明主机可达。这 15 条改用 EU Publications Office 的 Cellar 端点按 CELEX
  号复核（`docs/evidence/2026-09-19-regulations-catalog-import/verify-eu-eli.py`），
  15 条全部返回 303 = 文书存在。
- **18 条登记的是官方门户而非条款深链**（越南 vanban.chinhphu.vn、印尼
  jdih.setneg.go.id、马来西亚 pdp.gov.my、泰国 mdes.go.th、阿联酋 u.ae、
  海湾 gso.org.sa、越南 tcvn.gov.vn、luatvietnam.vn、UL / IEC 官网）——
  点「原文」拿到的是门户首页，条文以 `doc_files` 登记的本地原件为准。
  其中 UN R155/R156（unece.org 403）、EU-2019-452（编号纠错）、AE-LABOR-33-2021
  （uaelegislation.gov.ae 403）在条目 `note` 里写明了原因。

## 与扫描的关系

目录条目 `articles: []`、`source_kind: unverified`，没有 KB anchor 引用它们，因此不会
进入扫描的法规检索与引用流程；`rag_service/tests/test_kb_loader.py` 保留两条单向约束：
锚点必须有法规兜底（`anchored ⊆ regulated`），且没有锚点的法规不得带条款正文
（只有目录条目可以没有锚点）。
