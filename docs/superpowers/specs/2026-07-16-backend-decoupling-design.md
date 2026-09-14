# Attrax 独立后端解耦设计

> ⚠️ **SUPERSEDED — 2026-07-16 历史架构设计 spec**。该设计中规划的 FastAPI 独立后端解耦已落地（`rag_service/` 现行），权威当前契约见 [`docs/FRONTEND-BACKEND-INTEGRATION.md`](../../FRONTEND-BACKEND-INTEGRATION.md)。

## 目标

把当前散落在 Next.js API Route 和 `lib/pipeline` 中的服务端职责迁入 Python FastAPI，使后续任意前端只通过稳定的 HTTP API 和 OpenAPI 契约接入，不再依赖 Next.js 服务端运行时或 TypeScript 内部类型。

## 当前基线

- 现有 Python RAG 服务负责扫描、利润报告、健康检查和 RAG 领域逻辑。
- Next.js 同时承担公开 API、上传校验、会话、访问令牌、文件队列、结果整形、路线图与 Trace 查询。
- `npm run typecheck` 当前有 1 个既有类型错误。
- `npm run test:rag` 当前为 515 项测试中 4 项失败。
- `main` 比 `origin/main` 多 1 个纯运维文档提交；本次工作基于 `codex/backend-decoupling` 分支。

## 架构

采用单一可部署 FastAPI 服务、内部模块化的方案。公开 API、应用服务、领域管线和基础设施适配器分层，避免路由直接读写文件或调用具体队列实现。

```text
任意前端
  -> FastAPI /api/v1
      -> application services
          -> ports (session, queue, upload, audit)
              -> filesystem adapters (initial implementation)
          -> existing RAG domain pipeline
```

初期继续使用本地文件存储，保持与现有部署条件一致。会话、队列和上传通过端口接口访问，以便后续替换为 Redis、数据库或对象存储而不改变公开 API。

## 模块边界

- `rag_service/api/`：版本化路由、请求解析、认证依赖和统一响应。
- `rag_service/application/`：创建扫描、查询扫描、删除扫描和运行任务的用例。
- `rag_service/domain/`：扫描状态、错误代码、值对象和与存储无关的规则。
- `rag_service/infrastructure/`：文件会话仓库、持久任务队列、上传归档和审计日志。
- `rag_service/orchestrator`、`retrieval`、`generate`、`verify`：保留现有 RAG 领域能力，由应用层调用。

每个模块只能依赖同层或更内层的公开接口。API 路由不得直接操作文件系统，领域模型不得导入 FastAPI。

## 公共 API

- `POST /api/v1/scans`：multipart 创建异步扫描，返回 202、会话 ID、访问令牌和轮询地址。
- `GET /api/v1/scans/{session_id}`：返回处理进度或最终规范化结果。
- `GET /api/v1/scans/{session_id}/roadmap`：返回结构化路线图。
- `GET /api/v1/scans/{session_id}/trace`：返回 Agent 轨迹。
- `DELETE /api/v1/scans/{session_id}`：删除会话、任务载荷和归档上传。
- `GET /api/v1/health`、`GET /api/v1/ready`：公开探针。
- `GET /openapi.json`：前端契约的唯一事实来源。

会话后续请求统一使用 `Authorization: Bearer <accessToken>`。旧 `/scan`、`/scan-multipart`、`/profit-report`、`/health` 和 `/ready` 暂时保留，作为迁移兼容面。

## 数据与状态

扫描状态固定为 `processing`、`ready`、`degraded` 或 `failed`。RAG 不可用但产生演示数据时只能标记为 `degraded`，不能伪装为真实成功。

会话创建、令牌哈希和任务入队必须具有补偿逻辑：任一后续步骤失败时清理已经写入的会话和文件，避免永久停留在 `processing`。队列任务使用原子文件替换，服务重启后能够恢复未完成任务；二进制载荷单独保存，不写入 JSON。

公开 JSON 使用 camelCase。后端负责把 `report_package`、利润结构化字段、路线图和决策视图规范化，前端不得依赖 Markdown 正则解析来补业务字段。

## 安全与错误

- 上传同时校验数量、声明 MIME、文件签名和单文件/总大小。
- 公共会话令牌只返回一次，磁盘仅保存哈希，比较使用恒定时间算法。
- 内部旧写接口继续使用 `X-Internal-Secret`；公共 v1 会话接口使用 Bearer token。
- CORS 来源由环境变量显式配置，不允许生产环境通配。
- 错误统一为 `{ data, error, meta }`，`error` 包含稳定的机器码，`meta` 包含 requestId。
- 日志不得记录访问令牌、API Key 或完整上传正文。

## 测试与验收

- 先修复并记录既有基线失败，所有生产代码变化遵循红-绿-重构。
- 领域和应用层以真实临时目录测试，不以 mock 文件系统代替关键持久化行为。
- API 契约测试覆盖 202 创建、Bearer 鉴权、轮询、删除、上传边界、错误 envelope 和 OpenAPI。
- 重启恢复测试覆盖 queued/running/failed 任务状态。
- 保留现有 RAG 测试，并增加新前端无需 Next.js 即可完成全流程的集成测试。
- 完成标准：Python 测试、TypeScript 测试、类型检查、lint、OpenAPI 契约检查和 Docker 配置校验全部通过。

## 前端交接物

- 版本化 OpenAPI 规范。
- 一份仅包含公开 v1 API 的接入说明。
- TypeScript 调用示例和生成类型命令。
- 环境变量样例、错误码表和最小轮询流程。
- Docker Compose 中前后端可独立启动，新前端只需配置一个后端基址。

## 非目标

- 本阶段不引入 Redis、数据库、Celery 或云对象存储。
- 不重写现有 RAG 检索和生成算法。
- 不重构现有前端页面和视觉组件。
- 不删除旧 API；删除动作留到新前端完成联调后的独立迁移阶段。
