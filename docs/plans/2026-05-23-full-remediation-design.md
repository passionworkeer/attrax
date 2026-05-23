# 全量问题修复设计

**日期**: 2026-05-23
**范围**: `PROJECT_ANALYSIS.md` 中 P0/P1/P2 问题全量修复

## 目标

一次性修复安全漏洞、逻辑错误、性能浪费、结构性代码质量问题，并补齐关键测试。修复顺序采用“缺陷修复 → 结构重构 → 测试验证”，避免先重构导致真实缺陷被掩盖。

## 阶段 1：缺陷修复

### 后端安全
- `rag_service/main.py`
  - 全局异常处理不再返回 `str(exc)`。
  - 添加请求体大小限制，拒绝过大请求。
  - 添加 CORS 白名单，默认只允许本地前端。
  - 添加轻量 IP 限流，避免引入新依赖。
  - `/health` 只返回基础 liveness 信息，内部索引状态保留在 `/ready`。

### 前端 API 与管线
- `app/api/scan/route.ts`
  - 为图片、PDF、DOCX、文本文件添加大小限制。
  - 明确 `void runScan(...)` 的后台任务语义，并确保失败时写入 session。
- `lib/pipeline/scan.ts`
  - 校验 `RAG_SERVICE_URL` 只能指向 localhost/127.0.0.1/::1。
  - 如果后端已返回 `profitReport.markdown`，直接复用；只有真正缺失时才 fallback。
  - 收口超时常量。
- `lib/hooks/useScanPolling.ts`
  - 添加最大轮询时长。
  - 添加指数退避，减少慢任务下的无效请求。

### 会话存储
- `lib/pipeline/session-store.ts`
  - stale 文件清理改为节流触发，而不是只在模块加载时执行一次。
  - 保留同步文件存储，避免扩大改动面。

## 阶段 2：结构重构

### 前端管线拆分
- 从 `lib/pipeline/scan.ts` 拆出：
  - `lib/constants.ts`：共享限制、超时、轮询和导出常量。
  - `lib/pipeline/profit-report.ts`：利润报告 markdown 解析与构建。
  - `lib/pipeline/report-package.ts`：RAG report package 归一化。

### 导出模块拆分
- 将 `lib/report-export.ts` 拆成内部模块：
  - `lib/report-export/pdf.ts`
  - `lib/report-export/docx.ts`
  - `lib/report-export/shared.ts`
- 保留原 `lib/report-export.ts` 作为公开导出入口，避免改调用方。

### 后端生成器拆分
- 从 `rag_service/generate/report_generator.py` 拆出：
  - `rag_service/generate/prebuilt_profit_data.py`
  - `rag_service/generate/fallback_report_package.py`
- 保留 `ReportGenerator` 公开类名不变。

## 阶段 3：测试与验证

### 新增/更新测试
- `runScan`：验证复用 package profit report，不触发 `/profit-report`。
- `runScan`：验证 RAG 失败 fallback 到 mock。
- `report-package`：验证 snake_case/camelCase 归一化。
- `profit-report`：验证 markdown 解析边界。
- `useScanPolling`：验证超时、退避、失败状态。
- `session-store`：验证节流清理 stale files。

### 验证命令
- `npm run test`
- `npm run build`
- `D:\python\python.exe -m pytest rag_service/tests/ -v`
- 如 UI 受影响，启动前端和 RAG 服务做手动扫描流程验证。

## 风险控制

- 不引入新 npm/pip 依赖，避免锁文件和环境问题。
- 不改 API 响应格式，只在内部归一化。
- 不做 multipart 改造本轮落地，因为它会改变前后端协议；本轮先加大小限制控制风险。
- 不提交 git commit，除非用户明确要求。
