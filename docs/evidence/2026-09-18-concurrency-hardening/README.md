# 2026-09-18 并发加固 — 验证证据

本目录保存这次全栈并发加固的**真实 HTTP 验证**记录（不是单测）。

## 为什么需要单独的证据目录

这次改动里有一个 bug 是单测**结构上无法**覆盖的：BFF 嗅探 multipart 的
`category` 时，第一版用 `body.tee()` 撕出两条分支、从一条读满 8KB 后
`cancel()` 它，再把另一条交给上游。单测和桩验证都没发现它，因为：

- 单测里 `Request` 的 body 是内存 Buffer，`tee()` 不会产生真实的分支竞争；
- 桩验证当时发的 body 只有 610 字节，能读到 `done`、走完循环，不触发；
- **真实产品图 44KB：请求在 BFF 里停到客户端超时，RAG 侧连 POST 记录都没有。**

阈值正好等于嗅探窗口（8KB）：≤8KB 正常，>8KB 必挂。只有真实 socket 支撑的
请求流能复现。所以这类问题必须留真实 HTTP 的证据。

## 目录内容

| 文件 | 用途 |
|------|------|
| `stub-rag-upstream.mjs` | 桩上游：模拟 RAG 的 `POST /api/v1/scans`，把收到的字节数、`Transfer-Encoding`、解析出的字段与文件打印成 JSON |
| `verify-stream-scan.mjs` | 按上传页的真实形态（文本字段在前、`markets` 逗号分隔、`declared_facts`）发一次 multipart，然后轮询到终态 |

## 怎么复现

```bash
# 桩上游（不需要 LLM key）
node docs/evidence/2026-09-18-concurrency-hardening/stub-rag-upstream.mjs &

# 前端 dev，指向桩
RAG_SERVICE_URL=http://127.0.0.1:8099 npm run dev

# 跑一次；第二参数可给真实产品图
node docs/evidence/2026-09-18-concurrency-hardening/verify-stream-scan.mjs \
  http://localhost:3001 public/product-samples/lego-76429/01.jpg
```

## 已验证的结论

### 1. 请求体确实是流式转发，不是缓冲后重发

桩上游收到的 POST 记录：

```json
{"event":"stub_received","path":"/api/v1/scans","method":"POST","bytes":610,
 "contentLengthHeader":null,"transferEncoding":"chunked",
 "internalSecret":"present",
 "fields":{"category":"toy","markets":"EU,US","locale":"zh",
           "declared_facts":"{\"battery\":\"否\"}"},
 "files":[{"name":"images","filename":"verify.png","bytes":75}]}
```

`transferEncoding: chunked` + 无 `Content-Length` 是关键：说明 BFF 没有把
body 读全再发，而是把请求流直接管道给了上游。同时字段与文件按原字节到达，
`internalSecret` 也在（流式改造没有丢掉鉴权头）。

### 2. 真实产品图跑完整链路

`public/product-samples/lego-76429/01.jpg`（44,649 字节）经真实 RAG 服务：

```
category      = "toy"
markets       = ["EU", "US"]
status        = ready
originalQuery = "评估 toy 类产品在 EU/US 市场的合规风险"
declaredFacts = {"battery": "否"}
ragProvider   = "deepseek"
compliance    = "WARN"
latencyMs     = 53417
degraded      = []
agentTrace    = [vision, generate, verify]
```

要点：`originalQuery` 正是旧 BFF `buildQuery` 的措辞（RAG 侧按浏览器的
category + markets 合成）；`declaredFacts` 完整穿过流式转发；`ragProvider`
如实写着 `deepseek`（当时 MiniMax 账号 Token Plan 额度耗尽，走了降级通道，
归属没有谎报成 primary）；`degraded` 为空，是一份真实的合规结论。

### 3. 死锁修复的阈值证据

修复前后用不同大小打 BFF：

| body 大小 | 修复前 | 修复后 |
|-----------|--------|--------|
| 4,000 B | 400（RAG 拒绝随机字节签名） | 400 |
| 9,000 B | **超时无响应** | 400 |
| 40,000 B | **超时无响应** | 400 |

400 是 RAG `_read_uploads` 对随机字节的签名拒绝——恰好证明 body 完整到达了
上游；超时则说明请求根本没离开 BFF。

## 边界

- 桩验证覆盖的是 BFF → 上游的转发形态；真实扫描覆盖的是端到端语义。
  两者都需要真实进程，不替代单元测试，也不是单元测试的替代品。
- 上面这次真实扫描跑在 2026-09-18 的本地环境，MiniMax 账号当时额度耗尽；
  正常额度下的 `ragProvider` 应为 `minimax`。这不影响本次要验证的结论
  （字段传递、流式转发、真实报告产出），但复跑时不要把它当成回归。
