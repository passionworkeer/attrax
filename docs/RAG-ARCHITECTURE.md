# 火鹰合规 RAG 架构方案

> 文档版本: 1.1
> 创建时间: 2026-04-28
> 最后更新: 2026-04-28（整合专家评审意见）
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
用户上传产品图片
       │
       ▼
┌─────────────────────────────────────────────────────┐
│  Vision 识别 (Claude Sonnet)                       │
│  → 产品类别 + 市场 + 关键参数                       │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│  结构化 Query 分解 (Query Decomposer)             │
│  → markets / product_categories / search_queries   │
│  → must_check_regulations（规则兜底）              │
└────────────────────┬────────────────────────────────┘
                     │
       ┌─────────────┴─────────────┐
       ▼                           ▼
┌──────────────────────────────────────────────────────┐
│  混合检索 (Hybrid Retrieval)                         │
│                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ Dense检索    │  │ BM25检索    │  │ 元数据    │  │
│  │ Child Chunk  │  │ (术语精确) │  │ 过滤      │  │
│  │ Top-50      │  │ Top-50     │  │ market    │  │
│  └──────┬──────┘  └──────┬──────┘  └────────────┘  │
│         └─────────────────┼──────────────────┘        │
│                           ▼                           │
│         RRF 融合 (Reciprocal Rank Fusion)            │
│                           ▼                           │
│         must_check 强制注入                          │
│         （充电宝必须含 REACH/RoHS，即使检索未召回）  │
│                           ▼                           │
│         BGE-reranker Cross-Encoder → Top-10          │
└────────────────────┬─────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│  Parent-Child Chunk 转换                             │
│  Child Chunk 检索精准 → 换取 Parent Chunk 完整条款  │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│  LLM 生成 (Claude Sonnet)                           │
│  Prompt: 严格引用原文，超出范围必须说明             │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│  后置引用验证 (Citation Verifier)                    │
│  验证报告中每条引用是否在原文可找到                  │
│  标记:  ✅ 已验证  /  ⚠️ 未验证                      │
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

### 4.4 Query 分解：结构化检索参数

```python
QUERY_DECOMPOSE_PROMPT = """
你是合规法规专家。给定产品描述，输出结构化检索参数。

产品: {product_description}
目标市场: {markets}

输出严格 JSON 格式:
{
  "markets": ["EU", "US"],
  "product_categories": ["电池产品", "便携式电子设备"],
  "regulatory_domains": ["化学品安全", "电气安全", "无线电频谱"],
  "search_queries": [
    "锂电池便携式充电宝 欧盟认证",
    "power bank lithium battery EU compliance",
    "portable battery CE marking requirements",
    "REACH restriction battery materials"
  ],
  "must_check_regulations": ["REACH", "RoHS", "新电池法", "RED", "LVD", "GPSR"],
  "keywords": ["锂电池", "充电宝", "便携式储能", "lithium", "power bank"]
}
"""
```

**must_check_regulations 规则兜底机制：**

```
充电宝类产品 → 必须包含 REACH + RoHS + CE + GPSR
玩具类产品   → 必须包含 EN 71 + REACH + GPSR
电子产品     → 必须包含 LVD + EMC + RED + RoHS
```

即使检索未召回，must_check 指定的法规条款也会被强制注入到上下文。

### 4.5 引用验证层（后置检查）

```python
def verify_citations(report_text: str, retrieved_chunks: list[dict]) -> dict:
    """
    验证报告中每条引用是否在检索到的原文中可以找到
    """
    # 提取报告中的所有引用标记
    import re
    citations = re.findall(
        r'\[([^\]]+(?:Article|第.*?条)[^\]]*)\]',
        report_text
    )

    verified = []
    hallucinated = []

    for citation in citations:
        found = any(
            citation_in_chunk(citation, chunk)
            for chunk in retrieved_chunks
        )
        if found:
            verified.append(citation)
        else:
            hallucinated.append(citation)

    return {
        "verified_citations": verified,
        "hallucinated_citations": hallucinated,
        "confidence": len(verified) / len(citations) if citations else 1.0,
        "status": "PASS" if not hallucinated else "WARN",
    }


def citation_in_chunk(citation: str, chunk: dict) -> bool:
    """
    判断某条引用是否在 chunk 中有对应内容
    宽松匹配：Article 编号 + 部分关键词
    """
    content = chunk.get("content", "") + chunk.get("source", "")
    # 提取 Article 编号
    article_match = re.search(r'(Article\s*\d+|[第一二三四五六七八九十\d]+条)',
                               citation)
    if not article_match:
        return False
    article_id = article_match.group(1)
    # 检查 Article ID 是否在 chunk 中
    return article_id.lower() in content.lower()
```

**前端展示：**

```
✅ [已验证] REACH Article 22, p.156 — "铅含量不得超过 0.01%..."
⚠️ [未验证] EU《新电池法》Article 61 — （检索未找到对应原文，请核实）
```

---

## 五、技术选型

| 环节 | 选型 | 理由 |
|------|------|------|
| RAG 服务框架 | **FastAPI** | 轻量、异步、与 Python ML 生态无缝集成 |
| 向量库 | **Qdrant** | Docker 一键启动，metadata filter 支持好，性能高 |
| 嵌入模型 | **voyage-multilingual-3** | 100+语言，中日韩英混排效果好 |
| Reranker | **BGE-reranker-v2-m3** | 中文法规 rerank 效果最佳，本地可部署 |
| PDF 解析 | **pdfplumber** | 已验证 100% 成功，Windows 兼容 |
| DOCX 解析 | **python-docx** | 直接读 XML，无外部依赖 |
| HTML 解析 | **BeautifulSoup4 + Playwright** | 静态 HTML 用 BS4，JS 渲染用 Playwright |
| JS 渲染处理 | **Playwright** | 处理动态内容嵌 JS 的 HTML |
| LLM | **Claude 4 Sonnet** | 已有 SDK，中文生成质量高 |
| 编码检测 | **chardet** | GBK/UTF-8 自动检测 |

---

## 六、文件结构

```
attrax/
├── rag-service/                  # 独立 Python FastAPI RAG 服务
│   ├── main.py                  # FastAPI 应用入口
│   ├── parser/
│   │   ├── __init__.py
│   │   ├── pdf_parser.py        # pdfplumber 解析
│   │   ├── docx_parser.py      # python-docx 解析
│   │   ├── html_parser.py       # BS4 + Playwright 解析
│   │   └── classifier.py         # HTML 类型分类
│   ├── chunker/
│   │   ├── __init__.py
│   │   ├── legal_chunker.py      # Parent-Child 分块
│   │   └── table_processor.py    # 表格描述化
│   ├── retrieval/
│   │   ├── __init__.py
│   │   ├── query_decomposer.py  # 结构化 Query 分解
│   │   ├── dense_retriever.py   # 向量检索（voyage API）
│   │   ├── bm25_retriever.py    # BM25 全文检索
│   │   ├── fusion.py            # RRF 融合
│   │   └── reranker.py          # BGE-reranker 重排
│   ├── verify/
│   │   └── citation_verifier.py  # 引用验证
│   ├── generator/
│   │   └── compliance_reporter.py  # LLM 生成报告
│   ├── storage/
│   │   └── qdrant_client.py     # Qdrant 连接和操作
│   ├── models/
│   │   └── schemas.py           # Pydantic 数据模型
│   ├── config.py                 # 配置管理
│   ├── requirements.txt          # Python 依赖
│   └── Dockerfile               # Docker 打包
│
├── data/
│   └── corpus/                  # 预解析法规语料库（构建后生成）
│       ├── eu/                   # EU 法规 JSON
│       ├── us/                   # 美国法规 JSON
│       ├── asia/                 # 亚洲法规 JSON
│       ├── products/             # 产品专项分析 JSON
│       └── index.json            # 全量索引
│
├── scripts/
│   ├── build_corpus.py           # 批量构建语料库脚本
│   ├── ingest_to_qdrant.py       # 批量入 Qdrant 脚本
│   └── test_retrieval.py          # 检索测试脚本
│
├── src/                          # Next.js（现有代码）
│   └── app/api/scan/route.ts      # 转发请求到 rag-service
│
└── docs/
    └── RAG-ARCHITECTURE.md       # 本文档
```

---

## 七、实施计划

### Phase 0：基础设施验证（0.5天）

```
目标: 验证所有外部依赖可以连通
步骤:
1. 安装 rag-service Python 依赖
2. docker pull qdrant/qdrant && docker run 起 Qdrant
3. 验证 voyage API（云端）可连通
4. 验证 BGE-reranker 可本地加载
5. 验证 Python FastAPI 服务启动成功
```

### Phase 1：语料库构建（1.5天）

**专注 18个 EU PDF + 9个 DOCX，不碰 HTML**

```
目标: 建立可用基线
步骤:
1. 运行 build_corpus.py 解析 EU PDF → Parent-Child JSON
2. 运行 build_corpus.py 解析 DOCX → JSON（含表格描述化）
3. 运行 ingest_to_qdrant.py 入 Qdrant
4. 验证: test_retrieval.py 抽检 5 个文件
```

### Phase 2：检索验证（1天）

```
目标: 召回率验证（目标: 90%+ 准确）
步骤:
1. 准备 10+ 个测试 query
2. 检查 Top-10 是否召回正确条款
3. 调整 chunk size / reranker threshold / RRF weight
4. 测试 must_check 强制注入机制
5. 测试引用验证（verify_citations）
```

**测试 Query 列表：**

| # | 产品 | 市场 | 预期召回 |
|---|------|------|----------|
| 1 | 充电宝 | EU | REACH + RoHS + GPSR + CE |
| 2 | 乒乓球拍 | EU | REACH + GPSR + EN 71 |
| 3 | 锂电池 | US | FCC + DOT + TSCA |
| 4 | 电子手表 | EU | LVD + EMC + RED + GPSR |
| 5 | 蓝牙音箱 | EU + US | RED + FCC + CE |

### Phase 3：接入 attrax（2天）

```
目标: 端到端跑出第一张真实报告
步骤:
1. 启动 rag-service FastAPI 服务
2. 修改 app/api/scan/route.ts → POST rag-service
3. 接入 Vision 识别结果 → Query 分解
4. 接入 Claude LLM 生成报告（含引用验证）
5. 前端展示报告（引用溯源高亮）
```

### Phase 4：扩充语料（1天）

```
目标: 处理质量较好的 HTML
步骤:
1. 分类处理 35 个 HTML（静态 UTF-8 / GBK / JS渲染）
2. Playwright 处理 JS 渲染类（~10个）
3. 增量入 Qdrant
4. 评估 7 个截图 PDF：OCR 还是放弃
```

---

## 八、数据更新流程

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
DELETE /corpus/{doc_id}（删旧版本） + POST /corpus（存新版本）
       │
       ▼
验证检索效果
```

---

## 九、风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| Python/TS 分裂架构 | BGE-reranker 无法在 TS 环境运行 | ✅ 已修正：统一 Python FastAPI |
| REACH Annex XVII 超长 chunk | embedding 截断，核心条款丢失 | ✅ 已修正：Parent-Child 双层结构 |
| HTML 质量差 | 召回率低 | 分类处理，JS渲染用 Playwright |
| LLM 编造条款编号 | 报告引用不准确 | ✅ 已修正：后置引用验证层 |
| 法规版本过期 | 报告引用旧条款 | index.json 带版本号和日期 |
| 表格信息丢失 | 二维关系线性化后语义稀薄 | ✅ 已修正：description + raw_table 双字段 |
| Qdrant Docker 不被允许 | 无法本地部署 | 考虑云端 Qdrant 或纯 BM25 备选 |

---

## 十、确认事项（需在实施前确认）

1. **Qdrant 部署**: 公司 IT 是否允许 Docker 部署？若不允许，使用云端 Qdrant（qdrant.cloud）。
2. **Embedding 方式**: voyage API 云端调用（按量付费）还是本地部署（需 GPU）？
3. **法规更新频率**: 法规多久更新一次？影响版本管理设计。
4. **用户上传法规**: 是否需要支持用户自行上传法规文件入库？还是管理员维护？

---

## 十一、版本历史

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| 1.0 | 2026-04-28 | 初版方案 |
| 1.1 | 2026-04-28 | 整合专家评审意见：统一 Python FastAPI、Parent-Child 分块、HTML 分类处理、表格描述化、结构化 Query 分解、引用验证层 |