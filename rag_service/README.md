# 火鹰合规 RAG Service

KB 锚定合规扫描后端（FastAPI）。公开 `/api/v1`、Bearer 轮询流程、错误码和生成类型方式见 [`docs/FRONTEND-BACKEND-INTEGRATION.md`](../docs/FRONTEND-BACKEND-INTEGRATION.md)。旧 `/scan` 与 `/scan-multipart` 仅为迁移兼容接口。

> 2026-09-11 起 RAG 栈（embedding / FAISS / BM25 / LangGraph）已按 de-RAG spec §7.7 整体塌缩为线性 3 步管线。本 README 于 2026-09-14 重写对齐现状；旧架构描述已删除。

## 架构

```
用户上传 → vision（MiniMax 视觉分析 + 视觉检查 profile）
              │
           generate（KB 锚定生成）
             锚点 = must_check 规则矩阵 + data/kb/anchors YAML
             正文 = data/regulations/ 44 篇法规原文条款
              │
           verify（确定性验证）
             quote_matcher：citation 反向字面匹配 → match_status
             applicability：三态 ProductFacts（confirmed/candidate/absent）
              │
        PASS / WARN / REJECTED + report_package（含 citations[]）
```

## 技术栈

| 组件 | 技术 | 说明 |
|------|------|------|
| HTTP 框架 | FastAPI 0.115.6 | ASGI；uvicorn 单 worker + ThreadPoolExecutor（默认 5 并发扫描） |
| LLM | MiniMax-M3 | 唯一外部 API（视觉 + 生成共用；Anthropic 兼容端点，urllib 直连不走代理） |
| 知识库 | `data/kb/anchors/*.yaml` | 品类/特征 → 法规锚点（kb_loader） |
| 法规库 | `data/regulations/*.yaml` | 44 篇法规原文条款（article_loader） |
| 验证 | quote_matcher / applicability / grounding / vision_cache | 确定性，零 LLM |
| PDF 解析 | pdfplumber | 用户上传 PDF → 文本 |
| 编排 | 线性 3 步（`pipeline/runner.py`） | LangGraph 已移除 |

**无 embedding**：PAI / ModelScope / Ollama 均已删除，代码中不存在任何 embedding 调用或降级路径。

## 快速开始

### 1. 安装依赖

```bash
python3 -m venv rag_service/.venv
rag_service/.venv/bin/pip install -r rag_service/requirements-prod.txt
```

### 2. 配置环境变量

```bash
cp rag_service/.env.example rag_service/.env
# 编辑 rag_service/.env
```

必需（非 demo）：
- `MINIMAX_API_KEY` — LLM（报告生成 + 视觉分析；兼容旧 `MIMOTALK_API_KEY` 别名）
- `RAG_INTERNAL_SECRET` — BFF ↔ RAG 内部密钥（生产 fail-closed：留空拒绝启动）

### 3. 数据就位检查

启动时 lifespan 会打印 KB / 法规库条目数；`GET /ready` 的 `checks` 也暴露两者。缺数据时扫描会降级到 fallback 包而不是报错——看启动日志确认 `44 KB anchors` 与 `44 regulation library entries`。

### 4. 启动

```bash
rag_service/.venv/bin/uvicorn rag_service.main:app --host 127.0.0.1 --port 8001
```

## 测试

```bash
rag_service/.venv/bin/python -m pytest rag_service/tests/ -v
```

纯逻辑 gate 无需 API key；两个 supplement manifest 测试在 `data/regulation_supplements/*/raw/` 不在盘上时自动 skip（raw 原件 2026-09-14 起不进 git）。

## 目录

```
rag_service/
├── main.py               # FastAPI 入口 + lifespan（graceful shutdown drain）
├── config.py             # pydantic-settings（ALLOWED_MARKETS 等）
├── api/v1.py             # /api/v1/scans（canonical）+ evidence + revisions
├── application/scans.py  # ScanService：会话/作业生命周期、租约、重试、审计
├── infrastructure/file_backend.py  # 会话/作业/上传的原子文件后端
├── pipeline/
│   ├── runner.py         # 线性 3 步编排 + 进度回调
│   └── nodes/            # vision / generator / verifier / findings_builder / visual_checks
├── retrieval/            # must_check + kb_loader + article_loader（锚定三件套）
├── verify/               # applicability / grounding / quote_matcher / vision_cache
├── generate/             # report_generator（LLM）+ prebuilt_profit_data
├── parser/               # docx / html 解析
└── regulation_collectors/  # 法规离线采集（EU Cellar 等）
```

详细约定（端口、env 全表、部署雷区）见仓库根 `CLAUDE.md`。
