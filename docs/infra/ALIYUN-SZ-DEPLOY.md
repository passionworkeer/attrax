# Attrax 部署 · aliyun-sz（深圳）

> **2026-09-18 起生效**：attrax 整站部署到 `aliyun-sz`（深圳 203.0.113.10）。lighthouse（首尔）上的 attrax 进程已停 + nginx 站点已卸，`/opt/attrax` 数据原地保留。
>
> 本文是**部署操作手册**——mac 上 build → scp → aliyun-sz 上 apply → 验证。端口、nginx 配置、secret 处理、雷区。
>
> 历史部署：lighthouse（2026-09-18 之前 2 个月）+ 早期 aliyun-sz（2026-06 / 2026-07）。

---

## 1. 主机拓扑

| 主机 | SSH 用户 | IP | 跑什么 |
|---|---|---|---|
| **aliyun-sz**（生产） | root（`id_ed25519`） | 203.0.113.10 | attrax nextjs:3000 + rag-service:8001 + regwatch；nginx 80→443，HTTPS 复用 twinbuddy 证书。端口单一来源 = `scripts/ports.env`（见 §4.4） |
| **lighthouse**（仅 portfolio/study/monitor） | ubuntu（`lighthouse_seoul_new`） | 198.51.100.20 | portfolio nextjs:3002 + study/monitor 静态站。**attrax 不再跑** |

实例 `Ubuntu-lrtz`（`instance-id-placeholder`）2026-10-11 到期，**必须续费**（这是 attrax 的生产机）。

阿里云安全组默认放行 22/80/443。

---

## 2. aliyun-sz 上 attrax 的部署结构

```
/opt/attrax/                              ← 部署根（含源码 + build + data，与 lighthouse 同路径方便复用 ecosystem.config.cjs）
├── .env / .env.local / .env.production   ← secret（600 root）
├── .rag-internal-secret                  ← 48-hex 内部鉴权（600 root）
├── .build-sha                            ← 短 commit SHA（apply-deploy.sh 从 standalone/.build-sha 拷过来）
├── scripts/ecosystem.config.cjs          ← pm2 配置（端口 require scripts/ports.env.cjs，与 nginx 同源）
├── scripts/ports.env + ports.env.cjs     ← 端口单一来源（nginx upstream / ecosystem PORT / RAG_PORT 全从这里读）
├── scripts/render-nginx-vhost.sh         ← 从 .template + ports.env 渲染 /etc/nginx/sites-enabled/attrax
├── scripts/apply-deploy.sh               ← 服务器侧部署脚本（与 lighthouse 同源）
├── scripts/build-deploy-tarball.sh       ← 本地 tarball 打包脚本
├── scripts/guard-no-server-build.mjs     ← 服务器侧 next build 拒绝守卫
├── scripts/watchdog/                     ← 法规自动入库 daemon
├── rag_service/                          ← FastAPI 应用
├── .venv/                                ← Python 3.12 虚拟环境（lighthouse 上的 3.10 不可用，已删重建）
├── .next/
│   ├── standalone/                       ← PM2 nextjs 的 cwd）
│   │   ├── server.js
│   │   ├── .next/                        ← 内嵌 Next 16 standalone manifest（不需 _next 软链）
│   │   ├── app/ + components/ + lib/ + data/ + node_modules/ subset
│   │   ├── .deployed + .build-sha        ← 部署标识
│   │   └── public/                       ← 静态资源（Next 16 standalone 不自动复制，必须手动 cp）
│   ├── static/                           ← nginx /_next/static/ alias 直接读这里
│   ├── BUILD_ID
│   ├── server/
│   └── cache/                            ← Next.js 增量编译缓存（运行时不需要）
└── data/                                 ← 法规 + KB + FAISS（lighthouse 上完整 copy 过来，additive，**不** --delete）
    ├── corpus/                           ← FAISS 索引（50M）
    ├── regulations/                      ← 16 篇 git 内 + 48 篇自动入库（生产 64 篇）
    ├── regulation_supplements/           ← watchdog 自动入库包
    ├── kb/anchors/                       ← KB YAML 锚点
    └── backend/{sessions,jobs,uploads}/  ← 运行时，gitignore
```

**关键与 lighthouse 的差异**：
- **端口**：nextjs `3000`、rag-service `8001`（与 lighthouse 相同）。⚠️ 2026-09-18 之前本文档曾写"端口偏移 3001/8002 避免与 LabMemory 撞车"——LabMemory 已于 2026-09-18 退役，偏移前提消失；且实际部署的 ecosystem 从未改过端口，nginx 照旧文档写 3001 直接导致全站 502（见 §4.4）。现在端口只认 `scripts/ports.env`
- **Python venv**：3.12（lighthouse 是 3.10）—— 不可移植，必须 aliyun-sz 上重建
- **nginx**：直接 listen 80/443（lighthouse 上 80/443 是 attrax 专用，aliyun-sz 上原本是 twinbuddy，迁移后 attrax 接管）
- **证书**：复用 `/etc/letsencrypt/live/example.com/`，server_name = `example.com www.example.com 203.0.113.10 example.com`

---

## 3. 部署流程（mac → aliyun-sz）

### 3.1 完整流程（首次或代码改动后）

```bash
# 0. mac 本地：把代码推到 origin（部署流程不会自己 git pull；
#    服务器侧靠 bundle / scp 同步源码，落后 HEAD 会让运行时缺改动）
git push origin main

# 1. 本地：build + 打包 tarball
cd /path/to/attrax
npm run build                            # 必须本地 build（服务器内存紧张）
bash scripts/build-deploy-tarball.sh     # → /tmp/attrax-deploy-complete.tar.gz
                                          #    含 standalone + static + public + .deployed + .build-sha

# 2. scp 到 aliyun-sz
scp /tmp/attrax-deploy-complete.tar.gz aliyun-sz:/tmp/

# 2.5 同步部署脚本本身
#     /tmp/attrax-apply-deploy.sh 是历史副本，**不会**随 tarball 更新。改了
#     scripts/apply-deploy.sh 就必须重新 scp，否则跑的还是旧逻辑 —— 2026-09-20
#     实测踩中：新版脚本里的 nginx reload 自检没有生效，配置静默未应用。
scp scripts/apply-deploy.sh aliyun-sz:/tmp/attrax-apply-deploy.sh

# 3. aliyun-sz 上：apply
ssh aliyun-sz 'bash /tmp/attrax-apply-deploy.sh'
# 流程：备份旧 standalone → 解 tarball 到 /opt/attrax/.next/ → 验证软链 → 写 BUILD_ID
#      → pm2 restart nextjs --update-env → 重渲染 nginx vhost（reload 后校验 worker
#      是否换代，未换代则回退 restart）→ /api/health 轮询 10 次（30s 内成功）
```

### 3.2 仅 RAG service 代码改动（不动前端 build）

```bash
scp -r rag_service/ aliyun-sz:/opt/attrax/rag_service/
ssh aliyun-sz 'pm2 restart rag-service --update-env'
# 注意 rag_service 端口：8001（单一来源 scripts/ports.env 的 RAG_PORT）
```

### 3.3 仅 .env / secret 改动

```bash
# .env 改动
scp .env aliyun-sz:/opt/attrax/.env
ssh aliyun-sz 'chmod 600 /opt/attrax/.env && pm2 restart rag-service nextjs --update-env'

# RAG_INTERNAL_SECRET 改动（48-hex 轮换）
echo -n "<new-48-hex>" > /tmp/.rag-internal-secret
scp /tmp/.rag-internal-secret aliyun-sz:/tmp/.rag-internal-secret
ssh aliyun-sz 'sudo install -m 600 -o root /tmp/.rag-internal-secret /opt/attrax/.rag-internal-secret && pm2 delete rag-service nextjs && pm2 startOrRestart /opt/attrax/scripts/ecosystem.config.cjs --only rag-service,nextjs'
```

**关键雷区**：`pm2 restart` 不读 ecosystem env 段。改 env 必须 `pm2 delete && pm2 start`。

### 3.4 回滚

```bash
ssh aliyun-sz 'bash /tmp/attrax-apply-deploy.sh --rollback'
# 恢复到上一个 standalone-pre-deploy-<timestamp>/
```

### 3.5 健康检查

```bash
# 主路径（nginx 443）
ssh aliyun-sz 'curl -skS -o /dev/null -w "HTTP %{http_code} | %{time_total}s\n" https://127.0.0.1/api/health'

# nextjs 直连（绕 nginx，定位是 nginx 还是 nextjs 问题）
ssh aliyun-sz 'curl -sS -o /dev/null -w "HTTP %{http_code} | %{time_total}s\n" http://127.0.0.1:3000/api/health'

# rag-service 直连
ssh aliyun-sz 'curl -s http://127.0.0.1:8001/ready | python3 -m json.tool'

# 公网（要看证书域名匹配）
curl -skS -o /dev/null -w "HTTP %{http_code}\n" https://example.com/api/health
curl -skS -o /dev/null -w "HTTP %{http_code}\n" https://203.0.113.10/api/health   # 证书域名不匹配警告但可用
```

`/api/health` 200 不代表 BFF → rag auth 通。**真实扫描** 一次（提交 + 轮询 + 看结果）才能确认 `RAG_INTERNAL_SECRET` 等关键 env 生效。

---

## 4. PM2 + nginx 关键配置

### 4.1 PM2（`scripts/ecosystem.config.cjs`）

端口全部来自 `require("./ports.env.cjs")`（单一来源，见 §4.4），不写数字字面量：

```js
const PORTS = require("./ports.env.cjs");
// rag-service:  args [..., "--port", String(PORTS.RAG_PORT), ...]
// nextjs:       env: { PORT: String(PORTS.NEXTJS_PORT), RAG_SERVICE_URL: `http://127.0.0.1:${PORTS.RAG_PORT}`, ... }
// portfolio:    env: { PORT: String(PORTS.PORTFOLIO_PORT), ... }   // 3002，与 lighthouse 相同
```

改端口只改 `scripts/ports.env` → `node scripts/sync-ports.js` → 重新部署（apply-deploy 会重渲染 nginx vhost + startOrRestart pm2）。

### 4.2 nginx 站点

`/etc/nginx/sites-enabled/attrax` **不再手写**——由 `scripts/render-nginx-vhost.sh` 从 `docs/infra/nginx-attrax-vhost-prod.conf.template` + `scripts/ports.env` 渲染生成（模板里 upstream 是 `127.0.0.1:__NEXTJS_PORT__` 占位符）。每次部署 apply-deploy.sh [8.5] 自动重渲染 + reload：

```bash
# 手动渲染（改完 ports.env 或模板后）
ssh aliyun-sz 'bash /opt/attrax/scripts/render-nginx-vhost.sh --out /etc/nginx/sites-enabled/attrax && nginx -t && nginx -s reload'
```

```nginx
limit_req_zone $binary_remote_addr zone=attrax_api:10m rate=10r/s;

upstream attrax_nextjs {
    server 127.0.0.1:3000;   # ← 由 ports.env.NEXTJS_PORT 渲染，勿手改
    keepalive 32;
}

server {  # HTTP → HTTPS redirect
    listen 80; listen [::]:80;
    server_name example.com www.example.com 203.0.113.10 example.com;
    location /.well-known/acme-challenge/ { root /var/www/acme-challenge; try_files $uri =404; }
    location / { return 301 https://$host$request_uri; }
}

server {  # HTTPS
    listen 443 ssl http2; listen [::]:443 ssl http2;
    server_name example.com www.example.com 203.0.113.10;
    ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
    # ... + attrax-locations.conf（与 lighthouse 同源）
}
```

**关键**：static alias 直接 `/opt/attrax/.next/static/`（不是 `.next/standalone/.next/static/`，Next 16 不复制）。

### 4.3 ufw

```bash
ufw allow 22/tcp
ufw allow 80/tcp    # ACME + HTTP → HTTPS redirect
ufw allow 443/tcp   # HTTPS
# 阿里云安全组需独立放行（默认就开 80/443，但 DNS 切到 aliyun-sz 后要确认）
```

### 4.4 端口单一来源 + 502 自愈守护（2026-09-18 事故后加）

**事故回顾**：2026-09-18 全站 502 数小时。根因是本文档旧版写着 aliyun-sz 端口偏移（nextjs 3001 / rag 8002），nginx vhost 照文档配了 `upstream 127.0.0.1:3001`；但实际部署的 `ecosystem.config.cjs` 从未偏移（nextjs 监听 3000）。nginx 连不上上游 → connection refused → 502。pm2 三进程全部 online、`/api/health` 直连 200，极具迷惑性。

**防护架构**（三层）：

1. **单一来源**：`scripts/ports.env`（`NEXTJS_PORT=3000` / `RAG_PORT=8001` / `PORTFOLIO_PORT=3002`）。
   - `ecosystem.config.cjs` `require("./ports.env.cjs")`（由 `node scripts/sync-ports.js` 从 ports.env 镜像生成）
   - nginx vhost = `docs/infra/nginx-attrax-vhost-prod.conf.template`（占位符 `__NEXTJS_PORT__`）经 `scripts/render-nginx-vhost.sh` 渲染
   - 这 8 个运维文件随每次 deploy tarball 走（`standalone/ops/`），apply-deploy.sh [6.5] 安装——不依赖服务器 git 状态

2. **部署时强制刷新**：apply-deploy.sh 每次部署都重渲染 vhost + `nginx -t` + reload（[8.5]），并用 `pm2 startOrRestart`（不是裸 restart）让 pm2 重读 ecosystem——手改的端口一律被覆盖回真值。[0] 步骤发现 vhost 与 ports.env 漂移时打 WARN。

3. **运行时自愈**：systemd timer `attrax-healthcheck.timer`（60s 一次）curl `https://example.com/api/health`（走公网域名，覆盖 nginx 这一环）：
   - 连续 3 次失败 → level2：用 render 脚本重写 vhost + `nginx -t` + reload
   - 连续 6 次失败 → level3：`pm2 restart nextjs`
   - 连续 12 次失败 → level4：`pm2 restart rag-service nextjs`
   - 恢复时打 `RECOVERED`。日志：`/var/log/attrax-healthcheck.log`；状态：`/var/lib/attrax/healthcheck/`
   - 2026-09-18 实测：人为把 upstream 改坏 → **150 秒内自动恢复 200，无人干预**

```bash
# 查看守护状态 / 日志
systemctl list-timers attrax-healthcheck.timer
tail -50 /var/log/attrax-healthcheck.log

# 手动触发一次健康检查
systemctl start attrax-healthcheck.service
```

**改端口的正确流程**（只有这一条路）：
```bash
# 本地
vim scripts/ports.env                 # 改 NEXTJS_PORT / RAG_PORT
node scripts/sync-ports.js            # 镜像到 ports.env.cjs
bash scripts/render-nginx-vhost.sh --check   # 校验渲染链路
bash scripts/build-deploy-tarball.sh && scp ... && ssh aliyun-sz 'bash /tmp/attrax-apply-deploy.sh'
```

---

## 5. Secret 处理

**单一来源 = `/opt/attrax/.rag-internal-secret`**（48-hex，600 root）。`scripts/ecosystem.config.cjs` 启动时同时注入 `rag-service` 与 `nextjs`：

```js
const RAG_INTERNAL_SECRET = (process.env.RAG_INTERNAL_SECRET
    || fs.readFileSync("/opt/attrax/.rag-internal-secret", "utf8")).trim();
if (!RAG_INTERNAL_SECRET) throw new Error("RAG_INTERNAL_SECRET is empty");
```

**绝不要**：
- 在 git 里写真值（旧值 `REDACTED_ROTATED_INTERNAL_SECRET` / `REDACTED_ROTATED_INTERNAL_SECRET` 在 git 历史暴露过，已全部失效）
- 用 PM2 ecosystem env 段硬编码 secret（应该用文件）
- 跳过 secret 直接 `pm2 restart` 启动（`APP_ENV=production` 会校验 FAISS manifest，密封失败拒绝启动）

**轮换流程**：`openssl rand -hex 24 | tr -d '\n' | sudo tee /opt/attrax/.rag-internal-secret` → `chmod 600` → `pm2 delete rag-service nextjs && pm2 startOrRestart ...`

---

## 6. Regwatch（法规自动入库）

PM2 常驻 daemon（**不是** cron-restart），每天 03:00 CST 跑一次。

```bash
# 看状态
ssh aliyun-sz 'pm2 jlist | grep regwatch'
ssh aliyun-sz 'pm2 logs regwatch --lines 100 --nostream'

# 手动跑一次
ssh aliyun-sz 'cd /opt/attrax && PYTHONPATH=. /opt/attrax/.venv/bin/python -m scripts.watchdog.orchestrator --once'

# 检查源健康
ssh aliyun-sz 'cd /opt/attrax && PYTHONPATH=. /opt/attrax/.venv/bin/python -m scripts.watchdog.check_sources'

# 查看 pending review（一次性真有变化 → 写 pending_review.json）
ssh aliyun-sz 'cat /opt/attrax/data/regulations/watchdog-$(date -u +%F)/pending_review.json 2>/dev/null'
```

默认 `ATTRAX_REGWATCH_AUTO_INGEST=true` → 真实变化自动入库，退出码改写为 0（异常时仍是 2/3）。

---

## 7. 数据迁移（attrax 自身的 source/data 同步）

> 仅在 aliyun-sz 与 lighthouse 双跑期间需要；现 lighthouse 已停，**这条只用于全量 reimport**。

`data/regulations/` 必须 **additive** 同步（不 `--delete`）：

```bash
# 1. 打包 lighthouse data（排除 .venv/node_modules 等）
ssh lighthouse 'sudo tar --exclude=./.venv --exclude=./node_modules --exclude=./__pycache__ \
  --exclude=./.cache --exclude=./logs --exclude=./.git/objects \
  --exclude=./frontend/dist --exclude=./frontend/node_modules \
  -czf /tmp/attrax-data.tgz -C /opt/attrax data'

# 2. 拉过去解包
scp lighthouse:/tmp/attrax-data.tgz aliyun-sz:/tmp/
ssh aliyun-sz 'cd /opt/attrax && tar -xzf /tmp/attrax-data.tgz'

# 3. 重建 FAISS 索引（如 KB 变化）
ssh aliyun-sz 'cd /opt/attrax && PYTHONPATH=. .venv/bin/python -c \
  "from rag_service.indexing.auto_ingest import AutoIngestor; AutoIngestor()._rebuild_index()"'
```

**不要** `rsync --delete /opt/attrax/data/`——服务器上 git 外的生产数据（自动入库的法规 + 评测产物）会丢。

---

## 8. 雷区（迁移后仍生效）

- **不要在 aliyun-sz 上 `npm run build`**（2026-09-16 + 2026-09-18 两次实测 OOM）：1.6G 内存 + next build 内存峰值会顶死 sshd。强制走本地 build → scp → apply-deploy.sh
- **`pm2 restart` 不读 env 段**：env 改动必须 `pm2 delete && pm2 start`
- **Next 16 standalone 不复制 `.next/static/`** + 不复制 `public/` 到 `standalone/public/`：必须 tarball 阶段手动 stage（`build-deploy-tarball.sh` 已做）+ 服务器侧 `apply-deploy.sh` 不重建软链（直接放在 build root）
- **nginx `_next/static/` 用 `alias <root>/.next/static/`**（不是 standalone 内部）
- **nginx heredoc 写 `$binary_remote_addr` 会被 shell 吞掉**——必须用 scp 上传文件或 `tee <<'EOF'`（单引号 heredoc）
- **`/api/health` 200 不代表 RAG auth 通**——必须真实扫描一次
- **不要 `--delete` 同步 `data/regulations/`**——自动入库数据会丢
- **不要跳过 FAISS manifest seal**——`APP_ENV=production` 启动校验失败
- **证书现复用 twinbuddy 的**——访问 `example.com` 或 `203.0.113.10` 会有证书域名不匹配警告。要正式切域名：DNS A 记录改 203.0.113.10 + certbot 申请 `example.com` 证书
- **nginx `limit_conn_zone` 必须先于 vhost 引用存在（2026-09-18 并发加固批次事故）**：`limit_conn_zone` 只能在主 `/etc/nginx/nginx.conf` 的 `http {}` 段定义；vhost 只能 `limit_conn attrax_conn 20` 引用。如果只改 `docs/infra/nginx-attrax-vhost-prod.conf.template` 加 vhost 引用、忘了把 `limit_conn_zone` 收录到主 conf 的 `http {}` 段，`nginx -t` 会报 `zero size shared memory zone`，`apply-deploy.sh [8.5]` 在 render + reload 之前就 fail-stop。**两处必须同时改**：`docs/infra/nginx-nginx.conf` 显式收录 + `docs/infra/nginx-attrax-vhost-prod.conf.template` 引用；`apply-deploy.sh [8.5]` 在 render 前自检主 conf 是否含 `limit_conn_zone ... attrax_conn:10m`，缺则按同样字符串在 `keepalive_requests 100` 之后插入（idempotent），防止任何后续 PR 只改 vhost 时再次复发

---

## 9. lighthouse 上的 attrax 残留（2026-09-20 已清零）

| 项 | 状态（2026-09-20 全部清除/迁移完毕） |
|---|---|
| PM2 nextjs / rag-service / regwatch | 已 `pm2 delete`（进程不存在）；旧 pm2 日志已删 |
| nginx attrax 站点 / 片段 | `sites-available/attrax`、`snippets/attrax-locations.conf`、`attrax-engagement.conf` 已删；`conf.d/attrax-gzip.conf` 改名 `compression.conf`（全站共用，内容不变） |
| `/opt/attrax` 数据 | **已于 2026-09-20 整目录删除**（attrax 只保留 aliyun-sz 一份；媒体原稿先归档到 mac `~/archives/attrax-media-originals-2026-09-20/`） |
| 定时任务 / logrotate | `/etc/cron.d/attrax-backup{,-remote}`、`/etc/logrotate.d/attrax` 已删 |
| 监控残留 | lighthouse 的 uptime-check v5（移除 4 个 attract 探针、新增 main-https）、collector（移除 attract 站点映射与 3000/8001 健康探测）、monitor 前端文案已同步清理 |
| `~/.ssh/config` | `Host lighthouse` 仍保留（portfolio / study / monitor 仍用） |

---

## 10. 待办

1. **2026-10-11 前**给 aliyun-sz 续费（迁移后这条更要紧：实例过期 attrax 整站下线）
2. ~~**`example.com` DNS 切换**~~ —— **2026-09-20 决定不做**：主域名由 lighthouse 上的 portfolio 承接（HTTPS 已配好，vhost `sites-available/example.com`）。attrax 的公开入口 = `example.com` / IP。
3. **数据备份异地化**：`scripts/backup-remote.sh`（lighthouse 时代）需重新校准目标，aliyun-sz 上验证一次自动跑
4. **regwatch 健康持续监测**：30 个 source（09-17 审计后）全 healthy；接入告警（runbook §7）
5. ~~**访问域名 cert 不匹配告警**~~ —— 已消解（2026-09-20）：`example.com` 不再指向 aliyun-sz（改由 lighthouse 的 portfolio 承接）；`example.com` 无 warning。

---

*最后更新：2026-09-20（lighthouse 残留全清 + 主域名 example.com 改由 lighthouse 上的 portfolio 承接）*