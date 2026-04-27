# 火鹰合规 (Blaze Hawks) - 项目描述文档

## 1. 项目概述

### 项目名称
**火鹰合规** (英文名: Blaze Hawks)

### 核心定位
AI 合规风险智能扫描平台 —— 帮助出海企业在上架前快速识别产品图片中的合规风险点，并生成可操作的整改清单。

### 核心 Slogan
> "想出海？先烧毁。"

### 目标用户
- 跨境电商卖家（亚马逊、eBay、速卖通等平台）
- 品牌方合规负责人
- 工厂外贸业务

---

## 2. 技术栈

### 前端框架
| 技术 | 版本 | 用途 |
|------|------|------|
| Next.js | 16.2.4 | React 全栈框架 |
| React | 19.2.4 | UI 库 |
| TypeScript | 5.x | 类型安全 |
| Tailwind CSS | 4.x | 样式框架 |
| shadcn/ui | 4.4.0 | UI 组件库 |
| base-ui | 1.4.1 | Button 等核心组件 |
| framer-motion | 12.38.0 | 动画库 |
| Lucide React | 1.9.0 | 图标库 |

### 后端/API
| 技术 | 版本 | 用途 |
|------|------|------|
| Next.js API Routes | - | 后端 API |
| Node.js | - | 运行时 |
| Zod | 4.3.6 | 数据验证 |
| ULID | 3.0.2 | 会话 ID 生成 |

### AI/视觉服务 (待接入)
| 技术 | 用途 |
|------|------|
| Claude (Anthropic) | 视觉分析 |
| OpenAI GPT-4V | 视觉分析 |
| Gemini (Google) | 视觉分析 |

### 开发工具
| 技术 | 用途 |
|------|------|
| ESLint | 代码检查 |
| TypeScript | 静态类型检查 |
| tsx | TypeScript 执行器 |

---

## 3. 目录结构

```
attrax/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # 首页 (Landing)
│   ├── layout.tsx                # 根布局
│   ├── globals.css               # 全局样式
│   ├── upload/                   # 上传页面
│   │   └── page.tsx              # 图片上传
│   ├── burning/                  # 扫描中页面
│   │   └── [sessionId]/page.tsx  # 轮询等待
│   ├── result/                   # 结果页面
│   │   └── [sessionId]/page.tsx  # 扫描结果展示
│   └── api/                      # API 路由
│       └── scan/
│           └── route.ts          # 扫描 API
│
├── components/                   # UI 组件
│   ├── ui/                       # shadcn/ui 组件
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── progress.tsx
│   │   ├── badge.tsx
│   │   ├── tooltip.tsx
│   │   ├── separator.tsx
│   │   ├── tabs.tsx
│   │   ├── sonner.tsx
│   │   ├── dialog.tsx
│   │   └── sheet.tsx
│   ├── burning/                  # 扫描中组件
│   ├── flame/                    # 火焰/风险组件
│   ├── result/                   # 结果展示组件
│   └── upload/                   # 上传相关组件
│
├── lib/                          # 核心库
│   ├── types.ts                  # TypeScript 类型定义
│   ├── schemas.ts                # Zod 验证 schema
│   ├── utils.ts                  # 工具函数 (cn)
│   ├── hooks/                    # React hooks
│   │   └── useScanPolling.ts    # 扫描状态轮询
│   ├── mock/                     # Mock 数据
│   │   └── scan-result.ts        # 模拟扫描结果
│   ├── pipeline/                 # 扫描管线
│   │   ├── scan.ts              # 真实扫描逻辑 (待接入)
│   │   └── session-store.ts     # 会话存储
│   ├── rag/                      # RAG 相关 (待开发)
│   └── vision/                   # 视觉服务 (待开发)
│
├── public/                       # 静态资源
│   ├── brand/                    # 品牌素材
│   ├── icons/                   # 图标
│   ├── mock-fixtures/           # Mock 图片
│   └── uploads/                 # 用户上传
│
├── data/                         # 数据文件
│   └── mock-fixtures/           # Mock 数据
│
├── docs/                         # 文档
│   ├── PROJECT.md               # 本文档
│   ├── PRD.md                   # 产品需求文档
│   ├── TEST-REPORT.md          # 测试报告
│   └── BUG-REPORT.md           # 问题报告
│
├── .next/                       # Next.js 构建输出
├── node_modules/                # 依赖
│
├── package.json                 # 项目依赖
├── tsconfig.json               # TypeScript 配置
├── next.config.ts              # Next.js 配置
├── components.json             # shadcn 配置
└── README.md                   # 项目说明
```

---

## 4. 前端架构

### 页面路由
```
/                       首页 (Landing)
/upload                 图片上传页
/burning/[sessionId]    扫描中页面 (轮询状态)
/result/[sessionId]     扫描结果页
/result/demo            Demo 结果页
```

### 页面流程
```
[首页] → [上传页] → [扫描中页] → [结果页]
  ↓
[Demo 结果页] ←─────────────┘
```

### 状态管理
- **Session Storage**: 存储扫描结果 (跨页面传递)
- **React State**: 组件内状态
- **Polling Hook**: `useScanPolling` 定时获取扫描状态

### 核心组件
| 组件 | 位置 | 功能 |
|------|------|------|
| Button | components/ui/button.tsx | 按钮 (基于 base-ui) |
| Card | components/ui/card.tsx | 卡片容器 |
| Progress | components/ui/progress.tsx | 进度条 |
| Badge | components/ui/badge.tsx | 标签 |
| Tooltip | components/ui/tooltip.tsx | 提示 |
| Tabs | components/ui/tabs.tsx | 标签页 |
| Sonner | components/ui/sonner.tsx | Toast 通知 |
| Dialog | components/ui/dialog.tsx | 对话框 |
| Sheet | components/ui/sheet.tsx | 侧边抽屉 |

---

## 5. 后端架构

### API 端点

#### POST /api/scan
**功能**: 启动扫描任务

**请求**:
- Content-Type: `multipart/form-data`
- 字段:
  - `images`: File[] (必填，1-8张图片)
  - `category`: string (产品类别，默认 "electronics")
  - `markets`: string (市场，逗号分隔，默认 "EU,US")

**响应** (202 Accepted):
```json
{
  "sessionId": "scan_01JXXXXX",
  "status": "processing",
  "pollUrl": "/api/scan/scan_01JXXXXX"
}
```

**错误响应** (400):
```json
{
  "error": {
    "code": "BAD_INPUT",
    "message": "请至少上传 1 张图片..."
  }
}
```

#### GET /api/scan/[sessionId]
**功能**: 获取扫描状态/结果

**响应**:
```json
{
  "sessionId": "scan_01JXXXXX",
  "status": "ready" | "processing" | "failed",
  "progress": 0-100,
  "stageText": "识别铭牌与认证标识...",
  "result": { ... }  // ready 时才有
}
```

### 会话存储
- 使用内存 Map (`globalThis.__scanStore`)
- Session 有效期: 1 小时
- 存储内容: ScanStatus 对象

### 扫描管线 (Pipeline)

#### Demo 模式
当 `DEMO_MODE=true` 时:
1. 1秒后: 进度 30%，stageText = "识别铭牌与认证标识..."
2. 2.5秒后: 进度 65%，stageText = "匹配欧美法规库..."
3. 4.5秒后: 完成，进度 100%，返回 Mock 数据

#### 真实管线 (待接入)
```typescript
// lib/pipeline/scan.ts (当前 stub)
export async function runScan(sessionId: string, input: RunScanInput) {
  // 当前直接失败，提示需要接入真实 Vision 管线
}
```

---

## 6. 数据模型

### ScanResult (扫描结果)
```typescript
interface ScanResult {
  sessionId: string;
  scanTime: string;          // ISO datetime
  productCategory: ProductCategory;
  productName?: string;
  targetMarkets: Market[];
  complianceScore: number;    // 0-100
  scoreGrade: ScoreGrade;     // A | B | C | D
  images: ImageAsset[];
  riskPoints: RiskPoint[];
  checklist: ChecklistItem[];
  generatedAt: string;
  modelInfo?: {
    visionProvider: "claude" | "openai" | "gemini" | "mock";
    latencyMs: number;
  };
}
```

### RiskPoint (风险点)
```typescript
interface RiskPoint {
  riskId: string;
  title: string;              // 如 "缺少 CE 标识"
  description: string;
  severity: "critical" | "warning" | "info";
  flameLevel: 1 | 2 | 3;     // 火焰级别 (视觉呈现)
  confidence: number;         // 0-1 置信度
  imageId: string;
  bbox: BoundingBox;          // 归一化坐标 0-1
  regulations: RegulationRef[];
  recommendedAction: string;
  estimatedFixCost?: string;
}
```

### RegulationRef (法规引用)
```typescript
interface RegulationRef {
  regId: string;
  code: string;               // 如 "CE", "FCC"
  name: string;               // 如 "CE 标识通用要求"
  nameEn?: string;
  market: "EU" | "US" | "UK";
  summary: string;
  sourceUrl: string;
  severity: Severity;
}
```

### ChecklistItem (整改清单项)
```typescript
interface ChecklistItem {
  itemId: string;
  category: string;
  title: string;
  requiredMaterials: string[];
  recommendedLab?: string;
  estimatedCost?: string;
  estimatedTime?: string;
  isFree: boolean;
}
```

---

## 7. 类型定义

### ProductCategory
```typescript
type ProductCategory = "electronics" | "appliance" | "3c" | "toy" | "home" | "other";
```

### Market
```typescript
type Market = "EU" | "US" | "UK";
```

### Severity
```typescript
type Severity = "critical" | "warning" | "info";
```

### ScoreGrade
```typescript
type ScoreGrade = "A" | "B" | "C" | "D";
```

### FlameLevel
```typescript
type FlameLevel = 1 | 2 | 3;
```

---

## 8. 样式系统

### 设计令牌 (Design Tokens)
```css
/* 品牌色 */
--blaze-red: #d93a1a;
--blaze-orange: #ff8a1f;
--blaze-gold: #ffd23f;
--blaze-dark: #1a1a2e;
--blaze-surface: #fff8f4;
--blaze-ink: #221c1a;

/* UI 色 */
--background: #fff9f5;
--foreground: #221c1a;
--primary: #d93a1a;
--secondary: #ffe8d8;
--muted: #fff0e7;
--border: rgba(34, 28, 26, 0.12);

/* 圆角 */
--radius: 0.625rem;  /* 10px base */
```

### 背景效果
```css
body {
  background-image:
    radial-gradient(circle at top, rgba(255, 210, 63, 0.2), transparent 32%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(255, 248, 244, 0.92));
}
```

---

## 9. Mock 数据

### Demo 扫描结果
- 产品: USB 智能加湿器
- 市场: EU, US
- 得分: 45 (Grade D)
- 风险点: 2 个
  1. "缺少 CE 标识" (critical)
  2. "警示标签可疑" (warning)
- 清单项: 2 项

---

## 10. 环境变量

### 当前支持
| 变量 | 默认值 | 说明 |
|------|--------|------|
| DEMO_MODE | "true" | 是否使用 Demo 模式 |

### 待添加
| 变量 | 说明 |
|------|------|
| ANTHROPIC_API_KEY | Claude API 密钥 |
| OPENAI_API_KEY | OpenAI API 密钥 |
| GOOGLE_API_KEY | Gemini API 密钥 |

---

## 11. 品牌视觉

### Logo 概念
火焰/鹰元素，代表"烧毁"风险

### 色彩心理学
- 红色系: 警示、风险
- 金色/橙色: 热情、行动
- 深蓝色: 专业、可靠

---

## 12. 已知限制

1. **扫描管线未接入**: 真实 Vision AI 尚未接入
2. **无持久化存储**: 会话存储在内存，重启丢失
3. **无用户系统**: 匿名使用，无登录
4. **无数据库**: 无持久化数据存储
5. **无图片存储**: 上传图片仅在内存处理，未持久化

---

*文档版本: 1.0*
*最后更新: 2026-04-27*