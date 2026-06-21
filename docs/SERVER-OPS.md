# Attrax Production Server — Operations Manual

> **当前生产部署**: Alibaba Cloud ECS `120.77.36.107`,无 Docker 部署,Node 22 + Python 3.12 venv + pm2 + systemd。
> 最后更新: 2026-06-21

本文档面向接手运维的同事,记录当前生产服务器的连接方式、运行服务和日常操作。Docker 部署说明见 `DEPLOYMENT.md`(已弃用)。

---

## 1. 快速连接

```bash
# SSH (使用密钥认证,无需密码)
ssh root@120.77.36.107
```

> **不要修改 SSH 配置或重装系统**。服务器上已有 1.6GB RAM + 4GB swap,内存紧张,任何变更前先看本文第 6 节「常见问题」。

| 项目 | 值 |
|------|-----|
| 公网 IP | `120.77.36.107` |
| SSH 用户 | `root`(密钥认证) |
| SSH 端口 | `22`(默认) |
| 前端公网端口 | `3000` |
| RAG 内网端口 | `8001` (仅 `127.0.0.1`,不直接对外) |
| 系统用户 | `root` / `admin`(无密码 SSH,无 sudo) |

**注意**: RAG 服务的 `8001` **不直接对外开放**。所有流量必须经过前端 `3000` 反向代理到 `127.0.0.1:8001`。这是阿里云 NAT 端口映射配置决定的(只有 3000 被正确代理)。

---

## 2. 访问入口

### 公网

```
http://120.77.36.107:3000
```

### 端到端验证

```bash
# 健康检查 (前端 + RAG 状态)
curl http://120.77.36.107:3000/api/health

# 预期响应
{"timestamp":"...","frontend":"ok","ragService":{"status":"ok","responseTimeMs":<10-50>,"error":null},"demoMode":false}
```

### 内网直连(仅 SSH 登录后可用)

```bash
curl http://127.0.0.1:3000/api/health     # 前端
curl http://127.0.0.1:8001/health         # RAG 服务
```

---

## 3. 架构

```
┌─────────────────────────────────────────────────────┐
│ 公网:120.77.36.107:3000 (Next.js standalone)         │
│ /opt/attrax/.next/standalone/server.js              │
│ pm2 id=2, pid 当前(用 pm2 list 查)                 │
│ 内存 ~100 MB                                          │
└──────────────────────┬──────────────────────────────┘
                       │ RAG_SERVICE_URL=http://127.0.0.1:8001
                       ↓
┌─────────────────────────────────────────────────────┐
│ 内网:127.0.0.1:8001 (FastAPI + LangGraph)            │
│ /opt/attrax/.venv/bin/uvicorn rag_service.main:app   │
│ pm2 id=1                                             │
│ 内存 ~750-800 MB                                      │
│ - FAISS IndexFlatIP, 1024 维, 7170 向量              │
│ - BM25 (jieba)                                       │
│ - ModelScope Qwen3-Embedding-0.6B (云端 API)        │
│ - MiniMax-M3 LLM (Anthropic 兼容,api.minimaxi.com)   │
└─────────────────────────────────────────────────────┘
```

**为什么是 1 个 worker**: 单进程串行处理扫描请求。LLM 调用 60-120 秒/次,多 worker 反而触发 API 限流(经验值)。

---

## 4. 目录结构(关键路径)

```
/opt/attrax/
├── .env                              # 环境变量(API keys 在此)
├── .next/
│   ├── static/                       # Next.js 构建产物(源)
│   └── standalone/                   # 实际运行目录(server.js)
│       ├── server.js                 # Next.js standalone 入口
│       ├── .next/                    # 包含 BUILD_ID 等
│       ├── public/                   # 静态资源(每次 build 后 copy)
│       └── data/                     # 运行时数据(见下)
├── rag_service/                      # Python RAG 源码
│   ├── .venv/                        # Python 3.12 虚拟环境
│   ├── main.py                       # FastAPI 入口(端口 8001)
│   ├── config.py
│   ├── orchestrator/                 # LangGraph 节点
│   ├── retrieval/                    # FAISS + BM25 + Embedding
│   ├── generate/                     # LLM 报告生成
│   └── verify/                       # 引用验证
├── data/                             # 数据文件
│   ├── faiss/legal_chunks.index      # FAISS 索引(7170 向量)
│   ├── faiss/legal_chunks_meta.json
│   ├── corpus/                       # 法规语料
│   └── regulation_supplements/       # 法规补充包
├── node_modules/pm2/                 # pm2 本地安装
└── scripts/ecosystem.config.cjs      # pm2 进程配置

/opt/attrax/.next/standalone/data/    # 运行时数据(Next.js 进程内)
├── sessions/                         # 扫描会话(SESSION_TTL_MS=1h)
└── scan-queue/                       # 扫描任务队列

/var/log/
├── attrax-rag.log                    # RAG stdout
├── attrax-rag.err.log                # RAG stderr
├── attrax-next.log                   # Next.js stdout
└── attrax-next.err.log               # Next.js stderr(含扫描错误日志)
```

---

## 5. 日常操作

### 5.1 服务管理(pm2)

**所有 pm2 命令必须从 `/opt/attrax` 目录运行**(pm2 在 `node_modules` 本地安装)。

```bash
ssh root@120.77.36.107
cd /opt/attrax

# 查看进程状态
node_modules/pm2/bin/pm2 list

# 预期输出
# ┌────┬────────────────┬─────────┬────────┬──────────┐
# │ id │ name           │ status  │ ↺      │ mem      │
# ├────┼────────────────┼─────────┼────────┼──────────┤
# │ 2  │ nextjs         │ online  │ 0      │ ~100 MB  │
# │ 1  │ rag-service    │ online  │ 0-2    │ ~750 MB  │
# └────┴────────────────┴─────────┴────────┴──────────┘

# 重启单个服务
node_modules/pm2/bin/pm2 restart nextjs
node_modules/pm2/bin/pm2 restart rag-service

# 启动/停止
node_modules/pm2/bin/pm2 start rag-service   # 用于首次或 stop 后
node_modules/pm2/bin/pm2 stop rag-service     # 释放内存(为 build 准备)
node_modules/pm2/bin/pm2 stop nextjs

# 查看实时日志
node_modules/pm2/bin/pm2 logs                 # 全部
node_modules/pm2/bin/pm2 logs rag-service     # 单个

# 详细进程信息
node_modules/pm2/bin/pm2 show rag-service
```

**重要约束**: pm2 配 `max_memory_restart`,超过自动重启。rag-service 阈值 900MB,nextjs 阈值 500MB。如果 `↺` 计数持续增长,说明服务在 OOM 重启循环(看第 6 节)。

### 5.2 开机自启

`pm2-root.service` systemd 单元已配置,服务器重启后 pm2 会自动拉起两个服务。

```bash
# 检查状态
systemctl is-active pm2-root
systemctl status pm2-root

# 重启后,pm2 resurrect 拉起进程
# 验证:重启后等 30s,curl /api/health
```

### 5.3 查看日志

```bash
# 实时跟踪
tail -f /var/log/attrax-rag.log
tail -f /var/log/attrax-rag.err.log
tail -f /var/log/attrax-next.err.log     # 扫描错误主要在这

# 最近 50 行
tail -50 /var/log/attrax-rag.err.log
```

**关键日志信号**:

| 信号 | 含义 |
|------|------|
| `mimoTalk report generated (NNNN chars)` | LLM 真实生成报告 |
| `rag-service ready` | 启动完成 |
| `POST /scan-multipart HTTP/1.1 504` | 扫描超时(>280s)|
| `Invalid input: expected string, received null` | Zod schema 不匹配(见第 6 节)|
| `Embedding query failed: Text too short or binary` | 查询文本为空(正常) |

### 5.4 修改代码后重新部署

**关键:必须先停 rag-service 再 build,否则 1.6GB 内存 + 800MB uvicorn 同时跑会 OOM(已经踩过这个坑 2 次)。**

```bash
ssh root@120.77.36.107
cd /opt/attrax

# 1. 停 rag-service(释放 ~800MB)
node_modules/pm2/bin/pm2 stop rag-service
sleep 5

# 2. 修改代码(本地编辑后 scp 上传,或 vim 直接改)
#    - Next.js 代码 → /opt/attrax/...
#    - RAG 代码 → /opt/attrax/rag_service/...

# 3. 如果改了 Next.js,需要重新 build
chown -R admin:admin /opt/attrax/.next/standalone   # 防止权限问题
su admin -c 'rm -rf .next/standalone/data && NODE_OPTIONS=--max-old-space-size=1024 npm run build'

# 4. 拷贝构建产物到 standalone
su admin -c 'set -e
cd /opt/attrax
rm -rf .next/standalone/.next/static .next/standalone/public .next/standalone/.env
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
cp .env .next/standalone/.env'
chown -R root:root /opt/attrax/.next/standalone

# 5. 启动所有服务
cd /opt/attrax
node_modules/pm2/bin/pm2 start /opt/attrax/scripts/ecosystem.config.cjs
# 或分别: pm2 start /opt/attrax/scripts/ecosystem.config.cjs --only nextjs

# 6. 验证
sleep 10
curl http://127.0.0.1:3000/api/health
```

如果只改了 RAG(Python)代码,**不需要 build Next.js**,只需:

```bash
node_modules/pm2/bin/pm2 restart rag-service
```

### 5.5 端到端扫描测试

```bash
# 生成测试图片(本地)
# Windows: 用任何 1x1 PNG 即可

# 公网扫描
SID=$(curl -s -X POST http://120.77.36.107:3000/api/scan \
  -F "category=electronics" \
  -F "markets=EU" \
  -F "images=@/path/to/pixel.png;type=image/png")
echo "$SID" | python -m json.tool

# 提取 sessionId 和 accessToken
# 然后轮询
curl http://120.77.36.107:3000/api/scan/<sessionId> \
  -H "Authorization: Bearer <accessToken>"

# 预期 ~2-3 分钟后返回:
# - status: ready
# - result.source: real   ← 关键,确认是 RAG 真实报告
# - result.complianceReport: 2000-5000 字符的中文报告
```

如果 `result.source: fallback` 且 `error: RAG_SERVICE_*`,**RAG 链路有问题**,查 `/var/log/attrax-next.err.log`。

---

## 6. 常见问题

### 6.1 RAG 报告降级为 fallback

**症状**: 公网扫描 `result.source` 是 `fallback` 而非 `real`,`error: RAG_SERVICE_*`。

**排查**:
```bash
# 看 Next.js 错误日志(grep 关键词)
grep -E 'rag-service call failed|Invalid input' /var/log/attrax-next.err.log | tail -20

# 常见错误:
# 1. "RAG_SERVICE_INVALID_RESPONSE: Invalid input: expected string, received null"
#    → Zod schema 不允许 null。修复见 RAG 文档/schema
# 2. "rag-service call failed: fetch failed"
#    → RAG 服务不可达。先 curl http://127.0.0.1:8001/health
# 3. error: RAG_SERVICE_TIMEOUT
#    → 扫描超过 280s。看 rag 日志确认 LLM 是否真的卡住
```

### 6.2 OOM(内存不足)

**症状**: 服务频繁重启(`↺` 计数增长),`dmesg | grep -i oom` 有 Kill 记录,SSH 偶尔超时。

**根因**: 1.6GB RAM + 4GB swap,内存余量仅 ~300MB。

**预防**:
- **永远不要同时跑 `npm run build` 和 rag-service**(build 峰值 ~1GB,uivcorn 800MB)
- 如果要 build,先 `pm2 stop rag-service`

**恢复**:
```bash
# 如果 SSH 进不去,需要阿里云控制台强制重启
# 进得去的话:
node_modules/pm2/bin/pm2 resurrect    # 恢复保存的进程列表
curl http://127.0.0.1:3000/api/health
```

### 6.3 FAISS 索引丢失

```bash
ls -la /opt/attrax/data/faiss/
# 应该看到 legal_chunks.index (~30MB) 和 legal_chunks_meta.json

# 如果丢了,从构建机器同步:
scp /opt/attrax/data/faiss/legal_chunks.index root@120.77.36.107:/opt/attrax/data/faiss/
scp /opt/attrax/data/faiss/legal_chunks_meta.json root@120.77.36.107:/opt/attrax/data/faiss/

# 然后重启
node_modules/pm2/bin/pm2 restart rag-service
```

### 6.4 磁盘空间

```bash
df -h /opt/attrax
du -sh /opt/attrax/data/sessions/    # 会话文件(1h TTL 自动清理)
du -sh /opt/attrax/.next/            # 构建产物(~1GB)
du -sh /var/log/                     # 日志(可能很大)
```

### 6.5 API Key 轮换

```bash
# 编辑 env
vim /opt/attrax/.env

# 必须同步到 standalone 目录(Next.js 读这里)
cp /opt/attrax/.env /opt/attrax/.next/standalone/.env

# 重启
node_modules/pm2/bin/pm2 restart rag-service
node_modules/pm2/bin/pm2 restart nextjs
```

注意 `MIMOTALK_API_KEY`、`MODELSCOPE_API_KEY` 在 `/opt/attrax/.env` 和 `/opt/attrax/.next/standalone/.env` 两处都要更新,前者给 RAG 读,后者给 Next.js 读。

---

## 7. 关键环境变量

`/opt/attrax/.env`:

| 变量 | 必填 | 用途 |
|------|------|------|
| `MIMOTALK_API_KEY` | 是 | MiniMax-M3 LLM API key |
| `MIMOTALK_BASE_URL` | 否 | 默认 `https://api.minimaxi.com/anthropic/v1` |
| `MIMOTALK_MODEL` | 否 | 默认 `MiniMax-M3` |
| `MODELSCOPE_API_KEY` | 是 | Qwen3 Embedding API key |
| `RAG_ALLOWED_ORIGINS` | 是 | CORS 白名单,逗号分隔 |
| `RAG_SERVICE_URL` | **必填 `http://127.0.0.1:8001`** | Next.js 调 RAG 用的地址(不要用 localhost,避免 IPv6) |
| `DEMO_MODE` | 否 | 默认 `false`,设为 `true` 走 Mock 降级 |

⚠️ **不要把任何 API key 提交到 git**。

---

## 8. 性能数字(参考)

| 指标 | 数值 |
|------|------|
| 前端响应时间 | 10-50 ms |
| RAG `/health` 响应 | < 20 ms |
| RAG `/scan-multipart` 端到端 | 60-180 s(单次 LLM 调用 ~10-30s,可能 3-4 次) |
| FAISS 索引加载 | ~1 s(7170 向量) |
| BM25 构建 | ~1-2 s(每次请求重建,内部 per-request 优化) |
| FAISS 检索 + 融合 | < 100 ms |
| mimoTalk 报告生成 | 10000-20000 字符,~30-90 秒/次 |

---

## 9. 当前已知限制

| 限制 | 说明 |
|------|------|
| 内存 1.6 GB | 不能再加 worker,build 需停 RAG |
| 单进程 uvicorn | 扫描串行,LLM 限流友好但吞吐低 |
| 8001 端口不对外 | 阿里云 NAT 只代理 3000,改 NAT 配置前不要直接开放 8001 |
| 会话 1h TTL | 内存 + 文件,无数据库 |
| FAISS 索引只读 | 不在容器内,改索引需在构建机器重新 `build_faiss.py` 后同步 |
| 无登录鉴权 | `/api/scan` 用 session access token(临时方案) |
| `requirements-prod.txt` 冗余 | 核心 ~20 个包,完整 ~500+ 行,已加 `openai` (ModelScope 用) |

---

## 10. 应急联系 / 文档索引

- 项目 CLAUDE.md: `E:\desktop\火鹰合规\CLAUDE.md`(仓库根)
- RAG 架构: `docs/RAG-ARCHITECTURE-v3.md`
- 部署历史: `docs/plans/`(含 ATTRAX_REMEDIATION_PLAN_2026-06-18.md)
- 法规数据源覆盖: `docs/regulation-data-sources-coverage-2026-05-27.md`
- 项目状态: `docs/PROJECT-STATUS.md`

修改本文档后,请更新顶部「最后更新」日期。
