# 04 · 后端扫描管线（De-RAG 三步）

## 核心要点（30 秒读完）

- **线性 3 步**：`vision → generate → verify`（`pipeline/runner.py`）。每步完成后通过 `_emit(callback, stage_key, stage_state, progress)` 把阶段进度（12~98）发给 ScanService → burning 页轮询驱动动画。
- **vision**：VisionAnalyzer 调 LLM 看图，返回 `{category, core_features, observations[]}`；MiniMax 失败自动改发 DeepSeek OpenAI 兼容端点；LRU 缓存按 `sha256(image_bytes)` 复用。
- **generate**：ReportGenerator 把 KB 锚点 + 法规原文塞进 system prompt，LLM 输出 `citations[]` + `decisionView` + `riskFindings`；MiniMax 失败自动改发 DeepSeek Anthropic 兼容端点。
- **verify**：纯 Python 字符串比对。`quote_matcher.match_citations` 对每条 citation 返回 `matched / fallback_article_only / unmatched` 三态，写入 `auditMetadata.verificationMode = "kb_exact_quote"`。
- **降级矩阵**：DEMO 全 mock；vision 失败 → DeepSeek；generate 失败 → DeepSeek；双供应商都挂 → `report_package.degradedFallback=true`；RAG 不可达 → 前端降级 + 红色横幅。
- **关键工程细节**：DeepSeek reasoning 模型需独立 token 预算（16384）；Anthropic 兼容端点响应有 `thinking` 块要全部 text 拼接；primary 只重试 1 次（否则 280s 兜底会被吃光）。
- **安全**：`RAG_INTERNAL_SECRET` 必须设（`/opt/attrax/.rag-internal-secret`），prod 空 secret → `RuntimeError` 拒启动；写入端点 HMAC `compare_digest` 校验 X-Internal-Secret。

> 数据快照：2026-09-17。`rag_service/` 下的 FastAPI + Python 3.10+，端口 8001，单 worker uvicorn + 5 线程 ThreadPoolExecutor 跑扫描，单扫描墙钟超时 280s。

## 全局架构

```
POST /api/v1/scans (multipart)
       │
       ▼
api/v1.py:_read_uploads → ScanSubmission ──► application/scans.py:ScanService
                                                       │
                                                       ▼
                                       FileBackend.save_session (JSON 落盘 data/backend/sessions/{sessionId}.json)
                                                       │
                                                       ▼
                                       scan_service.enqueue(submission)
                                                       │
                                                       ▼
                                       ThreadPoolExecutor.submit(_run_public_scan_payload)
                                                       │
       ┌───────────────────────────────────────────────┘
       ▼
_run_public_scan_payload → _run_scan_request → run_compliance_graph
       │
       ▼  Pipeline (de-RAG linear 3-step)
       ┌────────────────┐
       │ 1. vision      │  VisionAnalyzer  (MiniMax → DeepSeek fallback)
       ├────────────────┤
       │ 2. generate    │  ReportGenerator (MiniMax → DeepSeek fallback)
       ├────────────────┤
       │ 3. verify      │  quote_matcher.match_citations
       └────────────────┘
       │
       ▼
ScanResponse { status, report, agent_trace, report_package, ... }
       │
       ▼
FileBackend.save_session (更新结果，status=ready)
```

## 入口与生命周期

### `application/scans.py:ScanService`

`main.py:lifespan` 启动时实例化（接收 `FileBackend(settings.runtime_data_dir)` + `runner=_run_public_scan_payload`）。`resume_pending()` 在启动时扫描磁盘，把上次进程异常退出时未完成的扫描重新入队（job 已被声明，所以可以安全重启续跑）。

每次收到 `/api/v1/scans`：

1. `_read_uploads` 校验文件大小、MIME、扩展名、magic bytes（图像）；DOCX 还要校验 ZIP 结构 + `[Content_Types].xml` 存在 + 解压后文件数 ≤ 500、展开后 ≤ 50MB（防 zip bomb）。
2. 生成 32-byte accessToken（base64url）→ SHA-256 hash 写入 `sessions/{sessionId}.json`。`sessionId` 格式 `/^scan_[A-Za-z0-9_-]{1,64}$/`。
3. `enqueue` 提交到 `ThreadPoolExecutor(max_workers=settings.scan_worker_concurrency)`（默认 5，见 `config.py`）。
4. Job 内调 `runner(payload)`，执行中通过 `progressCallback` 写入 stage 进度。
5. 异常时 heartbeat 标记失败，文件保留供 `resume_pending` 复检。

### `infrastructure/file_backend.py:FileBackend`

进程安全靠 `RLock`；落盘 `sessions/{sessionId}.json`（含 status / progress / accessTokenHash / payload / result）。`getattr(app.state, "scan_service", None)` 是 BFF 拿到的服务实例（`api/dependencies.py:get_scan_service`）。

## 线性三步管线（`pipeline/runner.py`）

```python
state = initial_state(query, product, category, markets, vision_result, images, documents, session_id, declared_facts)

state = _merge(state, vision_analysis_node(state))      # 1. vision
state = _merge(state, generator_node(state))            # 2. generate
state = _merge(state, verifier_node(state))             # 3. verify

return { "status": _final_status(state), ... }
```

阶段进度（`STAGE_PROGRESS`）：

```python
{
  "vision":        (12, 30),
  "applicability": (30, 36),
  "generate":      (36, 83),
  "verify":        (83, 93),
  "persist":       (93, 98),
}
```

- `_emit(callback, stage_key, stage_state, progress)` 在阶段边界调用上层 callback（`ScanService` 把它桥接到 session.update()，前端 burning 页读这个数字驱动动画）。
- `_merge` 实现 LangGraph 语义：除 `agent_trace` 外都覆盖；`agent_trace` 是 append-only（这是 2026-06-29 审计留下的不变式，塌缩后保留）。
- `_final_status(state)` 严格派生 PASS/WARN/REJECTED/UNKNOWN：先看 `auditMetadata.validationStatus`（invalid/fallback → UNKNOWN）；再看 LLM 自己的 `decisionView.verdict`（PASS/WARN/REJECTED/UNKNOWN 原样透传）；缺 verdict + 生成 ok → UNKNOWN（旧版 NLI `generation_score` 已随 de-RAG 删除）。

## 第 1 步：vision（`pipeline/nodes/vision.py`）

`VisionAnalyzer` 单例（`main.py:lifespan` 用 `set_vision_analyzer` 注入）。

主路径：

```
build_messages(images, observations_prompt)
  ↓ anthropic.messages.create(model=MINIMAX_MODEL, messages=[...])
  ↓ 返回 JSON（try_parse_json 反复重试 3 次）
  ↓ validate_schema({category, core_features, observations[]}, Zod 形状)
  ↓ VisionResult { category, core_features, observations[], raw_text }
```

### 双供应商降级（2026-09-16 上线）

`vision.py` 把消息构建抽成 `_vision_text`，主调用走 MiniMax (`https://api.minimaxi.com/anthropic/v1`)，返回空 / 异常时改调 `_call_deepseek`：

- DeepSeek 走 OpenAI 兼容 `/chat/completions`：`DEEPSEEK_BASE_URL=https://api.deepseek.com`（不含 `/v1`）。
- `_to_openai_messages` 把 Anthropic `system + image base64 + text` 转 OpenAI `[{role:user, content:[{type:text|image_url}, ...]}]`。
- 缓存分层：降级结果按 `fallback_model` 算独立 cache key，永不被当作 primary 结果回放。

**关键坑**：`deepseek-flash` 是 reasoning 模型，`reasoning_content` 与 `content` 共用 completion 预算；沿用 primary 的 3072 预算会得到 HTTP 200 + 空 content。所以降级通道独立预算 `DEEPSEEK_MAX_TOKENS=16384`；空 content + 有 reasoning 时打显式错误日志。

### 视觉结果缓存（`verify/vision_cache.py`）

按 `(sha256(image_bytes), provider_key)` LRU；同一张图重复出现直接复用，免重复 LLM 调用。

## 第 2 步：generate（`pipeline/nodes/generator.py`）

`ReportGenerator` 单例（同样 `main.py:lifespan` 注入 `set_generator`）。

主调用：`_generate_mimotalk(body)` → `anthropic.messages.create(...)` → `_read_mimotalk_response(content_blocks)` 拼接所有 `type=="text"` 块。

### Prompt 拼接

1. `must_check.build_anchor_list(category, markets, detected_features)` → `anchors[]`。
2. 对每个 anchor：`article_loader.build_article_texts_for_anchors(anchors)` → `{doc_id#article_id: text}`。
3. system prompt 段落：
   - 「下面是本次扫描必须覆盖的法规锚点（KB anchors）」+ 锚点清单（doc_name / region / reason / key_points）。
   - 「下面是锚点对应的法规原文（article bodies）」+ 上述文本。
   - 「JSON Schema（report_package）」+ 字段定义。
4. user prompt：`query` + `product` + `images[0..n]` 缩略信息 + 上传的 PDF / DOCX 文本（前 5000 字符）。

### LLM 双供应商降级（2026-09-16 上线）

`_generate_mimotalk` 在主调用失败（超时 / 4xx / 5xx / 返回非 JSON）后，把**同一份 body** 重发到 DeepSeek 的 Anthropic 兼容端点：

- `DEEPSEEK_ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic/v1`（**必须含 `/v1`**，代码自己拼 `/messages`）。
- `provider` 改成「实际服务的供应商」（默认仍是 `minimax`，失败回退变 `deepseek`）；`pipeline/nodes/generator.py` 在生成后刷新它。
- 两个必须知道的坑（来自代码头注释）：
  1. DeepSeek 的 Anthropic 端点返回 `content[0]={"type":"thinking"}`、`content[1]={"type":"text"}`。原代码读 `content[0].text` 恒空 → ValueError。修复：`_read_mallack_response` 拼接所有 text 块。
  2. `_LLM_MAX_ATTEMPTS=3` × 90s 超时 + backoff ≈ 273s ≈ `_SCAN_TIMEOUT_SECS=280`。纯超时下 primary 重试就能耗尽整轮预算。所以**配置了降级 key 时 primary 只试 1 次**。

### 输出

```json
report_package = {
  "citations": [
    {
      "doc_id": "EU-2023-1542",
      "article_id": "art-7",
      "quote": "...ver quote...",
      "key": "due-diligence-obligations",
      "match_status": null  // 由 verify 步骤填充
    }, ...
  ],
  "decisionView": {
    "verdict": "PASS" | "WARN" | "REJECTED" | "UNKNOWN",
    "rationale": "...",
    "topActionItems": ["..."],
    "deferredRisks": ["..."]
  },
  "riskFindings": [...],
  "auditMetadata": {
    "validationStatus": "valid" | "invalid" | "fallback",
    "provider": "minimax" | "deepseek",
    "ragProvider": "minimax" | "deepseek"   // generator 节点刷新
  }
}
```

## 第 3 步：verify（`pipeline/nodes/verifier.py` + `verify/quote_matcher.py`）

零 LLM、零网络，纯字符串比对。

```python
match_citations(citations, cache=_ARTICLE_TEXT_CACHE)
```

每条 citation 走三态：

| match_status | 含义 | 前端 CitationChip |
|---|---|---|
| `matched` | 引文在原文 verbatim（或 NFKC + 全角/半角标点 + 空白折叠后）命中 | ✅「已对照原文」 |
| `fallback_article_only` | 法规与条款存在，但引文与原文不完全字面匹配（含 `unverified` 源） | ⚠️「仅对照摘要」 |
| `unmatched` | 法规 id / 条款 id 未找到，或引文为空 | ❌「引用错误」 |

性能：50 citations × ~5KB article × 200-char quote < 50ms（纯 Python `str.find` + 2 次 normalize passes）。

### `auditMetadata`

- `verificationMode = "kb_exact_quote"`：证明引用验证用了确定性字符串匹配（旧 NLI 文本重叠已被删）。
- `canonicalQuoteAttachedCount`：在 `fallback_article_only` 上 attach 法规原文（前 700 字符）作为参考，**不**伪造 `match_status`。

### 缓存失效联动

`article_loader.cache_generation()` 是「磁盘 stamp 变化次数」的计数器。verifier 在每次运行前 `_sync_article_cache()`：首次调用采用当前 generation，**不**清空（测试预填 fixture 不被误杀）；后续 generation tick → 清空整个 article 文本缓存，让下次 verify 全部按新法条重比对。

## 引用证据 pack

`quote_matcher.build_evidence_pack(citations)`：按 `(doc_id, article_id)` 去重，每条带 `quote_span`（高亮 `[start, end)`）+ `match_status`。供结果页 EvidencePanel 与 DocViewer 高亮显示。

## 降级与失败模式

| 现象 | 处理 |
|---|---|
| `DEMO_MODE=true` | 直接返回 `status=DEMO`，report 是固定 markdown，不调任何 LLM |
| LLM 返回非 JSON | 重试 3 次，仍失败 → 走降级或 fallback package |
| MiniMax 与 DeepSeek 都失败 | `report_package.degradedFallback=true`，UI 显示「演示回退」开关；`auditMetadata.validationStatus = "fallback"` |
| 单扫描墙钟超时 | `_SCAN_TIMEOUT_SECS=280s`；`asyncio.wait_for` 抛 `TimeoutError` → BFF 返 504 |
| 5 个 worker 全卡 | 队列会积压；前端 burning 页继续轮询；旧 worker 因 LLM 慢会逐渐释放 |

## 安全 / 限流 / 健康

- `protect_requests` 中间件：
  - `_MAX_BODY_SIZE_BYTES = 50 MB` 超 413。
  - `_RATE_LIMIT_WINDOW_SECS=60s / _RATE_LIMIT_MAX_REQUESTS=30` 进程内 deque 速率限制（`/scan`、`/scan-multipart`、`/profit-report`、`/api/v1/scans` 写入路径）。
  - `_INTERNAL_WRITE_PATHS = {"/scan", "/scan-multipart", "/profit-report"}` + `RAG_INTERNAL_SECRET` HMAC `compare_digest` 校验 `X-Internal-Secret` header。
- `_enforce_secret_policy`：prod 空 secret → `RuntimeError` 拒启动；非 prod 自动生成 ephemeral secret + 打日志；`RAG_ALLOW_INSECURE=true` 显式 opt-out。
- `_is_privileged`：`/health` 与 `/ready` 详细字段（`version / demo_mode / pipeline`）只对 demo / 携带 X-Internal-Secret / loopback peer / `RAG_ALLOW_INSECURE` 开放；最小字段（`status / ready / checks / version`）始终返回。
- `_readiness_snapshot`（每 5 分钟被 uptime monitor 触发一次）：检查 KB anchors 与 regulation library 已加载、API key 配置（demo 跳过）、scan_service 已实例化；返回 `release = {buildSha, releaseId, kbHash, regulationCount, inspectionProfileVersion}`（J22 plan §9.3 审计可追溯）。

## CORS

`CORSMiddleware`：白名单由 `settings.allowed_origins`（`RAG_ALLOWED_ORIGINS`，逗号分隔），`allow_credentials=False`（不在 CORS 层传 cookie，由 BFF 在同站回传），方法 `GET / POST`，header `Content-Type / Authorization / X-Request-Id`。

## 文件解析

- 图像：`vision_node` 直接喂 base64 给 VisionAnalyzer。
- PDF：`main.py:_run_scan_request` 用 `pdfplumber.open(io.BytesIO(buf))` 抽文本（前 5000 字符，写入 `documents[]`）。
- DOCX：v1 API 在 `_valid_docx_archive` 校验 ZIP 头 + 必须存在 `[Content_Types].xml` + `word/document.xml` + 限制解压成员数 / 展开大小。

## 关键文件清单

- [`rag_service/main.py`](rag_service/main.py)：FastAPI 入口、middleware、secret policy、health / ready、`/scan` & `/scan-multipart`。
- [`rag_service/api/v1.py`](rag_service/api/v1.py)：公开 v1 API（multipart + Bearer + 文件校验 + ScanService DI）。
- [`rag_service/application/scans.py`](rag_service/application/scans.py)：ScanService，会话生命周期 + 异步 job + evidence / revision 注入。
- [`rag_service/pipeline/runner.py`](rag_service/pipeline/runner.py)：线性 3 步编排。
- [`rag_service/pipeline/state.py`](rag_service/pipeline/state.py)：GraphState + initial_state。
- [`rag_service/pipeline/nodes/vision.py`](rag_service/pipeline/nodes/vision.py)：VisionAnalyzer + MiniMax / DeepSeek 双供应商。
- [`rag_service/pipeline/nodes/generator.py`](rag_service/pipeline/nodes/generator.py)：ReportGenerator + 同上双供应商。
- [`rag_service/pipeline/nodes/verifier.py`](rag_service/pipeline/nodes/verifier.py)：verifier 节点 + article cache 同步。
- [`rag_service/pipeline/nodes/findings_builder.py`](rag_service/pipeline/nodes/findings_builder.py)：确定性 findings（hazards 匹配 + contrast marker 防御）。
- [`rag_service/pipeline/nodes/visual_checks.py`](rag_service/pipeline/nodes/visual_checks.py)：inspection profile 加载 + 视觉检查。
- [`rag_service/pipeline/nodes/declared_facts.py`](rag_service/pipeline/nodes/declared_facts.py)：J09 用户声明事实 + `NEGATIVE_VALUES` frozenset。
- [`rag_service/generate/report_generator.py`](rag_service/generate/report_generator.py)：实际 LLM 调用 + 双供应商降级。
- [`rag_service/verify/quote_matcher.py`](rag_service/verify/quote_matcher.py)：确定性引用验证 + 高亮 span。
- [`rag_service/verify/applicability.py`](rag_service/verify/applicability.py)：三态 ProductFacts（confirmed/candidate/absent）。
- [`rag_service/config.py`](rag_service/config.py)：pydantic-settings 配置。

## 常用环境变量（rag_service 一侧）

| 变量 | 用途 |
|---|---|
| `MINIMAX_API_KEY` | 主 LLM key（vision + generate 共用） |
| `MINIMAX_BASE_URL` | 默认 `https://api.minimaxi.com/anthropic/v1` |
| `MINIMAX_MODEL` | 默认 `MiniMax-M3` |
| `MINIMAX_THINKING_MODE` | `adaptive` / `disabled`；`disabled` 跳过思考链降延迟 |
| `DEEPSEEK_*` | 降级 key + endpoints + max_tokens |
| `RAG_INTERNAL_SECRET` | BFF ↔ RAG 内部认证；prod 必须配；空 + prod 直接拒启动 |
| `RAG_ALLOWED_ORIGINS` | CORS 白名单 |
| `SCAN_WORKER_CONCURRENCY` | ThreadPoolExecutor 大小（默认 5） |
| `DEMO_MODE` | 全 mock 模式 |
| `RAG_ALLOW_INSECURE` | 显式开放 internal secret 检查 |
| `ATTRAX_BUILD_SHA` | 当前部署 commit SHA（写入 `/ready.release.buildSha`） |
| `ATTRAX_RUNTIME_DIR` | RAG 会话 / job / upload 目录（默认 `data/backend`） |