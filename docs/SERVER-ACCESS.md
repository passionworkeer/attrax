# 服务器 SSH 连接参考（2026-07-18）

> 这台机器怎么连到 `120.77.36.107`，写下来免得每次都翻聊天记录。

## 1. 基础信息

| 项 | 值 |
|---|---|
| 服务器 IP | `120.77.36.107` |
| 部署用户 | `admin`（不是 root） |
| SSH 端口 | `22`（默认） |
| 认证方式 | 公钥 only（`PasswordAuthentication no`） |
| 本地私钥 | `C:\Users\04735\.ssh\id_ed25519` |
| 公钥 | `C:\Users\04735\.ssh\id_ed25519.pub` |
| 部署目录 | `/opt/attrax/` |
| 进程管理 | pm2（systemd `pm2-root.service`） |
| 公开域名 | `twinbuddy.xyz` / `www.twinbuddy.xyz` |

> **不要用 `root@`**：服务器只允许 `admin`（也允许公钥登录的其他用户），root 走不通。

## 2. 一行连接

```bash
ssh -i /c/Users/04735/.ssh/id_ed25519 admin@120.77.36.107
```

放到 `~/.ssh/config` 里更省事：

```
Host attrax
  HostName 120.77.36.107
  User admin
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes
  ServerAliveInterval 30
  ServerAliveCountMax 5
```

之后：

```bash
ssh attrax
scp file.tar.gz attrax:/tmp/
```

## 3. 在 Claude Code 里怎么调

**推荐：用 `!` 前缀把命令在本地已认证的 shell 里跑**（不进入 Claude 的 SSH 会话，结果直接回写到对话里）：

```
! ssh attrax 'pm2 list'
! scp build.tar.gz attrax:/tmp/
```

**或者直接 `Bash` 工具调**（每条命令一个新 SSH 连接，状态不保留）：

```bash
ssh -i /c/Users/04735/.ssh/id_ed25519 -o StrictHostKeyChecking=no \
    admin@120.77.36.107 'cd /opt/attrax && ls -la .next/standalone/.next/BUILD_ID'
```

加 `-o StrictHostKeyChecking=no` 是因为首次连会有 fingerprint 提示，脚本里加这个跳过交互。

## 4. 防火墙 / 网络

| 来源 | 目标端口 | 用途 |
|---|---|---|
| 本地 / 公网 | `22` | SSH |
| 公网 | `443` | nginx → nextjs `127.0.0.1:3000` |
| 公网 | `80` | nginx → 301 跳 https |
| `127.0.0.1`（nextjs）| `8001` | RAG service（仅 loopback） |

服务器防火墙（`ufw` / `firewalld`）默认放行 22 + 80 + 443。**RAG 8001 端口仅 loopback 监听**，不对公网。

## 5. 关键路径速查

```
/opt/attrax/                          # 部署根（tarball + 上传覆盖）
├── .env                              # 600 权限，build 时嵌入 standalone
├── .env.production                   # 600 权限，运行时
├── .next/standalone/                 # next 16 standalone build 根
│   ├── server.js                     # next 入口
│   ├── .next/BUILD_ID                # 当前 commit build id
│   ├── .next/static/                 # chunks + media
│   ├── public/                       # 静态资源（fonts/ 必须有）
│   ├── node_modules/                 # 生产 deps
│   └── data/                         # 业务数据（corpus/faiss 等）
├── rag_service/.env                  # 600 权限，RAG 启动时读
├── scripts/ecosystem.config.cjs      # pm2 配置
├── logs/                             # request log 等
├── backups/                          # 完整备份目录
└── pre-fix-*/                        # 每次部署前的 standalone 备份
```

```
/var/log/
├── attrax-next.log / .err.log        # nextjs stdout/stderr
├── attrax-rag.log / .err.log         # RAG stdout/stderr
└── nginx/...
```

```
/home/admin/.pm2/                    # pm2 dump（daemon 状态）
/etc/nginx/sites-enabled/attrax      # nginx vhost
/etc/letsencrypt/live/twinbuddy.xyz/ # SSL 证书
```

## 6. 常用命令

### 服务状态

```bash
ssh attrax 'env PM2_HOME=/home/admin/.pm2 /opt/attrax/node_modules/.bin/pm2 list'
ssh attrax 'systemctl status nginx pm2-root fail2ban'
```

### 日志

```bash
ssh attrax 'tail -50 /var/log/attrax-next.log'
ssh attrax 'tail -50 /var/log/attrax-next.err.log'   # nextjs 错误
ssh attrax 'tail -50 /var/log/attrax-rag.log'         # RAG stdout
ssh attrax 'tail -50 /var/log/attrax-rag.err.log'    # RAG 错误
```

### 健康检查

```bash
# nextjs 内部
curl -s https://www.twinbuddy.xyz/api/health | python -m json.tool

# RAG 直接（loopback）
ssh attrax 'curl -s http://127.0.0.1:8001/health'
```

### 部署 / 重启

```bash
# 部署（本地 → 服务器）
scp build.tar.gz attrax:/tmp/
ssh attrax 'bash /tmp/apply-fix-v2.sh'   # 一键：standalone + static + public + restart + 验证

# 单独 restart（注意：pm2 restart --update-env 不重新读 ecosystem.config.cjs）
ssh attrax 'env PM2_HOME=/home/admin/.pm2 /opt/attrax/node_modules/.bin/pm2 restart nextjs --update-env'

# 改了 ecosystem.config.cjs 之后，必须 delete + start
ssh attrax 'env PM2_HOME=/home/admin/.pm2 /opt/attrax/node_modules/.bin/pm2 delete nextjs'
ssh attrax 'env PM2_HOME=/home/admin/.pm2 /opt/attrax/node_modules/.bin/pm2 start /opt/attrax/scripts/ecosystem.config.cjs --only nextjs'
```

### 资源

```bash
ssh attrax 'free -m'              # 内存
ssh attrax 'df -h /opt/attrax'    # 磁盘
ssh attrax 'ps -p <PID> -o pid,etime,cmd'  # 进程 runtime
```

## 7. 已知坑

- **`pm2 restart --update-env` 不重新读 ecosystem.config.cjs**——改了那文件必须 `delete` + `start`。
- **next.js 16 standalone 不带 `.env.production`**——`RAG_SERVICE_URL` / `RAG_INTERNAL_SECRET` 必须通过 ecosystem.config.cjs 的 `env` 注入，**不要靠 `.env.production` 文件**。
- **`localhost:8001` 在 nextjs 进程里会先试 IPv6 `::1` 然后失败**——`RAG_SERVICE_URL` 必须用 `http://127.0.0.1:8001`。
- **公网证书 `twinbuddy.xyz` 跟 `www.twinbuddy.xyz` 都用**——nginx 两个 server name 都配了。

## 8. 紧急情况

### 502 / fetch failed（nextjs → RAG 调不通）

```bash
# 看 nextjs 进程有没有 RAG_SERVICE_URL
ssh attrax "pgrep -f next-server | xargs -I{} sh -c 'cat /proc/{}/environ' | tr '\0' '\n' | grep RAG_"
# 应该看到 RAG_SERVICE_URL=http://127.0.0.1:8001
# 如果没看到 → pm2 没读新 ecosystem，必须 delete + start
```

### 整机 OOM（npm / build 卡住）

`1.6GB` ECS 容器跑 `npm install` / `next build` 容易 OOM。**不要在服务器跑 npm ops**——本地 build 后 scp 产物。

### rollback

```bash
# 看有哪些备份
ssh attrax 'ls -td /opt/attrax-pre-* /opt/attrax-backup-*'

# restore (示例: rollback 到 pre-fix-20260718-152602)
ssh attrax '
  PREV=/opt/attrax-pre-fix-20260718-152602
  cp -a $PREV/standalone /opt/attrax/.next/
  env PM2_HOME=/home/admin/.pm2 /opt/attrax/node_modules/.bin/pm2 delete nextjs
  env PM2_HOME=/home/admin/.pm2 /opt/attrax/node_modules/.bin/pm2 start /opt/attrax/scripts/ecosystem.config.cjs --only nextjs
'
```

更早的整盘备份在 `/opt/attrax-backup-*/`，目录完整 `attrax-backup-{ts}.tar.gz`。

---

*文档创建于 2026-07-18*
*适用部署 commit: `7f8398e` (origin/codex/backend-decoupling)*
*对应 BUILD_ID: `xeMxi3QSjvxVEi0ZELUGP`*