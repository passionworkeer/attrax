# 07 · 部署与运维

## 核心要点（30 秒读完）

- **三步部署**：本地 `git bundle` 推到服务器 → 本地 `bash scripts/build-deploy-tarball.sh` 打 tarball → scp + 服务器 `bash /tmp/attrax-apply-deploy.sh` 解包。
- **Next 16 部署雷区**：`next build` + Turbopack 不再复制 `.next/static/` 到 standalone，也不复制 `public/`。`build-deploy-tarball.sh` 在 stage 阶段处理；服务器 nginx `alias /opt/attrax/.next/static/` 兜底。
- **/opt 下禁止 `npm run build`**：2026-09-16 真实事故后加了 `scripts/guard-no-server-build.mjs` + `package.json prebuild` 钩子，cwd 在 `/opt/` 下直接拒绝构建。
- **pm2 三进程**：`nextjs`（3000）、`rag-service`（8001，max_memory 1300M）、`regwatch`（500M，autorestart）；env 段改用 `pm2 delete && start`，换 `.env` 用 `restart`。
- **备份**：每日 03:00 cron → `scripts/backup-data.sh` 打包 .env + data + supplements，保留 14 份 `600` 权限 tarball（约 4MB）；standalone 旧版本保留 2 份可回滚。⚠️ 异地备份未配置。
- **监控**：`/home/ubuntu/uptime-check.sh`（work 仓）每 5 分钟 cron，覆盖 HTTP + pm2 + BUILD_ID 漂移 + 磁盘水位；⚠️ webhook 未配置。
- **已知事故**：2026-09-16 线上全站 500（服务器误跑 build 删 standalone）；2026-07-18 load 111（meta.json 95MB 未分片 + memory_restart 900M 过低）。

> 数据快照：2026-09-17。生产机 lighthouse 腾讯云首尔 `198.51.100.20`。本地路径 `/workspace/me/attrax/`，服务器路径 `/opt/attrax/`。

## 部署流程（git bundle + tarball）

> 服务器 ssh key 无法直接 fetch GitHub（详见 memory `2026-09-14-lighthouse-fetch-github-fix`：known_hosts 缺失 + attrax_pull_key 未注册），所以源码同步走 bundle 路线。

### 1) 本地打 git bundle

```bash
cd /workspace/me/attrax
git bundle create /tmp/attrax-{new_sha}.bundle old_commit..new_commit
scp /tmp/attrax-{new_sha}.bundle lighthouse:/tmp/
ssh lighthouse 'cd /opt/attrax && git fetch /tmp/attrax-{new_sha}.bundle new_branch:new_branch && git checkout new_branch'
```

服务器 `git fetch` 后 HEAD 推进；HEAD 本身**不**被生产消费（runtime 走 standalone tarball），但它能让服务器 git diff / blame 用。

### 2) 本地构建 standalone tarball

```bash
cd /workspace/me/attrax
bash scripts/build-deploy-tarball.sh
# 产物 /tmp/attrax-deploy-complete.tar.gz
#   - 含已 stage 好的 .next/standalone/
#   - 含 .next/static/（Next 16 + Turbopack 不再自动复制）
#   - 含 public/（打入 standalone/public，避免 404）
#   - 写 .deployed 标识（含 commit SHA + BUILD_ID）
```

构建产物关键检查：

- `.next/standalone/` 含 `server.js` + 路由 manifest + 最小 `node_modules/`。
- `.next/static/` 同步存在（Next 16 不会自动从 `.next/static` 拷到 `.next/standalone/.next/static`）。
- `standalone/public/` 是 `public/` 完整副本（Next 16 不会自动拷）。
- `BUILD_ID` 写在 `.next/BUILD_ID` 与 `.next/standalone/BUILD_ID`。

> 不要在服务器 `/opt/attrax` 跑 `npm run build`：`next build` 开跑即清空 `.next/`，pm2 `nextjs` 进程 cwd 指向已删除目录 → `ChunkLoadError` + `/complipilot/*` 404。`package.json` 已加 `prebuild` 钩子（`scripts/guard-no-server-build.mjs`）在 `/opt/` 下直接拒绝；确需服务器构建 `ATTRAX_ALLOW_SERVER_BUILD=1` 放行。

### 3) scp + 服务器解包

```bash
scp /tmp/attrax-deploy-complete.tar.gz lighthouse:/tmp/
ssh lighthouse 'bash /tmp/attrax-apply-deploy.sh /tmp/attrax-deploy-complete.tar.gz'
# apply-deploy.sh：
#     保留当前 .next/standalone-pre-deploy-<stamp>
#     解包新 .next/standalone/ + .next/static/
#     重建 _next/static -> standalone/.next/static 软链
#     保留最近 2 份 pre-deploy 可回滚
```

> `openrsync` 对 `.next/standalone` 这种大目录会崩，所以全用 `tar -C .next -czf - X | ssh lighthouse 'tar -xzf -'`。

### 4) pm2 重启

```bash
ssh lighthouse 'pm2 restart nextjs'
# 换 .env 文件 → restart 即可（pydantic-settings 每次启动读 .env）
# 换 ecosystem env 段或 cwd → 必须 pm2 delete && start
# 换 RAG_INTERNAL_SECRET → 同时重启 rag-service 与 nextjs（只重启一个会让 BFF/RAG secret 不一致 → 写端点全 401）
```

### 5) 验证

```bash
ssh lighthouse 'curl -s http://127.0.0.1:3000/api/health'
ssh lighthouse 'curl -s http://127.0.0.1:8001/api/v1/ready'   # checks 应全 true
# 真实扫描：跑一次完整 createScan → 轮询 → 看 ready 结果（/api/health 200 不代表 BFF→rag auth 通）
```

## Next 16 standalone 部署雷区（必读）

[`docs/infra/NEXTJS-16-STANDALONE-NOTES.md`](file:///workspace/me/attrax/docs/infra/NEXTJS-16-STANDALONE-NOTES.md) 逐条记录：

1. `next build` + Turbopack `output: "standalone"` **不**复制 `.next/static/` 到 `standalone/.next/static/`。Next 15 还会这么做，Next 16 不会。
2. standalone/ 里只有 `server.js` + 路由 manifest + 最小 `node_modules/`。`public/` 也不存在。
3. 必须分别 rsync / tar `.next/standalone/` 与 `.next/static/` 两份到服务器（`build-deploy-tarball.sh` 已在 stage 阶段把它们一起打包）。
4. nginx `location ^~ /_next/static/` 用 `alias /opt/attrax/.next/static/`（不是 `root $nextjs_root`，因为 standalone/ 里没有 `.next/static/`）。
5. 必须 `ln -sfn /opt/attrax/public /opt/attrax/.next/standalone/public`，否则 `/complipilot/*` 全 404（独立 build tarball 已自动 stage `public/` 到 `standalone/public`，无需手动软链）。
6. 裸 `pm2 start server.js --name nextjs --cwd .next/standalone` 会丢 env。必须 `pm2 start scripts/ecosystem.config.cjs --only nextjs` 让 env 块注入。
7. 换 .env / ecosystem env 段 / cwd：`pm2 delete && start`，**不要**用 `restart`。

## pm2 进程清单（`scripts/ecosystem.config.cjs`）

| 名称 | script | cwd | instances | 内存上限 |
|---|---|---|---|---|
| `nextjs` | `node .next/standalone/server.js` | `/opt/attrax/.next/standalone` | 1 (fork) | 默认 |
| `rag-service` | `python3 -m uvicorn rag_service.main:app --host 127.0.0.1 --port 8001` | `/opt/attrax` | 1 | `1300M` |
| `regwatch` | `python3 -m scripts.watchdog.orchestrator` | `/opt/attrax` | 1 (fork) | `500M` |

env 段关键：

- `RAG_INTERNAL_SECRET`：从 `/opt/attrax/.rag-internal-secret` 文件读。
- `MINIMAX_API_KEY` / `DEEPSEEK_*`：从 `/opt/attrax/rag_service/.env` 与 `/opt/attrax/.env.production` 读。
- `ATTRAX_BUILD_SHA`：pydantic-settings 读取，写入 `/ready.release.buildSha`。`pm2 restart` 即生效（专门为避开 env 不重读雷区设计）。

## 备份与恢复

### 本地 14 份回滚备份

`docs/infra/cron-attrax-backup`（安装为 `/etc/cron.d/attrax-backup`）每日 03:00 触发 `scripts/backup-data.sh`：

- 打包 `.env` / `.env.local` / `.env.production` / `rag_service/.env` / `data/kb` / `data/regulation_sources` / `data/regulation_supplements` / `data/**/*.db`。
- 输出 `/opt/attrax/backups/attrax-data-YYYYMMDD-HHMMSS.tar.gz`，权限 `600`，保留 14 份。
- `umask 077`（含密钥，故严控权限）。

### standalone 旧版本回滚

`/tmp/attrax-apply-deploy.sh` 在每次部署时把上一份 `.next/standalone/` 改名 `standalone-pre-deploy-<stamp>/`（保留 2 份）。回滚：

```bash
ssh lighthouse 'cd /opt/attrax/.next && rm -rf standalone && mv standalone-pre-deploy-<新stamp> standalone && pm2 restart nextjs'
```

### ⚠️ 没有异地备份

`docs/infra/cron-attrax-backup-remote` 已就位，但 `scripts/backup-remote.sh` 未安装、`BACKUP_REMOTE_DEST` 未配置。**单盘故障 = 14 份备份全失**（已标记为最高优先级运维缺口）。

## 监控

每 5 分钟 cron `/etc/cron.d/uptime-monitor` → `/home/ubuntu/uptime-check.sh`（work 仓 `ops/monitor/uptime-check.sh` 是唯一来源）：

- 多站点 HTTP 探针（`example.com` / `/api/health`）。
- pm2 进程内存 / 状态。
- Next 构建漂移指纹（`/opt/attrax/.next/BUILD_ID` vs 浏览器拿到的）。
- 磁盘水位（单分区布局下唯一能提前发现「写满根分区」的手段）。
- 日志 `/home/ubuntu/uptime.log`（成功不写，只记失败 / 漂移）；告警 webhook **未配置**，只落本地。

## 日志轮转

- `journald` 200 MB + 14 天保留（`docs/infra/journald-00-attrax.conf`）。
- nginx 自带 `/etc/logrotate.d/nginx`。
- attrax 自身：`docs/infra/logrotate-attrax`（装 `/etc/logrotate.d/attrax`）轮转 `/opt/attrax/logs/*.log`、pm2 日志、`data/backend/audit.jsonl`。**2026-09-17 之前这三类没有任何轮转规则**。

## 故障排查 / 事故记录

### 2026-09-16 线上全站 500 + 图片 404（p0）

- **症状**：`/profit/*` 500，前端「Runtime error / Something caught fire」，`/complipilot/*` 全 404；`/api/health` 200 看着没事。
- **根因**：服务器 `/opt/attrax` 跑 `npm install && npm run build`（中午 12:11~12:15），`next build` 开跑即清空 `.next/`，pm2 `nextjs` cwd 指向已删除 `.next/standalone/`，Node 按需加载 chunk → 已加载路由照常 + 没加载的 500 → nginx root 失效 → `/complipilot/*` 404。
- **修复**：本地重建 tarball → scp → 服务器解包 + `.next/static` 软链自愈 + `pm2 restart nextjs`。
- **治本**：`scripts/guard-no-server-build.mjs` + `package.json` `prebuild` 钩子，在 `/opt/` 直接拒绝构建。

### 2026-07-18 服务器 load 111 + HTTPS 502（已治）

- **症状**：load 飙到 111，可用内存 58MB，公网 HTTPS 502，前端 400「Failed to find Server Action」。
- **根因（两层）**：
  1. 前端 BUILD_ID 旧，浏览器 Server Action ID 与新版不匹配 → 400 + 反复重试。
  2. `rag-service --workers 1` + 280s 超时（LLM 反复重试）→ 单 worker 卡 + 内存 960MB → `max_memory_restart: 900M` 频繁重启 → meta.json 95MB 未分片加剧。
- **修复**：meta.json 95MB 分 50 份；`max_memory_restart: 900M → 1300M`；LLM timeout 280s 兜底。
- **存档备注**：`data/faiss/` 与 `FaissRetriever` 已随 de-RAG 在 2026-09 移除，此条仅为事故存档。

## 关键文件清单

- [`scripts/build-deploy-tarball.sh`](file:///workspace/me/attrax/scripts/build-deploy-tarball.sh)：本地构建 tarball。
- [`scripts/apply-deploy.sh`](file:///workspace/me/attrax/scripts/apply-deploy.sh)：服务器解包（保留 2 份回滚）。
- [`scripts/ecosystem.config.cjs`](file:///workspace/me/attrax/scripts/ecosystem.config.cjs)：pm2 配置。
- [`scripts/guard-no-server-build.mjs`](file:///workspace/me/attrax/scripts/guard-no-server-build.mjs)：服务器构建守卫。
- [`scripts/preflight-deploy.mjs`](file:///workspace/me/attrax/scripts/preflight-deploy.mjs)：部署前自检。
- [`scripts/backup-data.sh`](file:///workspace/me/attrax/scripts/backup-data.sh)：本地 14 份备份。
- [`scripts/backup-remote.sh`](file:///workspace/me/attrax/scripts/backup-remote.sh)：异地备份（no-op）。
- [`docs/infra/NEXTJS-16-STANDALONE-NOTES.md`](file:///workspace/me/attrax/docs/infra/NEXTJS-16-STANDALONE-NOTES.md)：Next 16 standalone 部署坑总览。
- [`docs/infra/cron-attrax-backup`](file:///workspace/me/attrax/docs/infra/cron-attrax-backup) + [`-remote`](file:///workspace/me/attrax/docs/infra/cron-attrax-backup-remote)：备份 cron。
- [`docs/infra/logrotate-attrax`](file:///workspace/me/attrax/docs/infra/logrotate-attrax)：日志轮转。
- [`CHANGELOG.md`](file:///workspace/me/attrax/CHANGELOG.md)：历史事故 + 修复时间线。
- [`CLAUDE.md §部署雷区`](file:///workspace/me/attrax/CLAUDE.md)：常见踩坑清单（构建雷区、pm2 env、nginx alias、openrsync、服务器 git 落后）。