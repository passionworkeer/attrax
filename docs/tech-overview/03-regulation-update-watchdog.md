# 03 · 法规自动更新（Watchdog）

## 核心要点（30 秒读完）

- **调度**：pm2 守护 `regwatch` 进程（fork 模式 + autorestart），进程内 `time.sleep` 循环每天 03:00 服务器本地时巡检；不用 cron_restart 因为 fork 退出后 stop 状态 pm2 不会重启。
- **35 个监控源**：覆盖 EU（9）、US（4）、CA（6）、UK（4）、NZ（2）、CN（2）、JP/KR/AE/SA（4）、BR/IN（2），机器走 Cellar RDF / eCFR API / Federal Register / CPSC RSS 等结构化通道。
- **自动入库四类语义**：
  - **UPDATE** — 刷新 `last_verified` / `checksum_sha256` / `raw_file`，原 YAML 备份。
  - **CREATE** — 可映射但 YAML 不存在时自动创建最小 public 条目 + raw_file 指针。
  - **MARK** — 连续 7 天失败 → `status: stale`；Federal Register 文档含 `removal/revoke/repeal` → `status: repealed`。永不硬删。
  - **EVIDENCE** — 所有变化都保存原始 RDF / HTML / XML + 统一 diff，可审计。
- **变更检测**：`SourceStateStore`（SQLite）做 baseline + 相似度比对；相似度 ≥ 0.95 = cosmetic 自动 snapshot；否则 = real_change 触发入库。
- **退出码**：0 = 无变化；2 = 真实变化（已自动入库或待人工 ack）；3 = 部分失败；1 = 致命。

> 数据快照：2026-09-17。watchdog 由 pm2 进程 `regwatch` 持有，每天服务器本地时间 03:00 巡检一次 35 个官方源，自动 UPDATE / CREATE / MARK，**不**需要人工 ack。已上线一年多（最初文档 2026-09-09，之后 09-13~09-17 多次加固）。

## 概览

| 项目 | 值 |
|---|---|
| 入口脚本 | `python -m scripts.watchdog.orchestrator` |
| 注册表 | `data/regulation_sources/official_sources.json`（35 项） |
| 监控产物目录 | `data/regulation_supplements/watchdog-YYYY-MM-DD/` |
| 备份目录 | `data/regulation_supplements/auto-YYYY-MM-DD/` |
| 调度 | 进程内 `time.sleep` 循环（不依赖 pm2 cron_restart，详见 §为什么自带调度） |
| 跑批时间 | 默认 `03:00` 服务器本地时（aliyun-sz 上 = Asia/Shanghai = 19:00 UTC） |
| 启用开关 | `ATTRAX_REGWATCH_ENABLED=true/false`（默认开） |
| 自动入库开关 | `ATTRAX_REGWATCH_AUTO_INGEST=true/false`（默认开） |

## 为什么自带调度（不是 cron）

代码注释原话（`scripts/watchdog/orchestrator.py` 模块头）：「原设计依赖 pm2 `cron_restart` 每日重启 fork 进程。但 fork 进程干净退出后会进入 'stopped' 状态，pm2 cron_restart 永远不触发它」。改为进程内 `time.sleep` 循环：pm2 把进程当成常驻服务，autorestart 处理崩溃；时间配置（`ATTRAX_REGWATCH_RUN_AT`）单点存在一处。

## 跑批流程（`run_pass` 函数逐行解读）

1. **加载源**（`load_sources()`）：读 `data/regulation_sources/official_sources.json`（35 项数组）。空 / 不为 list 直接 `SystemExit`。
2. **建立输出目录**：`data/regulation_supplements/watchdog-{UTC 日期}/`。
3. **建立 SQLite 快照库**：`SourceStateStore(SUPPLEMENTS_DIR)`，每次成功采集的内容入库做 baseline。
4. **建立 AutoIngestor**（如开启）：见下文「自动入库语义」。
5. **逐源采集 + 差异检测**（`for entry in entries`）：
   - 调 `collect_source(entry)` → `RegulationUpdate(text, content_hash, market, source_type, source_url, title, metadata)`。
   - 任一源抛异常 → 写 `errors.json`、记入 ingestor 的 `failed`，继续下一源（**per-source isolation**）。
   - `store.detect_changes(source_id, update.text, metadata)` 比较 SQLite 里上一次成功的快照：
     - `kind == "cosmetic"`（相似度 ≥ 0.95）→ 自动 baseline 推进，**不**触发入库。
     - `kind == "added" / "modified" / "removed"` → 计入 `real_changes`。
6. **触发自动入库**（`AutoIngestor.apply(...)`）：见 §自动入库语义。
7. **推进快照**（`store.bulk_snapshot(...)`）：
   - 自动入库成功 + 无失败源 → 该源推进 baseline，下次不会再报差异。
   - 自动入库失败 → 该源 **不**推进 baseline，保持在 `pending_review` 里等下次再试或人工 ack。
8. **写产物**：
   - 全部 unchanged → `no_change.json`。
   - 有真实变化 → `diff.json`（清单）+ 自动入库成功时同时写 `applied.json`；未开启自动入库时改写 `pending_review.json`（提示运行 `--ack`）。
   - 仅 cosmetic → `cosmetic.json`。
   - 有错误 → `errors.json`。
9. **通知**：`notify_all(notifiers, title, body, payload)` 走 `scripts/watchdog/notify.py:build_notifiers()`，默认 NoopNotifier；可挂 webhook（目前未配置）。
10. **退出码**：
    - `EXIT_CLEAN = 0`：无变化或仅 cosmetic。
    - `EXIT_CHANGES_PENDING = 2`：有真实变化（已自动入库或待人工 ack）。
    - `EXIT_PARTIAL_FAILURE = 3`：有源失败但没真实变化。
    - `EXIT_FATAL = 1`：致命（如源注册表为空）。

## 自动入库语义（`scripts/watchdog/auto_ingest.py`）

用户 2026-09-13 指令：「不要人工 review gate」。所以 watchdog 检测到真实差异后立刻尝试应用，应用失败不阻塞其它源。映射四类操作（与原始指令逐字对应）：

| 操作 | 触发 | 动作 |
|---|---|---|
| **UPDATE** | 源能映射到现有 `data/regulations/{region}/{id}.yaml` | 刷新 `last_verified` / `checksum_sha256` / `raw_file` / `source_url` + append 审计 note；原 YAML 备份到 `data/regulation_supplements/auto-{date}/backup/`。**`articles[]` 不动**（逐字法条提取是显式后续任务，由人来跑） |
| **CREATE** | 源可映射（如 EU CELEX `32012L0019` → `EU-2012-19`，但当前 YAML 不存在） | 在 `data/regulations/{region}/{id}.yaml` 写入最小 public 条目：`official_citation` 模板生成 + `raw_file` 指针 + `articles: []` 待提取 |
| **MARK（删）** | 连续失败 `STALE_AFTER_CONSECUTIVE_FAILURES = 7` 天；或 Federal Register 文档 `action/title` 含 `removal / revok / repeal / revocation / withdraw` | 设置 `status: stale` 或 `status: repealed`，**永不**硬删（防止网络抖动毁掉 KB） |
| **EVIDENCE** | 任一变化源（无论是否映射成功） | 把原始拉取文件（rdf / json / xml / html）+ metadata + 统一 diff 写到 `data/regulation_supplements/auto-{date}/{source_id}/` |

入库完成后：

- `regulations_index.json` 由 YAML 树重建。
- ingestor `record_success` 让 baseline 推进；`record_failure` 不推进。
- 报告里仍以 `applied.json` 形式保留 ingest 报告（成功 / 失败 / 标 stale / 标 repealed 的具体清单）。

## 采集器分类（`scripts/watchdog/collectors/`）

| 文件 | 类型 | 用途 |
|---|---|---|
| `base.py` | `BaseCollector` | 共享 `requests.Session` + 自动 UA + 90s 超时 + 3 次重试 + curl fallback（与 regulation_collectors 共用基类） |
| `eu.py` | `eu_celex` | EUR-Lex Cellar `Accept: application/rdf+xml`，绕过 EUR-Lex HTML 站点 AWS WAF（`watchdog_actual_fetch` 字段说明） |
| `us_ecfr.py` | `ecfr_part` | eCFR JSON API（背后 Federal Register 联邦公报） |
| `us_cpsc.py` | `cpsc_rss` | CPSC 公开召回 RSS |
| `gov_html.py` | `gov_html` | GOV.UK / ProductSafety NZ / SASO / BIS / INMETRO 等通用 HTML 抓取 |
| `safety_gate.py` | `safety_gate` | EU Safety Gate（每周 RAPEX 通报） |

`rag_service/regulation_collectors/` 下还有 `base / eu_rdf / powershell_fetcher`，是早期手动一次性采集脚本，不属于 watchdog 主路径。

## 35 个监控源分组（人读链接见 `data/regulation_sources/official_sources.json`）

| 区域 | 源数 | 备注 |
|---|---:|---|
| EU | 9 | GPSR / 玩具 / RoHS / WEEE / RED / EMC / LVD / 市场监管 2019/1020 / Safety Gate |
| US | 6 | 16 CFR 1307 邻苯 / 16 CFR 1630-1633 阻燃 / 16 CFR 1700 PPPA / CPSC 召回 |
| CA | 6 | 加拿大司法部 6 部 SOR 法规（消费化学品、表面涂层、邻苯、儿童睡衣、消费品含铅、有绳窗帘） |
| UK | 4 | GOV.UK WEEE 指南 / EPR 包装 / UK-REACH / HSE SVHC |
| NZ | 2 | 玩具标准 2005 / 婴儿床标准 2016 |
| CN | 2 | SAMR 召回 / 认监委 CCC 目录 |
| JP/KR/AE/SA | 4 | METI PSE / MOTIE KC / MoIAT ECAS / SASO SABER |
| BR/IN | 2 | INMETRO / BIS CRS |

每条记录的字段（[示例](data/regulation_sources/official_sources.json#L1-L32)）：

```json
{
  "id": "eu-2023-988-general-product-safety",  // 唯一源 ID
  "regulation_id": "EU-2023-988",              // 映射目标 YAML
  "market": "EU",                              // 用于 _REGION_DIRS
  "title": "Regulation (EU) 2023/988 ...",
  "channel": "Publications Office of the European Union",
  "source_type": "eu_celex",                   // 决定走哪个 collector
  "source_url": "https://publications.europa.eu/resource/celex/32023R0988",
  "celex": "32023R0988",
  "human_view_url": "https://eur-lex.europa.eu/eli/reg/2023/988/oj",
  "human_view_status": "ok" | "waf_challenge_temporary",
  "watchdog_actual_fetch": "Cellar RDF via Accept: application/rdf+xml",
  "notes": "...",
  "files": ["raw/eu/eu-2023-988-general-product-safety.rdf", ...],
  "product_categories": [...], "regulatory_types": [...],
  "why_added": "..."
}
```

> 注意每个源都同时有 `source_url`（机器抓取端点，如 Cellar RDF / Federal Register API）与 `human_view_url`（浏览器可打开的人类 URL）。文档里同一源要同时提供两条 URL。

## 调度算法（`_seconds_until_next_run`）

```python
target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
if target <= now: target += timedelta(days=1)
return max(60.0, (target - now).total_seconds())
```

- 默认 03:00，server-local。
- 不足 60s 就等明天。
- daemon 模式 chunked sleep（每 30s 醒一次）确保 SIGTERM 能在 30s 内被处理。

## 手动命令（运维）

| 场景 | 命令 |
|---|---|
| 立刻跑一次 | `python -m scripts.watchdog.orchestrator --once` |
| Dry-run（不写产物、不动 SQLite） | `python -m scripts.watchdog.orchestrator --dry-run` |
| 关闭自动入库（退回人工 ack 模式） | `ATTRAX_REGWATCH_AUTO_INGEST=false` |
| 关闭 watchdog 整体 | `ATTRAX_REGWATCH_ENABLED=false` |
| 手工 ack 指定源 | `python -m scripts.watchdog.orchestrator --ack <sourceId>`（可多次） |
| 手工 ack 所有 | `--ack-all` |
| 看今天 diff | `cat data/regulation_supplements/watchdog-$(date -u +%F)/diff.json` |

## pm2 配置（`scripts/ecosystem.config.cjs`）

`regwatch` 进程名以 fork 模式启动：

- `script: 'python'`、`args: ['-m', 'scripts.watchdog.orchestrator']`
- `max_memory_restart: '500M'`
- `autorestart: true`（崩溃自动重启；autorestart + 内置调度 = 替代 cron_restart）
- `env.ATTRAX_REGWATCH_RUN_AT = '03:00'`
- `env.ATTRAX_REGWATCH_AUTO_INGEST = 'true'`

## 关键文件清单

- [`scripts/watchdog/orchestrator.py`](scripts/watchdog/orchestrator.py)：跑批编排 + 调度循环。
- [`scripts/watchdog/auto_ingest.py`](scripts/watchdog/auto_ingest.py)：UPDATE / CREATE / MARK / EVIDENCE 四类自动入库。
- [`scripts/watchdog/state.py`](scripts/watchdog/state.py)：SQLite baseline + 差异检测。
- [`scripts/watchdog/collectors/`](scripts/watchdog/collectors)：6 个具体采集器。
- [`scripts/watchdog/notify.py`](scripts/watchdog/notify.py)：webhook 通知（默认 noop）。
- [`data/regulation_sources/official_sources.json`](data/regulation_sources/official_sources.json)：35 个监控源注册表。
- [`docs/WATCHDOG.md`](docs/WATCHDOG.md)：运维手册（与本套独立）。
- [`docs/regulations/URL-INVENTORY-2026-09-16.md`](docs/regulations/URL-INVENTORY-2026-09-16.md)：所有源的人类可访问 URL 总表。

## 已知运维坑

- `watchdog_actual_fetch` 与 `source_url` 经常不同源（机器走 Cellar RDF，人类走 EUR-Lex HTML），任何对 `source_url` 的修改要先确认 collector 还能跑。
- EUR-Lex 整站 AWS WAF 挑战：浏览器大多数能过，但偶发临时态。watchdog 已规避（直接走 Cellar `Accept: application/rdf+xml` 信任路径），但运营复核时要意识到 `human_view_status: "waf_challenge_temporary"` 是合规提示，不是真的源失败。
- `articles[]` 在 UPDATE 路径上**不**被机械重写，逐字法条正文提取需要人手动跑（设计如此：避免 LLM 改写官方原文）。要补全文必须人介入。
- 旧版本（2026-09-13 之前）走 `--ack` 人工 ack，已被自动 ingest 取代；如要在测试环境复现旧行为，把 `ATTRAX_REGWATCH_AUTO_INGEST` 关掉即可。