# 火鹰合规 · 项目上线评估报告

> 评估时间：2026-06-26
> 评估范围：前端 / RAG 后端 / 数据层 / 部署配置
> 评估方法：参考历史报告（2026-05-23 / 2026-06-14 / 2026-06-20）+ 当前代码状态核对

---

## 一、整体完成度评估

| 模块 | 状态 | 完成度 |
|------|------|--------|
| 前端（Next.js） | ✅ 基本完成 | ~99% |
| API 路由 | ✅ 基本完成 | ~99% |
| RAG Service 后端 | ✅ 基本完成 | ~85% |
| LangGraph 编排 | ✅ 已实现 | ~100% |
| 混合检索管线 | ✅ 已实现 | ~85% |
| 语料库 + FAISS 索引 | ✅ 已实现 | ~100% |
| 文档 | ✅ 基本完成 | ~95% |

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
| i18n 变体 | `app/[locale]/page.tsx` | ✅ 完成 |

**组件库（shadcn/ui）：** button, card, progress, badge, tooltip, tabs, sonner, dialog, sheet, separator, LanguageSwitcher — 全部完成。

**核心 Hook：** `useScanPolling` ✅ 已实现。

### 2.2 2026-05 新增模块

#### 2.2.1 法规更新页面

| 功能 | 文件 | 验收标准 |
|------|------|---------|
| 法规更新列表页 | `app/regulations/page.tsx` | ✅ 页面可访问，显示法规更新列表 |
| API 接口 | `GET /api/regulations/updates` | ✅ 返回法规更新数据（时间、内容、市场） |
| 状态筛选 | - | ✅ 支持按市场/时间筛选法规更新 |

> ⚠️ `app/api/regulations/updates/route.ts` 文件 1165 行硬编码 demo 数据，是已知 P1 优化项。

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
| PDF 导出 | `lib/report-export-modules/profit-pdf.ts` | ✅ 支持导出 PDF 格式报告 |
| DOCX 导出 | `lib/report-export-modules/profit-docx.ts` | ✅ 支持导出 DOCX 格式报告 |

#### 2.2.5 RAG Service /profit-report API

| 功能 | 文件 | 验收标准 |
|------|------|---------|
| 端点 | `POST /profit-report` | ✅ 接受产品信息，返回成本利润报告 |
| 数据处理 | - | ✅ 调用 RAG 检索相关成本数据 |
| 报告生成 | - | ✅ 生成结构化成本利润报告 |

#### 2.2.6 三层会话架构（2026-06 增强）

- **会话存储**：`lib/pipeline/session-store.ts`（内存 + 文件，TTL 1小时）
- **扫描队列**：`lib/pipeline/scan-queue.ts`（持久化到 `data/scan-queue/`，可恢复任务）
- **访问认证**：`lib/pipeline/session-auth.ts`（base64url token + SHA-256 哈希，跨标签页/刷新）

### 2.3 API 路由

| 端点 | 文件 | 状态 |
|------|------|------|
| `POST /api/scan` | `app/api/scan/route.ts` | ✅ 完成 |
| `GET /api/scan/[sessionId]` | `app/api/scan/[sessionId]/route.ts` | ✅ 完成 |
| `GET /api/regulations/updates` | `app/api/regulations/updates/route.ts` | ✅ 完成（1165 行，待拆分） |
| `GET /api/trace/[sessionId]` | `app/api/trace/[sessionId]/route.ts` | ✅ 完成 |
| `GET /api/roadmap/[sessionId]` | `app/api/roadmap/[sessionId]/route.ts` | ✅ 完成 |
| `GET /api/health` | `app/api/health/route.ts` | ✅ 完成 |
| `POST /api/session-access` | `app/api/session-access.ts` | ✅ 完成 |

- Demo 模式降级 ✅
- Zod Schema 验证 ✅
- 错误码体系（NOT_FOUND / BAD_INPUT）✅
- 限流（`lib/rate-limit.ts`）✅

### 2.4 RAG Service

| 端点 | 状态 |
|------|------|
| `POST /scan` | ✅ 已实现 |
| `GET /health` | ✅ 已实现 |
| `POST /profit-report` | ✅ 已实现（成本利润报告生成） |

**LangGraph 图（8 个节点）：**
- `vision` — MiniMax-M3 Vision 分析 ✅
- `query_planner` — 查询规划 ✅
- `fan_out` — 多市场 Send fan-out ✅
- `retrieve` — 并行检索节点 ✅
- `synthesis` — 结果汇聚 ✅
- `generate` — MiniMax-M3 报告生成 ✅
- `verify` — NLI 引用验证 ✅
- `refine` — HyDE 查询精化 ✅

**混合检索管线：**
- FaissRetriever（1024 维，~15K 向量）✅
- BM25Retriever（jieba 中文分词）✅
- RRF 融合（k=25）✅
- Must-Check 强制注入 ✅
- API-only Embedding（ModelScope → Ollama → BM25 fallback）✅

**数据层：**
- FAISS 索引：`data/faiss/legal_chunks.index`（~29 MB）
- Meta 文件：`data/faiss/legal_chunks_meta.json`（~167 MB）
- 已处理语料：`data/corpus/processed/`（~140 JSON 文件）
- 法规补充包：`data/regulation_supplements/`（6 批次 369 原始文件）

---

## 三、⚠️ 架构与文档偏差（已修复 vs 仍存在）

### 3.1 已修复偏差（2026-05 → 2026-06）

| 旧描述 | 当前实现 | 状态 |
|------|------|------|
| 使用 Cohere embed-multilingual-v3 | ModelScope API | ✅ 已修复（文档已更新） |
| 使用 Qdrant 向量数据库 | FAISS（本地文件） | ✅ 已修复 |
| 使用 Docling 解析 PDF | pdfplumber | ✅ 已修复 |
| 使用 DeBERTa NLI 模型验证 | fallback 文本重叠法 | ✅ 文档已标注 |
| `data/全部法规/` 和 `data/合规/` 冗余副本 | 已清理 | ✅ 已修复 |
| `RAG-ARCHITECTURE-v2.md` 旧版架构文档 | 已迁移为 `RAG-ARCHITECTURE-v3.md` | ✅ 已修复 |

### 3.2 仍存在偏差

| 项 | 说明 | 影响 |
|------|------|------|
| `app/api/regulations/updates/route.ts` | 1165 行硬编码 demo 数据 | 中（性能 + 可维护性） |
| `lib/i18n.tsx` | 1004 行超大文件 | 中（可维护性） |
| `lib/pipeline/scan.ts` | 234 行偏大 | 低（可读性） |
| `rag_service/requirements.txt` | 500+ 条依赖，核心仅 20 个 | 低（部署体积） |
| `cohere_reranker.py` | 实现但未接入 | 低（功能未启用） |
| `cohere_embedder.py` | 默认未启用 | 低（功能未启用） |

---

## 四、🔴 上线阻塞问题（2026-05 评估）

### 历史阻塞项

1. **前端未将图片发送到 RAG Service** → ✅ 已修复（`images: array of {buffer, mime_type, name}`）
2. **环境变量配置未完成** → ⚠️ 仍需用户填入真实 API Key
3. **FAISS 索引路径硬编码** → ✅ 已修复（`FAISS_INDEX_DIR` 环境变量，默认 `data/faiss/`）
4. **RAG Service 无 Dockerfile** → ✅ 已修复（`rag_service/Dockerfile`）
5. **会话存储无持久化** → ✅ 已加文件持久化层（仍无数据库）
6. **上传页 category/markets 硬编码** → ⚠️ 仍为硬编码（P3）

### 当前阻塞（2026-06 复评）

| 阻塞 | 状态 | 修复方案 |
|------|------|------|
| 环境变量未配 | 用户侧 | 复制 `.env.local.example` 填入 Key |
| LLM 端点：MIMOTALK_BASE_URL | ✅ 已切到 `https://api.minimaxi.com/anthropic/v1` | - |
| ModelScope Embedding 限流 | 已用 50/batch 批量化 | - |

---

## 五、⚠️ 非阻塞问题

### 5.1 语料库数据架构（已大幅清理）

| 目录 | 状态 |
|------|------|
| `data/corpus/processed/` | ✅ 正式处理结果（~140 JSON） |
| `data/corpus/{asia,cn,eu,gcc,intl,middle_east,us}/` | ✅ 源文件按地域组织 |
| `data/regulation_supplements/` | ✅ 6 批次法规补充包 + manifest + audit |
| `data/regulation_reports/` | ✅ 覆盖率报告 |
| `data/全部法规/` | ✅ 已清理 |
| `data/合规/` | ✅ 已清理 |
| `data/corpus/screenshot_pending/` | ⏳ 不存在，已移除 |

### 5.2 已知遗留

| 项 | 说明 | 处理 |
|------|------|------|
| `rag_service/requirements.txt` 冗余 | 500+ 条，核心 20 个 | 计划精简（`requirements-prod.txt` 已部分精简） |
| `cohere_reranker.py` 未接入 | CLAUDE.md 已知 | 视需要启用 |
| `cohere_embedder.py` 默认未启用 | HybridRetriever 中可选 | 视需要启用 |
| `tests/pressure/` 压测脚本 | 未集成 CI | 后续纳入 |

---

## 六、上线前检查清单

### 必须修复（上线阻断）

- [x] **1. 环境变量配置**：`MIMOTALK_API_KEY` 已支持（需用户填入）
- [x] **2. FAISS 路径**：已改为 `FAISS_INDEX_DIR` 环境变量
- [x] **3. 图片传输**：前端到 RAG Service 的图片流已打通
- [x] **4. Docker 化**：已有 `rag_service/Dockerfile` + `docker-compose.yml`
- [x] **11. 法规更新页**：已实现 `/regulations` 页面和 API
- [x] **12. Agent 轨迹页**：已实现 `/trace/[sessionId]` 页面、组件和 API
- [x] **13. 合规路线图页**：已实现 `/roadmap/[sessionId]` 页面和 API
- [x] **14. 成本利润报告**：已实现 ProfitReportView 和 `/profit-report` API
- [x] **15. 三层会话架构**：内存 + 文件 + 队列 + 访问 token

### 建议修复（提升质量）

- [x] **5. 文档对齐**：CLAUDE.md / README.md / docs/README.md / docs/PROJECT-STATUS.md 已更新（2026-06-20）
- [x] **6. 数据清理**：`data/全部法规/` 和 `data/合规/` 已清理
- [x] **16. LLM 切换**：从 mimoTalk 切到 MiniMax-M3，端点 `api.minimaxi.com/anthropic/v1`
- [x] **17. ModelScope 批量化**：`build_faiss.py` 50/batch，规避 350 calls/h 限流
- [ ] **7. 会话持久化**：升级到 Redis 或数据库（当前为内存+文件+队列，TTL 1小时）
- [ ] **8. requirements.txt 精简**：生成精简版 `requirements.txt`
- [x] **18. 超大文件拆分**（2026-06-26 完成）：`app/api/regulations/updates/route.ts` 1165 → 80 行（拆 4 文件）+ `lib/i18n.tsx` 1040 → 103 行（拆 translations 数据到独立文件）
- [ ] **9. 上传页 UI**：暴露 category/markets 选择器
- [ ] **10. CI 集成**：压测、E2E、Lint 流水线
- [ ] **19. cohere_reranker 接入**（如确需 rerank）

---

## 七、项目结构现状（2026-06）

```
attrax/
├── app/                              # Next.js App Router
│   ├── page.tsx                      # 首页 ✅
│   ├── layout.tsx                    # 根布局 ✅
│   ├── [locale]/page.tsx             # i18n 变体 ✅
│   ├── upload/page.tsx               # 上传页 ✅
│   ├── burning/[sessionId]/page.tsx  # 扫描中 ✅
│   ├── result/[sessionId]/page.tsx   # 结果页 ✅
│   ├── regulations/page.tsx          # 法规更新页 ✅
│   ├── trace/[sessionId]/page.tsx    # Agent 轨迹页 ✅
│   ├── roadmap/[sessionId]/page.tsx  # 合规路线图页 ✅
│   └── api/                          # 7 个 API 路由 ✅
│       ├── session-access.ts
│       ├── scan/route.ts + [sessionId]/route.ts
│       ├── regulations/updates/route.ts
│       ├── trace/[sessionId]/route.ts
│       ├── roadmap/[sessionId]/route.ts
│       └── health/route.ts
│
├── components/                       # 11 个 shadcn/ui + 业务组件
│   ├── ui/                           # ✅ 11 个
│   ├── upload/UploadForm.tsx         # ✅
│   ├── burning/BurningAnimation.tsx  # ✅
│   ├── result/                       # ✅ AgentTraceView + ProfitReportView
│   └── trace/                        # ✅ AgentDecisionTree + ComplianceTimeline
│
├── lib/                              # 核心库（完整类型 + Zod + i18n + 报告导出）
│   ├── types.ts                      # ✅
│   ├── schemas.ts                    # ✅
│   ├── constants.ts                  # ✅
│   ├── api-response.ts               # ✅
│   ├── i18n.tsx / server-i18n.ts     # ✅ 双端 i18n
│   ├── rate-limit.ts                 # ✅
│   ├── upload-validation.ts          # ✅
│   ├── report-localization.ts        # ✅
│   ├── report-export.ts + report-export-modules/  # ✅ 7 个实现
│   ├── pipeline/                     # ✅ 5 个文件（scan/session-store/scan-queue/session-auth/profit-report）
│   ├── mock/scan-result.ts           # ✅
│   └── hooks/useScanPolling.ts       # ✅
│
├── rag_service/                      # Python RAG 后端
│   ├── main.py                       # ✅ FastAPI 入口
│   ├── config.py / Dockerfile        # ✅
│   ├── parser/                       # ✅ HTML/DOCX
│   ├── chunker/legal_chunker.py      # ✅ Parent-Child 分块
│   ├── retrieval/                    # ✅ 混合检索（10 个文件）
│   ├── verify/citation_verifier.py   # ✅ NLI 软门
│   ├── generate/                     # ✅ 报告生成（2 个文件）
│   ├── schemas/report_package.py     # ✅
│   ├── orchestrator/                 # ✅ 8 节点 LangGraph
│   ├── regulation_collectors/        # 法规离线采集
│   ├── eval/                         # 检索评估
│   └── tests/                        # ✅ pytest 测试
│
├── data/
│   ├── corpus/                       # ✅ 源法规（按地域）+ processed/
│   ├── regulation_supplements/       # ✅ 6 批次补充包
│   ├── regulation_reports/           # ✅ 覆盖率报告
│   ├── faiss/                        # ✅ 索引 + 元数据
│   ├── sessions/                     # ✅ 会话文件
│   └── scan-queue/                   # ✅ 任务队列
│
├── docs/                             # 文档
│   ├── README.md                     # ✅ 文档索引（已更新 2026-06-20）
│   ├── PROJECT.md                    # ✅ 项目描述
│   ├── PRD.md                        # ✅ 产品需求
│   ├── PROJECT-STATUS.md             # ✅ 本文档
│   ├── RAG-ARCHITECTURE-v3.md        # ✅ RAG 架构
│   ├── DOCUMENT-PIPELINE.md          # ✅ 语料库构建
│   ├── DEPLOYMENT.md                 # ✅ 部署
│   ├── plans/                        # ✅ 修复计划（2 份）
│   └── superpowers/specs/            # ✅ 架构设计 spec（2 份）
│
├── scripts/                          # 运维脚本
│   ├── build_faiss.py                # ✅ 主构建脚本（50/batch）
│   ├── collect_*.py                  # 5 个法规离线采集
│   ├── ingest_regulation_supplements.py
│   ├── diff_regulation_manifests.py
│   ├── report_regulation_coverage.py
│   ├── evaluate_regulation_retrieval.py
│   ├── preflight-deploy.mjs / run-pytest.mjs
│   ├── start_rag.bat / sync-data-to-server.sh
│   └── deploy.sh / deploy.ps1
│
├── tests/                            # 前端测试
│   ├── unit/                         # Vitest（30+ 文件）
│   ├── e2e/                          # Playwright（5 个 spec）
│   ├── fixtures/                     # 测试数据
│   ├── pressure/                     # 压测脚本
│   └── setup.ts
│
└── docker-compose.yml                # 8001:8000 端口映射
```

---

## 八、总结

**整体评价：** 火鹰合规项目的核心 RAG 架构实现扎实，LangGraph 编排、混合检索管线、NLI 引用验证等关键组件均已落地，前端页面骨架完整，会话存储升级到三层架构（内存 + 文件 + 队列 + 访问 token），LLM 已切到 MiniMax-M3。

**2026-06-20 → 2026-06-26 主要变更（17 轮 P0/P1/P2/P2-Plus 迭代）：**

1. **测试通过率 90% → 100%**：从 587/652 提升到 **696/696** 通过；新增 60+ 测试覆盖新组件
2. **TypeScript 错误清零**：修复 10 个假错误（stale attrax/ 目录误导 tsc）；Windows EPERM 重试 + 降级
3. **代码结构大幅简化**：
   - `app/result/[sessionId]/page.tsx` 956 → **261 行**（-73%，拆出 5 个组件：SourceNotice/DownloadButtons/ImageCarousel/ComplianceReportView/LegacyResultView/ReportPanels）
   - `app/api/regulations/updates/route.ts` 1165 → **80 行**（拆 4 文件：route/data/types/utils）
   - `lib/i18n.tsx` 1040 → **103 行**（拆出 translations.ts 数据文件）
   - `components/trace/AgentDecisionTree.tsx` 898 → **810 行**（拆出 DecisionTreePrimitives）
4. **安全性增强**：`next.config.ts` 加 3 个安全头（Permissions-Policy、Cross-Origin-Opener-Policy、Cross-Origin-Resource-Policy）；API 路由全部统一用 `ok/fail` envelope
5. **性能优化**：`/api/regulations/updates` 加 `unstable_cache`（5min TTL）；`app/regulations/page.tsx` 搜索框用 `useDeferredValue`；Next.js 16 Turbopack `optimizePackageImports`
6. **错误处理 + UX**：3 个 error boundary（`app/error.tsx` / `app/result/[sessionId]/error.tsx` / `app/not-found.tsx`）+ 5 个 loading.tsx skeleton（upload/burning/result/trace/roadmap）
7. **法规知识库扩容**：`data/corpus/processed/` 135 → **355 文档**；FAISS 索引 0 → **14,495 chunks**（28 区域覆盖）；6 个 supplements 全部 ingest
8. **API 安全合约**：`tokenFromRequest` 注释明确 Bearer-only（防 query string 泄漏到 access log）；`core-utilities.test.ts` 更新反映安全合约
9. **未 commit 改动**：~29 代码文件 + 220 语料 + FAISS 386M + 3 新测试文件（待用户授权 commit + attrax/ 决策）

**主要风险（更新）：**

1. **环境配置**：用户需填入真实 API Key（`.env.local` + `rag_service/.env`）
2. ~~**超大文件**~~（2026-06-26 已解决）：`app/api/regulations/updates/route.ts`、`lib/i18n.tsx` 均已拆分
3. **cohere 路径未启用**：`cohere_reranker.py` / `cohere_embedder.py` 实现但默认未启用
4. **requirements 冗余**：`rag_service/requirements.txt` 含 500+ 条，核心仅 20 个
5. **stale attrax/ 目录**：项目根有 4 月份旧副本（独立 .git 0 commits，~1.2GB），tsconfig 已 exclude，但物理目录仍在（需用户决策删除或保留）

**上线可行性：** 技术上可行。核心链路 + 文档 + 数据均已对齐到 2026-06-26 状态。剩余 P3 项（cohere 启用/requirements 精简/CI 集成/Redis 持久化）可在迭代中处理。

---

*最后更新：2026-06-26*
*下次评估建议：attrax/ 决策 + commit 拆分 + Redis 持久化升级*
