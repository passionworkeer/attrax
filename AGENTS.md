# Attrax 项目约定

Attrax 根据用户提供的产品资料、市场、规则知识库和法规原文生成可溯源的合规报告。按本次改动读取相关实现与文档；依赖版本、环境变量默认值和运行配置以当前代码为准。

## 实现约束

- 保持调用方输入不可变。需要调整 observations、会话或报告字段时创建新对象，保留原始证据。
- 事实、检查结论和法规引用必须具有实际来源。证据不足时保留未知、不可见或待确认状态；供应商、降级原因、引用验证方式与 `match_status` 必须反映实际执行结果。
- `lib/types.ts` 提供市场和品类类型；报告包契约位于 `lib/rag-client/report-package-schema.ts` 与 `rag_service/schemas/report_package.py`。修改契约时同步 OpenAPI 快照、TypeScript 类型、适配、展示及导出。
- 扫描由 `rag_service/application/scans.py` 管理生命周期，`rag_service/pipeline/runner.py` 执行 vision、generate、verify。检索依据 `must_check.py`、`kb_loader.py`、`anchor_selection.py` 与 `article_loader.py`；需要修改架构时读取对应设计材料。
- UI 与导出使用统一结果语义；检查 finding、observation、image、citation 的真实关联，保留无风险但已有观察结果的正常报告。扫描完成状态同时满足终态与结果可读取条件。
- 用户输入在系统边界验证。BFF 负责请求上限、类型、限流及品类早期校验，RAG 的 `_read_uploads` 负责逐文件数量、类型、魔数和总大小校验。
- 扫描创建、补充证据和资产响应保持流式传输。BFF 通过单个 reader 读取并回放有限前缀；避免使用读取部分内容后取消分支的 `body.tee()`。上传文本字段放在文件前，字段名称遵循 RAG 契约，例如 `declared_facts`。
- `lib/rag-client/v1-adapter.ts` 统一封装 BFF 到 RAG 的 HTTP 请求。保留内部认证、请求标识和可信代理信息；会话访问令牌使用 HttpOnly cookie 或 Bearer header，禁止放入 URL 或日志。
- 会话更新、队列锁、幂等检查与写入遵循 `FileBackend` 的原子操作。补充证据和重扫重试复用同一次用户操作的幂等键；避免将检查与写入拆成存在并发间隙的步骤。
- 可重试 HTTP 状态遵循 `lib/transient-retry.ts` 的有限重试契约；401、404 等不可重试错误及时结束。真实服务失败必须保留可见错误及原因，演示数据不能充当真实扫描或实测结果。
- 管理员统计读取实际审计日志、法规索引与运行记录。匿名访客、扫描次数和用户人数分别表达；公开流量采集不得暴露 IP、令牌、上传内容或完整查询参数。
- `middleware.ts` 当前使用 Node.js 内置模块，保留 `runtime: "nodejs"`。变更 Next.js API 前先读取本机 `node_modules/next/dist/docs/` 的相关指南。
- 保留 `public/fonts/NotoSansSC-Regular.ttf`，PDF 导出与相关验证使用该字体。UI 下载入口使用 `lib/report-download.ts` 的按需加载方式。

## 按任务读取

| 当前任务 | 相关入口 |
|---|---|
| 扫描 API、轮询、证据补充、重扫 | [接口契约](docs/FRONTEND-BACKEND-INTEGRATION.md)、`app/api/scan/`、`lib/rag-client/`、`rag_service/api/v1.py` |
| 检查结论、引用、结果页和导出 | `lib/result/inspection-view-model.ts`、`rag_service/verify/`、`rag_service/pipeline/nodes/findings_builder.py`、`lib/report-export-modules/` |
| 后端业务与存储并发 | `rag_service/application/scans.py`、`rag_service/infrastructure/file_backend.py` |
| 知识锚点与法规采集 | `rag_service/retrieval/`、[watchdog 约定](docs/WATCHDOG.md)、[脚本说明](scripts/watchdog/README.md) |
| 管理员认证与统计 | [管理员 BI](docs/admin-bi.md)、`lib/admin/`、`app/api/admin/` |
| 安全与内部认证 | [认证约束](docs/agent-operations.md#数据与认证)、`lib/pipeline/session-auth.ts`、`app/api/backend-session-access.ts` |
| 构建、部署、进程或 nginx 配置 | [运行与部署约束](docs/agent-operations.md) |
| 架构调整 | [知识库生成设计](docs/plans/2026-09-11-de-rag-evidence-spec.md)、[检查与证据设计](docs/plans/2026-09-14-judge-review-and-optimization-plan.md) |
| 查询既往执行与验证 | [CHANGELOG](CHANGELOG.md)，按当前问题定位实际存在的执行记录；记录中的通过状态只证明对应运行 |

## 验证

根据受影响范围选择检查，完成后报告本次结果。命令定义维护在 `package.json`。

| 改动范围 | 检查入口 |
|---|---|
| TypeScript、React、BFF | `npm run typecheck`、`npm run lint`、`npm run test -- <相关测试文件>` |
| RAG 服务 | `npm run test:rag -- <相关测试文件> -q`；完整检查使用 `npm run test:rag` |
| watchdog 与法规脚本 | `rag_service/.venv/bin/python -m pytest scripts/watchdog/tests/ -q` |
| OpenAPI 与报告契约 | `npm run check:rag-openapi`，并检查 `lib/rag-client/openapi.snapshot.json`、`types.gen.ts` 和契约使用方的一致性 |
| 页面行为与完整扫描 | 根据用户授权运行受影响的 Playwright 流程或新的真实扫描，核对提交、轮询、报告、引用与导出 |
| 构建与交付包 | 在本地运行受影响的构建、交付包检查；部署与生产验证遵循运行文档和当前授权 |

流式上传改动需要使用真实且大于前缀窗口的媒体，经真实 HTTP 请求验证传输与结束状态。静态类型、单元测试或 `/api/health` 的成功不能代替该验证。
