# 火鹰合规 - 文档索引

## 📚 文档列表

| 文档 | 描述 |
|------|------|
| [PROJECT.md](./PROJECT.md) | 项目描述文档 - 技术栈、架构、目录结构 |
| [PRD.md](./PRD.md) | 产品需求文档 - 功能范围、验收标准 |
| [TEST-REPORT.md](./TEST-REPORT.md) | 测试报告 - 单元测试、E2E、压力测试结果 |
| [BUG-REPORT.md](./BUG-REPORT.md) | 问题报告 - Bug 列表、Mock 数据、未来接入计划 |

---

## 🚀 快速开始

### 安装依赖
```bash
cd attrax
npm install
```

### 开发模式
```bash
npm run dev
# 访问 http://localhost:3000
```

### 运行测试

#### 单元测试
```bash
npx vitest run
```

#### E2E 测试
```bash
node tests/e2e/smoke-tests.mjs
node tests/e2e/e2e-tests.mjs
```

#### 压力测试
```bash
bash tests/pressure/simple-load-test.sh
```

---

## 📁 文档目录结构

```
docs/
├── PROJECT.md      # 项目描述
├── PRD.md          # 产品需求
├── TEST-REPORT.md  # 测试报告
├── BUG-REPORT.md   # 问题报告
└── README.md       # 本文件
```

---

## 🔗 相关链接

- **首页**: http://localhost:3000
- **上传页**: http://localhost:3000/upload
- **Demo 结果**: http://localhost:3000/result/demo
- **API 端点**: http://localhost:3000/api/scan

---

## 📊 项目状态

| 模块 | 状态 | 说明 |
|------|------|------|
| 首页 | ✅ 完成 | P0 骨架 |
| 上传页 | ✅ 完成 | P1 骨架 |
| 扫描页 | ✅ 完成 | P0 完成 |
| 结果页 | ✅ 完成 | P0 骨架 |
| API 路由 | ✅ 完成 | P0 完成 |
| Vision AI | ❌ 待接入 | P2 计划 |
| 持久化存储 | ❌ 待接入 | P2-P3 计划 |
| 用户系统 | ❌ 待接入 | P3-P4 计划 |

---

*最后更新: 2026-04-27*