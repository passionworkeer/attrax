# 火鹰合规 · 项目状态快照

> 最后更新：2026-09-14（重写）
> 范围：前端 / RAG 后端 / 数据层 / 部署配置
> 阅读建议：本页只写当下真值。历史快照（2026-06 / 2026-07 等）见 `HARDENING-SUMMARY.md`、`SERVER-VERSION.md` 与 `CHANGELOG.md`。

---

## 一、当前架构（1 段）

KB 锚定生成（knowledge-anchored generation）：用户上传图片 → Next.js BFF `POST /api/scan` → FastAPI `POST /api/v1/scans` 走线性 3 步管线 **vision → generate → verify**（LangGraph 编排壳已按 `2026-09-11-de-rag-evidence-spec.md §7.7` 塌缩移除）。锚点来自三段：① `data/kb/anchors/*.yaml` 经 `rag_service/retrieval/kb_loader.py` 加载（**真值源**）；② `rag_service/retrieval/must_check.py` 的 `CATEGORY_REGULATIONS` / `FEATURE_REGULATIONS` 自 2026-09-11 起是 KB YAML 的计算 shim（顶部 `"""Deprecated as of 2026-09-11**` 标注），仅保留 `detect_features` / `build_anchor_list` 入口；③ `rag_service/retrieval/article_loader.py`（`data/regulations/` 44 篇法规原文 + summary）。验证层：`verify/applicability.py`（三态 ProductFacts）+ `verify/quote_matcher.py`（每条 citation 字面匹配，match_status）+ `verify/grounding.py`（grounding verifier）+ `verify/vision_cache.py`（sha256 LRU）。报告导出：PDF/DOCX 走客户端 `lib/report-export-modules/`（jsPDF + Packer），md/csv 走 `GET /api/report/[sessionId]/[reportType]`。Embedding：**无**——embedding 栈（PAI/ModelScope）已随 de-RAG §7.7 整体删除。

## 二、模块完成度

| 模块 | 状态 | 备注 |
|------|------|------|
| 前端 Next.js 16.2.6 + React 19.2.4 | ✅ 完成 | 详见 `CLAUDE.md` 目录树 |
| BFF API（v1 canonical） | ✅ 完成 | `/api/scan` + `/api/scan/[sessionId]/{asset,evidence,revisions}` + `/api/report/[sessionId]/[reportType]`（md/csv） + `/api/regulations/*` + `/api/health`（`app/api/backend-session-access.ts` 是 helper 模块非路由） |
| FastAPI v1 端点 | ✅ 完成 | `/api/v1/scans/{evidence,revisions}` + `/api/v1/regulations/{doc_id}` |
| 知识库锚定三件套 | ✅ 完成 | must_check / kb_loader / article_loader |
| 验证四件套 | ✅ 完成 | applicability / grounding / quote_matcher / vision_cache |
| 视觉检查（inspection_profiles 11 个 yaml） | ✅ 完成 | Batch A–E 2026-09-13 |
| 引用契约（source / literal / semantic） | ✅ 完成 | J04 2026-09-14 |
| 证据/重扫循环（POST .../evidence + .../revisions） | ✅ 完成 | J10 2026-09-14 |
| 利润独立页面 + PDF/DOCX 客户端导出 | ✅ 完成 | `app/profit/[sessionId]` + `lib/report-export-modules/profit-{pdf,docx}` |
| Demo 模式 + DegradedBanner 接入 | ✅ 完成 | 真实路径降级显式 `degradedReason` |
| 10 品类 × 16 市场覆盖 | ✅ 完成 | electronics / toy / battery / textile / cosmetic / food_contact / appliance / 3c / home / other（**单数**）；EU/US/UK/CN/AU/SA/AE/JP/KR/CA/SG/MX/BR/DE/FR/IT |
| 评测（grounding eval） | ✅ 完成 | `scripts/eval_grounding.py` + `docs/annotation/grounding-eval.md` |
| watch-dog 法规自动入库 | ✅ 完成 | `scripts/watchdog/` + `docs/WATCHDOG.md`（默认 AUTO_INGEST=true） |
| i18n（zh/en） | ✅ 完成 | `lib/i18n.tsx` + `lib/i18n/translations.ts`，locale 由 `BlazeLocaleProvider` 统一提供 |
| 部署（lighthouse git-bundle + tar） | ✅ 完成 | `docs/README.md §生产部署` + `docs/infra/NEXTJS-16-STANDALONE-NOTES.md` |
| 死代码扫描（3 subagent 对抗） | ✅ 完成 | 2026-09-14 第二轮（本次 commit）：-5962 LOC / +231 LOC |

## 三、关键约定与端口

- **开发**：`http://localhost:3000`（前端） / `http://localhost:8001`（FastAPI）。docker-compose 映射为 loopback-only `127.0.0.1:${RAG_PORT:-8001}:8000`。
- **生产**：腾讯云首尔 lighthouse `43.155.141.192`，pm2 跑 `nextjs` + `rag-service` + `regwatch`，nginx 反代，**不走 docker-compose / Ansible**（`docs/infra/` 下的 Ansible 文件是历史 aliyun-sz 时代遗留）。
- **环境变量**（前端）：`MINIMAX_API_KEY` / `MINIMAX_BASE_URL` / `MINIMAX_MODEL` / `RAG_SERVICE_URL` / `DEMO_MODE` / `ATTRAX_BUILD_SHA`（`PAI_API_KEY` / `DAILY_FREE_SCAN_LIMIT` 无代码读取）。详见 `CLAUDE.md` §环境变量清单。
- **RAG 服务鉴权**：`RAG_INTERNAL_SECRET`（BFF ↔ RAG 内部认证，fail-closed：prod 空 secret 拒绝启动）。

## 四、当前已知限制（`CLAUDE.md` §已知限制 同源）

| 限制 | 说明 |
|------|------|
| 无持久化 | RAG 会话存文件 TTL 默认 24h（`data/backend/sessions/`），无数据库 |
| 无用户系统 | 无登录/注册/权限控制（会话级 accessToken 校验有） |
| requirements 快照 | 生产用 `requirements-prod.txt`；原 `requirements.txt`（500+ 条）已改名 `requirements-snapshot.txt` 并标注勿安装 |
| 报告语言 | 正文以中文为主；`?lang=en` 导出有框架字段英文回退，LLM 正文仍中文 |
| rag-service 单 worker | uvicorn `--workers 1`，扫描经 ThreadPoolExecutor（默认 5 并发）；`max_memory_restart: 1300M`；LLM 慢时 worker 被占（280s 兜底超时） |

## 五、当下优化方向

- `docs/plans/2026-09-14-judge-review-and-optimization-plan.md` 冻结 11 节 J01–J11，本日 Batch A/A1/B1/C2 已落地；剩余 J03 / J08 待办。
- `docs/plans/2026-09-11-de-rag-evidence-spec.md` 第七章（去 RAG 塌缩路线）：第 7.7 节 LangGraph 塌缩已完成；剩余 7.1 KB 抽取 / 7.5 法规原文 chunk 重构 / 7.6 embedding fallback 论证 仍未实施。

## 六、文档诚实性记录（2026-09-14）

本次重写同步删除了 4 份仅适用已退役阿里云深圳 `120.77.36.107` 的部署文档（`DEPLOYMENT.md` / `RECOVERY.md` / `E2E-REPORT-20260718.md` / `DEPLOY-CHECKLIST.md`）。attrax 当前生产已迁至腾讯云首尔 lighthouse 一段时间，但本份项目状态报告未跟随更新；之前的 3 个月累计偏差包括：LangGraph 编排、FAISS 索引、cohere embed、trace/roadmap 孤儿页、ProfitReportView 独立组件、`lib/pipeline/scan-queue.ts` 任务队列、ModelScope API、MIMOTALK 端点、`data/faiss/`、`data/scan-queue/` 等——本快照已统一移除。下次重大重写不晚于下一次架构变更后 7 天。

---

*最后更新：2026-09-14*
</content>
</invoke>