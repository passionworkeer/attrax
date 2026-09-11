# De-RAG + Evidence-Anchored Reports · 完整实施规格

> **成文时间**: 2026-09-11
> **状态**: 🟢 规格冻结，等执行
> **前置**: 2026-09-10 第一性原理审查 + A+B Phase 1（commit `e4da8d5` + `6717b77` + `1bbda64`）已上线
> **本文档作用**: 把"去 RAG + 结构化法规库 + 条款级引用与划线"的全部决策与实现路径冻成可执行规格。后续 session 直接按 §10 顺序推进

---

## 0. TL;DR

**核心决策**：attrax 不再是"基于 LangGraph Agentic RAG 的合规扫描平台"。它是 **"Knowledge-Anchored Generation"**——视觉识别 → 规则知识库确定性查表 → 按需加载适用条款原文 → LLM 一次性生成（带条款 ID + 原文引句）→ 确定性引文回匹配（同时产出可信度校验和高亮坐标）→ 报告 + 文档查看器 + 证据包下载。

**量化收益**：
- rag-service 代码量 11,287 行 → ~4,000-5,000 行（**-55~65%**）
- 生产依赖移除：`faiss-cpu / numpy / jieba / rank-bm25 / langgraph / langchain-core / openai SDK`
- 常驻内存 900MB+ → ~150MB（**-83%**）
- 外部 API 依赖：2 个 key（LLM + embedding）→ 1 个（LLM only）
- 整类问题消失：embedding 单点故障、向量空间一致性、FAISS 重建、meta 分片、manifest 密封、agent_trace 指数复制风险、单 worker 内存瓶颈、第二个 key 的管理陷阱

**新增产品能力**（不是只有减法）：
- 报告每条风险点可点击直达**官方原文具体条款**
- 原文段落高亮（精确字符级）
- 下载原始官方文件（公开法规）
- 导出"证据包" PDF（本次报告引用的全部条款摘录）
- 引文真实性得到确定性保证（LLM 不可伪造未实际出现的引文）

---

## 1. 决策记录（不要重新讨论这些）

| 决策 | 理由 |
|---|---|
| **完全去掉 RAG（embedding + 向量检索 + BM25）** | attrax 场景下"该看哪条法规"由 KB 确定性给出（品类×特征×市场），向量检索是用模糊工具解已解问题；embedding 已静默失效 3 个月无人察觉证明它不承重；现行 31s 管线 30.5s 是 LLM，<0.5s 的检索对延迟无意义 |
| **结构化法规库替代语料全文索引** | 法规有天然结构（Part/Chapter/Article/Paragraph），按条款切比按字符 chunk 切更贴用户认知；条款级引用是法律科技的标准形态（EUR-Lex / Westlaw / LexisNexis 都这样） |
| **LLM 引用形式为「法规 ID + 条款号 + 原文引句」** | 该形式同时承载 ① 跳转 ② 高亮 ③ 可信度校验三件事；比今天的「[法规名称/条款]」文本引用强一个量级 |
| **确定性引文回匹配替代 citation_verifier** | 同一机制同时产出：① 校验（引文是否真在原文里）② 高亮坐标（精确字符偏移）。text-overlap verifier 在生产 text-overlap 模式下的 REJECTED 噪声（spec B 问题）整体消失 |
| **保留 corpus 原始文件 + regulation_collectors** | 原始文件转作"下载资产" + "重新解析源"；collectors 转作"保鲜采集"，不再是索引重建器；Safety Gate 采集器（phase2 Spec D1）原样保留 |
| **不再投入**：reranker / 引用覆盖率硬约束 / NLI 注入 / cohere / Ollama 兜底 | 2026-09-10 审查结论不变。LLM 已知 RoHS / RED / UN 38.3 等主流法规；未知部分靠 KB key_points 沉淀 |
| **不重写 git history** | 同 2026-09-10 决策 |
| **CSPF nonce / OTel / metrics / demo data.ts 拆分** | 仍是 attrax 长期遗留项，与本次重构无关，按原节奏处理 |

---

## 2. 目标架构

### 2.1 管线终态

```
┌──────────────────────────────────────────────────────────────────────┐
│ 用户上传图片                                                          │
│     ↓                                                                 │
│ vision (MiniMax vision)        — 产品类型 + 核心特征 + 可见认证标志     │
│     ↓                                                                 │
│ KB 查表 (确定性)                  — 品类 × 特征 × 市场 → 适用法规清单   │
│     ↓                          — 每条法规 → key_articles (条款级)     │
│ 加载条款原文 (确定性)             — 按 doc_id 读 data/regulations/*.yaml│
│     ↓                          — 只加载 key_articles 指向的条款正文    │
│ generate (MiniMax-M3, 一次性 JSON) — LLM 输入: 产品 + KB 锚点 + 条款正文 │
│     ↓                          — LLM 输出每条风险点带 [doc_id#article]│
│                                  + 短引句 (≤ 200 字符)               │
│ 引文回匹配 (确定性)               — 每条引句在原文里做子串匹配           │
│     ↓                          — 成功 → 字符偏移 (高亮用)            │
│     ↓                          — 失败 → 降级为条款级定位 + 警告       │
│ 报告 + 文档查看器 + 证据包                                              │
└──────────────────────────────────────────────────────────────────────┘
```

**对比当前（8 节点 LangGraph）**：

| 当前节点 | 目标状态 |
|---|---|
| `vision` | **保留**，不变 |
| `query_planner` (同义词展开) | **删除**（KB 已用结构化数据，不再需要关键词模糊化） |
| `fan_out` / `retrieve` / `synthesis` (per-market 检索合并) | **整体删除**（KB 一次性查完所有市场；条款级别加载替代 chunk 检索） |
| `generator` | **保留并改造**：输入从 "chunks + anchors" 改为 "条款原文 + anchors"；prompt 要求每条引用带 [doc_id#article] + 短引句 |
| `verifier` | **替换**：text-overlap → 引文回匹配（确定性，产出高亮坐标） |
| `refiner` (LLM 自我纠错循环) | **删除**（生产 NLI 已跳过；引文回匹配是确定性检查） |

**LangGraph 自身**：8 节点塌缩为线性 3 步（vision → generate → verify-quote-match）。**LangGraph 依赖也一并移除**，用纯 `async def` 即可。

### 2.2 服务边界

- `rag_service/` 后端：仅保留 vision、KB 查表、条款加载、generate、引文回匹配、API/session/worker 编排
- 前端 (`attrax/app/`)：报告 + 文档查看器新页面 + 引用 chip 跳转 + 证据包导出
- 数据：双层 `data/kb/`（适用性）+ `data/regulations/`（条款原文）

### 2.3 数据归属示意（条款 ID + 引文实例）

报告输出示例（用户看到）：

```
风险：电池产品进入欧盟需电池护照（digital product passport）
依据：(EU) 2023/1542 Art. 77 — 适用：含电池 → EU
引文：「For each battery... a digital product passport shall be made available」
[打开原文] [查看报告所引用的全部条款]
```

点击「打开原文」→ 跳转 `/regulations/EU-2023-1542#art-77`，条款文本中高亮划线。

---

## 3. 数据模型

### 3.1 法规库（`data/regulations/`，每篇一个 YAML/JSON）

```yaml
# data/regulations/eu/2023-1542.yaml
id: EU-2023-1542                       # 全局唯一稳定 ID（系统寻址用）
official_citation: "Regulation (EU) 2023/1542"
short_name: "EU Battery Regulation 2023/1542"
region: EU
license: public                         # 见 §6 license 策略
source_url: "https://eur-lex.europa.eu/eli/reg/2023/1542/oj"
consolidated_version_url: null         # 若存在合并版本，指向之
in_force_as_of: "2023-08-17"
last_verified: "2026-09-11"
last_verified_by: human|collector      # 人工核验 or 采集器自动核验
replaces: ["2006/66/EC"]
replaced_by: null                      # 法规废止时填此
language: en                           # 原文语种
articles:                              # 条款树
  - id: art-38
    title: "Conformity assessment and CE marking"
    text: "..."
  - id: art-77
    title: "Battery passport"
    text: "..."
raw_file: raw/eu-2023-1542.pdf         # 官方原文件（公开法规）/ 仅元数据（私有标准）
checksum_sha256: "..."                 # 整库一致性
schema_version: 1                      # 法规库 schema 版本
```

**条款 ID 命名**：
- 法规级：`{REGION}-{NUMBER}`（EU-2023-1542、CN-GB-6675、US-49-CFR-173-185）
- 条款级：`{REG_ID}#{ART_ID}`（EU-2023-1542#art-77）
- 多级用 `/`（`EU-2023-1542#annex-iv#section-A#para-2`）

**存储**：
- `data/regulations/{region}/{reg_id}.yaml`（人类可读、diff 友好）
- 构建期聚合为 `data/regulations_index.json`（仅元数据，供 KB 查询快速定位）
- `raw/` 子目录存原始官方文件（公开法规存完整 PDF/HTML；私有标准存元数据占位文件 `LICENSE_PRIVATE.json`，内容为 `{license: private, purchase_url, why_cannot_reproduce}`}）

### 3.2 KB（`data/kb/`，每条规则一条 YAML）

```yaml
# data/kb/anchors/battery-eu.yaml
id: KB-battery-EU-001                  # KB 内部 ID
regulation_id: EU-2023-1542             # 引用法规库
official_citation: "Regulation (EU) 2023/1542"
applies_if:                            # 触发条件（确定性查表用）
  category: [battery]
  features_any: [battery]               # 任一特征匹配
  markets: [EU]
key_articles: ["art-77", "art-38", "art-7"]   # 生成时加载这些条款原文
key_points:                            # 沉淀关键事实/数字（防 LLM 幻觉 + 替代 chunk 引用）
  - "Battery passport mandatory from 2027-02-18 (industrial >2kWh)"
  - "Battery passport mandatory from 2028-08-18 (LMT batteries)"
  - "CE marking + REMS operator registration required for placement on market"
risk_hint: "no CE / no passport → market blocking"
est_cost: "certification ¥15K-40K / 6-10 weeks"
last_verified: "2026-09-11"
verified_by: human|llm-assisted
```

**KB 由 `must_check.py` 自动迁移**：
- §7.1 给定迁移脚本（从 `CATEGORY_REGULATIONS` + `FEATURE_REGULATIONS` 程序化生成 YAML）
- 人工补全 `key_articles` / `key_points` / `last_verified` / `license` 字段
- `must_check.py` 改为从 YAML 加载（保持函数签名一致：向后兼容现有测试）

### 3.3 报告包 schema 增量（`schemas/report_package.py`）

现有 `report_package` 加一个顶级字段：

```python
class CitationRef(BaseModel):
    doc_id: str             # 法规库 ID
    article_id: str        # "art-77" 或 "annex-iv#section-A"
    official_citation: str # "(EU) 2023/1542 Art. 77"
    quote: str             # 原文引句（≤ 200 字符）
    quote_span: tuple[int, int] | None  # 引句在 article text 中的 [start, end)
    match_status: Literal["matched", "fallback_article_only", "unmatched"]

class ReportPackage(BaseModel):
    # ... 现有字段 ...
    citations: list[CitationRef] = []  # 报告级别引用清单
    evidence_pack: list[CitationRef] = []  # 证据包（去重，下载用）
```

LLM 输出 JSON 时一并填 `citations`（每个引用对应一个 `CitationRef`，`quote_span` 留空由后端跑回匹配填充）。前端从 `report_package.citations` 渲染引用 chip，从 `evidence_pack` 生成证据包导出。

### 3.4 KB 与法规库的关系

```
KB (适用性层)                Regulation Library (原文层)
─────────────────         ──────────────────────────────
applies_if: {...}    ─→  按 doc_id 找到适用法规
key_articles: [...]  ─→  按 article_id 加载条款原文
key_points: [...]    ─→  作为 LLM 结构化输入
                       ─→  报告生成时按需读 text 字段
```

KB **不存储法规原文**。原文只在法规库。KB 只索引到 doc_id + article_id。这是数据归属的硬约束。

---

## 4. 引用 + 高亮机制（确定性算法）

### 4.1 报告生成时

LLM system prompt 关键修改（`REPORT_PACKAGE_SYSTEM_PROMPT`）：

```
## 引用规则（强制）
对每条风险点、合规要求、禁止项目，必须输出：

{
  "claim": "具体合规陈述",
  "citations": [
    {
      "doc_id": "EU-2023-1542",
      "article_id": "art-77",
      "official_citation": "(EU) 2023/1542 Art. 77",
      "quote": "原文引句，≤ 200 字符，必须逐字摘自条款正文"
    }
  ]
}

- 找不到合适原文引句时，引句留空字符串，引文仍保留（按条款级定位）
- 严禁编造条款号或引句——不在原文里的引文会被后端校验拒绝并标记
```

`generator_node` 输入端从「24 chunks×700 chars」改为「KB 适用条款的完整 text 字段拼接 + key_points」。

### 4.2 引文回匹配（确定性后检）

`verify/quote_matcher.py`（新文件）：

```python
def match_quote(article_text: str, quote: str) -> tuple[int, int] | None:
    """精确匹配，返回 [start, end) 偏移；失败返回 None"""
    if not quote:
        return None
    idx = article_text.find(quote)
    if idx >= 0:
        return (idx, idx + len(quote))
    # 归一化匹配：去空白、全半角
    norm_text = _normalize(article_text)
    norm_quote = _normalize(quote)
    norm_idx = norm_text.find(norm_quote)
    if norm_idx >= 0:
        # 映射回原文偏移（用空白字符位置表）
        return _denormalize_span(article_text, norm_idx, len(norm_quote))
    return None
```

**性能**：纯 Python 字符串操作；典型 article 1-5KB、引句 <200 字符，单次 < 1ms；50 条引用 < 50ms。

**确定性**：无 LLM 调用、无网络、无外部依赖。CI 友好。

### 4.3 三态 match_status

| 状态 | 含义 | 前端表现 |
|---|---|---|
| `matched` | 引句精确（或归一化后）匹配 | 引用 chip 显示 ✓；点击跳转后**划线高亮** |
| `fallback_article_only` | 条款存在但引句匹配失败（LLM 引句与原文略有偏差） | 引用 chip 显示 ⚠️；点击跳转**仅定位条款**，不划线 |
| `unmatched` | 条款不存在或 article_id 无效 | 引用 chip 显示 ✗；不跳转，计入审计 |

降级路径有意保留：`fallback_article_only` 不是失败——条款级引用仍可信，LLM 摘抄偏差可通过反馈循环优化 prompt。

### 4.4 高亮数据流向

```
LLM 生成 → citations[].quote
    ↓
quote_matcher.match_quote(article.text, quote)
    ↓ (matched)
citations[].quote_span = (start, end)
    ↓
报告 JSON 进入 session 持久化
    ↓
前端 <CitationChip onClick> → router.push(`/regulations/{doc_id}#art-{article_id}?q=...&hl={start},{end}`)
    ↓
文档查看器 SSR + 客户端 JS 接 hl 参数，定位到 DOM 节点，加 <mark class="hl"> 包裹
```

---

## 5. 法规库结构化策略

### 5.1 当前语料健康度（已实测）

| 指标 | 值 | 说明 |
|---|---|---|
| `data/corpus/processed/*.json` 总数 | 355 | 含已同步到服务器的 30 市场语料 |
| rawText 为 PDF 二进制乱码 | **3**（其中含 RED 2014/53/EU、CLP 1272/2008、2000/14/EC） | XHTML 抓取失败把原始字节当文本存了 |
| rawText < 200 字符（近空） | **25** | 抓取不完整 |
| 线上 FAISS 索引覆盖文档数 | 135（旧）+ 220 新文档**未入索引** | 索引基于 6 月快照（7170 chunks），新市场语料不可检索 |

### 5.2 结构化优先级

**Phase 1（必须，~30 天完成度）**：**44 篇锚点法规**——`must_check.py` 引用的去重后全部。程序化导出见 §5.3。

**Phase 2（视使用频次补）**：每条 `last_verified` 超过 6 个月、或 KB 触发但 §5.3 缺失的法规。

**Phase 3（按产品战略）**：SA / AE / 东南亚等长尾市场法规，按报告生成频次累加 50 次以上即触发结构化。

### 5.3 44 篇锚点法规清单（程序化提取自 `must_check.py`，2026-09-11 实测）

按区域分组：

| 区域 | 数量 | 法规（去重） |
|---|---|---|
| EU | 13 | RoHS 2011/65/EU, EMC 2014/30/EU, LVD 2014/35/EU, ErP 2009/125/EC, RED 2014/53/EU, Toy Safety 2009/48/EC, REACH (EC) 1907/2006, GPSR (EU) 2023/988, Battery Reg (EU) 2023/1542, Cosmetics Reg (EC) 1223/2009, Textile Labelling 1007/2011, FCM Framework 1935/2004, FCM 10/2011 |
| US | 12 | FCC Part 15, Prop 65, UL 60335, FCC Part 15/18, ASTM F963, CPSIA, CPSC General Product Safety, 49 CFR 173.185, MoCRA, TFPIA, FDA 21 CFR 174-190, UL/ETL Listing |
| CN | 12 | CCC认证 中国强制性产品认证, GB 4943.1, GB 4706, CCC认证 信息技术设备, GB 6675, GB 5296, GB 31241, CSAR 化妆品监督管理条例, GB 18401, GB 5296.4, GB 4806, SRRC 无线电型号核准 |
| UK | 5 | UKCA Marking Requirements, UKCA Marking for Appliances, Batteries and Accumulators (UK Retained), UK Cosmetics Regulation (Retained 1223/2009), UKCA Radio Equipment Regulations 2017 |
| AU | 1 | RCM Compliance 无线电通信标识 |
| UN | 1 | UN 38.3 Transport Testing |
| **合计** | **44** | |

### 5.4 解析路径

**首要源**（按优先级）：
1. **EUR-Lex** HTML/XML 版（EU 法规）—— 已有 `regulation_collectors/eu_rdf/` 基础
2. **eCFR / govinfo** （US 法规，公开）—— 直接 API
3. **gov.uk** legislation.gov.uk （UK 法律）—— 公开 API
4. **国家市场监督管理总局 / SAMR** （CN 法规；GB 标准除外）—— 公开
5. **UN** （UN 38.3 等）—— 公开

**需重抓的 3 个乱码文档**：
- `EU_Official_eu-2014-53-radio-equipment.json`（RED）—— 从 EUR-Lex HTML 版重建
- `EU_Official_eu-2008-1272-clp.json`（CLP）—— 同上
- `EU_Official_eu-2000-14-outdoor-noise.json`（outdoor noise）—— 同上

`regulation_collectors/` 重定向：不再为索引服务，转为：(a) 初次结构化 (b) 定期保鲜（每周一次拉 EUR-Lex consolidated 版本 diff）

### 5.5 解析产物

每篇法规一个 `{reg_id}.yaml`，其中 `articles[].text` 是该条款**完整正文**（不限字符数，KB 的 `key_articles` 决定加载哪些）。解析器（`parser/legal_parser.py` 新增）按以下标记定位条款：

- EU：HTML `div.eli-subdivision[id^="art_"]` 或文本中的「Article N」「Art. N」
- US CFR：结构 `§ xx.xx` / `Section xxx`
- UK：`section N` / `(N)`
- CN：「第 X 条」「第 X 章」
- 国际（UN）：Part III subsection 38.3 类固定结构

解析器规则约 200-300 行（覆盖 5 种主流结构）。后续按需扩展。

---

## 6. License 策略

### 6.1 分类总表

| License | 范围 | 处理策略 |
|---|---|---|
| `public` | EU 指令/法规、US CFR、UK Acts、CN 法规/条例、UN 公约、AU Acts、加拿大 Acts | **完整正文入库** + `raw_file` 存官方 PDF/HTML + 高亮 + 下载 |
| `private_with_summary` | GB 标准、ASTM、UL、EN、ISO、IEC、IEEE、AS/NZS | **只入结构化元数据 + key_points 摘要** + `purchase_url` 链接 + **不高亮不下载全文** |
| `public_but_check` | （罕用）部分国家二级立法版权状态待核实 | 暂按 `private_with_summary`，核实后调整 |

### 6.2 44 篇法规的 license 分类

**public（33 篇）**：
- EU 全部 13 篇（directive/regulation 是公法）
- US 公开部分 8 篇：FCC Part 15, Prop 65 (statute), 49 CFR 173.185, CPSIA (statute), CPSC General Product Safety, FDA 21 CFR 174-190, TFPIA (statute), MoCRA (statute)
- CN 法规 4 篇：CCC认证制度（CNCA 强制认证制度文件）、SRRC 无线电型号核准（工信部规定）、CSAR 化妆品监督管理条例（行政法规）
- AU 1 篇：RCM Compliance（ACMA 监管要求）
- UK 5 篇（UK legislation 是公法）
- UN 1 篇：UN 38.3（UN 出版物）

**private_with_summary（11 篇）**：
- GB 标准 8 篇：GB 4943.1, GB 4706, GB 6675, GB 5296, GB 31241, GB 18401, GB 5296.4, GB 4806
- ASTM/UL/EN 3 篇：ASTM F963, UL 60335, UL/ETL Listing

### 6.3 KB 上的 license 处理

`private_with_summary` 的 KB 条目：
- `key_articles: []`（不引条款号，因为无法验证）
- `key_points` 字段是合规摘要（人工撰写 + LLM 协助）
- `purchase_url` 字段填官方/查询链接（如 GB 国标全文公开查询：`https://openstd.samr.gov.cn/`；ASTM：`https://www.astm.org/`）
- KB 仍驱动锚点（产品触发即列出"需 GB 4943.1 检测"），但生成的报告里**不出现条款级引文 chip**，代之以 key_points 摘要 + 购买链接

### 6.4 政策红线的工程化保证

`schema_validator.py`（新增，CI 运行）：

```python
def validate_regulation_yaml(data: dict) -> None:
    license = data["license"]
    if license == "private_with_summary":
        if data.get("articles"):  # articles 必须为空或仅含 title 摘要
            for art in data["articles"]:
                if len(art.get("text", "")) > 200:
                    raise ValidationError(f"{data['id']}#art {art['id']} has text >200 chars under private license")
        if not data.get("purchase_url"):
            raise ValidationError(f"{data['id']} private license requires purchase_url")
    if license == "public":
        if not data.get("raw_file"):
            raise ValidationError(f"{data['id']} public license requires raw_file")
```

CI 在每个 PR 上跑一遍 `data/regulations/**/*.{yaml,json}`，确保私有不漏 + 公开不缺。

---

## 7. 实施步骤（按可独立验收拆分）

### 7.1 KB 抽取（无风险，可立即开工）

**目标**：`must_check.py` 的 370 行 Python dict 数据 → 44 个 YAML 文件（§5.3 清单）+ `kb_loader.py` 兼容层

**步骤**：
1. 写 `scripts/migrate_must_check_to_kb.py`：读取 `must_check.py` 的两个 dict，程序化生成 `data/kb/anchors/*.yaml` 骨架（`applies_if` / `official_citation` 自动填，其余字段空）
2. 人工补全 `key_articles`（按现有法规公开条款号填，公开法规 33 篇每篇 3-8 个关键条款；私有 11 篇用 key_points 替代）
3. 人工/ LLM-assisted 撰写 `key_points`（每个 KB 条目 3-8 条事实）
4. 写 `rag_service/retrieval/kb_loader.py`：暴露同名 API（`get_must_check_regulations` / `detect_features` / `build_anchor_list` / `get_feature_regulations`），实现改为读 YAML
5. `must_check.py` 标记为 `@deprecated`，保留 30 天后删除

**验收**：
- [ ] `pytest rag_service/tests/test_must_check.py -q` 全绿（22/22 现有用例不改一行）
- [ ] `data/kb/anchors/*.yaml` 文件数 = 44 - 私有重映射后 = 44（KB 文件数与原文档数无关，按 KB 锚点维度）
- [ ] `python3 scripts/migrate_must_check_to_kb.py --verify` 输出 ✓

**风险**：零。本步骤纯数据迁移，行为不变。

### 7.2 法规库 schema + 解析器（Phase 1 重点）

**目标**：`data/regulations/` 33 篇 public 法规完整入库（11 篇 private 仅元数据）

**步骤**：
1. `data/regulations/schema/regulation.schema.json`（JSON Schema，定义 §3.1 模型）
2. `rag_service/parser/legal_parser.py`（新，~300 行）：5 种结构识别（EU/US/UK/CN/UN）
3. `scripts/build_regulation_library.py`：从 `data/regulation_supplements/*/raw/` 解析 → `data/regulations/{region}/{reg_id}.yaml`；生成 `regulations_index.json`
4. 重抓 3 个乱码文档（从 EUR-Lex HTML 版）
5. `data/regulation_supplements/` → `data/regulations/` 的合并策略：保留历史 `processed/` 不动，新结构只放在 `regulations/`

**验收**：
- [ ] 33 篇 public 法规 `articles[].text` 非空、可解析
- [ ] 11 篇 private 仅有元数据 + key_points，`articles` 为空或仅 title
- [ ] `parser/legal_parser.py` 单测 ≥ 8 个（每种结构 ≥ 1）
- [ ] CI 上跑 `schema_validator.py validate-regulations` 通过

**风险**：解析准确率决定后续报告质量。EU EUR-Lex HTML 结构稳定（最高优先级先做完），其它区域若解析失败保留半结构化（仅 `articles: []`，靠 KB key_points 兜底）

### 7.3 生成器改造（关键改造点）

**目标**：`generator_node` 输入从 chunks 改为 KB 条款原文 + LLM 输出带 citations

**步骤**：
1. 新增 `rag_service/retrieval/article_loader.py`：`load_articles_for_anchors(anchors) -> dict[article_key, article_text]`，按 KB 的 `key_articles` 从法规库加载
2. `generator_node` 输入组装：
   - 旧：`documents`（chunks 列表）
   - 新：`article_texts`（条款正文 dict）+ `mandatory_regulations`（KB 锚点）+ `key_points`（KB 摘要）
3. `REPORT_PACKAGE_SYSTEM_PROMPT` 改造（加 §4.1 引用规则）
4. LLM 输出 schema 加 `citations` 字段（见 §3.3）
5. 报告包 schema 增加 `citations` / `evidence_pack` 字段
6. 前端 `lib/rag-client/report-package-schema.ts` 同步增加 Zod schema

**验收**：
- [ ] pytest `tests/test_generator_*.py` 全绿
- [ ] LLM 输出样本（人工 spot check 5 篇）每条风险点都有 `[doc_id#article]` 引用 + 引句
- [ ] 引文回匹配率 ≥ 90%（matched 状态占比）

**风险**：LLM prompt 改变可能改变输出风格，需在小流量先灰度（`USE_KB_INPUT=true` flag）

### 7.4 引文回匹配 + 校验管线

**目标**：`citation_verifier` 替换为 `quote_matcher`，产出 `quote_span`

**步骤**：
1. `rag_service/verify/quote_matcher.py`（§4.2）
3. `verify_node` 改为：调 `quote_matcher`，把 `quote_span` 写回 `report_package.citations[].quote_span`，设 `match_status`
4. `verifier_node` 移除（无 NLI 不 refine）
5. 前端 `report-package-schema.ts` 加 `quote_span` 字段

**验收**：
- [ ] `quote_matcher.py` 单测覆盖 3 种匹配结果
- [ ] `report_package.citations[].match_status` 分布：≥ 70% matched、≤ 25% fallback_article_only、≤ 5% unmatched
- [ ] 端到端：报告 JSON 中所有 `quote_span` 是有效偏移（指向 article text 范围内）

### 7.5 文档查看器 + 引用 chip 前端

**目标**：从报告跳转到法规文档查看器，引文高亮

**步骤**：
1. `app/regulations/[docId]/page.tsx`（新页面）：SSG/SSR 渲染法规 YAML 条款树
2. `components/regulation/CitationChip.tsx`：报告里的引用 chip 组件，点击跳转 `/regulations/{doc_id}#{article_id}?hl={start},{end}`
4. 客户端 JS 读取 `hl` 参数，定位 article DOM 节点，`<mark class="bg-yellow-200 dark:bg-yellow-900/40">` 包裹
5. `components/regulation/DocViewer.tsx`：左侧目录树 + 右侧条款正文 + 顶部原文下载按钮（公开法规）
6. 私有法规页面：仅显示元数据 + key_points + 购买链接（不显示条款正文）

**风险**：前端改工作量集中，需协调设计师（视觉规范在 next-line）

### 7.6 证据包导出

**目标**：本次报告引用的全部条款摘录 → 一份可打印 PDF

**步骤**：
1. `lib/report-export-modules/evidence-pack.ts`（新）：从 `report_package.evidence_pack` 聚合引用的条款全文摘录（含 highlight 标记），渲染 markdown
2. 复用 `report-export-modules/shared.ts` 的 PDF 生成（jspdf / docx）
3. 报告页「下载证据包」按钮（与现有 PDF/DOCX 导出并列）

**风险**：PDF 大小限制（典型扫描引用 5-10 篇法规 × 2-3 条款/篇 = 10-30 页，可控）

### 7.7 管线塌缩（删除 LangGraph + 检索栈）

**目标**：vision → generate → verify-quote-match 三步，删 LangGraph + FAISS + BM25 + embedder

**步骤**（**严格遵守顺序**，每步独立可回退）：
1. `RETRIEVAL_ENABLED=false` feature flag 落地（默认 false，新管线生效）
2. 切换开关：prod 默认关；开发机默认开（便于对比）
3. 删 `rag_service/retrieval/hybrid_retriever.py` / `faiss_retriever.py` / `bm25_retriever.py` / `modelScope_embedder.py` / `ollama_embedder.py` / `fusion.py`
4. 删 `rag_service/orchestrator/`（graph + 7 个 nodes 改为 `pipeline.py` 线性函数）
5. 删 `rag_service/chunker/`
6. 删 `rag_service/verify/citation_verifier.py`
7. 删 `rag_service/eval/`（检索评测——评测的子系统已删）
8. 删 `scripts/build_faiss.py`
9. `scripts/` 保留：`collect_*.py`（采集器，仍用于结构化）、`evaluate_*.py`（重写为 KB 覆盖评测）、`report_regulation_coverage.py`
10. `requirements-prod.txt` 移除：`faiss-cpu / numpy / jieba / rank-bm25 / langgraph / langchain-core / openai / pdfplumber`(?)/ `python-docx`(?) / `beautifulsoup4`(?) / `lxml`(?)
11. ecosystem `MODELSCOPE_API_KEY` / `MINIMAX_EMBED_*` 配置删除（外部依赖 2→1）
12. `data/faiss/` 删除（29MB），`data/embed_cache.json` 删除
13. `data/corpus/processed/` 保留作为下载资产源（被新 `regulations/` 引用 raw_file）；FAISS 索引文件全删
14. `data/corpus/index/manifest.json` 转换：原语料 manifest 字段映射为法规库 manifest
15. `Dockerfile` 同步清理

**验收**：
- [ ] `grep -r "faiss\|bm25\|hybrid_retriever" rag_service/ scripts/` 无业务引用
- [ ] `requirements-prod.txt` 不含上述 8 个包
- [ ] `pm2 delete && pm2 start` 后内存 ≤ 250MB
- [ ] 单次扫描 latency 中位数 ≤ 35s（与现行持平或更好）
- [ ] vitest 914 全绿；pytest 562 全绿

---

## 8. 删除清单（review-friendly diff）

### 8.1 文件删除

```
rag_service/retrieval/hybrid_retriever.py        # 575
rag_service/retrieval/faiss_retriever.py         # ~350
rag_service/retrieval/bm25_retriever.py          # ~200
rag_service/retrieval/modelScope_embedder.py     # ~250
rag_service/retrieval/ollama_embedder.py         # ~150
rag_service/retrieval/fusion.py                  # ~150
rag_service/orchestrator/graph.py                # 166
rag_service/orchestrator/state.py                # ~80（保留 schema 但简化为 dataclass）
rag_service/orchestrator/nodes/query_planner.py  # 122
rag_service/orchestrator/nodes/retriever.py      # 95
rag_service/orchestrator/nodes/synthesis.py      # 78
rag_service/orchestrator/nodes/refiner.py        # 68
rag_service/verify/citation_verifier.py          # ~430
rag_service/chunker/legal_chunker.py             # ~300
rag_service/eval/metrics.py                      # ~400
rag_service/eval/run_eval.py                    # ~400
scripts/build_faiss.py                           # ~600
scripts/convert_faiss_to_hnsw.py                 # ~150
data/faiss/                                      # 整个目录
data/embed_cache.json
data/corpus/processed/                           # 保留作为 raw_file 源，重新组织到 data/regulations/raw/
                                                # 但 processed/ 中的 3 个乱码文档报废，需从 EUR-Lex 重抓
```

约 **5,000-6,000 行 Python 删除 + 35MB 索引删除**。

### 8.2 依赖删除（`requirements-prod.txt`）

```diff
- faiss-cpu==1.12.0
- numpy==1.26.4
- jieba==0.42.1
- rank-bm25==0.2.2
- langgraph==1.1.6
- langchain-core==1.2.5
- openai>=2.0.0
- pdfplumber==0.11.8           # 若 user_docs 解析改用 pdfminer.six 或其他
                                # （保留依赖评估见 §8.3）
- python-docx==1.2.0            # 同上
```

### 8.3 评估中的依赖（待定）

- `pdfplumber` / `python-docx` / `beautifulsoup4` / `lxml`：用于 user-uploaded 文档解析。当前 user_docs 走 `parser/docx_parser.py` + `parser/html_parser.py`。**保留**（用户文档不属于检索栈）
- `cryptography` / `tornado` / `defusedxml`：传递依赖，保留

### 8.4 环境变量 / 配置删除

```
ecosystem.config.cjs:
- MODELSCOPE_API_KEY
- (any minimax embedding-related env)

rag_service/.env:
- MODELSCOPE_API_KEY
- OLLAMA_BASE_URL (若不再用)
- OLLAMA_EMBED_MODEL
- FAISS_INDEX_DIR
```

### 8.5 前端清理（lib/rag-client/）

- `lib/rag-client/` 保留 `client.ts` / `errors.ts` / `response-schemas.ts` / `v1-adapter.ts` / `v1-result-adapter.ts`（BFF 通信必需）
- `report-package-schema.ts` 加 citations 字段
- 删除：若任何代码引用了 `documents` / `chunks`（即 raw chunks）→ 改用 `report_package.citations`

---

## 9. 对 phase2 spec 的影响

| phase2 Spec 项 | 状态 |
|---|---|
| §3 Spec A（FAISS 重建续跑） | ❌ **取消**——FAISS 索引整体删除 |
| §4 Spec B（verifier 软标注） | ❌ **取消**——verifier 被 quote_matcher 替换（确定性检查，无 REJECTED 噪声） |
| §5 Spec C（配额监控） | ⚠️ **简化**——只监控 LLM 一个 key，监控脚本相应简化 |
| §6 Spec D1（EU Safety Gate 采集器，喂 riskPoints） | ✅ **保留**——数据采集，跟检索无关 |
| §6 Spec D2（AU 联邦登记） | ✅ **保留**——补充法规库 AU 覆盖 |
| §6 Spec D3（周更 cron） | ⚠️ **调整为**：周更拉 EUR-Lex consolidated 版本 diff，写入 `regulations/{region}/{reg_id}.yaml`（不再是 chunk 重建） |
| §6 Spec D4（web_search 工具） | ✅ **保留**——时效查询的补充，依赖新供应商 key |
| §8 小债 | 见各条对应 §7 步骤 |

---

## 10. 执行顺序总表

```
不依赖外部额度，纯代码 + 数据工作，立即可做：
  ① §7.1 KB 抽取（1-2 天）                          ← 建议立刻开
  ② §7.2 法规库 schema + 解析器（3-5 天）
  ③ §7.3 生成器改造（2-3 天）
  ④ §7.4 引文回匹配 + 校验管线（1-2 天）
  ⑤ §7.5 文档查看器 + 引用 chip 前端（3-4 天）
  ⑥ §7.6 证据包导出（1-2 天）

等 LLM 额度（MiniMax 恢复）：
  ⑦ E2E 基线对比：用同一输入跑「老管线（带 chunks）」vs「新管线（KB 条款）」各 5 篇，对比报告质量（人工 spot check + 引文匹配率指标）
  ⑧ §7.7 管线塌缩（删除检索栈）—— 必须 ⑦ 跑过且新管线质量不低于旧管线才执行
```

---

## 11. 验收总表（每个 PR 自检）

### 11.1 KB 完整性

- [ ] `data/kb/anchors/*.yaml` 与 §5.3 清单一一对应
- [ ] 每个 KB 条目有 `applies_if` / `regulation_id` / `key_articles`（public）或 `key_points`（private）/ `last_verified`
- [ ] `kb_loader.py` 单元测试覆盖 22 个现有 must_check 用例

### 11.2 法规库完整性

- [ ] 33 篇 public 法规 `articles[].text` 非空
- [ ] 11 篇 private 法规仅有元数据 + key_points + purchase_url
- [ ] `schema_validator.py validate-regulations` CI 通过
- [ ] 3 个 EUR-Lex 重抓文档入库（RED/CLP/outdoor noise）

### 11.3 报告质量

- [ ] 人工 spot check 5 篇报告（覆盖 battery/electronics/toy/cosmetic/textile 各 1）：每条风险点都有 `[doc_id#article]` 引用 + 引文
- [ ] 引文回匹配率 ≥ 90%
- [ ] 私有标准引用合规（不出现条款级引文，仅 key_points + 购买链接）

### 11.4 性能 / 资源

- [ ] rag-service 内存 ≤ 250MB（vs 现行 900MB+）
- [ ] 单次扫描 latency 中位数 ≤ 35s
- [ ] 单次扫描 P99 latency ≤ 60s

### 11.5 工程

- [ ] vitest 914 全绿
- [ ] pytest 562 全绿
- [ ] `grep -r "faiss\|bm25\|hybrid_retriever" rag_service/ scripts/` 零业务引用
- [ ] `requirements-prod.txt` 已删除 §8.2 列出包
- [ ] ecosystem.config.cjs 已删除 MODELSCOPE_* 配置

---

## 12. 运维注意事项（继承 2026-09-10 handoff 的雷区）

### 12.1 PM2 env 优先级陷阱（继承）

- `pm2 restart` 改 env 不生效——必须 `pm2 delete && pm2 start`
- `ecosystem.config.cjs` 内的 env 段优先于 `.env`
- 本次重构**直接消灭了 1 个 env 变量**（MODELSCOPE_API_KEY）——这是好事，但雷区仍在：MINIMAX_API_KEY 若轮换仍需双侧同步

### 12.2 server-side .env 行尾

- 服务器上 `.env` 历史上是 CRLF；任何 sed 替换前先 `cat -A` 检查
- 重构后只剩 `MINIMAX_API_KEY` + `RAG_INTERNAL_SECRET` 两个 secret，管理面更窄

### 12.3 部署验证

- 部署后必须实测 `/scan` 端到端（不是 `/api/health`）—— 健康检查只测可达，不测鉴权与管线
- BFF `app/api/scan/route.ts` 的 `ALLOWED_CATEGORIES` 与 KB `applies_if.category` 必须同步（2026-09-10 实际踩中过实体 bug）

### 12.4 首屏 / SEO

- 新增 `/regulations/[docId]` 页面需要 sitemap 同步（`work/ops/` 有 Next 16 standalone sitemap 工具）
- 法规页 SSG 可缓存，CDN friendly

---

## 13. 不做（明确边界）

- ❌ 不引入 NLI 模型 / reranker
- ❌ 不做引用覆盖率硬约束（覆盖率本身不是目标，可信度才是）
- ❌ 不实现 OTel / Prometheus（spec C 范围外）
- ❌ 不重写 session/queue 层（2026-09-10 审计已加固，沿用）
- ❌ 不动 front-end 现有四场景 UI（合规报告 / 利润报告 / 路线图 / 决策视图）—— 仅增量加引用 chip 和证据包按钮
- ❌ 不引入 SQLite FTS5 等"跨库搜索"功能（暂不需要；将来若需要，按"按 KB 定位 + 文档级加载"思路实现，不回到向量检索）

---

## 14. 维护说明

- 本 spec 冻结于 2026-09-11
- 实施时按 §10 顺序推进，每步独立可回退
- §5.3 法规清单若 KB 矩阵扩展（如新增市场/法规）→ 更新本 spec §5.3 与 `data/kb/anchors/`
- §6 license 政策如发现新法规类型 → 更新 §6.1 总表，并在 KB 条目 `license` 字段填新枚举
- §11 验收标准每条勾选后打 ✓，禁止改写为"通过"等模糊表述

---

*实施细节请按 §7 步骤展开；如发现 KB / 法规库 schema 在实施中需调整，先回到本 spec 修改对应章节再写代码，避免 spec 与代码漂移。*