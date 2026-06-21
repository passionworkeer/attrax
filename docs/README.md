# 火鹰合规 - 文档索引

> 文档最后更新：2026-06-20

## 📚 文档列表

| 文档 | 描述 |
|------|------|
| [PROJECT.md](./PROJECT.md) | 项目描述 — 技术栈、架构、目录结构 |
| [PRD.md](./PRD.md) | 产品需求文档 — 功能范围、验收标准 |
| [RAG-ARCHITECTURE-v3.md](./RAG-ARCHITECTURE-v3.md) | RAG 架构文档（当前实现） |
| [DOCUMENT-PIPELINE.md](./DOCUMENT-PIPELINE.md) | 文档处理管线 — 语料库构建流程 |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | 服务器部署指南 — Docker Compose、环境变量、健康检查（已弃用，当前生产为无 Docker 部署）|
| [SERVER-OPS.md](./SERVER-OPS.md) | **生产服务器运维手册 — 当前部署 203.0.113.10（无 Docker）** |
| [PROJECT-STATUS.md](./PROJECT-STATUS.md) | 项目上线评估报告 — 完成度 + 阻塞问题 |
| [regulation-data-sources-coverage-2026-05-27.md](./regulation-data-sources-coverage-2026-05-27.md) | 法规数据源覆盖说明 |
| [plans/ATTRAX_REMEDIATION_PLAN_2026-06-18.md](./plans/ATTRAX_REMEDIATION_PLAN_2026-06-18.md) | 修复路线图（最新） |
| [plans/2026-05-23-full-remediation-design.md](./plans/2026-05-23-full-remediation-design.md) | 早期修复设计 |
| [superpowers/specs/](./superpowers/specs/) | 架构设计 spec（法规源注册 + 治理设计） |

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
# 编辑 rag_service/.env，填入 MIMOTALK_API_KEY、MODELSCOPE_API_KEY

# 构建 FAISS 索引（如尚未构建）
D:\python\python.exe scripts/build_faiss.py

# 启动服务
start-rag.bat
# 或：D:\python\python.exe -m uvicorn rag_service.main:app --reload --port 8001
```

### 测试

```bash
# 前端单元测试
npm run test

# 前端 E2E 测试
npm run test:e2e

# Python 单元测试
D:\python\python.exe -m pytest rag_service/tests/ -v
```

### 服务器部署

```bash
cp .env.production.example .env
# 填入 MIMOTALK_API_KEY 和 MODELSCOPE_API_KEY
docker compose up -d
```

---

## 📁 文档目录结构

```
docs/
├── README.md                                # 本文件
├── PROJECT.md                              # 项目描述
├── PRD.md                                  # 产品需求文档
├── RAG-ARCHITECTURE-v3.md                  # RAG 架构文档（当前）
├── DEPLOYMENT.md                           # 服务器部署指南（Docker，已弃用）
├── SERVER-OPS.md                           # 生产服务器运维手册（当前）
├── DOCUMENT-PIPELINE.md                    # 文档处理管线
├── PROJECT-STATUS.md                       # 项目上线评估
├── regulation-data-sources-coverage-2026-05-27.md
├── plans/                                  # 修复计划
│   ├── ATTRAX_REMEDIATION_PLAN_2026-06-18.md
│   └── 2026-05-23-full-remediation-design.md
└── superpowers/
    └── specs/                              # 架构设计 spec
        ├── 2026-05-26-regulation-retrieval-governance-design.md
        └── 2026-05-26-regulation-source-registry-design.md
```

---

## 🔗 相关链接

- **首页**: http://localhost:3000
- **上传页**: http://localhost:3000/upload
- **Demo 结果**: http://localhost:3000/result/demo
- **法规更新**: http://localhost:3000/regulations
- **RAG Service**: http://localhost:8001（需单独启动后端）
- **RAG Service 健康检查**: http://localhost:8001/health

---

## 📊 项目状态（2026-06）

| 模块 | 状态 | 说明 |
|------|------|------|
| 首页 | ✅ 完成 | Landing 页面 |
| 上传页 | ✅ 完成 | 图片上传 |
| 扫描页 | ✅ 完成 | 实时轮询 |
| 结果页 | ✅ 完成 | 合规 + 利润 + 决策 + 路线图 |
| 法规更新页 | ✅ 完成 | `/regulations` |
| Agent 轨迹页 | ✅ 完成 | `/trace/[sessionId]` |
| 合规路线图页 | ✅ 完成 | `/roadmap/[sessionId]` |
| API 路由 | ✅ 完成 | Next.js → RAG Service |
| Vision AI | ✅ 完成 | MiniMax-M3 vision |
| 混合检索 | ✅ 完成 | FAISS + BM25 + RRF |
| 多市场并行 | ✅ 完成 | LangGraph Send fan-out |
| 引用验证 | ✅ 完成 | NLI 软门（attribution_score 0.9/0.5/0） |
| 持久化存储 | ⏳ 计划中 | P2 |
| 用户系统 | ⏳ 计划中 | P3-P4 |

---

*最后更新: 2026-06-20*
