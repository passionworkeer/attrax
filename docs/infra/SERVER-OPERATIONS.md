# 服务器运维操作手册（aliyun-sz 203.0.113.10）

> 本文档是服务器侧日常运维的标准操作流程。所有操作都有「先做哪步、后做哪步」的硬性顺序，违反顺序会产生文档末尾「事故档案」里的同款问题。

## 一台机器长什么样

- **角色**：attrax 生产环境（前端 + RAG 服务 + watchdog + nginx + 备份链路）
- **公网**：HTTPS `https://example.com`（证书 nginx）
- **SSH 别名**：`aliyun-sz` → `203.0.113.10`（root，banner 提示登录即审计）
- **内存**：约 1.6 G 物理 + 4 G swap——**贴着天花板设计**，不要在机器上跑任何构建任务
- **磁盘**：`/dev/vda3` 40 G，`/opt/attrax` 是代码、`data/backend/{sessions,jobs,uploads}` 是运行时、`/opt/attrax/backups` 是每日备份
- **进程**：`pm2` 管三个应用——`nextjs`（3000）、`rag-service`（8001）、`regwatch`（法规自动入库）、`portfolio`（**当前未部署**，目录不存在，每次 `pm2 start` 会报 `Script not found`，见文末「已知缺陷」）

## 一、登录与零信任前提

- 用 `ssh aliyun-sz`，登录即落审计
- **进入 `/opt/attrax` 后请假定一切改动都会上线**——这是生产路径，没有 staging 环境
- **绝不在服务器上跑任何构建命令**（`next build` / `next dev` / `npx next` 等）。`npm run build` 有 `prebuild` 守卫会拒绝，但绕过前缀或环境变量就能绕过。直接后果见文末「事故档案 §2」

## 二、部署流程（唯一入口：tarball）

完整命令链：

```bash
# 本地 —— 构建并打包
ATTRAX_TARBALL=$PWD/tmp/attrax-deploy-complete.tar.gz bash scripts/build-deploy-tarball.sh

# 本地 —— 上传到服务器
scp tmp/attrax-deploy-complete.tar.gz aliyun-sz:/tmp/

# 服务器 —— 执行部署
ssh aliyun-sz 'bash /tmp/attrax-apply-deploy.sh'
```

**关键点**：

- `build-deploy-tarball.sh` 输出物：BUILD_ID、commit SHA、`.deployed` 标识、`.next/standalone/`（含 stage 好的 `.next/static/` 与 `public/`）、`standalone/ops/`（运维脚本真值源：ports.env、render-nginx-vhost.sh、ecosystem.config.cjs、healthcheck 三件套、nginx vhost 模板、备份脚本）
- `apply-deploy.sh` 流程：preflight → snapshot 旧树 → 解包 → 重连 static 软链 → 写 BUILD_ID → 安装 ops 文件 → 重新渲染 nginx vhost → `pm2 startOrRestart` → health gate 10 次重试。任何一步失败自动回滚到上一份 `standalone-pre-deploy-*`
- **环境变量 `ATTRAX_TARBALL` / `ATTRAX_DIR`** 可覆盖默认路径
- 回滚命令：`ssh aliyun-sz 'bash /tmp/attrax-apply-deploy.sh --rollback'`（默认只保留最近 2 份快照）

### 仅后端（rag_service）变更

`apply-deploy.sh` 只处理 Next.js。改了 `rag_service/*.py` 走另一条链：

```bash
scp -r rag_service aliyun-sz:/opt/attrax/
ssh aliyun-sz 'pm2 restart rag-service --update-env'
```

## 三、关键文件与「真值源」

| 文件 | 作用 | 修改方式 |
|------|------|---------|
| `scripts/ports.env`（同源 cjs） | 端口单一来源（3000 / 8001 / 3002） | 改这里，deploy 会重渲染 vhost 并 reload |
| `scripts/ecosystem.config.cjs` | pm2 应用清单与 cwd/port/env | 改这里，与 ports.env 同源 |
| `docs/infra/nginx-attrax-vhost-prod.conf.template` | nginx vhost 模板（带 `__NEXTJS_PORT__` 占位符） | 改这里 |
| `scripts/render-nginx-vhost.sh` | 模板渲染脚本（`--check` 验证端口等于 ports.env） | 改这里 |
| `/opt/attrax/.deployed` | 当前部署的 commit / BUILD_ID | 自动写入 |
| `/opt/attrax/.build-sha` | 当前 commit SHA（rag-service 启动时读作 `ATTRAX_BUILD_SHA`） | 自动写入 |
| `/etc/nginx/sites-enabled/attrax` | 渲染后的 nginx vhost 唯一真值 | **不要直接编辑**，deploy 会重渲染 |
| `/etc/systemd/system/attrax-healthcheck.{service,timer}` | 60s 一次公网 healthcheck，连续失败自愈 | deploy 会重装并 `enable` |
| `/etc/cron.d/attrax-backup{,-remote}` | 每日本地与异地备份（root 身份跑） | **必须 root**，否则 cron 静默跳过 |

## 四、应急处置速查

### 4.1 整站 502

```bash
ssh aliyun-sz 'curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/health'  # 直连
ssh aliyun-sz 'grep -E "^[[:space:]]*server" /etc/nginx/sites-enabled/attrax | head -3'  # 看 upstream
ssh aliyun-sz 'grep NEXTJS_PORT /opt/attrax/scripts/ports.env'                              # 看真值
```

不匹配就 `pm2 restart nextjs` 或重跑 `bash /opt/attrax/scripts/render-nginx-vhost.sh --out /etc/nginx/sites-enabled/attrax && nginx -s reload`。更深原因见 `docs/infra/ALIYUN-SZ-DEPLOY.md` §8 + `docs/infra/PORTS.md`「历史」段。

### 4.2 进程掉了

```bash
ssh aliyun-sz 'pm2 ls'
ssh aliyun-sz 'pm2 startOrRestart /opt/attrax/scripts/ecosystem.config.cjs'
ssh aliyun-sz 'systemctl is-enabled pm2-root'   # 确认开机自启启用
ssh aliyun-sz 'systemctl status attrax-healthcheck.timer'
```

如果 pm2 没自启：`pm2 startup systemd -u root --hp /root && pm2 save`（2026-09-19 之前没配过，导致重启后进程全空）。

### 4.3 资源耗尽（假死）

ping 通但 SSH / HTTPS 超时：内存被吃光，sshd fork 不出会话，nginx 分配不出 TLS 握手缓冲区。**唯一办法是通过云控制台硬重启**——SSH 这时进不去。重启后第一件事：

```bash
ssh aliyun-sz 'dmesg | grep -iE "out of memory|killed process" | tail -20'
ssh aliyun-sz 'pm2 logs --lines 200 --nostream | tail -80'
```

### 4.4 回滚

```bash
ssh aliyun-sz 'ls -dt /opt/attrax/.next/standalone-pre-deploy-* | head -3'   # 看可用快照
ssh aliyun-sz 'bash /tmp/attrax-apply-deploy.sh --rollback'                  # 退到最近一份
```

注意：`--rollback` 会消费掉最近一份快照；连续跑会再往上一代退。

## 五、自愈与监控

- **healthcheck timer**：每 60s `curl` 公网 `/api/health`，连续 3 次失败重渲染 vhost 并 reload；6 次 `pm2 restart nextjs`；12 次连 rag-service 一起重启。日志 `/var/log/attrax-healthcheck.log`
- **备份**：`/etc/cron.d/attrax-backup` 每日 03:00 用 root 跑 `backup-data.sh`（先 cp -al 快照再打包，纳入 `backend/{sessions,jobs,uploads}`）；`backup-remote` 异地（`BACKUP_REMOTE_DEST` 空时仅本地）
- **法规 watchdog**：`regwatch` 应用由 ecosystem 守护，每晚巡查 35 个源、抓取变更、入库 `data/regulations/`，凌晨 03:00 自动 ingest
- **审计留存**：管理员 BI 看板依赖审计日志；`backup-data.sh` 调用前先跑 `retain-admin-audit.py` 强制留存当日日志，避免轮转丢历史

## 六、禁忌清单（违反即上线事故）

- **绝不在服务器跑 `npm run build` / `npx next build` / `next dev`**——`next build` 一开跑就清空 `.next/`，连 pm2 正在运行的 `nextjs` 的 cwd（`.next/standalone`）一起删掉。进程不会立刻死，所以 `/api/health` 和首页仍返回 200 看着像没事；但已加载路由照常、没加载的逐个 ChunkLoadError→500 + nginx `root /opt/attrax/.next/standalone/public` 失效 → `/complipilot/*` 图片视频全 404。详见文末「事故档案 §2」
- **不要在 `sites-available/attrax` 改 vhost**——它是旧手工流程副本，端口漂移后 deploy 渲染会改回真值；任何「从 sites-available 恢复」的标准 Debian 操作都会把 502 带回来。apply-deploy [8.5] 每次部署都会清掉它
- **不要直接改 `/etc/nginx/sites-enabled/attrax`**——会被下次 deploy 重渲染覆盖。改 nginx 只能改 `docs/infra/nginx-attrax-vhost-prod.conf.template`，下次部署自动生效
- **不要 `pm2 restart` 改 env**——env 段变化必须 `pm2 delete && start`（或 `startOrRestart`）。换 `.env` 文件 `pm2 restart` 即可（pydantic-settings 每次启动读）
- **不要手动 mv `.next/standalone`**——会被下一次 deploy 当作旧树挪走丢掉；改 standalone 只能通过 tarball
- **不要 rsync/tar `.next/standalone/` 时用 openrsync**——大目录会崩，必须用 `tar -C .next -czf - X | ssh aliyun-sz 'tar -xzf -'`

## 七、跨主机工作流

部署只同步**运行时产物**（tarball + ops），不同步 git 仓库。要同步 git 走 bundle：

```bash
# 本地 → 服务器
git bundle create tmp/attrax.bundle main
scp tmp/attrax.bundle aliyun-sz:/tmp/
ssh aliyun-sz 'git -C /opt/attrax fetch /tmp/attrax.bundle main:bundle-tmp && git -C /opt/attrax merge --ff-only bundle-tmp && git -C /opt/attrax branch -D bundle-tmp'
```

服务器侧改数据（法规库新增/修改）：

```bash
# 服务器 → 本地
ssh aliyun-sz 'git -C /opt/attrax bundle create /tmp/attrax-out.bundle --all'
scp aliyun-sz:/tmp/attrax-out.bundle tmp/
git fetch tmp/attrax-out.bundle 'refs/heads/*:refs/remotes/attrax-sz/*'
```

服务器 git HEAD 落后是常态——主仓合入 PR 后服务器 git 不会自动同步，必须显式 bundle。

## 八、事故档案

### §1 全站 502（nginx upstream 端口漂移，2026-09-18）

`/etc/nginx/sites-enabled/attrax` 写 `127.0.0.1:3001`，ecosystem 里 nextjs 一直监听 3000——生态偏移前提早已不存在。pm2 三进程 online、直连 200，只有公网 502。修复：upstream 3001→3000 + `nginx -s reload`。根治三层：端口单一来源 `scripts/ports.env` + 部署强制刷新（apply-deploy [8.5]）+ healthcheck timer 自愈（实测人为改坏 150s 自动恢复）。

### §2 全站 500 + 图片 404（服务器侧 `next build` 删掉运行中的 standalone，2026-09-16）

`/opt/attrax/.next/standalone` 被删——pm2 `nextjs` 进程的 cwd 指向已删除目录。日志 `ChunkLoadError`、`Invariant: client reference manifest for route "/profit/[sessionId]" does not exist`、`/500 ENOENT ... pages/500.html`、`/complipilot/*` 图片视频全 404。触发者：在服务器 `/opt/attrax` 里跑的 `npm install && npm run build`（`/tmp/attrax-build.done` = `BUILD_DONE_127`、`BUILD2_DONE_1`，两次都没成功）。修复：本地重建完整 tarball → scp → 解包 → `.next/static` 重指软链 → `pm2 restart nextjs`。治本：`scripts/guard-no-server-build.mjs` + `package.json` `prebuild` 钩子，cwd 在 `/opt/` 下直接拒绝构建（`ATTRAX_ALLOW_SERVER_BUILD=1` 可放行）。

### §3 复刻 §2（同一坑踩第二遍，2026-09-19）

18:23 root 从非常用 IP `198.51.100.145` 登录（推测为协作者或 AI 编码 CLI），服务器 git 拉到 `78c0040`（19:04 才合入的 PR #8），19:13 `/opt/attrax/.next/` 被 `next build` 清空重建（目录里只有 `build/ cache/ server/ turbopack/`，没有 `standalone/`、没有 BUILD_ID，构建没跑完）。1.6G 内存被构建巨兽压垮，sshd fork 不出会话，整机假死数小时。**内核日志无 OOM kill 记录**——不是 OOM，是被构建直接打死。bash history 里有 `codex --version`——登录者在用 AI CLI 操作，大概率是它自主跑了构建（绕过 `npm run build` 守卫）。重启后补的两件事：① pm2 开机自启（之前根本没配，重启后进程全空）；② rag-service 走 git 不走 tarball 的快进流程首次实战（之前机器上没人跑过）。**请和协作者核对 `198.51.100.145` 是谁的 IP，并明确「部署只能走 tarball 流程，绝不在服务器构建」**。

### §4 /admin 与 `/etc/nginx/sites-available/attrax` 3001 地雷（2026-09-18）

`/etc/nginx/sites-available/attrax` 是旧手工流程副本仍写 3001，任何「从 sites-available 恢复」的标准 Debian 操作都会把 502 带回来。apply-deploy [8.5] 渲染后顺手删除（仅当 sites-enabled/attrax 非软链）。

## 九、已知缺陷

- `portfolio` 应用在 `ecosystem.config.cjs` 里有定义（端口 3002），但服务器上 `/opt/portfolio` 整个不存在——**它从未部署过**。每次 `pm2 start scripts/ecosystem.config.cjs` 都会报 `Script not found: /opt/portfolio/.next/standalone/server.js`，但不影响其他三个应用启动。要么部署它、要么从 ecosystem 配置移除
- 1.6G 内存跑生产偏紧。`SCAN_WORKER_CONCURRENCY=5` 是默认值，高峰期可能内存峰值冲到上限；长期方案是升配或下调到 2–3
- 异地备份未启用：`BACKUP_REMOTE_DEST` 留空，`backup-remote` cron 仅做本地备份，单盘风险仍在

## 相关文档

- [`ALIYUN-SZ-DEPLOY.md`](./ALIYUN-SZ-DEPLOY.md) — 历史部署生产语义细节（构建 / 端口单一来源 / nginx 雷区）
- [`NEXTJS-16-STANDALONE-NOTES.md`](./NEXTJS-16-STANDALONE-NOTES.md) — Next 16 standalone 构建坑（static 软链、public 软链、构建路径）
- [`PORTS.md`](./PORTS.md) — 端口台账
- [`../README.md`](../README.md) — 文档索引