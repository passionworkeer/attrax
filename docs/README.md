# 火鹰合规 - 文档索引

## 📚 文档列表

| 文档 | 描述 |
|------|------|
| [PROJECT.md](./PROJECT.md) | 项目描述 — 技术栈、架构、目录结构 |
| [PRD.md](./PRD.md) | 产品需求文档 — 功能范围、验收标准 |
| [RAG-ARCHITECTURE-v3.md](./RAG-ARCHITECTURE-v3.md) | RAG 架构文档（当前实现） |
| [RAG-ARCHITECTURE-v2-LEGACY.md](./RAG-ARCHITECTURE-v2-LEGACY.md) | RAG 架构文档 — 旧版（已归档） |
| [IMPLEMENTATION-PLAN-v3.md](./IMPLEMENTATION-PLAN-v3.md) | 实施计划（⚠️ 历史文档，实际路线已变更） |
| [DOCUMENT-PIPELINE.md](./DOCUMENT-PIPELINE.md) | 文档处理管线 — 语料库构建流程 |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | 服务器部署指南 — Docker Compose、环境变量、健康检查 |
| [PROJECT-STATUS.md](./PROJECT-STATUS.md) | 项目上线评估报告 — 完成度 + 阻塞问题 |
| [RAG-ARCHITECTURE.md](./archived/RAG-ARCHITECTURE.md) | RAG 架构文档 — 初始版（已归档） |
| [archived/](./archived/) | 已归档文档（历史版本） |

---

## 🚀 快速开始

### 前端

```bash
cd attrax
npm install
npm run dev
# 访问 http://localhost:3000
```

### RAG 后端（可选，需完整功能）

```bash
# 配置环境变量
cp rag_service/.env.example rag_service/.env
# 编辑 rag_service/.env，填入 MIMOTALK_API_KEY
# 同时填入 MODELSCOPE_API_KEY（生产 embedding 只走 API）

# 构建 FAISS 索引（如尚未构建）
.venv\Scripts\python.exe scripts/build_faiss.py

# 启动服务
scripts\start_rag.bat
```

### 测试

```bash
# 前端单元测试
npm run test

# 前端 E2E 测试
npm run test:e2e

# Python 单元测试
.venv\Scripts\python.exe -m pytest rag_service/tests/ -v
```

### 服务器部署

```bash
cp .env.production.example .env
# 填入 MIMOTALK_API_KEY 和 MODELSCOPE_API_KEY
npm run deploy:prod
```

---

## 📁 文档目录结构

```
docs/
├── README.md                          # 本文件
├── PROJECT.md                        # 项目描述
├── PRD.md                            # 产品需求文档
├── RAG-ARCHITECTURE-v3.md            # RAG 架构文档（当前）
├── DEPLOYMENT.md                     # 服务器部署指南
├── archived/                         # 已归档文档
│   ├── RAG-ARCHITECTURE.md           # ARCHIVED
│   ├── RAG-ARCHITECTURE-v2-LEGACY.md  # ARCHIVED（原 RAG-ARCHITECTURE-v2.md）
│   ├── IMPLEMENTATION-PLAN-v2.1.md   # ARCHIVED
│   └── IMPLEMENTATION-PLAN-v3-ARCHIVED.md
├── IMPLEMENTATION-PLAN-v3.md         # 实施计划（历史文档）
├── PROJECT-STATUS.md                 # 项目上线评估报告
└── DOCUMENT-PIPELINE.md              # 文档处理管线
```

---

## 🔗 相关链接

- **首页**: http://localhost:3000
- **上传页**: http://localhost:3000/upload
- **Demo 结果**: http://localhost:3000/result/demo
- **RAG Service**: http://localhost:8001 (需单独启动后端)
- **RAG Service 健康检查**: http://localhost:8001/health

---

## 📊 项目状态

| 模块 | 状态 | 说明 |
|------|------|------|
| 首页 | ✅ 完成 | Landing 页面 |
| 上传页 | ✅ 完成 | 图片上传 |
| 扫描页 | ✅ 完成 | 实时轮询 |
| 结果页 | ✅ 完成 | 合规报告展示 |
| API 路由 | ✅ 完成 | Next.js → RAG Service |
| Vision AI | ✅ 完成 | mimoTalk vision |
| 混合检索 | ✅ 完成 | FAISS + BM25 + RRF |
| 多市场并行 | ✅ 完成 | LangGraph Send fan-out |
| 引用验证 | ✅ 完成 | NLI 软门（attribution_score 0.9/0.5/0） |
| 持久化存储 | ⏳ 计划中 | P2 |
| 用户系统 | ⏳ 计划中 | P3-P4 |

---

*最后更新: 2026-05-05*
