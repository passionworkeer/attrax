# 2026-09-19 部署加固批次 — 验证证据

本目录是 2026-09-19 这批改动（省略号正则性能修复、部署自动回滚、tarball 卫生、
品类归一化等）的验证证据。所有脚本都可重跑，除注明外不需要网络与 API key。

## check_old_vs_new.py — quote_matcher 修复前后对比

用 `git show HEAD:rag_service/verify/quote_matcher.py` 取出改动前的版本加载为
独立模块，与当前工作树对比同一批引文的匹配结果。

```
python3.11 docs/evidence/2026-09-19-deploy-and-citation-fix/check_old_vs_new.py
```

预期输出：4 个用例由 `fallback_article_only` 变为 `matched`（em dash 折叠、
弯引号折叠、`. . .` 与 `..` 前缀剥离），1 个反向用例（内部空格省略号）保持
`fallback_article_only` —— 即不跨省略号拼接两段引文。

## run.sh / one_shot_health.py / verification.log — apply-deploy 失败自动回滚实测

用真实 `scripts/apply-deploy.sh` + 假 `ATTRAX_DIR` / `ATTRAX_REPO_DIR` /
假 pm2 桩跑一次部署，让 [9] health gate 必然失败，验证自动回滚。

```
bash docs/evidence/2026-09-19-deploy-and-citation-fix/run.sh
```

`verification.log` 是当次运行的完整输出。两条分支都验证过：

1. **部署前健康 200 + 失败** → 触发 `--rollback`，旧树被还原（日志里
   `OLD-TREE-MARKER` 回到线上），退出码 1，坏树保留在 `standalone-rollback-*`。
2. **部署前就不健康** → 按设计**不**回滚（失败不能归因于本次部署）。

## port-parse-run.sh — 端口预检解析回归

对三种输入跑 apply-deploy.sh [0] 的端口解析逻辑：真实 vhost（`server
127.0.0.1:3000 max_fails=3 fail_timeout=30s;`）、无 server 行的 vhost、只有
注释含地址的 vhost。三者的输出都必须是「不早退」——2026-09-19 部署实测中，
此处一个 `grep -oE '[0-9]+$'` 未命中会在 `set -e` + `pipefail` 下让整个部署
在任何日志之前静默退出（rc=1、零输出、部署 no-op）。

脚本引用的 `real-vhost.conf` 是生产 nginx 配置快照，未随证据入库。要用真实
输入复跑：

```
scp aliyun-sz:/etc/nginx/sites-enabled/attrax docs/evidence/2026-09-19-deploy-and-citation-fix/real-vhost.conf
bash docs/evidence/2026-09-19-deploy-and-citation-fix/port-parse-run.sh
```

## smoke-result.json — 生产端到端冒烟

部署后对 `https://twinbuddy.xyz` 发起的真实扫描（真实产品图 + electronics/EU）
的 BFF 轮询响应。要点：`status=ready`、`resultReady=true`、报告已生成。
