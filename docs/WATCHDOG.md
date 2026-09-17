# WATCHDOG 运维手册（法规自动更新）

完整设计见 `scripts/watchdog/README.md`。本文只覆盖服务器操作。

## 部署（lighthouse）

```bash
# 1. 同步代码（与其他服务一起）
rsync -az --delete --exclude='.venv' --exclude='.next' --exclude='node_modules' --exclude='.git' \
  --exclude='data/backend' --exclude='__pycache__' --exclude='*.pyc' \
  --exclude='data/regulation_supplements' \
  attrax/ lighthouse:/opt/attrax/

# 2. 无需 pip install — watchdog 只用标准库

# 3. 注册 pm2 进程（首次）
ssh lighthouse "cd /opt/attrax && /usr/bin/pm2 start scripts/ecosystem.config.cjs --only regwatch && /usr/bin/pm2 save"
```

> ⚠️ `--exclude='data/regulation_supplements'` 保护服务器上的快照库
> (`.cache.db`)不被本地目录覆盖 —— 丢了它所有源会重新报 `added`。

## 日常操作

```bash
# 看今天的运行结果
ssh lighthouse "ls /opt/attrax/data/regulation_supplements/watchdog-$(date -u +%F)/ 2>/dev/null"

# 手动触发一次（不等 cron）
ssh lighthouse "cd /opt/attrax && PYTHONPATH=/opt/attrax .venv/bin/python -m scripts.watchdog.orchestrator --once"

# 看日志
ssh lighthouse "/usr/bin/pm2 logs regwatch --lines 100 --nostream"
```

## 源健康检查（改注册表后必跑）

```bash
# 把每个源走真实 collector 抓一遍，报告可达性 + 内容厚度
ssh lighthouse "cd /opt/attrax && PYTHONPATH=. .venv/bin/python -m scripts.watchdog.check_sources"

# 只查一个源
ssh lighthouse "cd /opt/attrax && PYTHONPATH=. .venv/bin/python -m scripts.watchdog.check_sources --only uk-weee-regulations-guidance"
```

退出码：0 = 全部正常 · 3 = 有源失败 · 1 = 注册表本身不合规。

**为什么必须有这一步**：2026-09-17 审计发现 35 个源里 9 个从上线起每天都在失败
——它们的 `source_url` 指向 403/404，而 `human_view_status` 是手工填的、
填的是"浏览器能不能打开"，不是"watchdog 能不能抓"。所有代码都没有发现这件事，
只有 `errors.json` 记着，而没人看。详见
`docs/regulations/SOURCE-AUDIT-2026-09-17.md`。

输出里 `thin` 表示抓到了但正文过薄（JS 空壳站，摘要永远不变），`FAIL` 表示
抓取失败。两者都需要处理：要么找到可机器读取的端点，要么把该条目标成
`fetch_status: "shell_only"` / `"unreachable"`。

## 变更处理流程（2026-09-13 起默认全自动，2026-09-16 扩展）

默认 `ATTRAX_REGWATCH_AUTO_INGEST=true`：真实变化 pass 结束即自动入库 —
- **UPDATE**：eCFR / Canada Justice XML / gov_html / direct_url 也都能
  映射（显式 `regulation_id` 字段优先，按 source_type 推断兜底）
  → 更新 `last_verified` / `checksum_sha256` / `raw_file` / `source_url`
  / 必要时 `status: stale|repealed` + 审计 note。原文件备份到
  `auto-{date}/backup/`。**verbatim replacement pass** 仅在 YAML 的
  `source_kind: unverified` 且新抓文本含 `Article <n>` 边界时触发 —
  自动用真实正文覆盖 KB-condensed summaries 并提升 source_kind 到
  `official_verbatim`（eu_celex）或 `official_summary`（其他）。详见
  `scripts/watchdog/auto_ingest.py:_extract_articles_from_text`。
- **CREATE**：可映射但库里没有的（如 WEEE 2012/19 或新加入的非 EU 源）
  自动建最小 public 条目。
- **MARK（删的保守形态）**：源连续 7 天失联 → `status: stale`；FR 文件
  标题/类型含 removal/revocation/repeal → `status: repealed`。绝不硬删。
- **EVIDENCE**：每个变化源都在 `auto-{date}/{source_id}/` 留 raw + meta + diff。
- 入库成功即推进基线快照；`regulations_index.json` 自动重建；当日
  `applied.json` 记录干了什么。

## 复核自动入库（review CLI）

自动入库无人工闸门，`review.py` 是配套的复核入口：

```bash
# 今天入库了什么（source → regulation → action → 证据目录）
ssh lighthouse "cd /opt/attrax && PYTHONPATH=. .venv/bin/python -m scripts.watchdog.review --date $(date -u +%F)"

# 看某条变更的原始抓取内容 + meta + diff
ssh lighthouse "cd /opt/attrax && PYTHONPATH=. .venv/bin/python -m scripts.watchdog.review --date 2026-09-17 --show EU-2011-65"

# 回滚一条自动更新（从 auto-{date}/backup/ 恢复 + 重建索引）
ssh lighthouse "cd /opt/attrax && PYTHONPATH=. .venv/bin/python -m scripts.watchdog.review --date 2026-09-17 --revert EU-2011-65"

# 只打印计划不写盘
... --revert EU-2011-65 --dry-run
```

回滚的语义限制：只有 UPDATE 过的法规有备份，自动 CREATE 的没有前态；
且下次 pass 会重新抓到同样的变更并再次入库 —— 要长期保住回滚结果，
得先修源映射或关掉该源的自动入库。

## 2026-09-16 扩展：registry 增加到 35 条源 + 覆盖16 市场

新增 source_type / collector：
- `gov_html` → `scripts/watchdog/collectors/gov_html.py` — 用 stdlib
  `html.parser` 去除 cookie banner / nav / footer 等 chrome 元素，hash
  稳定跨 cookie 改动。
- `safety_gate` → `scripts/watchdog/collectors/safety_gate.py` — EU
  Safety Gate (RAPEX) JSON API，过滤到我们覆盖的品类。
- 两种 source_type 都启用 WAF fallback（见下一节）。

新增官方源（`data/regulation_sources/official_sources.json`）：
- US `us-cpsc-recalls-rss` (cpsc_rss)
- EU `eu-safety-gate-alerts` (safety_gate)
- CN `cn-samr-product-recall` / `cn-cnca-ccc-updates` (gov_html)
- JP `jp-meti-pse-list` (gov_html)
- KR `kr-motie-kc-safety` (gov_html)
- AE `ae-moiat-ecas` (gov_html)
- SA `sa-saso-news` (gov_html)
- BR `br-inmetro-novidades` (gov_html)
- IN `in-bis-crs` (gov_html)

### 2026-09-17 修正：这批源里 9 个从未抓取成功

上面的 2026-09-16 批次上线后，其中 9 条源的 `source_url` 实际返回
403/404，每个 pass 都在失败。已在同日修复或如实标记，详见
`docs/regulations/SOURCE-AUDIT-2026-09-17.md`。

## 2026-09-16 扩展：WAF fallback UA 链

`scripts/watchdog/collectors/base.py:fetch_url` 在 retry 时切换 UA：
- 第 1 次尝试：标准 Chrome UA
- 第 2-3 次：稍旧的 Chrome + Sec-Fetch-* / Sec-Ch-Ua-* headers

UA 现在按季度轮换（`base.py:_UA_TABLE`）。每季度往表顶加一行；
表过期不会报错，会继续用最后一条已知可用的 UA。临时换 UA 用
`ATTRAX_REGWATCH_UA=<完整 UA 字符串>`，不用改代码。

注意：UA 轮换救不了 IP 段级别的封禁。2026-09-17 实测 UK legislation.gov.uk
/ TGA / ACCC / EU Cellar SPARQL 即便带完整浏览器头、连人类页面也返回 403
—— 那是数据中心 IP 被封，不是 UA 问题。

回滚：`cp data/regulation_supplements/auto-{date}/backup/{id}.yaml data/regulations/{region}/{id}.yaml`
即可，或直接用 `review.py --revert`（`regulations_index.json` 由下次
watchdog pass 内的 `_rebuild_index()` 自动重建 —
`scripts/build_regulation_library.py` 这个脚本已删除，被
`scripts/watchdog/auto_ingest.py:_rebuild_index` 内联镜像取代，
**不要单独运行任何 build_xxx 脚本**）。

手动审阅模式（可选）：`ATTRAX_REGWATCH_AUTO_INGEST=false` 时恢复人工闸门 —
pending_review.json + `--ack <SOURCE_ID>` / `--ack-all` 审批推进基线。

## 通知配置

编辑后需 `pm2 delete regwatch && pm2 start scripts/ecosystem.config.cjs --only regwatch`
（pm2 restart 不重读 env 段 — 与 rag-service 同一雷区）：

```bash
ssh lighthouse "cd /opt/attrax && \
  ATTRAX_REGWATCH_NOTIFY=slack SLACK_WEBHOOK_URL=https://hooks.slack.com/... \
  /usr/bin/pm2 start scripts/ecosystem.config.cjs --only regwatch"
```

## 故障排查

| 症状 | 原因 | 处理 |
|------|------|------|
| 全部源报错进 `errors.json` | 服务器出网受限 / DNS | `curl -I https://www.ecfr.gov` 手测；首尔机房对 EUR-Lex 偶发超时，重试机制会兜 3 次 |
| 某个源每天报 `modified` | 源页面有动态内容（时间戳/CSRF token）降到相似度 0.95 以下 | 在该源的 collector 里加针对性清洗，或调 `state.SIMILARITY_THRESHOLD`；`diff.json` 里看 `seqShiftSensitive` 区分"真换序"和"抖动" |
| 某个源每天失败 | 端点 403/404，或本来就抓不到 | 跑 `check_sources --only <id>` 确认；能修就换端点，不能修就标 `fetch_status: unreachable`，别让它每晚刷 errors.json |
| 某源摘要永远不变 | JS 空壳站（抓到的是页面标题） | 跑 `check_sources` 看是否 `thin`；确认后标 `fetch_status: shell_only` |
| `.cache.db` 损坏 | 磁盘满 / 进程被 kill -9 | `rm data/regulation_supplements/.cache.db`，下次全量重建（全部报 added，属预期） |
| pm2 显示 regwatch errored | 退出码 2/3 是正常业务信号 | `pm2 logs regwatch` 看具体原因，不用 `pm2 restart` |
| 单个源卡住整晚 | Python 杀不掉阻塞在 socket 读的线程 | 已由 `fetch_deadline` 协作式预算兜住（60s）；若仍见超时，调 `PER_SOURCE_TIMEOUT_SECS` |
