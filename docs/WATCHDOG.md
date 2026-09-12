# WATCHDOG 运维手册（法规自动更新）

完整设计见 `scripts/watchdog/README.md`。本文只覆盖服务器操作。

## 部署（lighthouse）

```bash
# 1. 同步代码（与其他服务一起）
rsync -az --delete --exclude='data/faiss' --exclude='.venv' \
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

## 变更处理流程

1. `pending_review.json` 出现 → 打开同目录 `diff.json` 审阅 unified diff
2. 确认变更有效（不是误报）→ 手动跑
   ```bash
   ssh lighthouse "cd /opt/attrax && .venv/bin/python scripts/build_regulation_library.py"
   ```
3. 重建后重启 rag-service 使 KB 锚点生效：
   ```bash
   ssh lighthouse "cd /opt/attrax && /usr/bin/pm2 restart rag-service"
   ```
4. 确认误报 → 不用动任何东西，快照已在本次运行中更新，下次不会再报

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
