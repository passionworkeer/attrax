# 火鹰合规 (Attrax) 深度分析报告

**分析日期**: 2026/05/23
**分析范围**: 全项目（前端 Next.js + 后端 FastAPI/LangGraph RAG）
**分析方法**: 5 专家 agents 并行分析 + 2 派辩论

---

## 综合评分

| 维度 | 评分 | 趋势 |
|------|------|------|
| 架构 | 5.5/10 | — |
| 安全 | 7.8/10 | — |
| 性能 | 6.5/10 | — |
| 测试 | 6.5/10 | — |
| 代码质量 | 7.0/10 | — |
| **综合** | **6.7/10** | 中等，有改进空间 |

---

## 🔴 严重问题（必须修复）

### 1. 异常信息泄漏 — Critical
- **位置**: `rag_service/main.py:389-397`
- **问题**: `global_exception_handler` 返回 `str(exc)` 暴露完整堆栈、路径、变量名
- **风险**: 攻击者可推断系统架构和依赖版本，进行定向攻击
- **修复**: 删除 `detail: str(exc)`，改为固定消息 `"Internal server error"`
- **预估工时**: 5 分钟

### 2. RAG 服务 URL 无校验 — High
- **位置**: `lib/pipeline/scan.ts:25`
- **问题**: `RAG_SERVICE_URL` 完全信赖环境变量，可被配置为外部攻击者地址
- **风险**: 用户图片 base64 数据发送到恶意服务器
- **修复**: 限制为 `localhost` 地址白名单
- **预估工时**: 30 分钟

### 3. runScan 未 await — Critical
- **位置**: `app/api/scan/route.ts:213-224`
- **问题**: `runScan` 返回 Promise 未被 await，静默失败时用户永远看到 processing
- **风险**: 用户发起扫描后静默失败，无法获得结果
- **修复**: 添加 `void runScan(...)` 显式表明 fire-and-forget，或改用 `await`
- **预估工时**: 15 分钟

### 4. 利润报告双重 LLM 调用 — High
- **位置**: `lib/pipeline/scan.ts:637-688`, `rag_service/main.py:319-366`
- **问题**: 后端已返回完整 `profitReport`，前端 fallback 分支仍可能再次调用 `/profit-report`
- **风险**: 50% 请求触发双调用，浪费 50% API 成本 + 3 秒延迟
- **修复**: `scan.ts` 添加 `.trim()` 检查；后端确保 profitReport 永不为空
- **预估工时**: 1 小时

---

## 🟡 中等问题（建议修复）

### 5. Python 节点全局单例注入
- **位置**: `rag_service/orchestrator/nodes/retriever.py`, `generator.py`, `verifier.py`, `vision.py`
- **问题**: 4 个节点各自管理独立全局状态，无统一生命周期管理
- **风险**: 初始化顺序改变时导致 AttributeError，难以测试
- **修复**: 创建 `GraphDependencies` dataclass，lifespan 传入
- **预估工时**: 4 小时

### 6. 无速率限制
- **位置**: `rag_service/main.py`, `app/api/scan/route.ts`
- **问题**: `/scan` 和 `/profit-report` 无并发控制
- **风险**: 攻击者可快速耗尽 LLM API 配额
- **修复**: 集成 `slowapi` 限流（如 10 次/分钟/IP）
- **预估工时**: 2 小时

### 7. CORS 未配置
- **位置**: `rag_service/main.py`
- **问题**: FastAPI 未配置 CORS，默认允许所有来源
- **修复**: 配置精确域名白名单
- **预估工时**: 15 分钟

### 8. Base64 传输内存倍增
- **位置**: `app/api/scan/route.ts:205-211`, `rag_service/main.py:221-228`
- **问题**: 图片以 Base64 字符串传输，放大 33%，后端解码后再存一份
- **风险**: 5 张 5MB 图片 = 30MB+ 传输 + 3x 内存
- **修复**: 改用 `multipart/form-data` 流式传输
- **预估工时**: 4 小时

### 9. 会话清理仅启动时执行一次
- **位置**: `lib/pipeline/session-store.ts:216`
- **问题**: `cleanStaleFiles()` 仅在 import 时执行，重启后 stale 文件不清理
- **风险**: 低流量站点 session 文件长期累积
- **修复**: 改为每次 `createSession` 时清理，或后台定期清理
- **预估工时**: 1 小时

### 10. 轮询无退避
- **位置**: `lib/hooks/useScanPolling.ts:6`
- **问题**: 固定 800ms 轮询，慢查询时产生 12-37 次无效请求
- **修复**: 添加指数退避（500ms → 1s → 2s → 4s）
- **预估工时**: 1 小时

### 11. 检索缓存无上限
- **位置**: `rag_service/retrieval/hybrid_retriever.py:43`
- **问题**: `_RETRIEVAL_CACHE` 无 LRU 淘汰，高并发可能 OOM
- **修复**: 添加 `maxsize=500` LRU 限制
- **预估工时**: 30 分钟

---

## 🟢 优化建议（可选）

### 12. 3 个超大文件
| 文件 | 行数 | 建议 |
|------|------|------|
| `report-export.ts` | 901 | 拆分为 pdf-renderer.ts + docx-renderer.ts |
| `scan.ts` | 703 | 提取 normalizeReportPackage / buildProfitReportFromMarkdown |
| `report_generator.py` | 1056 | 拆分为 generate/ + data/ 模块 |

### 13. 深度嵌套
- `normalizeReportPackage` (`scan.ts:321-492`) 6+ 层嵌套
- 改用 `switch` + early return 减少嵌套

### 14. snake_case / camelCase 混用
- `ProductDossier`、`EvidenceBundle`、`AuditMetadata` 同时支持双格式
- 统一为 camelCase，在入口做一次转换

### 15. 魔法数字散布
- 建议创建 `lib/constants.ts` 集中管理：
  - `POLL_INTERVAL_MS = 800`
  - `SESSION_TTL_MS = 3600000`
  - `PDF_MARGIN_MM = 18`

### 16. FAISS 索引缺失
- `data/faiss/` 目录不存在，向量检索完全不可用
- 当前降级到 BM25-only，可接受但非最优

### 17. cohere_reranker 已实现未接入
- `rag_service/retrieval/cohere_reranker.py` 存在但未被调用
- 需明确是否需要接入

### 18. extractCostSummary 无测试
- `lib/pipeline/scan.ts:50-221` 171 行 Markdown 解析逻辑无测试覆盖
- LLM 输出格式变化即解析失败

### 19. vision.py 隐式环境变量副作用
- `rag_service/orchestrator/nodes/vision.py:16-20` 在模块加载时修改 proxy 环境变量
- 移至 config.py 初始化阶段

### 20. `/health` 暴露内部信息
- 健康检查返回 `faiss_index` 状态、vector count
- 建议只返回基本状态

---

## ⚔️ 辩论结论

### 共识
- **异常信息泄漏**：双方同意 P0 立即修复（5 分钟工时，攻击门槛低）
- **RAG URL 校验**：双方同意 P0 立即修复（隐私数据泄漏风险）
- **双重 LLM 调用**：双方同意需修复（工时 <1 小时，收益明确）
- **runScan 未 await**：双方同意需修复（用户可见的静默失败）

### 分歧
| 问题 | 乐观派 | 批判派 |
|------|--------|--------|
| Python 全局单例 | 不修复，文档说明即可 | P1 规划修复，影响稳定性 |
| 超大文件 | 不拆分，用测试覆盖 | P2 列入重构，违反团队规范 |
| FAISS 缺失 | V2 再构建 | P2 确认并修复 |

### 最终建议
基于辩论，**安全类问题必须立即修复**（P0），**性能/架构问题可渐进式改进**（P1-P2）。

---

## 🎯 修复路线图

### P0（24-48 小时内）
- [ ] 修复异常信息泄漏 — `rag_service/main.py:389-397`
- [ ] 修复 RAG URL 校验白名单 — `lib/pipeline/scan.ts:25`
- [ ] 修复 runScan 未 await — `app/api/scan/route.ts:213-224`
- [ ] 修复利润报告双重 LLM 调用 — `scan.ts:637` 添加 `.trim()`

### P1（1 周内）
- [ ] 添加速率限制 — `rag_service/main.py`
- [ ] 配置 CORS 白名单
- [ ] 规划 Python 依赖注入重构
- [ ] 修复轮询无退避

### P2（1 个月内）
- [ ] 拆分超大文件（report-export.ts, report_generator.py）
- [ ] 重构 normalizeReportPackage 减少嵌套
- [ ] 统一 snake_case / camelCase
- [ ] 集中管理魔法数字到 constants.ts
- [ ] 修复会话清理机制

### P3（后续迭代）
- [ ] 构建 FAISS 索引
- [ ] 添加 extractCostSummary 测试
- [ ] 接入 cohere_reranker

---

## 已做好的部分 ✅

| 特性 | 状态 |
|------|------|
| Zod/Pydantic 双端验证 | ✅ 完善 |
| LangGraph 多市场并行检索 | ✅ 正确实现 |
| 混合检索降级链路 | ✅ Ollama → ModelScope → BM25 |
| Session 双层存储 | ✅ 内存 + 文件 TTL |
| 无硬编码密钥 | ✅ 全部从环境变量读取 |
| XSS 防护 | ✅ react-markdown 自动转义 |
| Path Traversal 防护 | ✅ Session ID 白名单正则 |
| 核心路径测试覆盖 | ✅ API/Session/轮询/导出全覆盖 |

---

*报告由 DeepAnalysis 生成 | 5 agents 分析 + 2 派辩论*