# WATCHDOG 运维手册（法规自动更新）

完整设计见 `scripts/watchdog/README.md`。本文只覆盖服务器操作。

## 部署（lighthouse）

```bash
# 1. 同步代码（与其他服务一起）
rsync -az --delete --exclude='.venv' \
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

## 变更处理流程（2026-09-13 起默认全自动）

默认 `ATTRAX_REGWATCH_AUTO_INGEST=true`：真实变化 pass 结束即自动入库 —
- **UPDATE**：**仅 EU CELEX** 能机械映射到 `data/regulations/eu/*.yaml` 的源（更新 last_verified / checksum / raw_file / source_url + 审计 note；原文件备份到 `auto-{date}/backup/`；articles 正文永不机械改写）。US / CN / UK / AU / UN 等其他市场的源目前是 evidence-only（落入 `evidence/` 子目录但不入主库）—— 见 `scripts/watchdog/auto_ingest.py:_REGION_DIRS`
- **CREATE**：可映射但库里没有的（如 WEEE 2012/19）自动建最小 public 条目
- **MARK（删的保守形态）**：源连续 7 天失联 → `status: stale`；FR 文件
  标题/类型含 removal/revocation/repeal → `status: repealed`。绝不硬删
- **EVIDENCE**：每个变化源都在 `auto-{date}/{source_id}/` 留 raw + meta + diff
- 入库成功即推进基线快照；`regulations_index.json` 自动重建；当日
  `applied.json` 记录干了什么

回滚：`cp data/regulation_supplements/auto-{date}/backup/{id}.yaml data/regulations/eu/{id}.yaml`
即可（`regulations_index.json` 由下次 watchdog pass 内的 `_rebuild_index()` 自动重建 ——
`scripts/build_regulation_library.py` 这个脚本已删除，被 `scripts/watchdog/auto_ingest.py:351`
内联镜像取代，**不要单独运行任何 build_xxx 脚本**）。

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
| 每天都报同一源 `modified` | 源页面有动态内容（时间戳/CSRF token）降到相似度 0.95 以下 | 在该源的 collector 里加针对性清洗，或调 `state.SIMILARITY_THRESHOLD` |
| `.cache.db` 损坏 | 磁盘满 / 进程被 kill -9 | `rm data/regulation_supplements/.cache.db`，下次全量重建（全部报 added，属预期） |
| pm2 显示 regwatch errored | 退出码 2/3 是正常业务信号 | `pm2 logs regwatch` 看具体原因，不用 `pm2 restart` |
