# 火鹰合规 RAG 架构方案 — 已归档

> **状态**：已归档
> **归档时间**：2026-05-07
> **归档原因**：本方案描述的 Cohere/Qdrant/Docling 技术路线未实现，当前实现基于 Ollama/FAISS/pdfplumber。已由 `docs/RAG-ARCHITECTURE-v3.md` 替代。
> 状态: 待确认后实施

---

## 一、现状分析

### 1.1 现有数据总览

数据存放于 `data/` 目录，分为两个数据源：

| 数据源 | 路径 | 格式 | 文件数 |
|--------|------|------|--------|
| 全部法规 | `data/全部法规/` | PDF / HTML / DOCX | ~60 |
| 合规文档 | `data/合规/` | PDF / DOCX | ~30 |

#### EU 法规 PDF（`data/合规/EU_regulations/`）

18个官方 EU 法规 PDF，**质量全部 5/5**，纯文本可解析，零错误：

| 文件名 | 页数 | 字符数 | 核心内容 |
|--------|------|--------|---------|
| REACH_(EC)_1907-2006 | **849** | 956,374 | 化学品注册/评估/授权 |
| Blue_Guide_2022 | 156 | 623,748 | 欧盟产品规则实施指南 |
| AI_Act_(EU)_2024-1689 | 144 | 595,849 | 人工智能法（最新） |
| GDPR_(EU)_2016-679 | 88 | 355,906 | 通用数据保护条例 |
| DSA_(EU)_2022-2065 | 102 | 421,173 | 数字服务法 |
| DMA_(EU)_2022-1925 | 66 | 261,333 | 数字市场法 |
| GPSR_(EU)_2023-988 | 51 | 189,060 | 通用产品安全法规 |
| RED_2014-53-EU | 45 | 134,809 | 无线电设备指令 |
| 其他 10 个 | 5-47 | 各异 | EMC、LVD、RoHS、玩具安全等 |

EU 法规总计：**1,687 页，4.1M 字符**（已全部实测解析成功，零错误）

#### 合规产品 DOCX（`data/合规/具体/`）

产品专项分析 DOCX，质量极佳，全部 score 5/5：

| 文件名 | 段落数 | 表格数 | 内容 |
|--------|--------|--------|------|
| 欧美产品出海合规要求.docx | 192 | 3 | 通用产品合规全流程深度分析 |
| 欧盟乒乓球拍合规成本与利润.docx | 148 | 2 | 乒乓球拍合规成本量化 |
| 欧盟乒乓球拍合规性分析.docx | 187 | 3 | 乒乓球拍技术合规拆解 |
| 欧盟合规充电宝成本与利润分析.docx | 90 | 10 | 充电宝合规成本+风险量化 |
| 欧盟合规充电宝零件要求.docx | 161 | 3 | 充电宝零件级拆解 |
| 表格-欧盟充电宝合规成本与风险.docx | 14 | 1 | 成本与违法罚款对标 |
| 表格-乒乓球拍合规成本与风险分析.docx | 4 | 1 | 合规成本与罚款对标 |

#### HTML 法规（`data/全部法规/`）

35个 HTML 文件，质量参差不齐，按实际情况分类处理：

| 类型 | 示例 | 数量 | 处理方案 |
|------|------|------|---------|
| 静态 UTF-8 HTML | 欧盟解读、国际组织 | ~15 | BeautifulSoup 提取正文 |
| GBK 编码乱码 | 部分中国法规 | ~8 | chardet 重新检测编码 |
| JS 动态渲染 | 部分中国法规解读站 | ~10 | Playwright 无头浏览器 |
| 质量极差 | 编码完全错误 | 2 | 暂跳过，人工转文本 |

#### 截图 PDF（`data/合规/google gemini/`）

7个 PDF 为网页截图，扫描件无法直接解析：

- UL/IEC 标准截图类 → 需要 OCR（pytesseract）
- 处理优先级：最后再评估

### 1.2 现有 attrax 系统状态

| 组件 | 状态 |
|------|------|
| 前端（上传/扫描/结果） | ✅ 完成 |
| API Route | ✅ 完成（stub） |
| Vision AI SDK | ⚠️ 已装，未接入 |
| 文档解析管线 | ❌ 未开发 |
| RAG 检索服务 | ❌ 未开发 |
| LLM 生成 | ⚠️ 已装 SDK，未接入 |

### 1.3 数据质量总结

```
✅ 可直接入管线:
  - EU PDF: 18个，质量 5/5
  - 合规 DOCX: 9个，质量 3-5/5，含 ~23张表格

⚠️ 需预处理:
  - HTML（35个）: 按类型分流处理
  - 截图 PDF（7个）: 暂跳过或 OCR
```

---

## 二、目标

### 2.1 用户场景

```
用户上传产品图片 + 选择目标市场
    ↓
attrax 识别产品类别（Vision）
    ↓
Query 分解（结构化检索参数）
    ↓
混合检索（Child Chunk）+ 规则兜底（must_check 法规）
    ↓
Parent-Child 转换（完整条款上下文）
    ↓
引用验证 + LLM 生成报告
    ↓
输出带引用的合规报告（可导出）
```

### 2.2 输出目标：合规报告

每条风险点必须包含：

```
⚠️ [锂电池化学品超标]  不合规
  依据: REACH (EC) 1907/2006, Article 22, p.156
  原文: "铅含量不得超过 0.01%（均质材料重量比）..."
  ⚠️ 当前实测: 铅含量 0.05%，超出限量 5 倍
```

每条整改清单必须包含：

```
📌 整改清单

1. [高优先级] 替换电芯材料
   法规依据: REACH Article 22, p.156
   原文: "铅含量不得超过 0.01%..."
   建议: 使用无铅焊锡（Sn96.5Ag3Cu0.5）
   预估成本: $0.8/件 | 周期: 2-3周

2. [中优先级] 更新产品说明书
   法规依据: GPSR Article 5, p.23
   原文: "制造商应提供符合性声明..."
```

报告底部附引用来源索引：

```
📎 引用来源
[1] REACH (EC) 1907/2006, Article 22, p.156
[2] GPSR (EU) 2023/988, Article 20, p.23
[3] EU《新电池法》Regulation 2023/1542, Article 61
```

### 2.3 核心要求

| 要求 | 说明 |
|------|------|
| **可溯源** | 每条结论注明：法规名 + Article/条款 + 页码 |
| **引用原文** | 报告中包含被引用法规的实际文本（blockquote） |
| **精准** | 不夸大风险，不遗漏条款，不编造条款编号 |
| **引用验证** | 已验证引用显示绿色锁，未验证显示橙色警告 |
| **可导出** | Markdown / PDF 格式 |

---

## 三、架构方案

### 3.1 整体架构

```
用户上传产品图片 + 选择目标市场
       │
       ▼
┌─────────────────────────────────────────────────────┐
│  Vision 识别 (Claude Sonnet)                       │
│  → 产品类别 + 市场 + 关键参数                       │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│  Query Rewrite（轻量规则）                          │
│  用户表述 → 法规术语映射（50行代码，详见 4.4）     │
│  例: "铅含量" → "lead content Article 22 REACH"  │
│       "充电宝" → "lithium battery power bank CE"  │
└────────────────────┬────────────────────────────────┘
                     │
       ┌─────────────┴─────────────┐
       ▼                           ▼
┌──────────────────────────────────────────────────────┐
│  混合检索（并行，EU + US + CN 同时发起）             │
│                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ BGE-M3       │  │ BM25检索    │  │ 元数据    │  │
│  │ Dense Top-50 │  │ Top-50     │  │ 过滤      │  │
│  └──────┬──────┘  └──────┬──────┘  │ market    │  │
│         └─────────────────┼──────────┴────────────┘  │
│                           ▼                           │
│         RRF 融合 (Reciprocal Rank Fusion)            │
│                           ▼                           │
│         must_check 强制注入                          │
│         （充电宝 → REACH/RoHS/GPSR，即使未召回）    │
│                           ▼                           │
│         BGE-reranker Cross-Encoder → Top-10          │
└────────────────────┬─────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│  Parent-Child 上下文组装                             │
│  Child 精准召回 → 换取 Parent 完整 Article           │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│  LLM 生成报告 (Claude Sonnet)                       │
│  Prompt: 每个结论必须附 [Article No., p.Page]       │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│  Citation Verifier（硬门）⚡                         │
│  检查每条引用是否在原文可找到                         │
│                                                        │
│  ┌──────────────────────────────────────────────┐   │
│  │  IF verified == 0  → 拒绝生成，返回错误       │   │
│  │  IF verified < 3   → ⚠️警告，允许生成        │   │
│  │  IF verified >= 3  → ✅通过                  │   │
│  └──────────────────────────────────────────────┘   │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
             最终报告输出（可导出）
```

### 3.2 系统边界（核心修正）

**不采用 TypeScript 分裂架构**。TypeScript 生态缺少 BM25 + BGE-reranker 的成熟实现，全部逻辑统一在 Python FastAPI 服务中。

```
attrax/
├── rag-service/          ← 独立 Python FastAPI 服务（核心）
│   ├── parser/          ← PDF/DOCX/HTML 解析
│   ├── chunker/         ← Parent-Child LegalChunker
│   ├── retrieval/       ← Dense + BM25 + RRF + Rerank
│   ├── verify/          ← 引用验证
│   └── main.py          ← FastAPI，暴露 HTTP 接口
│
└── src/                  ← Next.js（现有代码）
    └── app/api/scan/route.ts  ← HTTP 转发到 rag-service
```

Next.js **只做两件事**：
1. 接收前端上传的文件和参数
2. POST 到 `http://localhost:8000/retrieve` 并返回结果

### 3.3 rag-service API 接口

```python
# 语料库构建（一次性，管理员调用）
POST /build-corpus
  Body: { file_path: str }  # 单个文件
  Response: { chunks_created: int }

# 检索（主要接口，Next.js 调用）
POST /retrieve
  Body: {
    product: str,              # "锂电池充电宝"
    markets: list[str],        # ["EU", "US"]
    category: str,             # "electronics"
  }
  Response: {
    chunks: list[ParentChunk],  # Top-10 完整条款
    must_check_injected: list[str],  # 被强制注入的法规名
    markets: list[str],
  }

# 报告生成
POST /generate-report
  Body: {
    product: str,
    markets: list[str],
    category: str,
    vision_result: VisionOutput,  # Vision 识别结果
  }
  Response: {
    report: ComplianceReport,
    verified_citations: list[str],
    hallucinated_citations: list[str],
  }
```

---

## 四、核心技术细节

### 4.1 分块策略：Parent-Child 层级结构

**问题：** REACH 的 Annex XVII 是"铅含量上限是多少"的核心表格，超过 40,000 tokens，按 Article 边界切分后这个 chunk 无法送入 embedding 模型。

**解决方案：** Parent-Child 双层结构。

```python
class LegalChunker:
    """
    Parent-Child Chunk 策略:
    - Parent: 按 Article 分隔，用于 LLM 生成时的完整上下文（可超长）
    - Child: 按 Clause/Paragraph 分隔，用于向量检索（300-500 tokens）
    """

    def chunk_document(self, text: str, metadata: dict) -> dict:
        # Step 1: 按 Article 边界分割 → Parent Chunks
        parent_chunks = self.split_by_article(text, metadata)

        # Step 2: Parent 内部按段落分割 → Child Chunks
        all_child_chunks = []
        for parent in parent_chunks:
            children = self.split_into_children(parent)
            for child in children:
                child["parent_id"] = parent["id"]
            all_child_chunks.extend(children)

        return {
            "parent_chunks": parent_chunks,  # 存文档，用于最终引用
            "child_chunks": all_child_chunks,  # 入向量库，用于检索
        }
```

**检索时行为：**

```
用户 query: "充电宝铅含量限制"
    ↓
向量检索 Child Chunk（精准）
    ↓
匹配: child: "Article 22第2款：铅含量不得超过 0.01%..."
    ↓
获取 parent_id → 取出完整 Parent Chunk
    ↓
Parent Chunk: REACH Article 22 全文（完整条款）
    ↓
送给 LLM（完整上下文，无截断）
```

### 4.2 HTML 分类处理

```python
def classify_html(filepath: str) -> str:
    """HTML 文件分类，决定处理方式"""
    raw = open(filepath, "rb").read()

    # 判断是否 JS 动态渲染（内容嵌 JS 变量）
    try:
        text = raw.decode("utf-8")
    except:
        text = raw.decode("gbk", errors="ignore")

    # JS 渲染判断：HTML 里有 script 且纯文本提取 < 500 字
    import re
    script_blocks = re.findall(r'<script[^>]*>.*?</script>',
                                text, re.DOTALL | re.IGNORECASE)
    clean_text = re.sub(r'<[^>]+>', '', text)
    if len(script_blocks) > 3 and len(clean_text.strip()) < 500:
        return "js_rendered"   # 需要 Playwright

    # GBK 编码检测
    try:
        text.encode("utf-8")
        return "static_utf8"    # BeautifulSoup 直接处理
    except:
        import chardet
        detected = chardet.detect(raw)
        if detected["confidence"] > 0.7:
            return f"gbk_{detected['encoding']}"
        return "unknown"


# 处理路由
if html_type == "js_rendered":
    # Playwright 无头浏览器渲染
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(f"file://{filepath}")
        page.wait_for_load_state("networkidle")
        text = page.inner_text("body")

elif html_type.startswith("gbk"):
    raw = open(filepath, "rb").read()
    encoding = chardet.detect(raw)["encoding"] or "gbk"
    text = raw.decode(encoding, errors="ignore")

elif html_type == "static_utf8":
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(open(filepath), "lxml")
    # 移除噪音元素
    for tag in soup.find_all(attrs={"class": re.compile(r"nav|sidebar|footer|header|menu", re.I)}):
        tag.decompose()
    text = soup.get_text(separator=" ", strip=True)
```

### 4.3 表格处理：描述化 + 原始数据并存

```python
def process_table(table: list[list[str]], source: dict) -> dict:
    """
    表格双字段策略：
    - description: 自然语言描述，用于 embedding
    - raw_table: 原始表格，用于报告引用展示
    """
    # 生成自然语言描述
    header = table[0] if table else []
    rows = table[1:6]  # 取前5行

    # 生成表格内容的自然语言摘要
    description_parts = []
    for row in rows:
        row_text = "、".join([f"{header[i]}={cell}" for i, cell in enumerate(row) if cell.strip()])
        if row_text:
            description_parts.append(row_text)

    description = (
        f"{source['doc_name']} {source.get('table_title', '附件表格')}，"
        f"列名：{'、'.join(header)}。数据：{'；'.join(description_parts)}。"
    )

    return {
        "type": "table_chunk",
        "description": description,          # 用于 embedding
        "raw_table": table,                   # 原始数据，用于报告引用
        "source": f"{source['doc_name']}, {source.get('location', '')}",
        "metadata": source,
    }
```

**效果示例：**

```
Embedding 输入（description 字段）:
"RoHS指令附件II中规定的有害物质最大浓度值：
铅(Pb)=0.01%重量比；镉(Cd)=0.01%；
汞(Hg)=0.1%；
六价铬(Cr VI)=0.1%；
多溴联苯(PBB)=0.1%；
多溴二苯醚(PBDE)=0.1%"

报告引用展示（raw_table 字段）:
| 物质     | 最大浓度 | 设备类型    | 法规依据         |
|----------|----------|-------------|------------------|
| 铅 (Pb)  | 0.01%   | 均质材料    | RoHS Annex II    |
| 镉 (Cd)  | 0.01%   | 均质材料    | RoHS Annex II    |
```

### 4.4 Query Rewrite：轻量规则映射

**背景：** 用户 query 表述（如"充电宝铅含量限制"）与法规原文措辞（如"lead content Article 22 REACH Regulation"）常有差异。BGE-M3 的 sparse 向量可部分缓解，但精确术语仍需显式 rewrite 补充。

**实现：50行规则，无需 Agent。**

```typescript
// query_rewrite_rules.ts
const rewriteRules = [
  {
    // 中文产品名 → 法规术语
    trigger: ["充电宝", "移动电源", "便携储能"],
    market: "EU",
    rewrites: [
      "lithium battery portable power bank REACH Article 22",
      "CE marking GPSR Article 4 portable electronic",
      "RoHS Annex II heavy metal lead cadmium",
    ],
  },
  {
    trigger: ["玩具", "儿童产品"],
    market: "EU",
    rewrites: [
      "EN 71-3 migrated elements toy safety",
      "REACH Annex XVII phthalate restriction",
      "GPSR Article 5 product safety",
    ],
  },
  {
    trigger: ["锂电池", "锂离子电池"],
    market: "EU",
    rewrites: [
      "Regulation 2023/1542 battery EU new rules",
      "REACH Article 22 chemical restriction",
      "CLP regulation lithium hazard classification",
    ],
  },
  {
    trigger: ["FCC", "美国认证"],
    market: "US",
    rewrites: [
      "FCC Part 15 unintentional radiator",
      "CPSIA lead content limit 100ppm",
      "TSCA chemical substance inventory",
    ],
  },
  {
    trigger: ["CCC认证", "中国认证"],
    market: "CN",
    rewrites: [
      "GB 31241 lithium battery safety",
      "CCC mandatory certification electronics",
    ],
  },
];

function rewriteQuery(query: string, market: string): string[] {
  const queries = [query]; // 保留原始 query（给 dense 向量用）
  for (const rule of rewriteRules) {
    if (rule.market !== market) continue;
    if (rule.trigger.some(t => query.includes(t))) {
      queries.push(...rule.rewrites); // 追加精确术语 query（给 BM25/sparse 用）
    }
  }
  return [...new Set(queries)]; // 去重
}
```

**执行时机：** rewrite 后每个 query 并行发起，召回结果合并去重。

**扩展方式：** Phase 2 检索验证时发现的新召回盲区，追加到 `rewriteRules` 即可，无需改架构。

### 4.5 must_check 规则兜底机制

检索结果注入前，按产品类别强制补充特定法规，即使命中数为 0：

```
充电宝类产品 → 必须注入 REACH + RoHS + GPSR + CE 相关条款
玩具类产品   → 必须注入 EN 71 + REACH Annex XVII + GPSR 相关条款
电子产品     → 必须注入 LVD + EMC + RED + RoHS 相关条款
纺织品       → 必须注入 REACH Annex XVII（偶氮染料）+ Oeko-Tex 相关条款
```

实现：从预设法规列表中按类别查 nano_vectordb，强制追加 Top-3 chunks 到召回集。

### 4.6 Citation Verifier：硬门验证层

**为什么是硬门而不是 Agent 循环：**

- Agent 自纠错循环（Retriever → 验证 → 失败 → 重检）额外增加 10-15s 延迟
- 在本场景下，召回失败的根本原因多是 chunk 质量问题或 query 表述，修复 chunk 质量比让 Agent 重试更有效
- CitationVerifier 作为**反应式硬门**（生成后检查）比**预防式 Agent 循环**更轻、更可预测

**实现：**

```python
def verify_citations(report_text: str, retrieved_chunks: list[dict]) -> dict:
    """验证报告中每条引用是否在原文可找到"""
    import re

    # Step 1: 提取报告中的所有引用标记
    citations = re.findall(
        r'\[([^\]]+(?:Article|第.*?条)[^\]]*)\]',
        report_text
    )

    verified = []
    unverified = []

    for citation in citations:
        found = any(citation_in_chunk(citation, chunk)
                    for chunk in retrieved_chunks)
        if found:
            verified.append(citation)
        else:
            unverified.append(citation)

    total = len(citations)
    verified_count = len(verified)

    return {
        "verified_citations": verified,
        "unverified_citations": unverified,
        "confidence": verified_count / total if total > 0 else 1.0,
        "status": "PASS" if not unverified else (
            "WARN" if verified_count >= 3 else "FAIL"
        ),
        # 硬门判断
        "gate_passed": verified_count >= 3,
        "report_allowed": verified_count > 0,  # 有至少1条才允许展示
    }


def citation_in_chunk(citation: str, chunk: dict) -> bool:
    """判断某条引用是否在 chunk 原文中有对应"""
    content = chunk.get("content", "") + chunk.get("source", "")
    # 提取 Article 编号（如 "Article 22"、"第22条"）
    article_match = re.search(
        r'(Article\s*\d+[\d\w]*|[第一二三四五六七八九十百\d]+条)',
        citation
    )
    if not article_match:
        return False
    return article_match.group(1).lower() in content.lower()
```

**硬门判断逻辑：**

```
gate_passed = True   →  ✅ 通过：≥3条已验证引用
report_allowed = True →  ⚠️ 警告：1-2条已验证引用，允许生成但标注
report_allowed = False →  ❌ 拒绝：0条已验证引用，不生成报告
                           返回："检索不足，无法生成有依据的合规报告"
```

**前端展示：**

```
✅ [已验证] REACH Article 22, p.156 — "铅含量不得超过 0.01%..."
⚠️ [未验证] EU《新电池法》Article 61 — （检索未找到对应原文，请核实）
❌ [拒绝] 当前报告含 0 条可验证引用，拒绝展示
```

### 4.7 Hallucination Grader（LLM-as-Judge，可选增强）

在 CitationVerifier（规则）基础上，增加 LLM 裁判层作为可选增强，用于检测**无法正则提取但实际无引用的结论**：

```python
HALLUCINATION_GRADE_PROMPT = """
你是一个严谨的法律合规审核员。
给定用户问题、检索到的法规原文、生成的报告，判断报告每个结论是否在原文中有依据。

问题: {question}
检索原文: {retrieved_contexts}
报告: {generated_report}

对每个结论打分：
- grounded: 结论在原文中有明确依据
- partial: 结论部分有依据，但不完整或超出原文范围
- ungrounded: 结论在原文中找不到依据（幻觉）

输出 JSON：
{{"grades": [{{"conclusion": "...", "score": "grounded|partial|ungrounded", "reason": "..."}}]}}
"""
```

此模块为可选增强（Phase 3 视召回验证效果决定是否启用），不影响核心架构。

---

## 五、框架调研与选型过程

### 5.0 Agentic RAG 评估与决策（最终结论）

**在决定架构之前，先回答一个问题：需要 Agent 吗？**

#### 调研结论：不需要，Static RAG + 硬门已足够

经过对 Agentic RAG 主流方案的系统评估（LangGraph Multi-Agent Corrective RAG / Self-RAG / ReAct 循环 / Multi-Agent Supervisor），核心判断如下：

**Agentic RAG 解决的三个核心问题：**

| 能力 | 解决问题 | 本场景是否需要 |
|------|---------|--------------|
| 自纠错循环 | 首次检索失败时换 query 重试 | ❌ BGE-M3 dense+sparse + BM25 首次命中率已足够高，失败根因在 chunk 质量而非 query 表述 |
| Supervisor 规划 | 决定下一步调哪个工具 | ❌ 工具选择固定：search → verify → generate，无需规划 |
| 迭代优化 | 逐步逼近正确答案 | ❌ 合规报告 query 结构化（产品+市场），非开放域探索 |

**Agentic 的代价：**
- 额外延迟 10-15s（多次 LLM 调用 + Agent 协调）
- 多 Agent 协调增加 debug 复杂度
- 在本场景（召回失败根因是 chunk 质量而非 query 表述）下，投入产出比差

**最终决策：不采用 Agentic 架构，理由如下：**

> Agentic RAG 的核心价值在于"预防幻觉"（通过预防式自纠错）。但在我们场景，CitationVerifier 作为"反应式硬门"（生成后检查）已足够防止无引用报告输出。修复 chunk 质量比加 Agent 循环更根本。

**唯一保留的轻量 Agentic 元素：Query Rewrite 规则（50行，详见 4.4）**

---

### 5.1 候选框架对比

经过全网调研（2024-2026 生产级 RAG / 法律 RAG 案例），核心候选框架对比如下：

#### 5.1.1 RAGFlow（infiniflow/ragflow）

| 维度 | 详情 |
|------|------|
| 基本信息 | 79,187 stars，Apache 2.0，EMNLP 2025 收录，极活跃 |
| 核心优势 | 模板化分块（可定义 Article 边界模板）、引用可视化、Citation Grounding |
| 支持格式 | PDF / DOCX / HTML / Word / Excel / 图片扫描件，多语言 |
| 不足 | Docker 部署（16GB+ RAM），内置 hallucination 检测缺失，chunk 模板质量依赖人工定义 |
| 对 attrax 价值 | **参考**：引用可视化逻辑 + chunk 模板设计思想 |
| 结论 | 不直接采用，不部署 Docker 服务 |

#### 5.1.2 LlamaIndex

| 维度 | 详情 |
|------|------|
| 基本信息 | 主流 RAG 编排框架，Pydantic 原生，Context7 文档 21,515 个代码示例 |
| 核心优势 | `BaseRetriever` 抽象体系成熟，`VectorIndex` + `BM25Retriever` + `EnsembleRetriever`（RRF）开箱即用，Pydantic Node metadata，Parent-Child Node 管理 |
| 幻觉检测 | 无内置，但 `with_structured_output()` + LLM-as-Judge 可自行构建 |
| 对 attrax 价值 | **核心采用**：作为检索编排层，替代纯 FastAPI 拼接 |
| 结论 | ✅ 采用，作为检索编排骨架 |

#### 5.1.3 LangChain / LangGraph

| 维度 | 详情 |
|------|------|
| 基本信息 | 最大 RAG/LLM 生态，LangSmith 评估平台 |
| 核心优势 | Hallucination grading pipeline 成熟（`grader_llm.with_structured_output(GradeHallucinations)`），多阶段 Agent 编排，streaming + structured output |
| 不足 | 学习曲线陡，LangGraph 编排复杂度过高，法律合规逻辑仍需自行构建 |
| 对 attrax 价值 | **参考**：Hallucination grading 模式借鉴到 Citation Verifier |
| 结论 | 不整体采用，吸收其 hallucination grading 思想 |

#### 5.1.4 Dify

| 维度 | 详情 |
|------|------|
| 基本信息 | 中国市场流行，开源 LLM 应用开发平台 |
| 核心优势 | 可视化 workflow 编排，中文支持好 |
| 不足 | 无 Article/Section 感知，引用精度非核心关注点，precision-critical 场景需大量定制 |
| 对 attrax 价值 | 无 |
| 结论 | ❌ 不采用 |

#### 5.1.5 MMA-RAG（Champ-X/MMA-RAG）

| 维度 | 详情 |
|------|------|
| 基本信息 | 79 stars，活跃项目，KB-aware multimodal RAG |
| 核心优势 | One-Pass hybrid 检索（dense + sparse + rerank），`citation_pov` 引用视角模式，intent 路由，Parent-Child chunk 策略 |
| 对 attrax 价值 | **参考**：One-Pass hybrid 检索架构 + citation_pov 思想 |
| 结论 | ❌ 不整体采用，吸收其检索模式思想 |

#### 5.1.6 LightRAG（HKUDS/LightRAG）

| 维度 | 详情 |
|------|------|
| 基本信息 | 34,000 stars，EMNLP 2025，香港大学 |
| 核心优势 | `NanoVectorDBStorage`：嵌入式 JSON 向量存储（`nano_vectordb` 库），零外部依赖 |
| 不足 | 固定 1200 token 分块（不适法律条款），无 BM25，无 Reranker，`kg_query` 实体提取精度不够 |
| 对 attrax 价值 | **部分采用**：`nano_vectordb` 替代 Qdrant |
| 结论 | ✅ 采纳 nano_vectordb，其他自建 |

#### 5.1.7 选型矩阵汇总

| 框架 | 编排层 | 向量存储 | 分块策略 | BM25 | Reranker | Citation Verifier | Docker 依赖 | 结论 |
|------|--------|---------|---------|------|----------|-------------------|-------------|------|
| RAGFlow | ✅ | Qdrant | ✅ 模板化 | ❌ | ❌ | ✅ 可视化 | ❌ 16GB+ | 参考 |
| LlamaIndex | ✅ 自建 | 均可 | 自建 | ✅ | ✅ | 自建 | 无要求 | **✅ 采用** |
| LangChain | ✅ | 均可 | 自建 | ✅ | ✅ | 借鉴 grading | 无要求 | 参考 |
| Dify | ⚠️ | ⚠️ | ❌ | ❌ | ❌ | ❌ | Docker | ❌ |
| MMA-RAG | ⚠️ | Qdrant | ✅ PC | ❌ | ✅ | ✅ pov | Docker | 参考 |
| LightRAG | ❌ | ✅ nano | ❌ 固定token | ❌ | ❌ | ❌ | 无 | nano_vectordb |

---

### 5.2 最终架构：LlamaIndex 编排层 + nano_vectordb 存储 + 自建法律专用组件

```
┌─────────────────────────────────────────────────────────────────────┐
│                    attrax 合规 RAG 系统分层架构                      │
├─────────────────────────────────────────────────────────────────────┤
│  [Next.js 前端]  →  HTTP POST  →  [FastAPI 网关 / LlamaIndex 编排] │
│                                        │                             │
│  ┌─────────────────────────────────────┼─────────────────────────┐  │
│  │              LlamaIndex 检索编排层                            │  │
│  │  QueryEngine → VectorIndex + BM25Retriever → EnsembleRetriever│  │
│  │              → ParentChildNodeAssembler → CitationGrader     │  │
│  └─────────────────────────────────────┼─────────────────────────┘  │
│                                        │                             │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │nano_vec  │  │ 自建         │  │ BGE-reranker │  │ 自建      │ │
│  │tordb     │  │ LegalChunker │  │ -v2-m3       │  │ Citation  │ │
│  │(向量存储) │  │ (Article边界)│  │ (Cross-Enc)  │  │ Verifier  │ │
│  └──────────┘  └──────────────┘  └──────────────┘  └───────────┘ │
│         │                                                          │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  LLM 层: Claude 4 Sonnet（已有 SDK）                         │  │
│  │  Prompt 强制格式：每个结论 → [Article No.] + [Page No.]       │  │
│  └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

**层级说明：**

```
第一层：LlamaIndex QueryEngine
  职责：组合 VectorIndex + BM25Retriever + EnsembleRetriever(rrf)
  不自己实现检索逻辑，依赖 LlamaIndex 成熟抽象

第二层：自建法律专用组件
  LegalChunker      — 按 Article/Section 边界分块（LlamaIndex Node 对象）
  CitationVerifier   — 生成后引用验证（LlamaIndex 钩子注入）
  ParentChildAssembler — Child 召回 → Parent 上下文组装

第三层：底层存储 / 模型
  nano_vectordb     — LlamaIndex VectorStore 后端
  BGE-M3            — 嵌入模型（dense + sparse 联合向量）
  BGE-reranker-v2-m3 — Cross-Encoder 重排
  Claude 4 Sonnet   — LLM 生成层
```

---

## 六、技术选型详解

### 6.1 编排层：LlamaIndex

**为什么用 LlamaIndex 而不是纯 FastAPI？**

| 对比维度 | 纯 FastAPI 拼接 | LlamaIndex |
|---------|---------------|------------|
| 向量检索 | 需手写 nano_vectordb 调用逻辑 | `VectorStoreIndex` 一行接入 |
| BM25 | 需手写 rank_bm25 或调用库 | `BM25Retriever` 开箱即用 |
| Ensemble（RRF） | 需手写融合算法 | `EnsembleRetriever(rrf)` 一行 |
| Parent-Child Node | 需自行设计存储和查询逻辑 | `ParentChildNodeAssembler` 有成熟模式 |
| 自定义 Retriever | 需实现 `BaseRetriever` 接口 | 同上，且框架提供统一调度 |
| 后续扩展 | 逐行改 | 增加 Retriever子类，热插拔 |

LlamaIndex 在检索编排上的积累远超过手写 FastAPI，且不锁定存储层（nano_vectordb 可作为 `VectorStore` 后端接入）。

**选型版本：`llama-index >= 0.11.0`（Python 3.10+）**

### 6.2 向量存储：nano_vectordb（LightRAG 依赖）

**为什么不用 Qdrant？**

Qdrant 需要 Docker 部署，公司 IT 可能不允许，且本项目规模（~20k Child Chunks）完全不需要专门向量数据库的性能。

**为什么不用 pgvector？**

pgvector 需要 PostgreSQL 部署，同样增加运维依赖。

**nano_vectordb 详情：**

- 库名：`nano_vectordb`，LightRAG 同款依赖
- 存储介质：`workspace/vdb_legal.json`（JSON 文件，追加写入）
- 检索性能：~20k 向量，毫秒级
- metadata filter：支持 dict filter
- 向量维度：BGE-M3 输出 1024 维
- 不足：超大规模（>1M 向量）需迁移 Qdrant，当前规模无压力

### 6.3 嵌入模型：BGE-M3（替换 voyage）

**对比：voyage-multilingual-3 vs BGE-M3**

| 维度 | voyage-multilingual-3 | BGE-M3 |
|------|----------------------|--------|
| 出品 | Voyage AI（商业） | 北京人工智能研究院（BAAI，开源） |
| 多语言 | 100+语言 | 100+语言，含中文最优 |
| dense + sparse | 仅 dense | **dense + sparse 联合**（一次输出同时含两种向量） |
| 中文效果 | 良好 | **最强**（BAAI 专门针对中日韩优化） |
| 调用方式 | 云端 API（需付费） | **本地推理**（无 API 费用） |
| 部署需求 | 无（API 调用） | CPU 推理即可（FP16 ~4GB 显存或纯 CPU） |
| EU/US/CN 混排 | 一般 | **最优**：同一模型覆盖三种语言 |
| 评测（MTEB） | top-tier | **SOTA**（MTEB 榜单 top3） |

**最终决策：BGE-M3，本地推理，零 API 费用**

理由：
1. EU/US/CN 三语混排场景，BGE-M3 是 SOTA
2. dense + sparse 联合向量：sparse 向量提供精确术语匹配（如 Article 编号、CAS 号），补充 BM25 的弱化版
3. 完全本地推理，无 API 费用，无网络依赖，无隐私风险
4. BGE-reranker-v2-m3 同体系，rerank 效果最佳

**模型规格：**
- 模型名：`BAAI/bge-m3`（HuggingFace）
- 向量维度：1024（dense）+ sparse（ColBERT-style）
- 量化版：`bge-m3-quantized`（INT8，推理更快，精度损失 < 1%）

### 6.4 Reranker：BGE-reranker-v2-m3

- 模型名：`BAAI/bge-reranker-v2-m3`
- 类型：Cross-Encoder
- 用途：Top-50 → Top-10 精排
- 部署：本地推理，FP16 或 INT8 量化
- 理由：BAAI 同体系，与 BGE-M3 联合优化效果最好，中文法规 rerank 效果最佳

### 6.5 PDF 解析：pdfplumber

**为什么不是 PyMuPDF？**

| 维度 | pdfplumber | PyMuPDF |
|------|-----------|---------|
| 表格提取 | ✅ 优秀（已验证 18 EU PDF 100% 成功） | ⚠️ 一般 |
| 页码保留 | ✅ 天然保留 | ⚠️ 需额外处理 |
| 纯文本提取 | ✅ 成功 | ✅ 成功 |
| 布局感知 | 基础 | 更强 |
| API 简洁性 | 简单 | 更灵活 |

已验证 `pdfplumber` 对 EU PDF 100% 解析成功，继续使用。

### 6.6 DOCX 解析：python-docx

已有验证，稳定可靠。

### 6.7 HTML 解析：BeautifulSoup4 + Playwright

分类处理路由不变（UTF-8 / GBK / JS 渲染）。

### 6.8 LLM：Claude 4 Sonnet

已有 SDK，中文生成质量最优，保持不变。

### 6.9 BM25：rank_bm25（LlamaIndex 依赖）

LlamaIndex 的 `BM25Retriever` 底层使用 `rank_bm25`，无需额外选型。BM25 负责：
- Article 编号精确匹配（"Article 22"）
- CAS 号匹配（"CAS 7439-92-1"）
- 化学物质名称精确匹配（"lead" / "铅" / "Pb"）

### 6.10 表格处理：LlamaIndex TableNode + 自建 dual-field

LlamaIndex 提供 `TableNode` 类型，支持表格结构化存储。配合自建 dual-field 策略（description + raw_table），满足报告引用展示需求。

### 6.11 完整选型总表

| 层级 | 组件 | 选型 | 决策理由 |
|------|------|------|---------|
| **编排层** | RAG 编排框架 | **LlamaIndex 0.11+** | 成熟检索抽象，VectorStore 可插拔，本地推理 |
| **向量存储** | 向量数据库 | **nano_vectordb**（LightRAG 同款） | 嵌入式 JSON，零外部依赖，LlamaIndex VectorStore 后端接入 |
| **嵌入模型** | Embedding | **BGE-M3**（BAAI） | 三语 SOTA，dense+sparse 联合，本地推理零费用 |
| **Reranker** | Cross-Encoder | **BGE-reranker-v2-m3** | 同体系，本地推理，中文法规精度最高 |
| **LLM** | 大语言模型 | **Claude 4 Sonnet** | 已有 SDK，中文质量最优 |
| **PDF 解析** | PDF 处理 | **pdfplumber** | 已验证 100% EU PDF 成功 |
| **DOCX 解析** | Word 处理 | **python-docx** | 直接读 XML，稳定 |
| **HTML 解析** | 网页处理 | **BeautifulSoup4 + Playwright** | 分类路由处理 |
| **BM25** | 稀疏检索 | **rank_bm25**（LlamaIndex 内置） | Article/CAS/化学品精确召回 |
| **表格处理** | 表格存储/检索 | **LlamaIndex TableNode + dual-field** | description 入检索，raw_table 用于展示 |
| **引用验证** | Hallucination 检测 | **自建 CitationVerifier**（借鉴 LangChain grading 模式） | 法律合规特有层 |
| **分块策略** | Chunking | **自建 LegalChunker** | 按 Article/Section 边界，非固定 token |

---

## 七、文件结构

```
attrax/
├── rag-service/                    # 独立 Python FastAPI RAG 服务（Static RAG + 硬门）
│   ├── main.py                    # FastAPI 应用入口
│   ├── parser/
│   │   ├── __init__.py
│   │   ├── pdf_parser.py          # pdfplumber 解析
│   │   ├── docx_parser.py        # python-docx 解析
│   │   ├── html_parser.py         # BS4 + Playwright 解析
│   │   └── classifier.py          # HTML 类型分类
│   ├── chunker/
│   │   ├── __init__.py
│   │   ├── legal_chunker.py      # Parent-Child 分块（按 Article/Section 边界）
│   │   │                          # 输出: LlamaIndex Document/Node 对象
│   │   └── table_processor.py     # 表格 dual-field 处理
│   ├── index/
│   │   ├── __init__.py
│   │   ├── legal_index.py         # LlamaIndex VectorStoreIndex 构建
│   │   │                          # nano_vectordb 作为 VectorStore 后端
│   │   ├── parent_child.py        # Parent-Child Node Assembler
│   │   └── query_engine.py        # LlamaIndex QueryEngine 组装
│   │                              # VectorIndex + BM25Retriever + EnsembleRetriever
│   ├── retrieval/
│   │   ├── __init__.py
│   │   ├── query_rewrite.py        # Query Rewrite 规则映射（50行）
│   │   ├── query_decomposer.py    # 结构化 Query 分解
│   │   ├── dense_retriever.py      # BGE-M3 嵌入（本地推理）
│   │   ├── bm25_retriever.py      # BM25Retriever（LlamaIndex 内置 rank_bm25）
│   │   ├── fusion.py               # RRF 融合（LlamaIndex EnsembleRetriever）
│   │   └── reranker.py            # BGE-reranker-v2-m3 Cross-Encoder 重排
│   ├── verify/
│   │   ├── __init__.py
│   │   ├── citation_verifier.py    # 引用验证（硬门，规则模式）
│   │   │                              # gate_passed / report_allowed 判断
│   │   └── hallucination_grader.py # LLM-as-Judge（可选增强，Phase 3 后视情况启用）
│   ├── generator/
│   │   └── compliance_reporter.py  # LLM 生成报告（Claude 4 Sonnet）
│   ├── models/
│   │   ├── schemas.py              # Pydantic 数据模型
│   │   │                              # LegalCitation, ChunkMetadata, ComplianceReport
│   │   └── node_schemas.py         # LlamaIndex Node metadata schema
│   ├── config.py                   # 配置管理（BGE 模型路径、nano_vectordb 路径等）
│   ├── requirements.txt            # Python 依赖
│   └── tests/                      # 单元测试
│       ├── test_legal_chunker.py
│       ├── test_citation_verifier.py
│       ├── test_query_rewrite.py
│       └── test_retrieval.py
│
├── models/                         # 本地模型（不随代码 push）
│   ├── bge-m3/                     # BGE-M3 嵌入模型（~2GB）
│   └── bge-reranker-v2-m3/          # BGE-reranker 模型（~1GB）
│
├── data/
│   └── corpus/                      # 预解析法规语料库（构建后生成）
│       ├── eu/                      # EU 法规 JSON
│       ├── us/                      # 美国法规 JSON
│       ├── asia/                    # 亚洲法规 JSON
│       ├── products/                # 产品专项分析 JSON
│       └── index.json              # 全量索引（含版本号、日期）
│
├── scripts/
│   ├── build_corpus.py              # 批量构建语料库（→ LlamaIndex Document）
│   ├── ingest_to_index.py           # 批量写入 LlamaIndex VectorStore（nano_vectordb 后端）
│   └── test_retrieval.py            # 检索测试（验证 Top-K 召回质量）
│
├── src/                             # Next.js（现有代码）
│   └── app/api/scan/route.ts        # 转发请求到 rag-service
│
└── docs/
    └── RAG-ARCHITECTURE.md          # 本文档
```

> **注意**：`models/` 目录不随 git push，需在部署时下载或初始化脚本拉取。
> **注意**：无 `agents/` 目录，无需多 Agent 协调。

---

## 八、实施计划

> **架构原则：静态 RAG + 硬门，无 Agentic 循环。简单即正确。**

### Phase 0：基础设施验证（0.5天）

```
目标: 验证所有外部依赖可用
步骤:
1. pip install llama-index nano-vectordb transformers torch
   （llama-index >= 0.11.0，含 rank_bm25、BM25Retriever、EnsembleRetriever）
2. 下载 BGE-M3 模型权重（~2GB，HuggingFace）
   python -c "from llama_index.embeddings.huggingface import HuggingFaceEmbedding; HuggingFaceEmbedding('BAAI/bge-m3')"
3. 下载 BGE-reranker-v2-m3 模型权重（~1GB）
4. 验证 nano_vectordb JSON 写入/读取（workspace/vdb_legal.json）
5. 验证 BGE-M3 本地推理（CPU 推理 < 5s/batch）
6. 验证 LlamaIndex VectorStoreIndex + BM25Retriever + EnsembleRetriever(rrf) 组合
7. 验证 FastAPI 服务启动（uvicorn）
8. 验证 Claude 4 Sonnet SDK 连通
注: 无 Docker，无 Qdrant，无云端 embedding API 依赖
```

**依赖安装命令：**
```bash
pip install llama-index>=0.11.0 \
  nano-vectordb \
  transformers sentencepiece torch \
  pdfplumber python-docx beautifulsoup4 playwright \
  chardet anthropic pydantic
playwright install chromium  # 若有 JS 渲染 HTML
```

### Phase 1：语料库构建（2天）

**专注 18个 EU PDF + 9个 DOCX，不碰 HTML**

```
目标: 建立可用基线（LlamaIndex Document → VectorStoreIndex）
步骤:
1. 运行 build_corpus.py 解析 EU PDF
   → pdfplumber 提取文本 + 页码
   → LegalChunker 按 Article/Section 边界分块
   → 输出: LlamaIndex Document（带 metadata: doc_name, article_no, page_range）
   → Child + Parent Node 对
2. 运行 build_corpus.py 解析 DOCX（含表格 → dual-field description + raw_table）
3. 运行 ingest_to_index.py
   → LlamaIndex VectorStoreIndex(storage_context=nano_vectordb)
   → 写入 workspace/vdb_legal.json
4. 验证: test_retrieval.py 抽检 5 个 query
   → 检查 Top-10 召回是否命中正确 Article
```

**LlamaIndex 接入 nano_vectordb 示例代码：**
```python
from llama_index.core import VectorStoreIndex
from llama_index.core.storage import StorageContext
from nano_vectordb import NanoVectorStore

# nano_vectordb 作为 LlamaIndex VectorStore 后端
vector_store = NanoVectorStore(workspace="workspace", namespace="legal")
storage_context = StorageContext.from_defaults(vector_store=vector_store)

# 构建索引
index = VectorStoreIndex.from_documents(
    documents,          # LegalChunker 输出的 LlamaIndex Document
    storage_context=storage_context,
    embed_model=BGE_M3_EMBED_MODEL,
)
```

### Phase 2：检索验证（1天）

```
目标: 召回率验证（目标: Top-10 90%+ 命中正确 Article）
步骤:
1. 准备 10+ 个测试 query（见下表）
2. 验证 Query Rewrite 规则补充效果（"充电宝" query 是否命中 REACH Article 22）
3. 验证 EnsembleRetriever(dense + BM25, rrf) 召回质量
4. 验证 BGE-reranker Top-50 → Top-10 精排效果
5. 验证 must_check 强制注入（充电宝 → REACH/RoHS/GPSR 必须召回）
6. 验证 Parent-Child 转换（Child 召回后获取 Parent 完整 Article）
7. 新发现召回盲区 → 追加到 query_rewrite_rules.ts
```

**测试 Query 列表：**

| # | 产品 | 市场 | 预期召回 |
|---|------|------|----------|
| 1 | 充电宝 | EU | REACH Article 22（铅含量）+ RoHS Annex II |
| 2 | 乒乓球拍 | EU | REACH Annex XVII（增塑剂）+ GPSR Article 5 |
| 3 | 锂电池 | US | TSCA 化学物质清单 + DOT 运输规定 |
| 4 | 电子手表 | EU | RED Article 3（射频频谱）+ LVD 安全要求 |
| 5 | 蓝牙音箱 | EU + US | RED + EMC + FCC Part 15 |
| 6 | 儿童玩具 | EU | EN 71-3（可迁移元素）+ REACH Annex XVII |
| 7 | 充电宝 | CN | CCC 认证 + GB 31241（锂电池） |
| 8 | 纺织品 | EU | REACH Annex XVII（偶氮染料）+ Oeko-Tex |

### Phase 3：引用验证硬门 + 报告生成（2天）

```
目标: 端到端跑出第一张带引用的合规报告，验证硬门逻辑
步骤:
1. 实现 CitationVerifier 硬门（规则模式）
   → 正则提取报告中的 Article/条款编号
   → 与检索到的 Chunk 原文交叉验证
   → 硬门判断: verified>=3 ✅ / 1-2 ⚠️ / 0 ❌拒绝
2. 接入 Claude 4 Sonnet 生成报告
   → Prompt 强制每个结论附 [Article No., p.Page]
   → 引用原文 blockquote
3. 测试硬门：
   a. 正常 query → 验证通过 → 展示报告
   b. 随机 query → 验证失败 → 返回错误（不生成幻觉报告）
4. 可选：启用 hallucination_grader（LLM-as-Judge）增强
```

### Phase 4：扩充语料（1天）

```
目标: 处理质量较好的 HTML
步骤:
1. 分类处理 35 个 HTML（静态 UTF-8 / GBK / JS渲染）
2. Playwright 处理 JS 渲染类（~10个）
3. 增量入 LlamaIndex VectorStore（upsert）
4. 评估 7 个截图 PDF：OCR 还是放弃
```

### Phase 5：接入 attrax 前端（1天）

```
目标: 端到端联调
步骤:
1. 启动 rag-service: uvicorn rag-service.main:app
2. 修改 app/api/scan/route.ts → POST rag-service
3. Vision 识别结果 → Query Rewrite → 检索 → 硬门验证 → 生成报告
4. 前端展示：✅ 已验证 / ⚠️ 警告 / ❌ 拒绝 标签 + Markdown/PDF 导出
```

**预估端到端延迟：5-10s**（并行 EU+US+CN 检索 + 单次 LLM 生成）

---

## 九（备选）、数据更新流程

```
法规更新事件
       │
       ▼
下载新法规文档 → 放入 data/全部法规/
       │
       ▼
POST /build-corpus（单文件增量构建）
       │
       ▼
LegalChunker 重新分块 → LlamaIndex Document
       │
       ▼
VectorStoreIndex.upsert() → nano_vectordb JSON 增量写入
（支持按 doc_id 覆盖旧版本）
       │
       ▼
验证检索效果
```

---

## 十、风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| Python/TS 分裂架构 | BGE-reranker 无法在 TS 环境运行 | ✅ 已修正：统一 Python FastAPI |
| REACH Annex XVII 超长 chunk | embedding 截断，核心条款丢失 | ✅ 已修正：Parent-Child 双层结构 |
| HTML 质量差 | 召回率低 | 分类处理，JS渲染用 Playwright |
| LLM 编造条款编号 | 报告引用不准确 | ✅ 已修正：CitationVerifier（规则）+ hallucination_grader（LLM-as-Judge）双层验证 |
| 法规版本过期 | 报告引用旧条款 | index.json 带版本号和日期，upsert 机制 |
| 表格信息丢失 | 二维关系线性化后语义稀薄 | ✅ 已修正：LlamaIndex TableNode + dual-field |
| Qdrant Docker 不被允许 | 无法本地部署 | ✅ 已解决：nano_vectordb 嵌入式，无需 Docker |
| BGE-M3 推理速度 | CPU 推理可能较慢（~2-5s/batch） | INT8 量化版；首批加载后缓存模型；实测满足 Phase 1 需求 |
| nano_vectordb 规模上限 | JSON 文件超过 1M 向量后性能下降 | 超量时迁移至 Qdrant（LlamaIndex VectorStore 后端热插拔） |
| LlamaIndex 版本兼容 | 大版本升级可能破坏 API | 锁定 >= 0.11.0，升级前跑全套回归测试 |
| 多语言 Chunk 质量 | 中英混合法规（如 EU 中英双语 PDF）分块可能切碎 | LegalChunker 增加双语感知：英文 Article 标题 + 中文正文 → 同 parent |

---

## 十一、确认事项（实施前确认）

> 以下事项在方案评审时已做决策（2026-04-29），供参考。实施前如有变化请更新。

**已确认事项：**

| 事项 | 决策 | 原因 |
|------|------|------|
| 向量存储 | **nano_vectordb**（LightRAG 同款） | 零 Docker 依赖，嵌入式 JSON，LlamaIndex VectorStore 后端接入 |
| 嵌入模型 | **BGE-M3**（本地推理） | SOTA 三语，dense+sparse 联合，零 API 费用 |
| 编排层 | **LlamaIndex 0.11+** | 成熟检索抽象，VectorStore 热插拔 |
| Reranker | **BGE-reranker-v2-m3** | BAAI 同体系，本地推理 |
| 架构风格 | **Static RAG + 硬门**（无 Agentic） | 延迟 5-10s，满足"快"；硬门验证满足"准"；Agentic 增加 10-15s 且复杂度过高 |
| Query Rewrite | **50行规则**（无 Agent） | 覆盖术语差异，扩展方式为追加规则，无需改架构 |

**待实施前确认：**

| 事项 | 说明 |
|------|------|
| BGE-M3 模型下载 | HuggingFace 网络是否可达？如不可达需准备离线文件（约 3GB） |
| 法规更新频率 | 影响版本管理和 upsert 策略（已设计 upsert 机制，待确认频率） |
| 用户上传法规 | 管理员维护 vs 用户自助入库（已设计增量构建 API，待确认） |
| 报告语言 | 中文 vs 英文（影响 Prompt 设计，文档已按中文设计） |
| 数据规模 | 预估 ~15k-25k Child Chunks，nano_vectordb JSON 预计 50-200MB |

---

## 十二、版本历史

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| 1.0 | 2026-04-28 | 初版方案 |
| 1.1 | 2026-04-28 | 整合专家评审意见：统一 Python FastAPI、Parent-Child 分块、HTML 分类处理、表格描述化、结构化 Query 分解、引用验证层 |
| 1.2 | 2026-04-28 | LightRAG 调研整合：以 nano_vectordb 替代 Qdrant（零外部依赖），移除 Docker 要求；自建 LegalChunker/HybridRetrieval/CitationVerifier |
| 1.3 | 2026-04-28 | 企业 RAG + 法律 RAG 全网调研整合：增加 LlamaIndex 编排层（替代纯 FastAPI），voyage → BGE-M3（本地推理零费用，SOTA 三语），增加 Hallucination Grader（LangChain grading 模式），更新 Phase 0-5 实施计划，更新风险清单 |
| 1.4 | 2026-04-29 | 架构决策：否决 Agentic RAG（延迟高、复杂、不适合本场景），采用 Static RAG + CitationVerifier 硬门；增加 Section 5.0（Agentic 评估决策）；新增 4.4 Query Rewrite（50行规则替代 Agent）；Section 3 架构图更新；Phase 1 延长至 2天（增加 LegalChunker 开发）；预估延迟 5-10s |