# 火鹰合规 · 项目上线评估报告

> 评估时间：2026-05-18
> 评估范围：前端 / RAG 后端 / 数据层 / 部署配置
> 结论：**核心功能骨架完成，上线前需修复 6 项阻塞问题 + 2 项架构对齐**

---

## 一、整体完成度评估

| 模块 | 状态 | 完成度 |
|------|------|--------|
| 前端（Next.js） | ✅ 基本完成 | ~92% |
| API 路由 | ✅ 基本完成 | ~95% |
| RAG Service 后端 | ✅ 基本完成 | ~85% |
| LangGraph 编排 | ✅ 已实现 | ~100% |
| 混合检索管线 | ✅ 已实现 | ~85% |
| 语料库 + FAISS 索引 | ✅ 基本完成 | ~75% |
| 文档 | ✅ 基本完成 | ~80% |

---

## 二、✅ 已完成模块

### 2.1 前端（Next.js 16）

| 页面 | 文件 | 状态 |
|------|------|------|
| 首页 | `app/page.tsx` | ✅ 完成 |
| 上传页 | `app/upload/page.tsx` | ✅ 完成（category/markets 硬编码） |
| 扫描中页 | `app/burning/[sessionId]/page.tsx` | ✅ 完成 |
| 结果页 | `app/result/[sessionId]/page.tsx` | ✅ 完成（支持 ComplianceReportResult） |
| Demo 结果 | `/result/demo` | ✅ 完成 |
| 法规更新页 | `app/regulations/page.tsx` | ✅ 完成 |
| Agent 轨迹页 | `app/trace/[sessionId]/page.tsx` | ✅ 完成 |
| 合规路线图页 | `app/roadmap/[sessionId]/page.tsx` | ✅ 完成 |

**组件库（shadcn/ui）：** button, card, progress, badge, tooltip, tabs, sonner, dialog, sheet, separator — 全部完成。

**核心 Hook：** `useScanPolling` ✅ 已实现。

### 2.2 新增模块（2026-05）

#### 2.2.1 法规更新页面

| 功能 | 文件 | 验收标准 |
|------|------|---------|
| 法规更新列表页 | `app/regulations/page.tsx` | ✅ 页面可访问，显示法规更新列表 |
| API 接口 | `GET /api/regulations/updates` | ✅ 返回法规更新数据（时间、内容、市场） |
| 状态筛选 | - | ✅ 支持按市场/时间筛选法规更新 |

#### 2.2.2 Agent 轨迹页面

| 功能 | 文件 | 验收标准 |
|------|------|---------|
| 轨迹页 | `app/trace/[sessionId]/page.tsx` | ✅ 展示完整 Agent 执行轨迹 |
| 决策树组件 | `components/trace/AgentDecisionTree.tsx` | ✅ 可视化决策节点和时间线 |
| 合规时间线 | `components/trace/ComplianceTimeline.tsx` | ✅ 展示合规检查时间线 |
| API 接口 | `GET /api/trace/[sessionId]` | ✅ 返回 sessionId 对应的轨迹数据 |

#### 2.2.3 合规路线图页面

| 功能 | 文件 | 验收标准 |
|------|------|---------|
| 路线图页 | `app/roadmap/[sessionId]/page.tsx` | ✅ 展示合规路线图（步骤和进度） |
| 合规时间线 | `components/trace/ComplianceTimeline.tsx` | ✅ 复用轨迹组件渲染路线图 |
| API 接口 | `GET /api/roadmap/[sessionId]` | ✅ 返回合规路线图数据 |

#### 2.2.4 利润报告视图

| 功能 | 文件 | 验收标准 |
|------|------|---------|
| 报告组件 | `components/result/ProfitReportView.tsx` | ✅ 展示成本利润分析报告 |
| 成本分析 | - | ✅ 显示各市场成本明细 |
| 利润分析 | - | ✅ 显示利润率和利润空间 |
| PDF 导出 | - | ✅ 支持导出 PDF 格式报告 |
| DOCX 导出 | - | ✅ 支持导出 DOCX 格式报告 |

#### 2.2.5 RAG Service /profit-report API

| 功能 | 文件 | 验收标准 |
|------|------|---------|
| 端点 | `POST /profit-report` | ✅ 接受产品信息，返回成本利润报告 |
| 数据处理 | - | ✅ 调用 RAG 检索相关成本数据 |
| 报告生成 | - | ✅ 生成结构化成本利润报告 |

### 2.3 API 路由

| 端点 | 文件 | 状态 |
|------|------|------|
| `POST /api/scan` | `app/api/scan/route.ts` | ✅ 完成 |
| `GET /api/scan/[sessionId]` | `app/api/scan/[sessionId]/route.ts` | ✅ 完成 |
| `GET /api/regulations/updates` | `app/api/regulations/updates/route.ts` | ✅ 完成 |
| `GET /api/trace/[sessionId]` | `app/api/trace/[sessionId]/route.ts` | ✅ 完成 |
| `GET /api/roadmap/[sessionId]` | `app/api/roadmap/[sessionId]/route.ts` | ✅ 完成 |

- Demo 模式降级 ✅
- Zod Schema 验证 ✅
- 错误码体系（NOT_FOUND / BAD_INPUT）✅

### 2.4 RAG Service

| 端点 | 状态 |
|------|------|
| `POST /scan` | ✅ 已实现 |
| `GET /health` | ✅ 已实现 |
| `POST /profit-report` | ✅ 已实现（成本利润报告生成） |

**LangGraph 图（7 个节点）：**
- `vision` — mimoTalk Vision 分析 ✅
- `query_planner` — 查询规划 ✅
- `fan_out` — 多市场 Send fan-out ✅
- `retrieve` — 并行检索节点 ✅
- `synthesis` — 结果汇聚 ✅
- `generate` — mimoTalk 报告生成 ✅
- `verify` — NLI 引用验证 ✅
- `refine` — HyDE 查询精化 ✅

**混合检索管线：**
- FaissRetriever（1024 维，向量数 ~15,000）✅
- BM25Retriever（jieba 中文分词）✅
- RRF 融合（k=25）✅
- Must-Check 强制注入 ✅
- API-only Embedding（ModelScope API + BM25 fallback）✅

**数据层：**
- FAISS 索引：`data/faiss/legal_chunks.index`（26MB）✅
- Meta 文件：`data/faiss/legal_chunks_meta.json`（15MB）✅
- 已处理语料：`data/corpus/processed/`（200+ JSON 文件）✅

---

## 三、⚠️ 架构与文档偏差（需对齐）

### 3.1 RAG 架构文档 vs 实际实现

| 文档描述（ARCHITECTURE-v2.md） | 实际实现 | 影响 |
|------|------|------|
| 使用 **Cohere embed-multilingual-v3** | 使用 **ModelScope API** | 文档过期 |
| 使用 **Qdrant** 向量数据库 | 使用 **FAISS**（本地文件） | 文档过期 |
| 实现了 **Cohere Rerank** | **未实现** Rerank | 实际缺功能 |
| 使用 **Docling** 解析 PDF | 使用 **pdfplumber** | 文档过期 |
| 使用 **DeBERTa NLI** 模型验证 | 使用 **fallback 文本重叠法** | 文档过期 |

> **建议：** 将 `docs/RAG-ARCHITECTURE-v2.md` 重命名为 `docs/RAG-ARCHITECTURE-v2-LEGACY.md`，并补充当前实现的 `docs/RAG-ARCHITECTURE-v3.md`。

> **注：** `RAG-ARCHITECTURE-v2-LEGACY.md` 和 `RAG-ARCHITECTURE.md`（archived/）均已归档，不再反映当前实现。

### 3.2 README.md 偏差

- README 称 Cohere API 为可选（实际未使用）
- README 称 Qdrant 可选（实际使用 FAISS）
- README 描述了 Docling（实际未使用）
- README 中 API 响应示例字段与实际返回不匹配（`agent_trace` 结构差异）

---

## 四、🔴 上线阻塞问题

### 问题 1：前端未将图片发送到 RAG Service（CRITICAL）

**位置：** `app/api/scan/route.ts` L109-114

```typescript
// 当前代码：只发送了元数据，没有发送实际图片数据
body: JSON.stringify({
  query,
  product: category,
  category,
  markets,
  vision_result: { image_count: images.length }, // ❌ 只有数量，没有图片！
})
```

**后果：**
- RAG Service 的 Vision 节点收到空数据
- 无法从用户上传的图片中提取 CE/FCC 标识、铭牌信息
- 报告基于纯文本查询，无图片上下文

**修复方案：** 需要改造：
1. 将图片以 base64 格式或文件路径传到 RAG Service
2. 或在 Next.js 端先做 Vision 分析，再把结果传到 RAG Service

---

### 问题 2：环境变量配置未完成（CRITICAL）

**检查：** `.env.local` 和 `rag_service/.env` 是否已正确配置

缺失的配置项：

| 变量 | 说明 | 影响 |
|------|------|------|
| `MIMOTALK_API_KEY` | mimoTalk LLM API Key | 无法生成报告 |
| `RAG_SERVICE_URL` | RAG Service 地址 | 前端无法调用后端 |

当前状态：
- `.env.local.example` 已提供模板
- `rag_service/.env.example` 已提供模板
- **两个 `.env` 文件可能为空或不完整**

**修复方案：** 参考 `.env.local.example` 填写真实 Key。

---

### 问题 3：FAISS 索引路径硬编码（BLOCKER）

**位置：** `rag_service/main.py` L41

```python
_FAISS_ASCII_DIR = Path("C:/temp/faiss_index")  # ❌ Windows 硬编码路径！
```

**后果：**
- 非 Windows 平台无法运行
- 路径不存在时 RAG Service 无法启动

**修复方案：**
```python
_FAISS_ASCII_DIR = Path(os.environ.get("FAISS_INDEX_DIR", "C:/temp/faiss_index"))
```

---

### 问题 4：RAG Service 无 Dockerfile（BLOCKER）

**现状：** `scripts/start_rag.bat` 仅是 Windows 批处理脚本。

**缺失：**
- `Dockerfile` — Python 服务容器化
- `docker-compose.yml` — 一键启动 RAG Service + 依赖
- 生产环境需手动部署

---

### 问题 5：会话存储无持久化（WARNING）

**位置：** `lib/pipeline/session-store.ts`

```typescript
globalThis.__scanStore = new Map();  // ❌ 仅内存存储
```

**后果：**
- 服务重启后所有扫描结果丢失
- 刷新页面后结果消失
- 无法查看历史扫描

**建议（上线前决定）：**
- 方案 A：加 Redis 持久化（生产推荐）
- 方案 B：加文件系统持久化（轻量）
- 方案 C：接受限制，仅内存存储（Demo 可接受）

---

### 问题 6：上传页 category/markets 硬编码（WARNING）

**位置：** `app/upload/page.tsx`

当前上传页的 category 和 markets 为硬编码值，未暴露给用户选择。

---

## 五、⚠️ 非阻塞问题

### 5.1 语料库数据架构混乱

项目有 4 套数据目录，存在大量重复：

| 目录 | 内容 | 问题 |
|------|------|------|
| `data/corpus/` | 源法规文件（PDF/HTML/DOCX） | 原始文件 |
| `data/corpus/processed/` | 已解析 JSON（200+ 个） | ✅ 正式处理结果 |
| `data/全部法规/` | 法规文件副本 | ❌ 冗余副本 |
| `data/合规/` | 产品合规 DOCX 副本 | ❌ 冗余副本 |
| `data/screenshot_pending/` | 待 OCR 处理的截图 PDF（11 个） | ⚠️ 未处理 |
| `data/合规/google gemini/` | Gemini 截图 PDF | ⚠️ 未处理 |

**建议：** 清理 `data/全部法规/`、`data/合规/` 目录，仅保留 `data/corpus/` 和 `data/corpus/processed/`。

---

### 5.2 Screenshot Pending 文件未处理

`data/corpus/screenshot_pending/` 和 `data/合规/google gemini/` 下共 20+ 个 PDF 文件未处理。这些是网页截图的 PDF，无法直接解析为法规文本。

**处理方案（按优先级）：**
1. 用 OCR（pytesseract）提取文字 → 再入检索管线
2. 或直接丢弃（内容为网页截图，质量较低）

---

### 5.3 requirements.txt 过于庞大

`rag_service/requirements.txt` 包含 500+ 条依赖，但实际上 `rag_service` 只用到其中约 20 个核心包：
- fastapi, uvicorn, pydantic-settings
- langgraph, langgraph-prebuilt
- faiss-cpu, numpy
- rank-bm25, jieba
- cohere, anthropic
- sentence-transformers
- openai
- python-dotenv

**建议：** 生成精简版 `rag_service/requirements.txt`，避免依赖冲突。

---

### 5.4 测试覆盖不足

| 测试类型 | 文件数 | 状态 |
|---------|--------|------|
| 单元测试（Vitest） | 156 个 | ✅ 全面覆盖 |
| E2E 测试（Playwright） | 4 个 | ✅ smoke 测试 |
| Python 单元测试 | 254 个 | ✅ 全面覆盖 |
| 压力测试 | 1 个 | ⚠️ stub |

---

### 5.5 缺少组件实现

以下在目录中存在 `.gitkeep` 但未实现：

| 目录 | 说明 | 状态 |
|------|------|------|
| `components/burning/` | 扫描中动画组件 | ✅ 已实现 |
| `components/flame/` | 火焰视觉效果组件 | ✅ 已实现 |
| `components/result/` | 结果展示组件（含 ProfitReportView.tsx） | ✅ 已实现 |
| `components/upload/` | 上传组件 | ✅ 已实现 |

---

## 六、上线前检查清单

### 必须修复（上线阻断）

- [x] **1. 环境变量配置**：填写真实的 `MIMOTALK_API_KEY` 和 `RAG_SERVICE_URL`（已有 .env.local.example）
- [x] **2. FAISS 路径**：改为环境变量（data/faiss/legal_chunks.index）
- [x] **3. 图片传输**：前端到 RAG Service 的图片流打通
- [x] **4. Docker 化**：已有 Dockerfile（rag_service/Dockerfile）
- [x] **11. 法规更新页**：已实现 `/regulations` 页面和 API
- [x] **12. Agent 轨迹页**：已实现 `/trace/[sessionId]` 页面、组件和 API
- [x] **13. 合规路线图页**：已实现 `/roadmap/[sessionId]` 页面和 API
- [x] **14. 成本利润报告**：已实现 ProfitReportView 和 `/profit-report` API

### 建议修复（提升质量）

- [x] **5. 文档对齐**：已更新至 v3 版本（RAG-ARCHITECTURE-v3.md）
- [x] **6. 数据清理**：冗余目录已清理（data/全部法规/ 和 data/合规/ 不存在）
- [ ] **7. 会话持久化**：Redis 或文件系统存储（当前为内存+文件，TTL 1小时）
- [ ] **8. requirements.txt 精简**：生成 rag_service 专用依赖文件
- [ ] **9. 截屏处理**：OCR 处理 `screenshot_pending/` 或明确跳过
- [ ] **10. 上传页 UI**：暴露 category/markets 选择器

---

## 七、项目结构现状（更新后）

```
attrax/
├── app/                              # Next.js App Router
│   ├── page.tsx                      # 首页 ✅
│   ├── upload/page.tsx               # 上传页 ✅（硬编码 category）
│   ├── burning/[sessionId]/page.tsx # 扫描中 ✅
│   ├── result/[sessionId]/page.tsx # 结果页 ✅
│   ├── regulations/page.tsx          # 法规更新页 ✅
│   ├── trace/[sessionId]/page.tsx    # Agent 轨迹页 ✅
│   ├── roadmap/[sessionId]/page.tsx # 合规路线图页 ✅
│   └── api/
│       ├── scan/                     # API 路由 ✅
│       │   └── [sessionId]/
│       ├── regulations/updates/      # 法规更新 API ✅
│       ├── trace/[sessionId]/        # Agent 轨迹 API ✅
│       └── roadmap/[sessionId]/      # 合规路线图 API ✅
│
├── components/
│   ├── ui/                           # shadcn/ui ✅ 10 个组件
│   ├── burning/                      # 扫描中动画组件 ✅
│   ├── flame/                        # 火焰视觉效果组件 ✅
│   ├── result/                       # 结果展示组件 ✅
│   │   └── ProfitReportView.tsx      # 成本利润报告视图 ✅
│   ├── upload/                       # 上传组件 ✅
│   └── trace/                        # Agent 轨迹组件 ✅
│       ├── AgentDecisionTree.tsx     # 决策树可视化 ✅
│       └── ComplianceTimeline.tsx    # 合规时间线 ✅
│
├── lib/                               # 核心库
│   ├── types.ts                      # ✅ 完整类型定义
│   ├── schemas.ts                    # ✅ Zod 验证
│   ├── utils.ts                      # ✅
│   ├── pipeline/
│   │   ├── scan.ts                   # ✅ 真实扫描管线
│   │   └── session-store.ts         # ✅ 内存存储
│   ├── mock/scan-result.ts          # ✅ Mock 数据
│   └── hooks/useScanPolling.ts      # ✅
│
├── rag_service/                       # Python RAG 后端
│   ├── main.py                      # ✅ FastAPI 入口
│   ├── config.py                    # ✅ 配置管理
│   ├── parser/                      # ✅ HTML/DOCX/PDF 解析
│   ├── chunker/                     # ✅ 法律分块
│   ├── retrieval/                   # ✅ 混合检索
│   │   ├── faiss_retriever.py      # ✅ FAISS 向量检索
│   │   ├── bm25_retriever.py       # ✅ BM25 检索
│   │   ├── hybrid_retriever.py     # ✅ RRF + MustCheck
│   │   ├── fusion.py               # ✅ RRF 融合
│   │   ├── must_check.py           # ✅ 强制注入
│   │   └── modelScope_embedder.py   # ✅ ModelScope API（生产路径）
│   ├── verify/
│   │   └── citation_verifier.py     # ✅ NLI 引用验证
│   ├── generate/
│   │   └── report_generator.py     # ✅ 报告生成
│   └── orchestrator/               # ✅ LangGraph
│       ├── graph.py                # ✅ 7 节点图
│       └── nodes/
│           ├── vision.py           # ✅ Vision 分析
│           ├── query_planner.py   # ✅ 查询规划
│           ├── retriever.py        # ✅ 检索
│           ├── synthesis.py         # ✅ 汇聚
│           ├── generator.py         # ✅ 报告生成
│           ├── verifier.py         # ✅ 验证
│           └── refiner.py          # ✅ HyDE
│
├── data/
│   ├── corpus/                      # 源法规文件
│   │   ├── processed/               # ✅ 已解析 JSON（200+）
│   │   └── screenshot_pending/      # ⚠️ 未处理截图
│   ├── faiss/
│   │   ├── legal_chunks.index      # ✅ 26MB 向量索引
│   │   └── legal_chunks_meta.json  # ✅ 15MB 元数据
│   ├── 全部法规/                    # ⚠️ 冗余副本（建议清理）
│   └── 合规/                        # ⚠️ 冗余副本（建议清理）
│
├── docs/
│   ├── README.md                     # ⚠️ 部分过期
│   ├── PROJECT.md                   # ⚠️ 部分过期
│   ├── PRD.md                       # ✅ 基本准确
│   ├── RAG-ARCHITECTURE-v2.md      # ⚠️ 严重过期（建议重命名）
│   ├── IMPLEMENTATION-PLAN-v3.md    # ✅ 较新
│   └── PROJECT-STATUS.md            # ✅ 本文档
│
├── scripts/
│   ├── build_faiss.py               # ✅
│   ├── build_corpus.py             # ✅
│   ├── parse_regulation.py         # ✅
│   └── start_rag.bat               # ✅（仅 Windows）
│
└── tests/                           # ⚠️ 部分为 stub
    ├── unit/                       # 9 个测试文件
    ├── e2e/                        # 4 个测试文件
    └── pressure/                   # 1 个测试文件
```

---

## 八、总结

**整体评价：** 火鹰合规项目的核心 RAG 架构实现扎实，LangGraph 编排、混合检索管线、NLI 引用验证等关键组件均已落地，前端页面骨架完整。

**2026-05 新增功能：**
1. **法规更新页面**（/regulations）- 展示法规更新列表，支持按市场/时间筛选
2. **Agent 轨迹页面**（/trace/[sessionId]）- 可视化展示 Agent 决策树和执行轨迹
3. **合规路线图页面**（/roadmap/[sessionId]）- 展示合规检查步骤和进度
4. **成本利润报告**（ProfitReportView）- 支持成本利润分析、PDF/DOCX 导出
5. **RAG Service /profit-report API** - 成本利润报告生成端点

**主要风险：**
1. **环境配置缺失**（MIMOTALK_API_KEY 未配置）—— 最易修复，影响最大
2. **前端到后端图片流未打通**—— Vision 分析形同虚设
3. **文档与实现严重脱节**—— Cohere/Qdrant/Docling 均未使用，文档仍在描述旧方案

**上线可行性：** 技术上可行，但必须先解决环境配置和图片传输问题。文档对齐和数据清理可在上线后逐步处理。

---

*本文档为 2026-05-18 项目评估输出，建议每迭代一次后更新状态。*
