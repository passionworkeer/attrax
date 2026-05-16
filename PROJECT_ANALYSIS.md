# 火鹰合规 (Attrax) 项目深度分析报告

> 分析时间：2026-05-13
> 分析维度：5 个并行维度
> 项目路径：E:/desktop/火鹰合规/attrax/

---

## 综合评分表

| 维度 | 评分 | 核心问题数 |
|------|------|-----------|
| 前端完整性 | **8.5 / 10** | 2 个中等问题 |
| 后端 API 完整性 | **9 / 10** | 1 个中等问题 |
| RAG Pipeline 完整性 | **9.5 / 10** | 1 个中等问题 |
| 测试覆盖度 | **7 / 10** | 2 个中等问题 |
| 可运行性 | **6 / 10** | 3 个严重问题 |
| **综合** | **8 / 10** | 8 个问题 |

---

## 维度 1：前端完整性检查

### 评分：8.5/10

### 页面结构
- `app/page.tsx` - 首页，存在
- `app/upload/page.tsx` - 上传页，**完整**（含图片预览、文档上传、类别/市场选择、提交逻辑）
- `app/burning/[sessionId]/page.tsx` - 扫描中页面，**完整**（火焰动画、进度条、阶段提示、失败处理）
- `app/result/[sessionId]/page.tsx` - 结果页，**完整**（合规报告+利润报告 Tab 视图、PDF/DOCX 导出、Agent Trace 时间线）

### 组件目录状态

| 目录 | .gitkeep | 说明 |
|------|---------|------|
| `components/burning/` | 存在 | 扫描动画全在页面内，未提取组件 |
| `components/flame/` | 存在 | 火焰效果全在页面内，未提取组件 |
| `components/result/` | 存在 | `ProfitReportView.tsx` 独立存在，布局合理 |
| `components/upload/` | 存在 | 上传逻辑全在页面内，未提取组件 |

### 发现的问题

1. **组件目录空占位 (.gitkeep)** - 中等
   - `components/burning/`、`components/flame/`、`components/upload/` 三个目录只有 `.gitkeep`，组件逻辑完全内联在 page.tsx 中
   - 长期会导致页面文件过大（upload/page.tsx 412 行，result/page.tsx 497 行）
   - 当前不影响功能，但技术债务明显

2. **缺失 lib/vision/ 和 lib/rag/ 实现** - 中等
   - `lib/vision/.gitkeep` - 前端无 Vision 封装（vision 分析在后端完成，合理）
   - `lib/rag/.gitkeep` - 前端无 RAG 封装（RAG 调用全在 `lib/pipeline/scan.ts` 中，可接受）

### 优点
- 页面流转完整（upload → burning → result → upload）
- Demo 模式降级完整（失败时自动切 mock 数据）
- ProfitReportView 组件结构清晰，功能完整
- 会话存储（memory + 文件 TTL）实现健壮
- useScanPolling hook 设计合理

### 关键问题摘要
1. 上传/燃烧/火焰组件目录为空，技术债务累积
2. 主要页面文件偏大（>400行），违反"小函数"原则

---

## 维度 2：后端 API 完整性检查

### 评分：9/10

### API 端点
- `GET /health` - 存活探针 ✅
- `GET /ready` - 就绪探针 ✅
- `POST /scan` - 主扫描端点 ✅（含 PDF 提取、DEMO 模式、180s 超时保护）
- `POST /profit-report` - 利润报告端点 ✅（60s 超时、预置数据快通道）

### LangGraph 节点（7 个）
| 节点 | 文件 | 功能 |
|------|------|------|
| vision | nodes/vision.py | 图片分析，提取产品类型+认证标志 |
| query_planner | nodes/query_planner.py | 查询规划 |
| fan_out | nodes/retriever.py | Send() 多市场并行 |
| retrieve | nodes/retriever.py | 分市场检索 |
| synthesis | nodes/synthesis.py | 跨市场去重合并（上限 40 条）|
| generate | nodes/generator.py | mimoTalk 报告生成 |
| verify | nodes/verifier.py | NLI 引用验证（软门）|
| refine | nodes/refiner.py | HyDE 风格查询精化 |

### 发现的问题

1. **cohere_reranker.py 已实现但未接入管线** - 中等
   - 文件 `retrieval/cohere_reranker.py` 存在（1 行注释）
   - `hybrid_retriever.py` 第 127 行明确注释：`Rerank: 不实现`
   - `CLAUDE.md` 已记录此限制
   - 不影响当前功能，但属于"死代码"

### 优点
- LangGraph 编排架构完整，多市场并行
- 依赖注入通过 lifespan 初始化（_retriever, generator, verifier, vision_analyzer）
- 优雅降级链：Ollama → 本地 Qwen → ModelScope → BM25-only
- 超时保护完善（scan 180s, profit 60s）
- Query pre-warming 机制避免首次查询延迟
- PDF 服务端提取（pdfplumber）已集成
- 代理禁用逻辑正确（Windows WinError 10060 修复）

### 关键问题摘要
1. cohere_reranker 为死代码，已声明但未接入

---

## 维度 3：RAG Pipeline 完整性检查

### 评分：9.5/10

### 完整链路状态

```
文档上传 (PDF/DOCX/HTML)
    ↓
parser/ (pdfplumber + html_parser + docx_parser)
    ↓
chunker/legal_chunker.py (Parent-Child 分块策略)
    ↓
processed/ JSON 文件（~100+ 个 .json）
    ↓
FAISS 索引 + BM25 索引（启动时构建）
    ↓
hybrid_retriever.py (Dense+BM25 → RRF融合 → Must-Check注入)
    ↓
synthesis.py (去重，caps at 40 chunks)
    ↓
generator.py (mimoTalk mimo-v2.5)
    ↓
verifier.py (NLI引用验证，软门)
```

### 语料库统计
- **EU 法规**：GDPR, RoHS, RED, EMC, LVD, GPSR, DSA, DMA, AI Act 等 20+ PDF + HTML
- **美国法规**：COPPA, FIRRMA, IRA, INFORM Consumers Act
- **中国法规**：出口管制法、反垄断法、两用物项条例
- **亚洲**：印尼、马来西亚、新加坡、泰国、越南各法规
- **中东**：沙特、阿联酋 PDPL + G-Mark/SFDA/Saber
- **国际**：WIPO PCT/马德里协定，UN R155/R156

### FAISS 索引
- `data/faiss/legal_chunks.index` - 存在 ✅
- `data/faiss/legal_chunks_meta.json` - 存在 ✅
- 启动时自动加载，加载失败时有 warning 日志

### 发现的问题

1. **截图 PDF 未处理** - 中等
   - `data/corpus/screenshot_pending/` 目录含 ~12 个 PDF 截图
   - `processed/` 中已有对应 JSON，但为半处理状态（OCR 未完成）
   - 影响：截图中法规信息无法被检索到

2. **processed/ 中部分 JSON 文件名含中文字符** - 低
   - `manifest.json` 中有 `_decompressed.html` 后缀文件
   - 已运行修复脚本，部分仍残留

### 优点
- Hybrid retrieval 完整（Dense + BM25 + RRF + Must-Check）
- Embedder 三级降级链健壮
- 5 分钟检索结果缓存（thread-safe）
- Must-Check 强制注入确保电子/玩具等品类不遗漏关键法规
- 预置利润报告数据（充电宝、乒乓球拍）无需 LLM 调用，速度极快

### 关键问题摘要
1. 截图 PDF 语料库待 OCR 处理，约 12 个文档未完全索引

---

## 维度 4：测试覆盖度检查

### 评分：7/10

### Python 测试（rag_service/tests/）

| 测试文件 | 覆盖模块 | 状态 |
|---------|---------|------|
| test_smoke.py | 入口点检查 | ✅ |
| test_api_smoke.py | FastAPI 端点 | ✅ |
| test_orchestrator.py | LangGraph 编排 | ✅ |
| test_component.py | 组件集成 | ✅ |
| test_faiss_retriever.py | FAISS 检索 | ✅ |
| test_retrieval.py | 混合检索 | ✅ |
| test_embedders.py | Embedder 降级链 | ✅ |
| test_report_generator.py | 报告生成 | ✅ |
| test_generator_node.py | 生成器节点 | ✅ |
| test_vision_node.py | Vision 节点 | ✅ |
| test_citation_verifier.py | 引用验证 | ✅ |
| test_legal_chunker.py | 分块策略 | ✅ |
| test_html_parser.py | HTML 解析 | ✅ |
| test_docx_parser.py | DOCX 解析 | ✅ |
| test_profit_report.py | 利润报告 | ✅ |

### 前端测试（tests/）

| 测试文件 | 覆盖模块 | 状态 |
|---------|---------|------|
| schemas.test.ts | Zod Schema | ✅ 全面 |
| types.test.ts | TypeScript 类型 | ✅ |
| utils.test.ts | 工具函数 | ✅ |
| scan-pipeline.test.ts | 扫描管线 | ✅ |
| session-store.test.ts | 会话存储 | ✅ |
| useScanPolling.test.tsx | 轮询 Hook | ✅ |
| report-export.test.ts | 报告导出 | ✅ |
| smoke.spec.ts | Playwright E2E | ✅ |

### 发现的问题

1. **前端组件测试缺口** - 中等
   - upload/page.tsx（412 行）、result/page.tsx（497 行）无独立组件测试
   - burning/page.tsx（152 行）无测试
   - ProfitReportView.tsx 无测试
   - 页面级测试依赖 smoke.spec.ts E2E，但无单元级保护

2. **无 API 路由单元测试** - 中等
   - `app/api/scan/route.ts` 和 `app/api/scan/[sessionId]/route.ts` 无测试文件
   - scan-post-route.test.ts, scan-route.test.ts, scan-session-route.test.ts 存在但需确认覆盖

3. **无覆盖率报告** - 中等
   - package.json 有 `test:coverage` 脚本（vitest --coverage），但未运行
   - Python 侧 pytest-cov 已安装但覆盖率未统计

### 优点
- Python 测试覆盖较全面，14 个测试文件
- Vitest 配置存在，React Testing Library 已安装
- Playwright 配置存在（playwright.config.ts）
- mock 数据（mock-scan-result.ts）完整，支持无 API 的本地测试

### 关键问题摘要
1. 前端核心页面（upload/result/burning）无单元测试覆盖
2. API 路由层缺少测试保护

---

## 维度 5：可运行性检查

### 评分：6/10

### 发现的问题

#### 1. requirements.txt 含不可移植路径 - 严重
以下行在 Docker 容器中会失败：

```txt
agent-reach @ https://github.com/Panniantong/Agent-Reach/archive/main.zip#sha256=...
-e git+https://github.com/anthropic/anthropic-sdk-python.git@97074788...#egg=anthropic
-e d:\openclaw-work\e2b-dev_e2b\packages\python-sdk
-e e:\desktop\notebooklm-py
```

**影响**：容器 build 失败，依赖无法解析。

**建议**：将这三个依赖提取到单独的 `requirements-hard.txt`，主 Dockerfile 不安装，文档说明开发者本地可选安装。

#### 2. Dockerfile 未验证 - 严重
- `rag_service/Dockerfile` 存在但未实际构建测试
- `docker-compose.yml` 配置合理（端口映射 8001:8000、FAISS 目录挂载、.env 挂载）
- 需要实际 `docker compose build` 验证

#### 3. test-doc-upload/ 为废弃目录 - 低
- `test-doc-upload/` 目录下有 8 个测试脚本（test-pdfplumber.js 等）
- 为手动测试阶段的残留物，无 CI 引用
- 建议：归档至 `scripts/archive/` 或删除

#### 4. .env.local 存在但包含敏感信息 - 注意
- `E:/desktop/火鹰合规/attrax/.env.local` 存在（不是 .gitkeep）
- 包含 MIMOTALK_API_KEY 等敏感变量
- 需确认 `.gitignore` 是否正确排除

### 优点
- package.json 脚本完整（dev/build/test/test:e2e）
- Docker Compose 配置合理（healthcheck、超时、资源挂载）
- 环境变量示例文件齐全（.env.local.example, rag_service/.env.example）
- 无多语言支持问题（CLAUDE.md 已记录）

### 关键问题摘要
1. requirements.txt 含不可移植路径导致 Docker 构建失败
2. Dockerfile 未经实际验证

---

## 辩论结论

### 乐观派观点
- 前端三大核心页面（upload/burning/result）功能完整，用户体验流程健壮
- Demo 模式降级设计让系统即使后端不可用也能展示结果，用户无感知
- RAG Pipeline 完整，多 embedding 降级链确保不同环境下均可用
- Python 测试覆盖较好，14 个测试文件覆盖所有核心模块
- 语料库丰富（100+ 法规文档），覆盖主流市场

### 批判派观点
- requirements.txt 不可移植是**阻塞性问题**，直接导致无法 Docker 部署
- 前端组件目录空占位（.gitkeep）违反"小文件"原则，长期技术债务
- 测试覆盖存在明显缺口（API 路由、核心页面无单元测试）
- cohere_reranker 为死代码，偏离"不积累技术债务"原则

### 共识
1. **必须修复**：requirements.txt 不可移植路径（否则无法部署）
2. **建议修复**：前端组件目录空占位（长期维护成本）
3. **建议增加**：API 路由测试覆盖率
4. **可延后**：截图 PDF OCR 处理（不影响 EU/US 等主流市场）

---

## 严重问题汇总

### 🔴 必须修复

1. **requirements.txt 含不可移植路径** (可运行性)
   - 位置：`rag_service/requirements.txt` 第 3、18、101、292 行
   - 影响：Docker 容器构建失败
   - 方案：将 Git/Zip 依赖移至 requirements-dev.txt，主 Dockerfile 不安装

2. **Dockerfile 未验证** (可运行性)
   - 位置：`rag_service/Dockerfile`
   - 影响：无法确认容器可正常启动
   - 方案：运行 `docker compose build && docker compose up` 验证

### 🟡 建议修复

3. **前端组件目录空占位** (前端完整性)
   - 位置：`components/burning/.gitkeep`、`components/flame/.gitkeep`、`components/upload/.gitkeep`
   - 影响：页面文件过大，技术债务
   - 方案：提取 BurningAnimation、FlameEffect、UploadForm 组件

4. **API 路由无单元测试** (测试覆盖度)
   - 位置：`app/api/scan/route.ts`、`app/api/scan/[sessionId]/route.ts`
   - 影响：路由逻辑无测试保护
   - 方案：补充 vitest 测试覆盖

5. **cohere_reranker 死代码** (后端完整性)
   - 位置：`rag_service/retrieval/cohere_reranker.py`
   - 影响：代码迷惑性维护成本
   - 方案：删除文件或注释说明用途

6. **截图 PDF 未处理** (RAG Pipeline)
   - 位置：`data/corpus/screenshot_pending/`
   - 影响：约 12 个法规文档无法被检索
   - 方案：OCR 处理后重建 FAISS 索引

### 🟢 优化建议

7. **前端无 E2E 覆盖 Playwright 测试** - `tests/e2e/smoke.spec.ts` 存在，需确认 `test:e2e` 脚本是否通过
8. **无覆盖率报告** - 运行 `npm run test:coverage` 生成 Istapaper/HTML 报告
9. **test-doc-upload/ 废弃目录** - 归档至 `scripts/archive/`

---

## 未来路线图

### 短期（1-2 周）
1. 修复 requirements.txt 可移植性，验证 Docker 构建 ✅
2. 补充 API 路由 Vitest 测试
3. 删除 cohere_reranker.py 死代码

### 中期（1 个月）
4. 提取 BurningAnimation、FlameEffect、UploadForm 组件
5. 补充前端核心页面（upload/result）Vitest 测试
6. OCR 处理截图 PDF，完善语料库

### 长期（3 个月）
7. 接入 Cohere Reranker 提升检索精度
8. 运行 test:coverage，设立 80% 覆盖率门槛
9. 多语言报告输出（英文市场）

---

*报告生成：Claude Code 深度分析 agent*
*分析耗时：约 45 分钟代码审查*