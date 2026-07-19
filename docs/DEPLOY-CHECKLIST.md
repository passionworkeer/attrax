# Attrax 端到端部署 Checklist（2026-07-17）

> 目标：把 `D:\Data\Desktop\attrax` 当前 HEAD（`332c457`）完整部署到
> `120.77.36.107`，跑通 `curl /api/health` + 真实扫描 `result.source=real`。

## 0. 阻塞前置：SSH 访问

服务器 `120.77.36.107` 仅接受公钥认证（`PermitRootLogin prohibit-password` +
`PasswordAuthentication no`，见 `docs/SECURITY.md` §SSH hardening）。本地
`~/.ssh/id_ed25519` 的公钥**不在服务器的 `authorized_keys`**（`Permission denied (publickey,password)`）。

**任选一种解法后再继续**：

- **A. 把本地公钥发给运维装到服务器**
  ```bash
  cat ~/.ssh/id_ed25519.pub  # 把输出发给运维 / 贴到服务器 root 与 admin 的 authorized_keys
  ssh-copy-id -i ~/.ssh/id_ed25519.pub root@120.77.36.107
  ```

- **B. 用户在 Claude Code 用 `! ssh root@120.77.36.107` 走自己已认证的会话**，剩余命令逐条发给我执行。

- **C. 换服务器地址 + 凭据**（覆盖现有部署）。

---

## 1. 部署前本地准备

| 步骤 | 命令 | 预期 |
|------|------|------|
| 1.1 确认 HEAD | `git rev-parse HEAD` | `332c457b...` |
| 1.2 检查数据状态 | `ls data/faiss/` | **当前本地缺失**，需先 §2 重建 |
| 1.3 切干净分支 | 确认 `git status` 无未提交改动（除 handoff 目录外） | 仅 `?? "\350\247\204\350\210\252AI-..."` |

## 2. 构建 FAISS 索引（本地或服务器均可）

```bash
# 需要 MODELSCOPE_API_KEY（已在 .env.local）
# FAISS_INDEX_TYPE=hnsw 是默认（CLAUDE.md §关键技术栈）
cd /opt/attrax               # 服务器
D:\python\python.exe scripts/build_faiss.py --limit 0    # 服务器；本地用 python scripts/build_faiss.py
# 或者本地：
python scripts/build_faiss.py
```

预期产物（服务器现状，已知 ~14495 向量 HNSW）：
```
data/faiss/legal_chunks.index         ~30MB（hnsw backend）
data/faiss/legal_chunks_meta.json     ~345MB（建议先 split_meta_to_shards 降低 RAM 峰值）
```

**注意**：服务器 `legal_chunks_meta.json` 345MB 一次加载会爆 1.6GB RAM。先跑：
```bash
python -c "from rag_service.retrieval.faiss_retriever import FaissRetriever; FaissRetriever.split_meta_to_shards('data/faiss/legal_chunks_meta.json', 50)"
```

## 3. 同步代码 + 数据到服务器

```bash
# 代码（服务器已是 git 仓库，pull 即可；或本机 rsync 整树）
ssh root@120.77.36.107 'cd /opt/attrax && git pull --rebase origin main'

# FAISS 数据（如本地构建）
rsync -avz --progress -e ssh data/faiss/ root@120.77.36.107:/opt/attrax/data/faiss/
```

## 4. **关键顺序**：停 RAG → build Next.js → 装回 standalone

> 服务器内存只有 1.6GB。rag-service ~800MB + Next.js build ~1GB 会 OOM。
> **永远不要同时跑 build 和 rag-service**。见 SERVER-OPS §5.4。

```bash
ssh root@120.77.36.107 'cd /opt/attrax && \
  node_modules/pm2/bin/pm2 stop rag-service && \
  sleep 5 && \
  echo "rag-service stopped, free -m:" && free -m'
```

预期：`free -m` 显示 available ≥ 800MB 才安全继续。

```bash
# 在 admin 用户下 build（不是 root）
ssh root@120.77.36.107 'cd /opt/attrax && \
  chown -R admin:admin /opt/attrax && \
  su admin -c "rm -rf .next/standalone/data && NODE_OPTIONS=--max-old-space-size=1024 npm ci --omit=dev && NODE_OPTIONS=--max-old-space-size=1024 npm run build"'
```

## 5. 拷贝构建产物到 standalone + 同步 .env

```bash
ssh root@120.77.36.107 'cd /opt/attrax && \
  su admin -c "set -e; \
    rm -rf .next/standalone/.next/static .next/standalone/public .next/standalone/.env; \
    cp -r .next/static .next/standalone/.next/static && \
    cp -r public .next/standalone/public && \
    cp .env .next/standalone/.env" && \
  chown -R root:root /opt/attrax/.next/standalone'
```

⚠️ `.env` 含 `MINIMAX_API_KEY` / `MODELSCOPE_API_KEY`，确认文件权限 600。

## 6. 启动服务

```bash
ssh root@120.77.36.107 'cd /opt/attrax && \
  node_modules/pm2/bin/pm2 start /opt/attrax/scripts/ecosystem.config.cjs && \
  sleep 15 && \
  node_modules/pm2/bin/pm2 list'
```

预期：
```
┌────┬────────────────┬─────────┬──────────┐
│ id │ name           │ status  │ mem      │
│ 2  │ nextjs         │ online  │ ~100 MB  │
│ 1  │ rag-service    │ online  │ ~750 MB  │
└────┴────────────────┴─────────┴──────────┘
```

## 7. 端到端验证

### 7.1 健康检查

```bash
# 前端（含 ragService.status=ok）
curl -s http://127.0.0.1:3000/api/health | python -m json.tool
# 预期：{"frontend":"ok","ragService":{"status":"ok","responseTimeMs":10-50,"error":null},"demoMode":false}

# RAG 直连
curl -s http://127.0.0.1:8001/health | python -m json.tool
# 预期：{"status":"ok"}
```

### 7.2 公网健康检查（如服务器启 nginx）

```bash
curl -s https://120.77.36.107/api/health | python -m json.tool
```

### 7.3 真实扫描端到端

```bash
# 用任意合法 PNG（≥ 1x1）。测试图片可在 tests/fixtures/ 或自造：
python -c "import base64; open('/tmp/pixel.png','wb').write(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='))"

# 发起扫描
SID=$(curl -s -X POST http://120.77.36.107:3000/api/scan \
  -F "category=electronics" \
  -F "markets=EU" \
  -F "images=@/tmp/pixel.png;type=image/png")

echo "$SID" | python -m json.tool
# 提取 sessionId 和 accessToken

# 轮询（间隔 10s，限流）
curl -s http://120.77.36.107:3000/api/scan/<sessionId> \
  -H "Authorization: Bearer <accessToken>" | python -m json.tool
```

**成功标志**（不是降级）：
- `status: ready`
- `result.source: real`（不是 `fallback`）
- `result.complianceReport`: 2000-5000 字符中文
- `result.citations`: 非空数组

**失败标志**：
- `result.source: fallback` + `error: RAG_SERVICE_*` → 查 `/var/log/attrax-next.err.log`
- `status: generation_failed` → 查 `/var/log/attrax-rag.err.log`

## 8. 关键日志路径（失败排查）

| 路径 | 内容 |
|------|------|
| `/var/log/attrax-rag.log` | RAG stdout |
| `/var/log/attrax-rag.err.log` | RAG stderr（LLM/embedding 错误）|
| `/var/log/attrax-next.log` | Next.js stdout |
| `/var/log/attrax-next.err.log` | Next.js stderr（schema 校验、扫描错误）|
| `/opt/attrax/logs/attrax-uptime.log` | 5 分钟健康检查失败记录 |

```bash
# 快速诊断
ssh root@120.77.36.107 'grep -E "rag-service call failed|Invalid input|mimoTalk" /var/log/attrax-next.err.log | tail -20'
ssh root@120.77.36.107 'tail -30 /var/log/attrax-rag.err.log'
```

## 9. 已知回滚命令（出问题立即可用）

```bash
# 回到上一次成功 build
ssh root@120.77.36.107 'cd /opt/attrax && git stash && git log --oneline -5'

# 用备份还原数据
ssh root@120.77.36.107 'ls /opt/attrax/backups/'   # 选最近 tar.gz
ssh root@120.77.36.107 'cd /opt/attrax && tar -xzf backups/attrax-data-LATEST.tar.gz'
```

## 10. 完成标准（全部满足才算部署完成）

- [ ] §0 SSH 可登录
- [ ] §6 pm2 list 显示 `nextjs` + `rag-service` 都 `online`
- [ ] §7.1 `/api/health` 返回 `ragService.status=ok`、`demoMode=false`
- [ ] §7.3 真实扫描返回 `result.source=real` + 非空 `complianceReport`
- [ ] 无 `result.source=fallback` / `generation_failed`

---

*最后更新：2026-07-17（对应 HEAD 332c457）*