# A+B 混合架构 · 第二阶段规格（spec，未实施）

> **成文时间**: 2026-09-10 深夜
> **状态**: ⏸️ 规格冻结，等外部额度恢复后按 §7 执行顺序开发
> **前置**: 第一阶段已上线（commit `e4da8d5` + `6717b77` + `1bbda64`，均已 push）
> **本文档作用**: 把 2026-09-10 审查发现的全部遗留问题整理成可执行规格，供后续 session 直接开发，无需重新推导上下文

---

## 1. 当前状态快照（2026-09-10 EOD）

| 项 | 状态 |
|---|---|
| 生产部署 | ✅ 三站全绿；A+B 锚点代码运行中；10 品类上线 |
| FAISS 磁盘索引 | ⚠️ **仍是 6 月版（Qwen3 空间）**，与已切换的 PAI embedder 空间不兼容 |
| Dense 检索 | ⛔ 实质不可用（PAI 401 → 自动降级 BM25-only，目前无害，见 §2 地雷） |
| Embed 缓存 | `data/embed_cache.json` 2594 条（PAI v4 空间），续跑不重付 |
| 语料 | ✅ 355 文件 / 49MB / 30 市场已同步服务器（此前只有 135/17 市场） |
| 测试 | ✅ vitest 927 全绿；服务器 pytest 586（剩 1 个 golden-set 失败等索引重建后自然过） |
| **PAI embedding 额度** | ⛔ `401 Exceeded quota`（~2600 chunk 后耗尽）— **等用户充值/换 token** |
| **MiniMax LLM 额度** | ⛔ `429 Token Plan 上限` — **等用户升级/购买** — vision+generator 全 fallback |
| E2E 锚点验证 | ⏸️ 基础设施已证明（POST 202 / 轮询 / 5 节点 trace / fallback 包含 UN 38.3）；**LLM 路径待额度恢复** |

---

## 2. ⚠️ 额度恢复后的执行顺序地雷（最优先记住的一条）

**事实链**：embedder 代码已切 PAI `text-embedding-v4`；磁盘索引仍是 Qwen3-Embedding-0.6B 建的。
两个模型都是 1024 维 L2 归一化（几何兼容），但**向量空间不同**——拿 PAI query 向量查 Qwen3 索引
= 返回语义噪声，且会经 RRF 融合混进最终检索结果（不是报错，是静默变差）。

**当前无害的原因**：PAI 401 → 探测失败 → BM25-only 降级。

**正确顺序（不可颠倒）**：
1. PAI 充值/换 token（写 `rag_service/.env` 的 `MODELSCOPE_API_KEY`，服务器 + 本地两份）
2. 服务器跑完 FAISS 重建（见 §3 续跑命令；目标 ~14000+ chunks，额度预算要按此准备）
3. 验证 manifest 落盘 + golden-set 测试过
4. **最后** `pm2 delete rag-service && pm2 start rag-service` 放开 dense

**只充 MiniMax 不充 PAI 的场景**：安全。dense 维持 BM25-only 降级，LLM 路径可先验证。

---

## 3. Spec A：FAISS 重建续跑（等 PAI 额度）

**执行**（lighthouse 服务器，`/opt/attrax`）：
```bash
cd /opt/attrax
MODELSCOPE_HOURLY_LIMIT=5000 .venv/bin/python3 scripts/build_faiss.py \
  --output-dir data/faiss --version-label "pai-v4-355docs"
```
- 缓存 2594 条命中，从 2594/~14000 续跑（355 文档比原 135 多）
- ⚠️ PAI batch ≤10 硬限已适配（`modelScope_embedder.py` + `build_faiss.py`，batch=10，超限 400）
- 本地限速器 `MODELSCOPE_HOURLY_LIMIT` 默认 300 是**假阳性源**（进程内存滑窗，重启清零），跑批必带 5000
- 真额度信号是 `401 Exceeded quota`（区别于 QPS 429）

**验收**：
- [ ] `Done!` 日志 + `data/faiss/` 新 manifest（version_label `pai-v4-355docs`，schema v2 sealed）
- [ ] golden-set pytest 过（UK/AU/JP source_id 进索引）
- [ ] `pm2 delete && pm2 start rag-service`（**不是 restart**）
- [ ] 实测 `/scan` 引用覆盖率 > 0、`/api/health` ok
- [ ] 清理 `data/faiss.bak-modelscope-20260910/`（29MB，确认新索引稳定后）

---

## 4. Spec B：verifier 软标注（A+B 设计第 3 条，纯代码不花钱，**建议额度恢复前先做**）

### 4.1 问题（已核实的事实链，file:line 可查）

A+B 下报告以规则矩阵为主锚点，语料引用天然稀少，但现有验证链会把这种**合法状态**当成失败：

```
锚点报告（引用少）
  → citation_verifier.py:436-462   coverage 计算 → status="REJECTED"（阈值硬拒）
  → verifier.py:54-60              generation_score="not_supported"
  → verifier.py:98-105             should_regenerate: 生产无 NLI → 直接 "end"（✅ 不烧额度，无需修）
  → graph.py:153-158               final_status="REJECTED"
  → scans.py:539                   compliance_status="REJECTED"
  → scans.py:584-585               coverage<=0 → hard_reason "ZERO_CITATION_COVERAGE"
                                   → session status="degraded"（红横幅）
```

**两个用户可见的伤害**：
1. `ZERO_CITATION_COVERAGE` 把「矩阵为主、无语料引用」的合法报告打成 **degraded + 红横幅**
2. `complianceStatus="REJECTED"` 语义混淆：这是**报告质量判词**，前端/用户读成「产品不合规」（前端 `result-view-helpers.ts:25` 的 REJECTED 才是真正的产品合规判词，由 riskLevels 推导）

### 4.2 设计

**原则**：矩阵锚定 ≠ 无证据。锚点报告缺语料引用是**预期状态**，降级为 warning 披露，不进 hard_reasons。

1. **GraphState 加字段**：`anchor_regulations_count: int`（generator_node 目前只写进 trace entry，
   `generator.py:247-248`；需同时 return 进 state 供下游消费，不动 agent_trace add-only 红线）
2. **citation_verifier.py**：`verify_citations` 增加可选参数 `anchor_count: int = 0`；
   当 `anchor_count > 0` 且 REJECTED 的唯一原因是 coverage 低（无 contradicted）时，
   返回 `status="WARN"` + `verification_mode` 追加 `_matrix_anchored` 标记，而非 REJECTED
3. **scans.py `_normalize_result`**：`ZERO_CITATION_COVERAGE` 拆成两种——
   - `anchor_regulations_count > 0` → warning `MATRIX_ANCHORED_NO_CORPUS_CITATIONS`（软）
   - `anchor_regulations_count == 0` 且无引用 → 维持 hard reason（真裸奔，照旧 degraded）
4. **complianceStatus 解耦**：report 质量判词不再直接映射 complianceStatus。
   有 report_package 时以包内风险等级为准（前端本来就用 topRank 推导展示）；
   无包时 UNKNOWN 而非 REJECTED。`citationVerification` 结构已有 mode/strength，够用
5. **trace 透明**：verifier trace entry 加 `anchor_count` 字段，审计可查

### 4.3 验收

- [ ] pytest：新增用例——`anchor_count>0 + coverage=0` → WARN + warning 非 hard reason；
      `anchor_count=0 + coverage=0` → 仍 REJECTED + degraded（防回退到「假可信」老问题 P0-2）
- [ ] E2E（MiniMax 恢复后）：battery 扫描 ready（非 degraded）、complianceStatus 不再因引用缺失出 REJECTED
- [ ] 前端 DegradedBanner 不再因锚点报告出现；warning 区可见 `MATRIX_ANCHORED_*` 披露

### 4.4 明确不做

- 不引入 NLI 模型（2026-09-10 审查结论：不投入）
- 不做覆盖率硬约束（同上）
- refine 循环不改（生产无 NLI 已跳过，`verifier.py:98-105` 有注释说明）

---

## 5. Spec C：配额/健康监控（今天的元问题）

**问题**：embedding 静默降级 3 个月无人察觉；今日双额度全死 `/api/health` 依然全绿（只测可达，不测鉴权/额度）。

**最低成本方案（cron + 现有通道）**：
1. lighthouse 加 cron（每 30min）：`grep -E '401|429' /root/.pm2/logs/rag-service-out.log` 近 30min 计数
   超阈值 → 写 `data/alerts/quota_alert.json`（去抖：同类 2h 内只记一次）
2. `/health` 增强（可选，P2）：加 `quota_suspect: bool` 字段由上述文件派生——保持无鉴权安全边界不变
3. 每日 1 次合成扫描（可选，花 ~1 次 LLM 额度）：真实跑通 POST /api/scan → 检查 status != degraded

**验收**：人为停 key → 30min 内 alert 落盘；恢复后自动清除。

**不做**：Prometheus/Grafana/OTel 全家桶（用户单人运维，过重；`/metrics` 留长期项）。

---

## 6. Spec D：语料新鲜度管道（A+B 的 B 部分核心）

**问题**：355 文件只解决「量」；无任何更新机制，法规领域静态索引必然过期
（EU 2023/1542 替代 2006/66/EC 这类事件抓不到）。

**优先级排序**（按对报告质量杠杆）：

### D1. EU Safety Gate 召回数据（优先级 1，喂 riskPoints 真数据）
- 源：`https://ec.europa.eu/safety-gate-alerts/api/web/feed`（JSON，无需 key，公开）
- 价值：每周真实召回案例 → `riskPoints` 场景从 mock/泛化变成「本周 EU 真实召回的品类+原因」
- 实现：`rag_service/regulation_collectors/safety_gate_collector.py`
  （仿现有 `base.py` 模式）→ 输出 `data/regulation_supplements/safety_gate_YYYYMMDD/`
- 字段映射：`productCategory` → attrax 品类、`riskType` → 风险文案、`countryOfOrigin` → 溯源提示

### D2. AU 联邦登记（优先级 2）
- must_check 矩阵引用 AU 法规（ACMA RCM 等）但语料→索引链路缺 AU 源
- 源：`https://www.legislation.gov.au` open data（Federated Register of Legislation）

### D3. 周更 cron（优先级 3）
- `collect → diff（scripts/diff_regulation_manifests.py 已有）→ ingest（ingest_regulation_supplements.py 已有）→ 重建 → pm2 delete&&start`
- 周日 04:00 lighthouse cron；重建走 §3 命令（embed 缓存保证增量便宜）
- ⚠️ 依赖 PAI 额度模型确定（按量付费 or 包月，决定 cron 频率）

### D4. web_search 工具（设计 B 完整体，优先级 4）
- LangGraph 加 `web_search` 节点：`query_planner` 产出时效性查询（如「锂电池航空运输 最新法规 2026」）
- **需新供应商 key**（Tavily/Brave/SerpAPI）——注意 2026-09-10 key 管理三教训：
  ① 不进 git ② ecosystem 与 .env 同步改 ③ pm2 delete&&start
- 结果进 `freshness_notes` 字段（软披露：「以下为网络检索，未经原文核验」），不混入引用证据

**验收**（D1）：跑一次 collector → ≥1 个真实召回进 supplements → 增量重建 → E2E 报告 riskPoints 出现真实案例。

---

## 7. 执行顺序总表（依赖关系）

```
现在就能做（不花钱，纯代码）：
  ① Spec B verifier 软标注     ← 强烈建议额度恢复前完成，见 §4.1 伤害链
  ② Spec E 见 §8（ALLOWED_CATEGORIES 回归测试）
  ③ D1 collector 开发+本地测试（不部署 cron）

等 PAI 额度：
  ④ Spec A FAISS 重建续跑（§2 顺序！先重建后重启）
     → golden-set 过 → pm2 delete&&start

等 MiniMax 额度：
  ⑤ 完整 E2E 锚点验证（battery 场景，验证 ①④ 的效果）

都恢复后：
  ⑥ Spec C 监控 cron 上服务器
  ⑦ D3 周更 cron（依赖额度模型确定）
  ⑧ D4 web_search（依赖新 key）
```

---

## 8. 小债清单（低优先级，见缝插针）

| 债 | 说明 | 触发条件 |
|---|---|---|
| `ALLOWED_CATEGORIES` 无回归测试 | `tests/unit/api-scan-post-full.test.ts` 不覆盖新品类；品类三处同步（types.ts / route.ts / must_check.py）目前只靠纪律 + 手动 E2E（2026-09-10 实际踩中） | 下次改品类前必补 |
| agent_trace 指数增长 | Send() fan-out × refine 乘法复制；默认 max_attempts=2 安全，配置不当会 OOM | 加并发/改 attempts 前 |
| 单 worker 串行 + 内存 | 语料 26→49MB 后 BM25 构建内存更高，`max_memory_restart:1300M` 余量缩小 | 重建后观察一次 RSS |
| 外部依赖全单点 | MiniMax（LLM）/ PAI（embedding）无备胎；D4 又引入第三个 key | 任意一家再挂时评估 |
| 会话 1h TTL / 无用户系统 / 报告仅中文 | 产品层已知限制 | 商业化前 |
| 服务器 venv 装了 pytest | 偏离 requirements-prod 最小安装（为跑 586 测试），已接受 | 下次重装 venv 时决定去留 |

## 9. 运维日历（非 attrax）

- **每晨**：验证 LabMemory 03:30 自动备份（`ssh aliyun-sz 'tail /home/admin/labmemory/backup.log'`）
- **2026-09-12 后**：清理 `labmemory.old/` + `bak.20260905_154631/`
- **2026-10-11 前**：阿里云实例 `Ubuntu-lrtz` 续费
- 长期：CSP nonce 专项（先全站 dynamic）、portfolio DEPLOY.md 回填真实数字

---

*维护说明：本 spec 冻结于 2026-09-10。实施时逐项勾验收框；执行顺序若因额度到货顺序调整，在 §7 标注即可，勿删 §2 地雷说明。*
