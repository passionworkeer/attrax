# 火鹰合规 RAG Service

公开 `/api/v1`、Bearer 轮询流程、错误码和生成类型方式见 [`docs/FRONTEND-BACKEND-INTEGRATION.md`](../docs/FRONTEND-BACKEND-INTEGRATION.md)。旧 `/scan` 与 `/scan-multipart` 仅为迁移兼容接口。

合规扫描后端服务：FastAPI + 线性三步管线（vision → generate → verify）。
检索不走 embedding / 向量索引——知识来自**规则矩阵（must_check）+ KB 锚点（kb_loader）+ 法规原文（article_loader）**三件套。

## 架构

```
用户上传（图片 + 声明事实）
  → vision    视觉检查清单识别（主模型视觉调用，失败降级 DeepSeek）
  → generate  规则矩阵 + KB 锚点 + 法规原文 → 主模型生成报告包（失败降级 DeepSeek）
  → verify    deterministic quote matching：逐条引用反向字面匹配法规原文
  → 报告包（citations / evidencePack / auditMetadata.verificationMode）
```

## 技术栈

| 组件 | 技术 | 说明 |
|------|------|------|
| HTTP 框架 | FastAPI 0.115.6 | ASGI 服务 |
| 主模型 | Anthropic 兼容端点（`LLM_*`） | 视觉分析 + 报告生成 |
| 降级通道 | DeepSeek（`DEEPSEEK_*`） | 视觉走 OpenAI 兼容端点，生成走 Anthropic 兼容端点 |
| 检索 | must_check + kb_loader + article_loader | 无 embedding、无向量索引 |
| 引用验证 | `verify/quote_matcher.py` | deterministic 反向字面匹配，每条引用带 `match_status` |
| 文档解析 | pdfplumber / docx 解析器 | 用户补充资料 |

## 快速开始

### 1. 安装依赖

```bash
python3 -m pip install -r rag_service/requirements-prod.txt
```

### 2. 配置环境变量

```bash
cp rag_service/.env.example rag_service/.env
# 编辑 rag_service/.env，填入必要的 API Key
```

必需配置：

- `LLM_API_KEY`（或兼容别名 `MINIMAX_API_KEY` / `MIMOTALK_API_KEY`）— 主模型；`LLM_BASE_URL` / `LLM_MODEL` 选填，默认 MiniMax Anthropic 兼容端点。
- `RAG_INTERNAL_SECRET` — BFF ↔ RAG 内部认证。生产真值存放在服务器文件 `/opt/attrax/.rag-internal-secret`（`600`），不写进 `.env`。
- `RAG_ALLOWED_ORIGINS` — CORS 白名单，逗号分隔。

可选：`DEEPSEEK_*`（降级通道，留空即关闭）、`DEMO_MODE`（Mock 数据，无需 API Key）、`SCAN_WORKER_CONCURRENCY`（默认 5）。

### 3. 启动服务

```bash
python3 -m uvicorn rag_service.main:app --reload --port 8001
```

服务地址：`http://localhost:8001`

---

## API

| 端点 | 用途 |
|------|------|
| `POST /api/v1/scans` | 创建扫描（BFF 走这条；返回 sessionId + accessToken） |
| `GET /api/v1/scans/{id}` | 轮询扫描状态与结果 |
| `POST /api/v1/scans/{id}/evidence` | 补充证据文件（J10） |
| `POST /api/v1/scans/{id}/revisions` | 用扩充后的证据重跑生成（J10，幂等键 `idempotency_key`） |
| `GET /api/v1/regulations/{doc_id}` | 单条法规原文（evidence-pack 引用） |
| `POST /scan` / `POST /scan-multipart` | 迁移兼容接口 |
| `POST /profit-report` | 利润分析报告（预置数据快路径，无需 LLM） |
| `GET /health` | 存活探针（未授权只返回 `{"status": "ok"}`） |
| `GET /ready` | 就绪探针（LLM / KB / 会话后端状态） |
| `GET /health/watchdog` | 法规守护进程只读运维视图 |

扫描结果是**报告包**（`reportPackage`）而非单段文本：含 `citations`（每条带 `match_status`）、`evidencePack`、`profitReport`、`roadmap`、`decisionView` 与 `auditMetadata.verificationMode`。

---

## 测试

```bash
python3 -m pytest rag_service/tests/ -v
```

---

## 项目结构

```
rag_service/
├── main.py                   # FastAPI 入口（/api/v1 挂载 + legacy /scan + /health + /ready）
├── config.py                 # Settings（从 .env 加载）
├── lifecycle.py              # 优雅关停信号（跨模块共享）
├── api/v1.py                 # /api/v1/scans + /evidence + /revisions
├── application/scans.py      # 扫描生命周期、准入控制、租约、重试
├── domain/                   # 领域类型（scans / categories）
├── infrastructure/file_backend.py  # 会话 / job / upload 文件后端（原子写 + 跨进程锁）
├── pipeline/                 # 线性三步管线
│   ├── runner.py             # 编排入口
│   ├── state.py              # PipelineState
│   └── nodes/                # vision / generator / verifier / findings_builder
│                             #   / visual_checks / declared_facts
├── retrieval/                # 知识三件套
│   ├── must_check.py         # 品类 × 市场规则矩阵 + 特征横切
│   ├── kb_loader.py          # KB 锚点 YAML（data/kb/anchors/）
│   └── article_loader.py     # 法规原文 + 摘要（data/regulations/）
├── verify/                   # 验证层
│   ├── quote_matcher.py      # 引用反向字面匹配
│   ├── applicability.py      # 三态 ProductFacts
│   ├── grounding.py          # bbox / 引用 grounding 校验
│   └── vision_cache.py       # 视觉结果 LRU + 单飞缓存
├── generate/report_generator.py    # 报告生成（主模型 + DeepSeek 降级）
├── parser/                   # docx / html 解析
├── schemas/                  # Pydantic 契约（report_package / visual_inspection）
├── regulation_collectors/    # 法规离线采集
└── tests/                    # pytest

data/kb/anchors/          # KB 锚点 YAML（按 regulation 维度）
data/regulations/         # 法规原文 YAML（生产只读）
data/inspection_profiles/ # 视觉检查 profile（按 category 维度）
data/regulation_sources/  # 法规数据源注册表（official_sources.json）
```

---

## 关联文档

- [`docs/FRONTEND-BACKEND-INTEGRATION.md`](../docs/FRONTEND-BACKEND-INTEGRATION.md) — 当前 API 契约
- [`docs/plans/2026-09-11-de-rag-evidence-spec.md`](../docs/plans/2026-09-11-de-rag-evidence-spec.md) — de-RAG 迁移规格
- [`CLAUDE.md`](../CLAUDE.md) — 项目约定与环境变量清单
- [`docs/WATCHDOG.md`](../docs/WATCHDOG.md) — 法规自动入库守护

---

**版本**：0.3.0
**最后更新**：2026-09-19
