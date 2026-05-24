# 火鹰合规项目全面审计报告

**项目名称**：火鹰合规（Attrax）  
**审计日期**：2026-05-23  
**审计范围**：全项目（Next.js 前端、FastAPI/LangGraph RAG 服务、测试、会话存储、导出与报告链路）  
**审计方式**：架构 / 安全 / 性能 / 测试 / 代码质量五维并行审计

---

## 一、执行摘要

当前项目已经具备可运行的 MVP/准生产形态，前后端主链路、RAG 编排、降级策略、基础校验和部分测试已经成型，说明项目不是简单 Demo。

但从生产可用性角度看，系统底层仍保留明显的 MVP 级实现特征，主要风险集中在：

1. **任务执行模型不可靠**：扫描任务以 fire-and-forget 方式挂在 Next.js 进程内，缺乏 durable queue/worker。
2. **接口防滥用不足**：昂贵扫描链路缺少完整鉴权、配额与真实入口限流。
3. **关键链路测试不足**：最重要的真实上传→扫描→轮询→结果链路没有被可靠 E2E 覆盖。
4. **核心模块可维护性下降**：多个主链路文件与函数过大，契约归一化与 fallback 逻辑开始堆积。

**综合判断**：项目具备继续迭代的基础，但距离稳定上线仍有一段距离。建议优先处理 P0 与 P1 问题，再推进扩展能力。

---

## 二、综合评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 架构 | 6.5 / 10 | 模块划分基本清晰，但任务执行与状态持久化不适合生产 |
| 安全 | 6.5 / 10 | 基础输入校验存在，但接口滥用、访问控制、文件校验仍明显不足 |
| 性能 | 6.5 / 10 | 有缓存与降级，但线程池、同步 IO、base64 中转、轮询模型会限制扩展 |
| 测试 | 6.2 / 10 | 单测不少，但关键真实业务路径缺乏可靠集成/E2E 覆盖 |
| 代码质量 | 6.5 / 10 | 类型与 Schema 基础不错，但核心文件/函数膨胀明显 |

**综合评分：6.4 / 10**

---

## 三、项目优点

### 1. 主体架构并不混乱
- LangGraph 流程分层较清晰：`rag_service/orchestrator/graph.py:27`
- 前端到 RAG 的扫描链路较明确：`lib/pipeline/scan.ts:159`

### 2. 基础输入校验意识较好
- 扫描接口使用 Zod 校验：`app/api/scan/route.ts:109`
- Schema 边界定义较明确：`lib/schemas.ts:134`

### 3. 降级与 fallback 设计较完整
- 检索层支持 dense/BM25 降级：`rag_service/retrieval/hybrid_retriever.py:172`
- 扫描失败时产品不会直接完全挂死：`lib/pipeline/scan.ts:561`

### 4. 已有测试基础，不是零保护状态
- API 测试：`tests/unit/api-scan-post.test.ts:1`
- session store 测试：`tests/unit/session-store.test.ts:1`
- 部分 RAG 组件测试：`rag_service/tests/test_embedders.py:1`

---

## 四、问题清单（按优先级排序）

# P0 必须优先修复

## 1. 扫描任务采用 fire-and-forget，任务可靠性不足
- **位置**：`app/api/scan/route.ts:235`
- **问题**：`void runScan(...)` 直接异步启动后台任务，生命周期绑定 Next.js 进程。
- **影响**：进程重启、部署、异常退出时，任务可能丢失，session 可能永久停留在 `processing`。
- **建议**：改为 **API 入队 + worker 执行 + 持久化状态**。

## 2. `/api/scan` 无鉴权、无前端层限流，容易被滥用
- **位置**：`app/api/scan/route.ts:100`
- **问题**：任意请求都可发起昂贵扫描任务。
- **影响**：可被恶意刷接口，消耗 RAG/LLM 资源，形成成本和稳定性风险。
- **建议**：增加鉴权、IP 限流、用户配额、全局并发上限。

## 3. 实际扫描入口 `/scan-multipart` 未被限流覆盖
- **位置**：`lib/pipeline/scan.ts:160`, `rag_service/main.py:167`
- **问题**：前端实际调用 `/scan-multipart`，但限流只覆盖 `"/scan", "/profit-report"`。
- **影响**：最重接口暴露在限流之外。
- **建议**：将 `/scan-multipart` 纳入限流和并发保护。

## 4. 会话状态存储不适合生产
- **位置**：`lib/pipeline/session-store.ts:5`, `lib/pipeline/session-store.ts:50`, `lib/pipeline/session-store.ts:71`, `lib/pipeline/session-store.ts:126`
- **问题**：使用 `globalThis.__scanStore` + 同步文件 IO + `setTimeout` TTL。
- **影响**：多实例不共享、重启恢复不可靠、轮询高峰会阻塞 Node 事件循环。
- **建议**：改为 Redis / 数据库持久化状态。

## 5. RAG 服务线程池过小，超时不等于取消
- **位置**：`rag_service/main.py:67`, `rag_service/main.py:360-377`
- **问题**：全局线程池只有 4 个 worker，超时后底层线程仍继续执行。
- **影响**：慢请求可占满线程池，客户端超时后服务端仍继续消耗资源。
- **建议**：引入真实取消、任务隔离、专用 worker 或队列系统。

---

# P1 高优先级问题

## 6. 上传文件校验不充分
- **位置**：`app/api/scan/route.ts:107-189`, `rag_service/main.py:269-289`
- **问题**：当前主要只校验数量和大小，缺少 MIME、扩展名、magic bytes、页数、像素数和解码验证。
- **影响**：伪造文件、畸形 PDF/DOCX、压缩炸弹等输入可触发解析异常、高 CPU 或高内存消耗。
- **建议**：前后端都做严格类型与内容校验，拒绝未知类型。

## 7. 原始异常可能透传给用户
- **位置**：`rag_service/main.py:382`, `lib/pipeline/scan.ts:170-171`, `app/api/scan/route.ts:244`
- **问题**：后端异常细节可能进入 session 并被前端读取。
- **影响**：可能泄露内部路径、依赖错误、第三方错误信息。
- **建议**：对外仅暴露错误码，详细异常只写服务端日志。

## 8. session 结果明文落盘，且拿到 sessionId 即可读取
- **位置**：`lib/pipeline/session-store.ts:11`, `lib/pipeline/session-store.ts:72`, `app/api/scan/[sessionId]/route.ts:24-37`
- **问题**：session 文件明文保存，无用户绑定或访问签名。
- **影响**：报告、trace、解析文本等数据有泄露风险。
- **建议**：session 绑定用户或短期 token，减少落盘敏感内容。

## 9. `scan/trace/roadmap` 接口都是 bearer-by-URL 模型
- **位置**：`app/api/scan/[sessionId]/route.ts:12`, `app/api/trace/[sessionId]/route.ts:12`, `app/api/roadmap/[sessionId]/route.ts:12`
- **问题**：只要知道 sessionId 就能读取结果。
- **影响**：URL 泄露即等于数据泄露。
- **建议**：加授权校验或短期签名访问。

## 10. PDF 解析在 async 路径中同步执行
- **位置**：`rag_service/main.py:329-350`
- **问题**：`pdfplumber` 解析在进入 executor 前执行。
- **影响**：阻塞 FastAPI event loop，拖慢其他请求。
- **建议**：PDF 解析也放入 worker/executor 或独立进程。

## 11. 上传链路存在明显内存放大
- **位置**：`app/api/scan/route.ts:151-159`, `lib/pipeline/scan.ts:148-156`, `rag_service/main.py:269-326`
- **问题**：文件被多次读入内存，并进行 base64 编解码。
- **影响**：大图/PDF 并发场景下内存峰值高。
- **建议**：尽量采用流式或原始二进制传递，避免 base64 中转。

## 12. 最关键真实扫描链路没有 E2E 覆盖
- **位置**：`tests/e2e/smoke.spec.ts:14-33`
- **问题**：现有 E2E 仅覆盖页面展示与 demo 页面，未覆盖真实上传→扫描→轮询→结果。
- **影响**：主业务链路损坏时，测试仍可能全绿。
- **建议**：补一条真实业务主流程 E2E。

## 13. RAG API smoke test 过于宽松
- **位置**：`rag_service/tests/test_api_smoke.py:24-27`, `rag_service/tests/test_api_smoke.py:63-64`, `rag_service/tests/test_api_smoke.py:77-81`
- **问题**：服务未启动可 skip，500 也可接受，且使用 `8000` 端口与项目约定不一致。
- **影响**：测试无法充当可靠发布门禁。
- **建议**：改为严格断言并统一到真实服务地址。

---

# P2 中优先级问题

## 14. API 响应契约与项目约定不一致
- **位置**：`app/api/scan/route.ts:145`, `app/api/scan/route.ts:248`, `app/api/scan/[sessionId]/route.ts:36`
- **问题**：项目约定要求 `{ success, data, error }`，实际却返回裸对象。
- **影响**：前后端契约漂移，调用方处理复杂度上升。
- **建议**：统一 envelope，并同步调整测试。

## 15. 测试已经默认接受契约漂移
- **位置**：`tests/unit/api-scan-post.test.ts:116-127`
- **问题**：测试描述写 envelope，但断言验证的是裸字段。
- **影响**：规范失效，未来更难收敛接口。
- **建议**：统一实现、文档、测试三者。

## 16. 前后端领域模型已漂移
- **位置**：`lib/types.ts:1-7`, `lib/schemas.ts:2`, `rag_service/retrieval/must_check.py:67-80`
- **问题**：Python 侧支持的类目/市场与 TS 侧不一致，文档与前端 schema 也不一致。
- **影响**：系统能力、文档和产品表现不一致。
- **建议**：建立统一单一契约源。

## 17. report package 归一化逻辑在前后端重复维护
- **位置**：`lib/pipeline/scan.ts:321`, `rag_service/schemas/report_package.py:293`
- **问题**：两边都手写 snake_case/camelCase 映射兼容。
- **影响**：极易继续漂移。
- **建议**：以 schema/OpenAPI/JSON Schema 为统一契约来源。

## 18. 检索/生成依赖全局可变单例
- **位置**：`rag_service/main.py:103-110`, `rag_service/orchestrator/nodes/retriever.py:14`, `generator.py:13`, `verifier.py:10`
- **问题**：graph 节点看似纯函数，实际依赖全局状态。
- **影响**：测试隔离、多租户和动态配置变困难。
- **建议**：改为显式上下文注入。

## 19. 多市场 fan-out 与内部线程池叠加
- **位置**：`rag_service/orchestrator/graph.py:45-52`, `rag_service/orchestrator/nodes/retriever.py:86-92`, `rag_service/retrieval/hybrid_retriever.py:233-239`
- **问题**：每个市场内部再开线程池。
- **影响**：市场数量增加后，线程调度成本与资源抖动上升。
- **建议**：收敛并发模型，避免嵌套线程池。

## 20. ModelScope fallback 固定限速，尾延迟偏高
- **位置**：`rag_service/retrieval/modelScope_embedder.py:81-85`, `rag_service/retrieval/modelScope_embedder.py:147-155`
- **问题**：至少 2 秒节流，且 batch 串行。
- **影响**：本地 embedding 不可用时，扫描延迟显著上升。
- **建议**：增加缓存、批量优化，或更早切到 BM25-only。

## 21. 前端轮询模式会制造稳定 QPS
- **位置**：`lib/constants.ts:11-13`, `lib/hooks/useScanPolling.ts:57-114`
- **问题**：0.8s~4s 持续轮询，且 `no-store`。
- **影响**：用户数上升后，对 session 读取造成稳定压力。
- **建议**：考虑 SSE/WebSocket 或更激进退避。

## 22. Markdown 渲染目前尚可，但缺少显式安全兜底
- **位置**：`app/result/[sessionId]/page.tsx:140`, `components/result/ProfitReportView.tsx:267`, `next.config.ts:3-23`
- **问题**：当前没看到 `rehypeRaw`，但缺少 CSP 和 URL 协议白名单。
- **影响**：后续一旦渲染链改动，XSS 风险会被放大。
- **建议**：增加 CSP、安全 headers 和链接协议白名单。

## 23. session store 测试过度依赖 mock fs
- **位置**：`tests/unit/session-store.test.ts:11-25`
- **问题**：主要是 mock 文件系统，没有真实写盘/恢复/并发场景验证。
- **影响**：线上文件系统问题难以及时暴露。
- **建议**：补真实文件系统集成测试。

## 24. 导出测试偏向 mock 调用验证，缺少真实产物校验
- **位置**：`tests/unit/report-export.test.ts:26-89`, `tests/unit/report-export.test.ts:390-411`
- **问题**：PDF/DOCX 导出更多是 mock 验证，没有验证真实文件质量。
- **影响**：乱码、分页错位、文件结构损坏难以提前发现。
- **建议**：增加产物级测试。

## 25. 没有覆盖率门槛，也缺少统一测试门禁
- **位置**：`vitest.config.ts:12-21`, `package.json:18`
- **问题**：没有 coverage thresholds，`test:all` 不包含 pytest。
- **影响**：测试数量多，但无法形成真实质量门禁。
- **建议**：建立统一 CI 测试与覆盖率门槛。

---

# P3 代码质量与维护性问题

## 26. 多个核心文件过大
- **位置**：`app/api/regulations/updates/route.ts:35`, `rag_service/generate/report_generator.py:479`, `lib/report-export.ts:480`
- **问题**：超过项目文件规模约定，职责过宽。
- **影响**：维护与 review 成本持续上升。
- **建议**：按职责拆分模块。

## 27. 多个关键函数过长
- **位置**：`lib/pipeline/scan.ts:50`, `lib/pipeline/scan.ts:321`, `lib/pipeline/scan.ts:501`, `app/api/scan/route.ts:87`
- **问题**：函数远超 50 行，编排、解析、fallback、组装都堆在一起。
- **影响**：修改风险高，测试难度大。
- **建议**：优先做低风险拆分。

## 28. `lib/pipeline/scan.ts` 是当前最需要拆分的热点文件
- **位置**：`lib/pipeline/scan.ts:501`
- **问题**：同时承担 RAG 调用、归一化、利润报告、fallback、session 更新。
- **影响**：扫描相关任何改动几乎都要碰它。
- **建议**：优先拆为 `rag-client`、`report-package-normalizer`、`profit-report-builder` 等模块。

## 29. 静态业务数据混在运行时代码中
- **位置**：`rag_service/generate/report_generator.py:281`, `rag_service/generate/report_generator.py:404`, `app/api/regulations/updates/route.ts:35`
- **问题**：预置数据与业务逻辑耦合。
- **影响**：更新数据需要改代码，demo/fallback/真实结果边界模糊。
- **建议**：迁移到独立配置或资源文件。

## 30. fallback / mock / 真实结果边界不清
- **位置**：`lib/pipeline/scan.ts:561`, `lib/pipeline/scan.ts:675`
- **问题**：真实失败时直接回 mock，缺少统一来源标识。
- **影响**：用户可能误把 fallback 结果当成真实分析结果。
- **建议**：统一加 `source: real | fallback | demo` 元数据。

## 31. 存在静默吞错
- **位置**：`rag_service/orchestrator/nodes/retriever.py:50`, `rag_service/orchestrator/nodes/retriever.py:72`, `lib/pipeline/session-store.ts:59`, `app/api/scan/route.ts:167`
- **问题**：`except: pass` 或直接忽略错误。
- **影响**：故障表现为“没数据”而不是明确失败，难排查。
- **建议**：关键路径至少打结构化日志。

## 32. React 上传组件职责偏重
- **位置**：`components/upload/UploadForm.tsx:127`
- **问题**：文件状态、校验、预览、市场、类目、提交都在一个组件。
- **影响**：后续继续膨胀，维护成本快速增加。
- **建议**：拆为更小的子组件。

## 33. `URL.createObjectURL` 用法不理想
- **位置**：`components/upload/UploadForm.tsx:81`
- **问题**：在 render 中创建 object URL。
- **影响**：生命周期和释放管理不清晰。
- **建议**：改为 `useEffect` 管理创建与释放。

## 34. 注释与实际行为不一致
- **位置**：`lib/pipeline/scan.ts:2`, `lib/pipeline/scan.ts:6`, `app/api/regulations/updates/route.ts:33`
- **问题**：注释提到 `runScan.ts` / `localhost:8000`，与现有实现不一致。
- **影响**：误导后续维护与排查。
- **建议**：清理失效注释。

## 35. 大组件叠加定时器动画，复杂度偏高
- **位置**：`components/trace/AgentDecisionTree.tsx:779-786`, `components/trace/ComplianceTimeline.tsx:245-252`
- **问题**：大组件 + interval 动画驱动。
- **影响**：性能调优和状态维护成本更高。
- **建议**：适度拆分与收敛状态。

---

## 五、最危险的未覆盖场景

### 36. 真实扫描全链路没有可靠回归保护

当前最危险、也最值得优先补测的场景是：

- 用户上传多张图片 + PDF/DOCX
- 前端调用 `/api/scan`
- Next.js 调 RAG `/scan-multipart`
- embedding fallback / profit-report fallback 同时发生
- session 最终正确进入 `ready` 或 `failed`
- 结果页正确展示合规报告、引用与利润 fallback

**原因**：这条链路横跨前端上传、Next API、RAG 服务、检索降级、状态存储、结果渲染，是最真实也最容易出事故的链路，但当前没有完整测试保护。

---

## 六、建议修复顺序

### 第一阶段：立刻处理（P0）
1. 给 `/api/scan` 与 `/scan-multipart` 加限流、并发保护、鉴权/配额
2. 把扫描任务改为队列 + worker + 持久状态存储
3. 停止对用户暴露原始异常信息

### 第二阶段：补足生产安全边界（P1）
4. 完整补齐上传文件校验
5. 给 session / trace / roadmap 加访问控制
6. 调整 PDF 解析与线程池并发模型

### 第三阶段：补测试与稳定性（P1/P2）
7. 补一条真实业务主链路 E2E
8. 收紧 RAG API smoke test
9. 建立统一测试门禁与 coverage 阈值

### 第四阶段：治理维护成本（P2/P3）
10. 统一 API 契约与前后端 schema
11. 拆 `lib/pipeline/scan.ts`
12. 拆 `report_generator.py` 与 `report-export.ts`
13. 统一 fallback/demo/real 输出模型

---

## 七、结论

这个项目当前的核心问题不是“写得差”，而是：

> **MVP 已经长成了准生产系统，但底层运行模型仍停留在 MVP 级别。**

如果只看演示和局部功能，它已经相当完整；但如果按稳定上线的标准审视，最大短板仍是：

- **任务执行不可靠**
- **资源入口不安全**
- **关键链路测试不够真**
- **核心模块正在变得难维护**

建议先把 P0/P1 收掉，再谈扩市场、扩类目、扩用户量。

---

*本报告基于 2026-05-23 对当前仓库代码的只读审计生成。*