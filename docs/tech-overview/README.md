# Attrax 技术文档集（基于真实代码 2026-09-17 抓取）

按用户要求，把 attrax（公开名「火鹰合规 / Blaze Hawks」）当前在生产运行的全链路逻辑整理为一份对外可读的技术参考。每个文档只引用仓库里真实存在的文件与代码，不写未实现的设想。

## 比赛场景快速导航

| 你想回答 | 读什么 |
|---|---|
| 30 秒讲清产品 | [08 Q&A §K 一句话电梯版](./08-qa.md) |
| 5 分钟讲清技术栈 | [01 §核心要点](./01-architecture-overview.md) + [08 §A 项目定位](./08-qa.md) |
| 评委追问「怎么防幻觉」 | [08 §C 避免幻觉](./08-qa.md) + [04 §第 3 步](./04-backend-pipeline.md) |
| 评委追问「准确度怎么保证」 | [08 §C2/C3](./08-qa.md) + [02 §source_kind 治理](./02-regulations-and-knowledge-base.md) |
| 评委追问「法规怎么更新」 | [08 §D5](./08-qa.md) + [03 全篇](./03-regulation-update-watchdog.md) |
| 评委追问「怎么部署 / 怎么扛流量」 | [08 §F 性能与可靠性](./08-qa.md) + [07 全篇](./07-deployment-and-operations.md) |
| 评委追问「数据安全 / 隐私」 | [08 §G 隐私与数据安全](./08-qa.md) + [06 §G 事故响应](./06-server-security.md) |
| 投资人追问「护城河 / 商业模式」 | [08 §I 业务与运营](./08-qa.md) + [08 §J4](./08-qa.md) |
| 技术评审追问「最难啃的工程决策」 | [08 §H 工程亮点](./08-qa.md) + [01 §de-RAG 时间线](./01-architecture-overview.md) |

## 阅读顺序

| # | 文档 | 回答的问题 |
|---|---|---|
| 01 | [架构总览](./01-architecture-overview.md) | attrax 是什么、怎么跑、端口怎么分、目录怎么走 |
| 02 | [法规与知识库](./02-regulations-and-knowledge-base.md) | 44 篇现行法规怎么组织、怎么按品类 / 特征触发、怎么查 |
| 03 | [法规自动更新（Watchdog）](./03-regulation-update-watchdog.md) | 35 个官方源每天怎么巡检、改动怎么自动入库 |
| 04 | [后端扫描管线](./04-backend-pipeline.md) | vision → generate → verify 三步管线是怎么把图片变成带引用合规报告的 |
| 05 | [前端与 BFF](./05-frontend-and-bff.md) | 浏览器怎么走 Next.js BFF，再到 RAG `/api/v1`，含速率限制 |
| 06 | [服务器与安全](./06-server-security.md) | 生产服务器怎么加固、密钥怎么管、限流 / 防火墙 / sshd 怎么配 |
| 07 | [部署与运维](./07-deployment-and-operations.md) | 构建 / 部署 / 备份 / 监控 / 日志轮转 / 事故响应 |
| 08 | [技术 Q&A](./08-qa.md) | 评委 / 投资人 / 技术评审可能问到的 30+ 个问题的口径化回答 |

## 文档约定

- 所有 `路径:行号` 引用都是当前仓库真实可定位的位置，下次代码改后可与 git blame 配合定位。
- 「已删除」「已塌缩」「已废弃」等说法对应代码注释里的 de-RAG 时间线（2026-09-11 之后）；老的 LangGraph / FAISS 痕迹只在事故 / 历史段出现。
- 「现行」「当前生产」指 aliyun-sz 阿里云深圳（`203.0.113.10`）。中段曾短暂运行在 lighthouse（`198.51.100.20`），对应旧文件保留为历史参考。
- 本文档不覆盖 de-RAG spec 全文与 judge review 逐条批注；这些在 attrax 仓的 `docs/plans/2026-09-11-*.md` 与 `docs/plans/2026-09-14-*.md`。

## 仓库快照

- 顶层：代码仓库根目录
- 前端：Next.js 16.2.6 + React 19 + TypeScript（`app/`、`components/`、`lib/`）
- 后端：FastAPI 0.115.6 + Python 3.10+（`rag_service/`）
- 生产运行时数据目录：`data/backend/`（gitignore，含 `sessions/`、`jobs/`、`uploads/`）
- 法规语料：`data/regulations/{region}/*.yaml`（44 篇）
- KB 锚点：`data/kb/anchors/*.yaml`（44 个 YAML，spec §7.1）
- 监控源注册表：`data/regulation_sources/official_sources.json`（35 项）
- 监管补充包（含 watchdog 原始拉取的 RDF / HTML / PDF，不入库）：`data/regulation_supplements/`