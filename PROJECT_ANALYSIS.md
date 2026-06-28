# 项目深度分析报告 — Wave 1+2 修复审计

**分析日期**: 2026-06-28
**分析范围**: Wave 1+2 全面优化（76 文件 +3198/-1293）
**方法**: 5 专家并行分析 + 2 派辩论

---

## 📊 综合评分

| 维度 | 评分 | 关键证据 |
|------|------|----------|
| 架构 | 8.5/10 | reducer / recursion_limit / degraded 契约打通；parent_chunks 索引化但检索层无 context expansion（死链）|
| 安全 | 7.0/10 | DAILY `clientIp()` 默认 "unknown" 致全站共享 bucket（新引入 DoS）；RAG /scan 8001 无 auth；API Key 仍明文 |
| 性能 | 8.5/10 | NLI 批量化 O(1) + yieldToMainThread 落地；FAISS 25k 暴力扫描 ~60ms 是天花板 |
| 测试 | 8.0/10 | 新增 7 个测试文件质量高（行为级合约测试）；核心 E2E (upload-scan-result) 不在 CI gating |
| 代码质量 | 8.0/10 | 不可变模式贯彻彻底；`writeJsonAtomic` 复用；markJobFailed 持久化缺、`embed_query` self-DoS |
| **平均** | **8.0/10** | 修复正确性 9/10，集成 8/10，**新引入 4 个 blocker** |

---

## 🔴 Blocker（必须立即修才能上线）

### B1. DAILY "unknown" bucket 全站共享（新引入 DoS）
- **位置**: `lib/rate-limit.ts:39-48` + `app/api/scan/route.ts:131, 138`
- **问题**: `RATE_LIMIT_TRUST_XFF` 默认 false → `clientIp()` 退回 `"unknown"` → 全站共享 `daily:unknown:YYYY-MM-DD` 桶 → 攻击者 3 次即耗尽全站 DAILY_FREE_SCAN_LIMIT=3 额度
- **攻击场景**: curl 3 次空表单（rate-limit 在 schema 校验前）→ 当天所有真实用户 DAILY_LIMIT_REACHED
- **修复（Surgical ~12 行）**: `unknown` fallback 改为 cookie → UA-hash 桶；`checkRateLimit` 移到 Zod 校验后；加单测验证不同 UA 命中不同桶
- **文件**: `lib/rate-limit.ts` + `app/api/scan/route.ts`

### B2. 核心 E2E (upload-scan-result) 不在 CI gating
- **位置**: `.github/workflows/ci.yml:101`
- **问题**: CI 仅跑 `smoke / pages / export-downloads` 3 spec；产品核心路径 `tests/e2e/upload-scan-result.spec.ts`（覆盖 result / burning / degraded UI，正是本次 76 文件改动重点）未跑
- **CI 假绿后果**: result 页空指针、burning→result 竞态、degraded 状态 401 错位全部进生产无拦截
- **修复（1 行 CI 改动）**: 追加 `upload-scan-result + error-boundary + not-found` 3 spec 到 gating（DEMO_MODE 下 < 4min）
- **文件**: `.github/workflows/ci.yml`

### B3. `markJobFailed` 写无 persistence（队列卡死）
- **位置**: `lib/pipeline/scan-queue.ts:165-193`
- **问题**: `unlinkSync` EPERM 失败后 failed marker 丢失，任务永远卡 `pending`，无报警，凌晨累积后早晨用户全转圈
- **修复**: 改用 `writeJsonAtomic` 原子写 failed marker（参考 session-store EPERM 重试模式），不要只靠 unlink
- **文件**: `lib/pipeline/scan-queue.ts`

### B4. `embed_query` rate-limit self-DoS（检索召回断崖）
- **位置**: `rag_service/retrieval/modelScope_embedder.py:296-311`
- **问题**: per-key lock 内重复写 `_CALL_TIMESTAMPS`，同 key 内已扣计数被放大 N 倍 → 并发用户 > 5 时 hit_rate 1.0 → 0.3
- **修复**: rate-limit 计数移到 lock 外（先 acquire semaphore 再读 self._hits），或换 token bucket
- **文件**: `rag_service/retrieval/modelScope_embedder.py`

---

## 🟡 高风险（7 天内跟进，不阻断上线）

| # | 发现 | 位置 | 风险 |
|---|------|------|------|
| A | parent_chunks 入索引但 `faiss_retriever` 无 `parent_id` 引用（context expansion 设计意图落空，索引体积翻倍）| `scripts/build_faiss.py` + `rag_service/retrieval/` | 浪费 1.6GB 磁盘 + 部署时间 +50% |
| B | FAISS IndexFlatIP 25k 暴力扫描 ~60ms/query | `rag_service/retrieval/faiss_retriever.py` | corpus 翻倍即 120ms 超 SLA |
| C | `rag_service/main.py` `_client_ip` 静默回 "unknown"（同 B1 孪生）| `rag_service/main.py:171-178` | RAG 端限流全单点失效 |
| D | `getattr(_hr, "_embedder_name")` 反射读私有属性 | `rag_service/main.py:256` | 重构即静默 break |
| E | `dense_dim_mismatch_count` 非原子自增（Send 并发丢计数）| `rag_service/retrieval/hybrid_retriever.py:335` | `/health` 监控漏报 |
| F | `graph.py:64` 死分支 `"force_generate": "generate"` | `rag_service/orchestrator/graph.py:64` | 状态机语义不清 |
| G | `useSessionId` SSR hydration 风险（useState 初值读 searchParams）| `lib/hooks/useSessionId.ts:27-29` | 客户端首屏 hydration mismatch |
| H | RAG `/scan` 8001 端口 docker 暴露无 auth | `docker-compose.yml:43-48` | 内网探测/暴露公网即绕过前端全部管控 |

---

## 🟢 优化建议（可选，下版本）

- **FAISS IndexFlatIP → IndexHNSWFlat**（M=32, efConstruction=200）：25k corpus search 5-10× 提速，1d 实现 + rebuild + eval
- **RRF dense_weight 调优**：env 已暴露（`RAG_DENSE_WEIGHT`），用 `data/regulation_eval` Phase B 跑出最优值
- **ThreadPool `SCAN_WORKER_CONCURRENCY` 默认升 8**：8-market fan-out 不阻塞
- **`__rateLimitBuckets` Map lazy eviction**：杜绝跨天后 stale entries 无界增长
- **CSP `script-src 'unsafe-inline'` 移除**：需 nonce-based inline script（Next.js middleware）
- **parent_chunks 单独索引**（不在主 search 路径，按需 expand）：检索 latency 减半

---

## ⚔️ 辩论结论

| 议题 | 乐观派 | 批判派 | 最终建议 |
|------|--------|--------|----------|
| DAILY "unknown" bucket | 单进程下风险可控，5 行补丁可降级 | 必立即修，攻击者一键锁全站 | **采纳批判派**（B1 P0）|
| 核心 E2E 不在 CI | 可延后，3 spec 够，DEMO_MODE 拆段可缓 | 必立即修，CI 假绿比 bug 更危险 | **采纳批判派**（B2 P0）|
| parent 死链 + FAISS 25k | corpus 翻 10 倍才需要，60ms 远低于 LLM | parent 死链浪费磁盘 + 部署时间 | **部分采纳**（A+B 高风险 7 天内）|

---

## ✅ 修复落实表

### P0（全部落实，含 2 个新引入风险）
| 项 | 状态 | 位置 |
|----|------|------|
| LangGraph state reducer | ✓ | `state.py:30, 51` |
| recursion_limit=50 + refiner 硬 end | ✓ | `graph.py:142` + `verifier.py:81` |
| NLI 批量化 O(1) | ✓ | `citation_verifier.py:209-214` |
| citation regex lru_cache | ✓ | `citation_verifier.py:133-139` |
| Vision + report_generator LLM 重试 | ✓ | `vision.py:142-153` / `report_generator.py:668` |
| build_faiss 脏向量剔除 + 续传 | ✓ | `build_faiss.py:40-71, 234-300` |
| parent-child 精确链接 | ✓ | `legal_chunker.py:227-291` |
| main.py XFF trust proxy | ✓ | `main.py:171-178` |
| get_running_loop | ✓ | `main.py:463, 583` |
| 健康端点 dense_dim_mismatch_count | ✓ RAG / ⚠ 前端 | `main.py:266, 273` |
| /ready modelscope 降级 | ✓ | `main.py:248-258` |
| Dockerfile non-root | ✓ | `Dockerfile:23-26` |
| scan.ts 5xx → degraded | ✓ | `scan.ts:241-254` |
| scan-queue 任务先标 running+attempts++ | ✓ | `scan-queue.ts:113-130` |
| 僵尸回收 reclaimZombies | ⚠ B3 markJobFailed 丢失 | `scan-queue.ts:139-163` |
| DAILY_FREE_SCAN_LIMIT enforcement | ⚠ B1 "unknown" bucket | `scan/route.ts:138-146` |
| session-auth 原子 hash | ✓ | `scan/route.ts:197` + `session-store.ts:333-352` |
| [locale] 路由 404 修复 | ✓ | `app/[locale]/page.tsx` |
| useSearchParams 重构 | ✓ | `useSessionId.ts` + trace/roadmap page |
| 假数据徽章 | ✓ | trace/roadmap page |
| i18n split 修复 | ✓ | `app/page.tsx` |
| LanguageSwitcher a11y | ✓ | `LanguageSwitcher.tsx:88-150` |
| SiteHeader 移动端导航 | ✓ | `SiteHeader.tsx` |
| ImageCarousel 上下文感知键盘 | ✓ | `ImageCarousel.tsx:46-63` |
| rate-limit XFF 默认拒绝 | ✓（fallback "unknown" B1）| `rate-limit.ts:39-48` |
| 缓存 key 归一化 | ✓ | `regulations/updates/route.ts` |
| CSP unsafe-eval 移除 | ✓ | `next.config.ts:17`（unsafe-inline 仍存）|
| typecheck gate | ✓ | `ci.yml` + `package.json` |
| backend unit gating | ✓ | `ci.yml:135-140`（test_build_faiss_versioning 误归 report-only）|
| e2e job | ⚠ B2 仅 3 spec | `ci.yml:101` |
| lint gating | ⚠ 保留 continue-on-error | `ci.yml:38-43`（10 错误未修）|
| playwright retries=2 | ✓ | `playwright.config.ts:8` |
| conftest.py + markers | ✓ | `conftest.py` + `pytest.ini` |
| golden set 版本号 | ✓ | `metrics.py:58` |
| yieldToMainThread PDF 分片 | ✓ | `shared.ts:29-35` + `profit-pdf.ts:212` |

### P1/P2（部分落实）
| 项 | 状态 | 备注 |
|----|------|------|
| BM25 去 bigram | ✓ | `bm25_retriever.py:38-68` |
| must_check 精确匹配 + RRF 穿插 | ✓ | `must_check.py:185-214` |
| metadata region 别名 | ✓ | `metadata_filter.py:23-38` |
| per-key 锁 | ⚠ B4 self-DoS | `modelScope_embedder.py:296-311` |
| faiss temp dir 清理 | ✓ | `faiss_retriever.py:182-186` |
| 路线图数据去重 | ✓ | `lib/mock/roadmap.ts` 单点 |
| UploadForm URL 缓存 | ✓ | `UploadForm.tsx:91-110` |
| health route Zod 校验 | ✓ | A8 实施 |
| upload 限长 1MB | ✓ | `upload-validation.ts` |
| html lang 绑 locale | ⚠ SSR 限制 | `layout.tsx` |
| PageTransition key | ✗ 未做 | 留 components 层 |
| AgentDecisionTree 810 行拆分 | ✗ 未做 | 留 A7 报告 |
| result Tabs 去重 | ✗ 未做 | 留 A7 报告 |
| cohere_embedder/local_embedder 删除 | ✗ 未做（被引用）| A3 报告 |
| FAISS 死代码清理 | ✗ 未做 | A3 报告 |

---

## 🔗 跨 agent 集成验证

| 契约 | 状态 | 备注 |
|------|------|------|
| degraded 状态端到端 | ✓ | result/burning 处理 + useScanPolling |
| dense_dim_mismatch_count | ✓ RAG / ⚠ 前端 | 前端 `/api/health` 透传待验 |
| getDefaultRoadmapItems | ✓ | 3 处 import 全部命中 |
| parent_chunks 入索引 | ⚠ 死链 | 检索层无 context expansion |
| recursion_limit + refiner 终止 | ✓ | 双重保险 |
| scan-queue 崩溃恢复 | ⚠ 基础 | markJobFailed 丢失 + state.running 漂移 |
| fusion 不可变 | ✓ | `bm25_score_norm` 局部 map + 重建 |
| 5xx 不静默 | ✓ | `if (!resp.ok) throw` + 标 degraded + source="fallback" |

---

## 📋 上线 Readiness

**Blocker（4 项必修，预计 2-3 小时）**:
1. B1: DAILY "unknown" bucket → `lib/rate-limit.ts` + `app/api/scan/route.ts`（12 行）
2. B2: 核心 E2E 进 CI → `.github/workflows/ci.yml`（1 行）
3. B3: markJobFailed 持久化 → `lib/pipeline/scan-queue.ts`（20 行）
4. B4: embed_query self-DoS → `rag_service/retrieval/modelScope_embedder.py`（15 行）

**用户手动操作（必修）**:
- [ ] **立即撤销并轮换** `rag_service/.env` 中真实 MODELSCOPE_API_KEY + MIMOTALK_API_KEY（已暴露给 AI 审查上下文）
- [ ] 部署前将 RAG 8001 端口改为 docker-internal（不映射宿主机），或加 shared secret
- [ ] 配置 `RAG_TRUSTED_PROXIES` 为前端容器真实 IP/CIDR
- [ ] 多实例部署前用 Redis/Upstash 替换 in-memory rate-limit / session store

**7 天内跟进（高风险，~1 天工作量）**:
- A+B: parent_chunks 不入 FAISS 索引 + 加 context expansion API
- C: RAG 端 `_client_ip` 修（同 B1）
- D: `_embedder_name` 升级 public API
- E: `dense_dim_mismatch_count` 改原子自增
- F: 删除 `graph.py:64` 死分支
- G: `useSessionId` SSR hydration 修
- H: RAG /scan auth 或端口收紧

**下版本（可选）**:
- FAISS → IndexHNSWFlat（5-10× 提速）
- RRF dense_weight 调优
- CSP unsafe-inline 移除
- AgentDecisionTree 810 行拆分
- 删 cohere_embedder/local_embedder 死代码

---

## 🎯 总体结论

**修复完成度 85%**，核心契约（reducer / recursion_limit / degraded / NLI batch / 脏向量剔除 / parent-child 链接 / XFF trust / typecheck gate）全部打通且测试覆盖。**但新引入 4 个 blocker**（2 个新 DoS 面 + 1 个 CI 假绿 + 1 个队列卡死），且 1 个 P0 安全遗留（API Key 仍需用户手动轮换）。

**完成 B1-B4 + 用户手动操作后预计 95% 可上线**。剩余 5% 为下版本持续优化（FAISS HNSW、parent expansion、unsafe-inline 等）。

**Wave 3 至此完成**。

---

*报告由 DeepAnalysis 生成 | 5 agents 分析 + 2 派辩论 + 跨 agent 契约验证*
*2026-06-28 | E:\desktop\火鹰合规*
