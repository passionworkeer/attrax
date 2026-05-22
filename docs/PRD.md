# 火鹰合规 (Blaze Hawks) - 产品需求文档 (PRD)

## 1. 产品愿景

### 核心价值
**在产品上架海外市场前，通过 AI 视觉分析快速识别合规风险点**

> "想出海？先烧毁。" —— 用 AI 的火眼金睛，先把风险"烧掉"

### 目标用户画像
| 角色 | 痛点 | 需求 |
|------|------|------|
| 跨境电商卖家 | 不了解目的地法规，上架后被下架/罚款 | 快速自查，降低风险 |
| 品牌合规负责人 | 人工审核图片效率低，遗漏风险 | 自动化扫描，提升效率 |
| 工厂外贸业务 | 不确定产品图片是否合规 | 一键检测，即时反馈 |

### 成功标准
- 用户上传图片后，5 分钟内获得风险报告
- 覆盖欧盟 CE、美国 FCC、英国 UKCA、中国 CCC、澳大利亚 RCM 等主流市场法规
- 风险识别准确率 > 85%

---

## 2. 产品功能

### P0 已完成

#### 2.0 首页 Landing Page

**功能描述**
产品 Landing Page，简洁有力，第一时间传达产品价值。

**验收标准**
- [x] 显示 Slogan "想出海？先烧毁。"
- [x] "开始扫描" 按钮跳转上传页
- [x] "查看 Demo" 按钮跳转 Demo 结果页

**当前状态**: ✅ 完成

---

#### 2.1 图片上传

**功能描述**
用户可上传 1-8 张产品图片，支持 JPG/PNG/WebP 格式。

**用户流程**
```
1. 访问 /upload 页面
2. 点击文件选择器，选择图片（1-8 张）
3. 选择产品类别: electronics / appliance / 3c / toy / home / other
4. 选择目标市场: EU / US / UK / CN / AU / SA / AE (可多选，默认 EU+US)
5. (可选) 上传产品文档 PDF/DOCX/HTML (最多 5 份)
6. 点击"提交并开始扫描"
7. 跳转到 /burning/[sessionId] 扫描中页面
```

**验收标准**
- [x] 支持多选图片（1-8 张）
- [x] 支持 JPG/PNG/WebP 格式
- [x] 显示已选图片数量
- [x] 未选择图片时按钮禁用
- [x] 选择产品分类 (electronics / appliance / 3c / toy / home / other)
- [x] 选择目标市场 (EU/US/UK/CN/AU/SA/AE，多选)
- [x] 文档上传 (PDF/DOCX/HTML，最多 5 份)
- [ ] 支持拖拽上传 (⚠️ 待实现)
- [x] 文件类型验证 (✅ 部分完成，后端 ACCEPTED_IMAGE_TYPES 过滤)

**当前状态**: ✅ 骨架完成（category/markets 硬编码部分已实现）

---

#### 2.2 扫描过程页面

**功能描述**
用户等待 AI 分析时，显示实时进度和当前阶段。

**用户流程**
```
1. 访问 /burning/[sessionId] 页面
2. 页面自动轮询扫描状态（每 1 秒）
3. 显示进度条和当前阶段文字
4. 完成后自动跳转到 /result/[sessionId]
```

**阶段说明**
| 进度 | 阶段文字 |
|------|----------|
| 0-20% | 准备中... |
| 30% | 🔍 识别铭牌与认证标识... |
| 45% | 📚 规划检索策略... |
| 65% | 📖 匹配法规库... |
| 75% | 🛡️ 生成合规报告... |
| 90% | ✅ 烧毁完成... |
| 100% | ✅ 完成 |

**验收标准**
- [x] 显示进度条 (0-100%)
- [x] 显示当前阶段文字
- [x] 扫描失败时显示错误信息和重试选项
- [x] 完成后自动跳转

**当前状态**: ✅ 完成

---

#### 2.3 结果展示

**功能描述**
展示完整的合规风险报告，包含风险点、整改清单、法规引用。

**用户流程**
```
1. 访问 /result/[sessionId] 页面
2. 加载扫描结果（从 sessionStorage 或 API）
3. 显示:
   - 合规得分 (0-100) 和等级 (A/B/C/D)
   - 风险点列表（按 critical > warning > info 排序）
   - 整改清单（requiredMaterials, estimatedCost, estimatedTime）
   - 法规引用（market, code, name, summary, sourceUrl）
   - 报告导出：PDF / Word 格式
```

**展示内容**
| 模块 | 内容 |
|------|------|
| 概览 | 合规得分 (0-100)、等级 (A/B/C/D)、产品名称、目标市场 |
| 风险点 | 标题、描述、严重程度、置信度、法规引用、整改建议 |
| 整改清单 | 待办事项、所需材料、预计费用、预计时间 |
| 法规引用 | 法规代码、名称、市场、摘要、来源链接 |
| 模型信息 | Vision AI 提供商、延迟 |

**评分规则**
| 等级 | 分数 | 含义 | 颜色 |
|------|------|------|------|
| A | 90-100 | 低风险，可直接上架 | 绿色 |
| B | 70-89 | 轻微风险，需小整改 | 蓝色 |
| C | 50-69 | 中等风险，需整改后上架 | 黄色 |
| D | 0-49 | 高风险，不建议上架 | 红色 |

**验收标准**
- [x] 显示合规得分和等级
- [x] 显示风险点列表（按严重程度排序）
- [x] 显示整改清单
- [x] 显示法规引用
- [x] 支持查看 Demo 结果
- [x] PDF/Word 报告导出 (✅ 完成，lib/report-export.ts，含合规+利润报告)

**当前状态**: ✅ 骨架完成

---

#### 2.4 Demo 模式

**功能描述**
无需上传图片，直接查看示例扫描结果，用于演示和开发调试。

**验收标准**
- [x] /result/demo 可访问
- [x] 显示预设的 Mock 数据
- [x] 覆盖完整数据模型（包含 AgentTrace）

**当前状态**: ✅ 完成

---

### P1 规划

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 拖拽上传 | 支持拖拽文件到上传区域 | P1 |
| 文件类型验证 | 上传前验证格式，非法时提示 | P1 |
| 多市场选择 | EU/US/UK/CN/AU/SA/AE 可多选 | P1 |
| 产品分类选择 | electronics/appliance/3c/toy/home/other | P1 |

---

### P2 规划

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 图像标注 | 在原图上标注风险区域 BoundingBox | P2 |
| 图片管理 | 上传历史、图片库 | P2 |
| PDF/Word 报告导出 | 生成可分享的风险报告 | ✅ P2 已完成 |
| 多语言界面 | 中文/英文界面切换 | P2 |

---

### P3 规划

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 用户系统 | 注册/登录/邮箱验证 | P3 |
| 扫描历史记录 | 查看历史扫描结果 | P3 |
| 团队协作 | 多人协作、权限管理 | P3 |
| 真实 Vision AI | Claude/GPT-4V/Gemini 视觉分析 | P3 |

---

## 3. 用户流程（完整链路）

```
[首页 /]
  │
  ├─ "开始扫描" → [上传页 /upload]
  │                    │
  │                    ├─ 选择图片（1-8 张，支持拖拽）
  │                    ├─ 选择产品分类（electronics/appliance/3c/toy/home/other）
  │                    ├─ 选择目标市场（EU/US/UK/CN/AU/SA/AE，多选）
  │                    ├─ (可选) 上传文档（PDF/DOCX/HTML）
  │                    └─ "提交并开始扫描"
  │                         │
  │                         ▼
  │                    [扫描中页 /burning/[sessionId]]
  │                         │  轮询状态，每秒刷新
  │                         │  进度条 0-100%，阶段文字显示
  │                         │  自动跳转
  │                         ▼
  │                    [结果页 /result/[sessionId]]
  │                         │  合规得分、风险点、整改清单、法规引用
  │                         └─ 报告导出（PDF/Word）
  │
  └─ "查看 Demo" → [Demo 结果页 /result/demo]
```

---

## 4. 核心页面规格

### 上传页 (/upload)

**组件布局**
```
┌─────────────────────────────────────┐
│  产品图片上传                          │
│  ┌─────────────────────────────┐    │
│  │  拖拽或点击上传 (1-8张)        │    │
│  │  支持 JPG/PNG/WebP            │    │
│  └─────────────────────────────┘    │
│  [已选: 0 张]                        │
│                                     │
│  产品分类: [electronics ▼]          │
│  目标市场: [EU✓] [US✓] [UK ] ...    │
│                                     │
│  产品文档 (可选):                     │
│  [上传 PDF/DOCX/HTML]               │
│                                     │
│  [提交并开始扫描] (禁用)              │
└─────────────────────────────────────┘
```

**数据校验**
- 图片数量: 1-8 张
- 图片格式: JPG, PNG, WebP
- 产品分类: electronics | appliance | 3c | toy | home | other
- 目标市场: EU | US | UK | CN | AU | SA | AE (至少选一个)
- 文档数量: 0-5 份
- 文档格式: PDF, DOCX, HTML

---

### 扫描中页 (/burning/[sessionId])

**组件布局**
```
┌─────────────────────────────────────┐
│  🔥 烧毁中...                         │
│                                     │
│  ████████████░░░░░░░░  65%         │
│                                     │
│  📖 匹配法规库...                     │
│                                     │
│  预计 2-3 分钟完成                    │
└─────────────────────────────────────┘
```

**轮询机制**
- 轮询间隔: 1000ms
- API: GET /api/scan/[sessionId]
- 状态: processing / ready / failed
- ready 时自动跳转到 /result/[sessionId]

---

### 结果页 (/result/[sessionId])

**组件布局**
```
┌─────────────────────────────────────┐
│  合规报告                             │
│  评分: 72 分  等级: B (蓝色)          │
│  🛡️ 轻微风险，需小整改                 │
│                                     │
│  ── 风险点 (4 项) ──                 │
│  [critical] 缺少 CE 标识              │
│  [critical] 电压标注不符 EU 规范       │
│  [warning]  说明书缺失欧盟语言         │
│  [info]     包装材料标识可选           │
│                                     │
│  ── 整改清单 ──                      │
│  • 申请 CE 认证（预计 2-4 周，¥5000） │
│  • 重新标注电压 (220V 50Hz)          │
│                                     │
│  ── 法规引用 ──                      │
│  EU | EMC 2014/30/EU | 电磁兼容指令   │
│  EU | LVD 2014/35/EU | 低电压指令     │
│                                     │
│  [导出 PDF] [导出 Word]              │
└─────────────────────────────────────┘
```

---

## 5. 数据模型（TypeScript 接口）

### ScanResult

```typescript
interface ScanResult {
  sessionId: string;                // 唯一会话 ID
  scanTime: string;                 // 扫描时间 (ISO 8601)
  productCategory: ProductCategory; // 产品类别
  productName?: string;             // 产品名称 (AI 识别)
  targetMarkets: Market[];          // 目标市场列表
  complianceScore: number;          // 合规得分 (0-100)
  scoreGrade: ScoreGrade;           // 等级 (A/B/C/D)
  status: "PASS" | "WARN" | "REJECTED";
  images: ImageAsset[];             // 图片列表
  riskPoints: RiskPoint[];          // 风险点列表
  checklist: ChecklistItem[];       // 整改清单
  agentTrace: AgentTrace[];         // AI 执行轨迹（调试用）
  loopCount: number;                // Agent 循环次数
  generatedAt: string;               // 报告生成时间
  modelInfo?: {                     // AI 模型信息
    visionProvider: string;
    latencyMs: number;
  };
}
```

### RiskPoint

```typescript
interface RiskPoint {
  riskId: string;                  // 风险点唯一 ID
  title: string;                   // 风险标题
  description: string;             // 风险描述
  severity: Severity;               // 严重程度
  confidence: number;              // 置信度 (0-1)
  regulations: RegulationRef[];    // 相关法规
  recommendedAction: string;        // 建议行动
  estimatedFixCost?: string;        // 预计整改费用
}
```

### RegulationRef

```typescript
interface RegulationRef {
  regId: string;                   // 法规 ID
  code: string;                    // 法规代码
  name: string;                    // 法规名称（中文）
  nameEn?: string;                 // 法规名称（英文）
  market: Market;                  // 适用市场
  summary: string;                 // 摘要说明
  sourceUrl: string;               // 官方来源链接
  severity: Severity;              // 风险严重程度
}
```

### 其他类型

```typescript
interface ChecklistItem {
  id: string;
  action: string;                  // 整改动作
  requiredMaterials?: string[];   // 所需材料
  estimatedCost?: string;          // 预计费用
  estimatedTime?: string;          // 预计时间
  priority: "high" | "medium" | "low";
}

interface AgentTrace {
  step: number;
  action: string;                  // 执行动作
  thought?: string;               // 思考过程
  result?: string;                // 执行结果
  durationMs?: number;            // 执行耗时
}

interface ImageAsset {
  id: string;
  filename: string;
  url?: string;                   // 图片访问 URL
  thumbnail?: string;             // 缩略图 URL
  size: number;                   // 文件大小 (bytes)
  width?: number;                // 图片宽度
  height?: number;                // 图片高度
  riskAnnotations?: BoundingBox[]; // 风险标注区域
}

interface BoundingBox {
  x: number;                      // 左上角 X
  y: number;                      // 左上角 Y
  width: number;                  // 宽度
  height: number;                 // 高度
  label: string;                  // 标注标签
  riskId?: string;                // 关联的风险点 ID
}
```

### 类型定义

```typescript
// 产品类别
type ProductCategory =
  | "electronics"   // 电子产品
  | "appliance"     // 家用电器
  | "3c"            // 3C 数码
  | "toy"           // 玩具
  | "home"          // 家居
  | "other";        // 其他

// 目标市场
type Market =
  | "EU"   // 欧盟
  | "US"   // 美国
  | "UK"   // 英国
  | "CN"   // 中国
  | "AU"   // 澳大利亚
  | "SA"   // 沙特阿拉伯
  | "AE";  // 阿联酋

// 风险严重程度
type Severity = "critical" | "warning" | "info";

// 合规评分等级
type ScoreGrade = "A" | "B" | "C" | "D";

// 成本汇总
interface CostSummary {
  bom: number;           // 材料成本（BOM）
  packaging: number;    // 包装印刷
  cert: number;         // 认证费摊销
  epr: number;          // EPR 运营费
  logistics: number;    // 物流渠道
  asp: number;          // 平均售价
  gp: number;           // 毛利润
}

// 利润报告结果（POST /profit-report）
interface ProfitReportResult {
  sessionId: string;
  productType: string;
  market: string;
  report: string;                       // Markdown 报告（含成本对比表）
  barebone: CostSummary;              // 裸奔模式成本
  compliant: CostSummary;              // 合规模式成本
  bareboneRiskExposure: number;        // 风险敞口（暴露金额）
  compliantRiskExposure: number;       // 风险敞口（暴露金额）
  keyConclusion: string;                // 关键结论
  generatedAt: string;                  // 生成时间
}
```

---

## 6. 评分规则

| 等级 | 分数范围 | 含义 | 状态 | 颜色 | 建议 |
|------|----------|------|------|------|------|
| A | 90-100 | 低风险，可直接上架 | PASS | 绿色 | 无需整改 |
| B | 70-89 | 轻微风险，需小整改 | WARN | 蓝色 | 建议小幅整改后上架 |
| C | 50-69 | 中等风险，需整改后上架 | WARN | 黄色 | 必须整改后才能上架 |
| D | 0-49 | 高风险，不建议上架 | REJECTED | 红色 | 存在严重合规风险 |

**评分算法**
- critical 风险: 每项扣 20 分
- warning 风险: 每项扣 10 分
- info 风险: 每项扣 3 分
- 满分 100 分，最低 0 分

---

## 7. API 设计

### POST /api/scan 启动扫描

**请求**
```
POST /api/scan
Content-Type: multipart/form-data
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| images | File[] | 是 | 图片文件，1-8 张，支持 JPG/PNG/WebP |
| documents | File[] | 否 | 文档文件，0-5 份，支持 PDF/DOCX/HTML |
| category | string | 是 | 产品类别 |
| markets | string[] | 是 | 目标市场，至少选一个 |

**响应 202 Accepted**
```json
{
  "sessionId": "scan_01JXXXXX",
  "status": "processing",
  "pollUrl": "/api/scan/scan_01JXXXXX",
  "estimatedTime": 120
}
```

**响应 400 Bad Request**
```json
{
  "error": {
    "code": "BAD_INPUT",
    "message": "请至少上传 1 张图片"
  }
}
```

---

### GET /api/scan/[sessionId] 查询状态

**响应 (processing)**
```json
{
  "sessionId": "scan_01JXXXXX",
  "status": "processing",
  "progress": 65,
  "stageText": "📖 匹配法规库..."
}
```

**响应 (ready)**
```json
{
  "sessionId": "scan_01JXXXXX",
  "status": "ready",
  "progress": 100,
  "stageText": "✅ 完成",
  "result": { ... ScanResult }
}
```

**响应 (failed)**
```json
{
  "sessionId": "scan_01JXXXXX",
  "status": "failed",
  "progress": 20,
  "stageText": "扫描失败",
  "error": "AI 服务暂时不可用，请稍后重试"
}
```

---

### 错误码定义

| code | HTTP 状态 | 说明 |
|------|-----------|------|
| BAD_INPUT | 400 | 请求参数错误 |
| FILE_TOO_LARGE | 400 | 文件大小超出限制 |
| UNSUPPORTED_FORMAT | 400 | 不支持的文件格式 |
| SESSION_NOT_FOUND | 404 | 会话不存在 |
| SCAN_FAILED | 500 | 扫描执行失败 |
| AI_SERVICE_ERROR | 503 | AI 服务不可用 |

---

## 8. 技术约束

### 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端框架 | Next.js | 16 |
| UI 框架 | React | 19 |
| 语言 | TypeScript | 5.x |
| 样式 | Tailwind CSS | 4.x |
| 后端框架 | FastAPI | 0.109+ |
| Python 版本 | Python | 3.10+ |
| Agent 框架 | LangGraph | latest |
| RAG 引擎 | FAISS + BM25 | - |
| Embedding | Ollama / ModelScope | - |
| 知识库 | mimoTalk | - |

### 系统约束

- **无持久化存储**: 所有会话数据存储在内存 Map + 文件中，TTL 1 小时，服务重启后可通过文件恢复
- **无用户系统**: 匿名使用，无需注册登录
- **会话有效期**: 会话数据保留 1 小时后自动过期（自动清理）
- **文件大小限制**: 单张图片最大 10MB，文档最大 20MB
- **并发限制**: 单用户同时最多 1 个扫描任务

### 性能要求

| 指标 | 要求 |
|------|------|
| 页面首屏加载 | < 2s |
| 图片上传响应 | < 500ms |
| 扫描状态轮询 | < 1s |
| 结果页渲染 | < 1s |
| 扫描完成时间 | < 5 分钟（常规图片） |

---

## 9. 验收检查清单

### 上传页 (/upload)
- [ ] 可选择多张图片（1-8 张）
- [ ] 显示已选图片数量和缩略图
- [ ] 未选择图片时"提交"按钮禁用
- [ ] 文件类型错误时显示友好提示
- [ ] 支持拖拽上传文件到上传区域
- [ ] 产品分类下拉选择器正常
- [ ] 目标市场多选正常（至少选一个）
- [ ] 文档上传功能正常（可选）
- [ ] 提交后正确跳转到 /burning/[sessionId]

### 扫描中页 (/burning/[sessionId])
- [ ] 进度条正确显示 0-100%
- [ ] 阶段文字与进度对应
- [ ] 每秒轮询状态更新
- [ ] 扫描失败时显示重试按钮
- [ ] 完成后自动跳转到结果页

### 结果页 (/result/[sessionId])
- [ ] 合规得分正确显示（0-100）
- [ ] 评分等级正确显示（A/B/C/D）
- [ ] 风险点列表按 critical > warning > info 排序
- [ ] 整改清单完整显示（材料/费用/时间）
- [ ] 法规引用显示完整（代码/名称/链接）
- [ ] 模型信息显示（AI 提供商/延迟）
- [ ] Demo 数据正常展示
- [ ] 报告导出按钮可用（PDF/Word）

### 性能要求
- [ ] Lighthouse 性能评分 > 80
- [ ] 页面 FCP < 2s
- [ ] 扫描轮询延迟 < 1s
- [ ] 无长任务阻塞 UI 线程

### 兼容性
- [ ] Chrome 100+ 正常
- [ ] Firefox 100+ 正常
- [ ] Safari 15+ 正常
- [ ] Edge 100+ 正常
- [ ] 移动端（iOS Safari / Android Chrome）基本可用

---

## 10. 当前进度

| 功能 | 状态 | 完成日期 | 备注 |
|------|------|----------|------|
| 首页 Landing Page | ✅ 完成 | - | P0 |
| 图片上传（1-8张） | ✅ 完成 | - | P0 |
| 文档上传（PDF/DOCX/HTML） | ✅ 完成 | - | P0 |
| 扫描中页面（轮询） | ✅ 完成 | - | P0 |
| 结果展示页 | ✅ 完成 | - | P0 |
| Demo 模式 | ✅ 完成 | - | P0 |
| API 路由（/api/scan） | ✅ 完成 | - | P0 |
| 类型定义（TypeScript） | ✅ 完成 | - | P0 |
| 样式系统（Tailwind + 设计令牌） | ✅ 完成 | - | P0 |
| 拖拽上传 | 🔲 待实现 | - | P1 |
| 文件类型验证 | 🔲 待实现 | - | P1 |
| 多市场选择（EU/US/UK/CN/AU/SA/AE） | 🔲 待实现 | - | P1 |
| 产品分类选择 | 🔲 待实现 | - | P1 |
| 图像标注（BoundingBox） | 🔲 待实现 | - | P2 |
| 图片管理（上传历史/图片库） | 🔲 待实现 | - | P2 |
| PDF/Word 报告导出 | 🔲 待实现 | - | P2 |
| 多语言界面 | 🔲 待实现 | - | P2 |
| 用户系统（注册/登录/团队协作） | 🔲 待实现 | - | P3 |
| 扫描历史记录 | 🔲 待实现 | - | P3 |
| 真实 Vision AI（Claude/GPT-4V/Gemini） | 🔲 待实现 | - | P3 |

**整体进度**: P0 功能已全部完成，P1/P2/P3 功能规划中

---

*文档版本: 2.0*
*最后更新: 2026-05-07*