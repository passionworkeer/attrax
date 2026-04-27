# 火鹰合规 (Blaze Hawks) - 问题报告

## 报告日期
2026-04-27

## 问题汇总

| ID | 严重程度 | 类型 | 问题 | 状态 |
|----|----------|------|------|------|
| BUG-001 | 🟡 中 | 逻辑错误 | Session Store 全局状态在测试中丢失 | 待修复 |
| BUG-002 | 🟢 低 | 错误处理 | API 空请求返回 500 而非 400 | 待修复 |
| BUG-003 | 🟢 低 | 性能 | 扫描管线循环测试超时 | 待优化 |
| BUG-004 | 🟡 中 | 功能缺失 | 真实 Vision AI 管线未接入 | 计划中 |
| BUG-005 | 🟡 中 | 功能缺失 | 无持久化存储 | 计划中 |
| BUG-006 | 🟡 中 | 功能缺失 | 无图片存储 | 计划中 |
| BUG-007 | 🟡 中 | 功能缺失 | 无用户系统 | 计划中 |

---

## 详细问题说明

### BUG-001: Session Store 全局状态在测试中丢失

**严重程度**: 🟡 中
**类型**: 逻辑错误
**位置**: `lib/pipeline/session-store.ts`

**问题描述**
在 Vitest 测试环境中，当使用 `beforeEach` 重置 `globalThis.__scanStore` 后，后续的测试无法正确访问之前创建的 session。Map 的行为似乎与预期不符。

**复现步骤**
1. 运行 `npx vitest run`
2. 查看 `session-store.test.ts` 中的两个失败测试

**当前代码**
```typescript
declare global {
  var __scanStore: Map<string, ScanStatus> | undefined;
}

const store = globalThis.__scanStore ?? new Map<string, ScanStatus>();

if (!globalThis.__scanStore) {
  globalThis.__scanStore = store;
}
```

**影响**
- 2 个单元测试失败
- 测试覆盖率降低

**修复建议**
1. 使用更可靠的存储方式（如 `Map` 的正确初始化）
2. 或者在测试环境中使用独立的模拟存储
3. 考虑使用真实数据库或 Redis 进行持久化

---

### BUG-002: API 空请求返回 500 而非 400

**严重程度**: 🟢 低
**类型**: 错误处理
**位置**: `app/api/scan/route.ts`

**问题描述**
当 POST 请求完全没有 multipart 数据时，API 返回 500 Internal Server Error，而不是返回 400 Bad Request。

**复现步骤**
```bash
curl -X POST http://localhost:3000/api/scan
# 期望: HTTP 400
# 实际: HTTP 500
```

**当前行为**
```
HTTP/1.1 500 Internal Server Error
```

**期望行为**
```
HTTP/1.1 400 Bad Request
{
  "error": {
    "code": "BAD_INPUT",
    "message": "请至少上传 1 张图片"
  }
}
```

**影响**
- 1 个冒烟测试失败
- API 不符合 RESTful 规范

**修复建议**
```typescript
export async function POST(request: Request) {
  let formData;
  try {
    formData = await request.formData();
  } catch (error) {
    return NextResponse.json(
      { error: { code: "BAD_INPUT", message: "无效的请求格式" } },
      { status: 400 }
    );
  }

  const files = formData.getAll("images").filter(isFile);
  // ... 后续验证
}
```

---

### BUG-003: 扫描管线循环测试超时

**严重程度**: 🟢 低
**类型**: 性能 / 测试优化
**位置**: `lib/pipeline/scan.ts`, `tests/unit/scan-pipeline.test.ts`

**问题描述**
在 `scan-pipeline.test.ts` 中，循环测试多个 category 和 market 组合时，由于 `runScan` 内部的 `setTimeout` 延迟，导致测试超时（5000ms）。

**当前代码 (runScan)**
```typescript
export async function runScan(sessionId: string, input: RunScanInput) {
  void input;
  updateSession(sessionId, {
    progress: 20,
    stageText: "真实扫描管线尚未接入，正在回退…",
  });

  await new Promise((resolve) => setTimeout(resolve, 1500)); // 这里有 1.5s 延迟

  updateSession(sessionId, {
    status: "failed",
    // ...
  });
}
```

**影响**
- 2 个单元测试超时
- 测试运行时间增加

**修复建议**
1. 在测试中使用 `vi.useFakeTimers()` 来控制时间
2. 或者减少循环次数，改为抽样测试
3. 或者增加测试超时时间

---

### BUG-004: 真实 Vision AI 管线未接入

**严重程度**: 🟡 中
**类型**: 功能缺失
**位置**: `lib/pipeline/scan.ts`

**问题描述**
当前 `runScan` 函数只是 stub，调用后会直接失败并提示需要接入真实管线。

**当前状态**
```typescript
export async function runScan(sessionId: string, input: RunScanInput) {
  void input;
  // 直接失败...
  updateSession(sessionId, {
    status: "failed",
    error: "真实 Vision 管线将在后续 Phase 接入。当前请保持 DEMO_MODE=true。",
  });
}
```

**期望状态**
- 支持 Claude Vision 分析
- 支持 OpenAI GPT-4V 分析
- 支持 Gemini Vision 分析
- 返回结构化的扫描结果

**影响**
- 无法进行真实产品图片扫描
- Demo 模式是唯一可用的扫描方式

**修复优先级**: P2

---

### BUG-005: 无持久化存储

**严重程度**: 🟡 中
**类型**: 功能缺失
**位置**: `lib/pipeline/session-store.ts`

**问题描述**
当前 session 存储使用内存 Map，重启服务后会丢失所有 session 数据。

**当前限制**
- Session 有效期仅限当前进程
- 无法跨服务器共享
- 刷新页面或服务重启后数据丢失

**期望状态**
- 支持数据库持久化（如 PostgreSQL, MongoDB）
- 支持 Redis 缓存层
- Session 数据可跨进程访问

**修复优先级**: P2

---

### BUG-006: 无图片存储

**严重程度**: 🟡 中
**类型**: 功能缺失
**位置**: `app/api/scan/route.ts`

**问题描述**
用户上传的图片仅在内存中处理，未持久化存储。

**当前限制**
- 无法保存用户上传的图片
- 无法回看历史图片
- 无法进行图片比对

**期望状态**
- 支持文件存储（S3, OSS, 本地存储）
- 支持图片元数据管理
- 支持图片预览

**修复优先级**: P3

---

### BUG-007: 无用户系统

**严重程度**: 🟡 中
**类型**: 功能缺失
**位置**: 全局

**问题描述**
当前产品没有用户认证和授权系统。

**当前限制**
- 匿名使用
- 无法保存用户配置
- 无法跟踪用户扫描历史
- 无法团队协作

**期望状态**
- 支持用户注册/登录
- 支持扫描历史
- 支持团队协作
- 支持权限管理

**修复优先级**: P4

---

## Mock 数据说明

### 当前 Mock 数据结构

**位置**: `lib/mock/scan-result.ts`

```typescript
export const mockScanResult = createMockScanResult("demo");
```

**包含内容**:
- sessionId: "demo"
- productName: "USB 智能加湿器"
- complianceScore: 45
- scoreGrade: "D"
- 2 张图片
- 2 个风险点
- 2 个整改清单项

### Mock 数据用途

1. **Demo 模式**: 供用户查看示例结果
2. **开发调试**: 开发时快速验证功能
3. **测试**: 用于自动化测试

### Mock 数据限制

- 数据是固定的，无法动态生成
- 不包含真实图片
- 法规信息可能过时

---

## 未来接入计划

### Phase 1: 核心功能完善 (P1-P2)

#### Vision AI 接入

| 优先级 | 任务 | 负责模型 |
|--------|------|----------|
| P1 | Claude Vision 接入 | Anthropic Claude |
| P2 | OpenAI GPT-4V 接入 | OpenAI |
| P2 | Gemini Vision 接入 | Google |

**环境变量需求**:
```bash
ANTHROPIC_API_KEY=sk-ant-xxxxx
OPENAI_API_KEY=sk-xxxxx
GOOGLE_API_KEY=xxxxx
```

#### 图片存储

| 优先级 | 任务 | 说明 |
|--------|------|------|
| P1 | 本地存储 | 简单文件存储 |
| P2 | S3/OSS 接入 | 云存储 |
| P2 | 图片压缩 | 使用 sharp |

### Phase 2: 数据持久化 (P2-P3)

#### 数据库选型

| 方案 | 优点 | 缺点 |
|------|------|------|
| PostgreSQL | 关系型、成熟 | 需要额外服务 |
| MongoDB | 灵活、JSON 友好 | 文档存储 |
| SQLite | 简单、无依赖 | 不适合生产 |

#### 建议
- 开发环境: SQLite
- 生产环境: PostgreSQL + Redis

### Phase 3: 用户系统 (P3-P4)

#### Auth 方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| NextAuth.js | 集成好、支持多 provider | 复杂度 |
| Clerk | 托管服务、简单 | 费用 |
| 自建 | 完全可控 | 工作量大 |

#### 建议
- 初期: NextAuth.js
- 进阶: Clerk

---

## 修复时间表

| ID | 问题 | 预计修复时间 | 难度 |
|----|------|-------------|------|
| BUG-001 | Session Store 测试问题 | 1-2 小时 | 中 |
| BUG-002 | API 空请求处理 | 30 分钟 | 低 |
| BUG-003 | 测试超时优化 | 1 小时 | 低 |
| BUG-004 | Vision AI 接入 | 1-2 天 | 高 |
| BUG-005 | 持久化存储 | 1-2 天 | 中 |
| BUG-006 | 图片存储 | 0.5-1 天 | 中 |
| BUG-007 | 用户系统 | 3-5 天 | 高 |

---

## 附录: 测试脚本位置

| 测试类型 | 位置 |
|---------|------|
| 单元测试 | `tests/unit/*.test.ts` |
| 组件测试 | `tests/components/*.test.tsx` (待创建) |
| E2E 测试 | `tests/e2e/*.mjs` |
| 冒烟测试 | `tests/e2e/smoke-tests.mjs` |
| 压力测试 | `tests/pressure/*` |

---

*问题报告版本: 1.0*
*报告人: Claude Code*
*最后更新: 2026-04-27*