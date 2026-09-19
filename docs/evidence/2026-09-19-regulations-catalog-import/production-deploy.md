# 生产部署记录 — 2026-09-19（attrax-docs 法规目录导入上线）

## 部署标识

| 项 | 值 |
|---|---|
| commit | `ddc9967`（feat(regulations): attrax-docs 法规目录导入 + 对抗性审查修正） |
| BUILD_ID | `YU8SNxMLjsyFVHcWswvRm` |
| tarball | 59M（`ATTRAX_TARBALL` 指向仓库内 `tmp/`，未落 /tmp） |
| 应用时间 | 2026-09-19 12:41:59 → 12:42:03（+08:00） |
| apply 脚本 | `/tmp/attrax-apply-deploy.sh`，sha256 `7f504374…`，与本地 `scripts/apply-deploy.sh` 一致 |

apply-deploy.sh 输出：`.next/static` 软链正确 → BUILD_ID 写入 → ops/ 10 个文件安装
（healthcheck timer enabled）→ `pm2 restart nextjs` → nginx vhost 重渲染
（upstream → 127.0.0.1:3000，`nginx -t` 通过并 reload）→ health gate 第 2 次尝试通过。

## 数据同步

`.next/standalone/data` 在打包阶段被删除（部署包不带数据快照），生产机的法规库在
`/opt/attrax/data/regulations/`，所以目录条目要单独 additive 同步：

```bash
rsync -a --ignore-existing --exclude 'raw/' data/regulations/ aliyun-sz:/opt/attrax/data/regulations/
ssh aliyun-sz 'cd /opt/attrax && PYTHONPATH=. .venv/bin/python -c \
  "from scripts.watchdog.auto_ingest import AutoIngestor; AutoIngestor._rebuild_index()"'
```

- 同步前服务器 64 篇（61 篇与本地共有 + 3 篇 watchdog 自动入库的 UK 法规），同步后 127 篇
- `--ignore-existing` 保证不覆盖服务器上被 watchdog 改过的 YAML；`raw/` 不同步
  （68 份 46MB 原件，运行时无任何代码读 `doc_files`）
- 索引在**服务器上**重建（127 条 = 本地 124 + 服务器独有的 3 条 UK）。直接拷本地索引会把
  那 3 条从档案页抹掉

## 核验结果（公网 https://twinbuddy.xyz）

| 检查 | 结果 |
|---|---|
| `/api/health` | 200 |
| `/regulations` 页面 | 200（0.22s） |
| `/api/regulations/archive` | `total=127`、`markets=21`、`withArticles=36`、带 domain 63 条 |
| 自动入库条目未被覆盖 | UK 9 条含 `UK-REACH` / `UK-WEEE` / `UK-Packaging-EPR` |
| `/api/regulations/sources` | `total=37` |
| `/api/regulations/updates` | `matching=60`（42 条静态卡片 + 18 条 watchdog 实时记录） |
| 页面副标题 | 「当前 127 篇法规档案（覆盖 21 个区域）+ 37 个抓取源 + 60 条近期动态。」无占位符漏出 |
| 越南筛选 | 6 张卡片 |
| 近期动态 tab | 60 张卡片 |

## 真实扫描冒烟（部署后）

`POST /api/scan`（Anker A2332 充电器 3 张图，EU+US，electronics）：

- 终态 `ready`，68s，无 `degradedReasons`
- 报告包：5 findings / 15 citations，`verificationMode=kb_exact_quote`
- quote_matcher：15 条引用 matched=10（67%）/ fallback=5（33%）/ unmatched=0
- `ragProvider=deepseek` —— 日志 `primary (MiniMax-M3) failed (<HTTPError 429: Too Many Requests>)`，
  走的是设计内的报告生成降级通道（见 CLAUDE.md「报告生成」降级行），不是本次部署引入的问题

这同时证明 BFF → RAG 的 `RAG_INTERNAL_SECRET` 鉴权与视觉/生成/验证三段管线在生产可用。

## 本次刻意没做的事

- **没有快进服务器 git**：`/opt/attrax` 的 HEAD 停在 `f1f3ccf`，工作区有 watchdog 写入的
  活数据（`data/regulations/jp/JP-METI-PSE.yaml`、`regulations_index.json` 等）。本次部署的
  运行产物全部经 tarball 与 rsync 落地，RAG 服务读 `data/` 不读 git；强行 ff 会与这些
  活数据冲突，收益为零。后续要同步用文档里的 bundle 流程，并在同步前处理工作区改动。
- **没有同步 `raw/` 原件**：见上，运行时无消费者，46MB 不值得占生产机磁盘。
- **没有改 `data/regulation_sources/official_sources.json`**：抓取源登记的是 watchdog
  每天真实巡检的通道，新增未验证的源会谎报巡检覆盖。
