# 火鹰合规 RAG 系统实施计划 v3.1

> ⚠️ **历史文档** — 本文档描述的计划（Cohere/Qdrant/Docling 路线）**未按计划实现**。
> 实际实现见 [RAG-ARCHITECTURE-v3.md](./RAG-ARCHITECTURE-v3.md)（Ollama/FAISS/pdfplumber 路线）。
>
> 基准文档：RAG-ARCHITECTURE-v2.1 + IMPLEMENTATION-PLAN-v2.1
> 创建时间：2026-04-29
> 更新：v3.1（2026-04-29）— 升级为 Agentic RAG 架构（LangGraph 编排）
> 技术路线（计划）：Cohere API + LangGraph（实际：Ollama + FAISS + mimoTalk）
> 方法论：TDD (测试驱动) + SDD (规格驱动) + Git 原子提交

---

## 当前状态快照

| 维度 | 状态 | 详情 |
|------|------|------|
| 数据 | ✅ 87/96 文件有 rawText | 91% 覆盖，2 个 PDF 有意留空（MY/TH PDPA，HTML 版已有内容） |
| 数据质量 | ✅ 12M+ 字符 | EU 4.7M, US 3.6M, CN 2.1M 等 16 个市场 |
| 3 个乱码文件 | ✅ 已修复 | gzip 解压 → 重新解析 → rawText 已写入 |
| 前端骨架 | ✅ 完成 | Next.js 16 + shadcn/ui，Demo 模式可跑 |
| rag-service | ❌ 不存在 | 需从零搭建 |
| Git | ⏳ 待初始化 | Phase 0 T0-1 待执行 |
| Docker/Qdrant | ❌ 未运行 | 需部署 |
| API Keys | ❌ 空 | 需填入 Cohere + Anthropic |
| Python venv | ❌ 无 | 需创建 |

---

## 全局约定

### Git 分支策略
```
main                    ← 稳定版本
├── feat/phase-0-data   ← 数据清理
├── feat/phase-1-env    ← 环境搭建
├── feat/phase-2-corpus ← 语料库管线
├── feat/phase-3-retrieval ← 检索管线
├── feat/phase-4-report ← 报告生成
├── feat/phase-5-frontend ← 前后端对接
├── feat/phase-6-multi-market ← 多市场
└── feat/phase-7-eval   ← 评估管线
```

每个 phase 完成后合并到 main，打 tag：`v0.1.0-phase0`, `v0.2.0-phase1`...

### TDD 工作流
```
RED    → 写测试，运行，看到失败
GREEN  → 写最少代码让测试通过
REFACTOR → 清理，保持测试通过
```

### SDD 规格驱动
每个 task 先写规格文档（输入/输出/边界条件），再写测试，再实现。

### 目录结构（最终）
```
attrax/
├── rag-service/                    # Python FastAPI 服务
│   ├── main.py                     # 入口 + lifespan
│   ├── config.py                   # 环境变量
│   ├── requirements.txt
│   ├── .env                        # API Keys
│   │
│   ├── parser/                     # 文档解析
│   │   ├── docling_parser.py       # PDF/DOCX/HTML → JSON
│   │   └── html_parser.py          # HTML 专用（BeautifulSoup）
│   │
│   ├── chunker/                    # 分块
│   │   ├── legal_chunker.py        # Parent-Child 按 Article 切分
│   │   └── table_processor.py      # 表格双重字段
│   │
│   ├── retrieval/                  # 检索管线（基础能力）
│   │   ├── cohere_embedder.py      # Cohere embed-multilingual-v3
│   │   ├── bm25_retriever.py       # jieba BM25
│   │   ├── fusion.py               # RRF 融合
│   │   ├── cohere_reranker.py      # Cohere rerank-multilingual-v3
│   │   ├── must_check.py           # 强制注入
│   │   ├── query_rewrite.py        # 规则 Rewrite
│   │   └── hybrid_retriever.py     # 组装主类（单次检索）
│   │
│   ├── verify/                     # 引用验证
│   │   └── citation_verifier.py    # 硬门
│   │
│   ├── generate/                   # 报告生成
│   │   └── report_generator.py     # Claude Sonnet
│   │
│   ├── orchestrator/               # ★ Agentic RAG 编排层（LangGraph）
│   │   ├── graph.py                # LangGraph StateGraph 定义
│   │   ├── state.py                # GraphState TypedDict
│   │   ├── nodes/
│   │   │   ├── query_planner.py    # 查询规划（分解 + 同义词扩展）
│   │   │   ├── parallel_retriever.py  # 并行 Dense+BM25 → RRF+Rerank
│   │   │   ├── synthesis.py        # 信息综合（跨法规归并）
│   │   │   ├── citation_verifier.py  # 引用验证节点（包装 verify/）
│   │   │   └── report_generator.py # 报告生成节点（包装 generate/）
│   │   └── edges.py                # 条件路由（re-retrieve 决策）
│   │
│   ├── eval/                       # 评估
│   │   ├── test_set.json
│   │   ├── run_eval.py
│   │   └── metrics.py
│   │
│   └── tests/                      # 测试
│       ├── conftest.py
│       ├── test_html_parser.py
│       ├── test_legal_chunker.py
│       ├── test_bm25_retriever.py
│       ├── test_cohere_embedder.py
│       ├── test_citation_verifier.py
│       ├── test_rrf_fusion.py
│       ├── test_query_rewrite.py
│       ├── test_report_generator.py
│       ├── test_orchestrator.py    # ★ Agentic RAG 集成测试
│       └── test_graph_nodes.py     # ★ 各节点单元测试
│
├── scripts/                        # 现有脚本（保留）
│   ├── batch_parse_corpus.py       # 修复版
│   └── build_corpus.py             # 新增：批量入库
│
├── app/                            # Next.js 前端（现有）
├── components/                     # UI 组件（现有）
└── docs/                           # 文档（现有）
```

### Agentic RAG 架构概览（v3.1 新增）

传统 RAG 是线性管线（Retrieve → Generate），无法处理：
- **多跳推理**：产品同时受 REACH + GPSR 约束，需跨法规交叉检索
- **信息不足自动补救**：首轮召回不够时，自动追加检索而非盲目生成
- **多市场并行**：EU+US+CN 三个市场独立检索后综合

**解决方案：LangGraph StateGraph 编排**

```
                 ┌──────────────────────────────────────┐
                 │            Agent Loop (max 2)        │
                 │                                      │
  用户查询 ─────▶│  [Query Planner]                     │
                 │       │                              │
                 │       ▼                              │
                 │  [Parallel Retrieval]                │
                 │   Dense + BM25 → RRF → Rerank       │
                 │       │                              │
                 │       ▼                              │
                 │  [Synthesis]  ← 跨法规归并           │
                 │       │                              │
                 │       ▼                              │
                 │  [Citation Verifier]                 │
                 │       │                              │
                 │       ├── PASS/ACCEPT ──────────────▶│──▶ [Report Generator]
                 │       │                              │      │
                 │       └── INSUFFICIENT ─┐            │      ▼
                 │                          │            │   最终报告
                 │              ┌───────────┘            │
                 │              ▼                        │
                 │    [Query Refiner]                    │
                 │     追加同义词 / 跨法规扩展           │
                 │              │                        │
                 │              └────── 回到 Retrieval ──┘
                 └──────────────────────────────────────┘
```

**关键节点说明：**

| 节点 | 职责 | 输入 | 输出 |
|------|------|------|------|
| `QueryPlanner` | 查询分解 + 市场路由 + 同义词扩展 | 原始查询 + markets[] | per-market 子查询列表 |
| `ParallelRetriever` | Dense+BM25 并行 → RRF 融合 → Rerank | 子查询 | Top-10 chunks |
| `Synthesis` | 跨法规信息归并、去重、补充 | 多市场 chunks | 归并后 chunks |
| `CitationVerifierNode` | 验证生成内容的引用完整性 | 报告草稿 + chunks | PASS/INSUFFICIENT + 缺失引用 |
| `QueryRefiner` | 根据缺失引用追加检索条件 | 缺失引用列表 | 扩展后的查询 |
| `ReportGeneratorNode` | Claude Sonnet 最终报告 | 归并后 chunks + 查询 | Markdown 报告 |

**引入 LangGraph 的理由（研究结论）：**

1. **多跳场景占比高**：充电宝 → REACH（铅）+ GPSR（安全）+ EMC 指令，单次召回无法覆盖
2. **召回不足时无补救**：传统管线首轮召回差 → 报告质量差，无法自动修正
3. **LangGraph 比 CrewAI 轻量**：状态图 + 条件路由，无需完整 agent framework
4. **状态可追踪**：GraphState 记录每步中间结果，便于调试和 eval

---

## Phase 0：数据清理 + Git 初始化（0.5 天）

### T0-1：Git 仓库初始化
**SDD 规格：**
- 初始化 git repo
- 创建 `.gitignore`（node_modules, .next, .venv, *.pyc, __pycache__, .env, qdrant_storage/）
- 首次提交所有现有代码

**执行步骤：**
```bash
cd E:/desktop/火鹰合规/attrax
git init
# 创建 .gitignore
git add .
git commit -m "chore: initial commit - existing frontend + docs + data scripts"
git tag v0.0.1-initial
```

**验证：** `git log` 有首次提交，`git status` 干净。

**Commit:** `chore: init repo with existing frontend + docs + data scripts`

---

### T0-2：修复 HTML/DOCX rawText 缺失
**SDD 规格：**
- 输入：`data/corpus/` 下 37 个 HTML + 10 个 DOCX 原始文件
- 输出：`data/corpus/processed/` 下对应 JSON，必须包含 `rawText` 字段且长度 > 100
- 边界：文件不存在时跳过；编码错误时 fallback

**TDD：**
```python
# tests/test_html_parser.py
def test_html_parser_extracts_rawtext():
    """HTML 解析必须输出 rawText 字段"""
    result = parse_html("data/corpus/eu/regulations/html/sample.html")
    assert "rawText" in result
    assert len(result["rawText"]) > 100

def test_docx_parser_extracts_rawtext():
    """DOCX 解析必须输出 rawText 字段"""
    result = parse_docx("data/corpus/eu/products/sample.docx")
    assert "rawText" in result
    assert len(result["rawText"]) > 100
```

**实现方案：**
1. 修复 `batch_parse_corpus.py` 中 `parse_html()` 确认返回 rawText
2. 对已处理的 37+10 个 JSON 文件，重新从源文件解析并覆盖
3. 跳过 Screenshot_Pending 目录的扫描件

**验证：**
```bash
D:/python/python.exe -c "
import json, os
empty = [f for f in os.listdir('data/corpus/processed')
         if f.endswith('.json') and len(json.load(open(f,encoding='utf-8')).get('rawText','')) < 100
         and 'Screenshot' not in f]
print(f'Empty (non-screenshot): {len(empty)}')  # 目标: 0
"
```

**Commit:** `fix: restore rawText for 37 HTML + 10 DOCX processed files`

---

### T0-3：数据质量审计
**SDD 规格：**
- 生成 `data/corpus/quality_report.json`
- 每个文件报告：rawText 长度、pageMap 是否存在、metadata 完整度
- 标记需要跳过的文件（扫描件、空文件）

**Commit:** `chore: add data quality audit report`

---

## Phase 1：环境搭建（0.5 天）

### T1-1：Python 环境
**SDD 规格：**
- Python 3.10.8（已安装于 D:\python\）
- venv 路径：`attrax/.venv/`
- 核心依赖：fastapi, uvicorn, cohere, rank_bm25, jieba, beautifulsoup4, python-docx, pdfplumber, anthropic, pydantic, python-dotenv, pytest

**执行步骤：**
```bash
cd E:/desktop/火鹰合规/attrax
D:/python/python.exe -m venv .venv
source .venv/Scripts/activate
pip install fastapi uvicorn cohere rank_bm25 jieba beautifulsoup4 \
            python-docx pdfplumber anthropic pydantic python-dotenv pytest httpx
pip freeze > rag-service/requirements.txt
```

**验证：**
```bash
python -c "import cohere; print('Cohere OK')"
python -c "import jieba; print(jieba.lcut('REACH Article 22')); print('jieba OK')"
python -c "import rank_bm25; print('BM25 OK')"
```

**Commit:** `chore: setup Python venv + requirements.txt`

---

### T1-2：Docker Qdrant 部署
**SDD 规格：**
- Qdrant Docker 容器，端口 6333/6334
- 持久化存储：`qdrant_storage` volume
- 两个 Collection：`legal_chunks`（带向量）、`legal_chunks_parents`（仅存储）

**执行步骤：**
```bash
docker pull qdrant/qdrant
docker run -d --name qdrant \
  -p 6333:6333 -p 6334:6334 \
  -v qdrant_storage:/qdrant/storage \
  qdrant/qdrant
curl http://localhost:6333/healthz
```

**TDD：**
```python
# tests/test_qdrant_init.py
def test_qdrant_health():
    resp = httpx.get("http://localhost:6333/healthz")
    assert resp.status_code == 200

def test_create_collections():
    # 运行 init_collections.py
    # 验证 collections 存在
    client = QdrantClient(host="localhost", port=6333)
    collections = [c.name for c in client.get_collections().collections]
    assert "legal_chunks" in collections
    assert "legal_chunks_parents" in collections
```

**Commit:** `chore: add Qdrant init script + health check tests`

---

### T1-3：环境变量配置
**SDD 规格：**
- `.env` 文件（rag-service/.env），不提交到 git
- `.env.example` 提交到 git（无真实 key）
- 必填：`COHERE_API_KEY`, `ANTHROPIC_API_KEY`
- 可选：`QDRANT_HOST`, `QDRANT_PORT`

```env
# rag-service/.env.example
COHERE_API_KEY=your-cohere-api-key
ANTHROPIC_API_KEY=your-anthropic-api-key
QDRANT_HOST=localhost
QDRANT_PORT=6333
DEMO_MODE=false
```

**验证：** `config.py` 能正确读取所有环境变量，缺失时抛明确错误。

**Commit:** `chore: add env config + .env.example`

---

### T1-4：项目骨架创建
**SDD 规格：**
- 创建 rag-service/ 下所有目录和 `__init__.py`
- 创建 `main.py`（FastAPI 入口，含 lifespan）
- 创建 `config.py`（Pydantic Settings）

**Commit:** `feat: create rag-service project skeleton`

---

## Phase 2：语料库管线（3 天） — TDD

### T2-1：HTML 解析器增强（0.5 天）
**SDD 规格：**
- 输入：HTML 文件路径
- 输出：`{ rawText, tables, metadata, pageCount: 1 }`
- BeautifulSoup 替换正则解析，提取 `<article>`, `<main>`, 正文
- 移除 nav/footer/script/style 噪音
- 保留表格结构

**TDD 测试优先：**
```python
# tests/test_html_parser.py
class TestHtmlParser:
    def test_extracts_main_text(self, sample_html_file):
        result = parse_html(sample_html_file)
        assert len(result["rawText"]) > 100
        assert "<script>" not in result["rawText"]

    def test_extracts_tables(self, html_with_tables):
        result = parse_html(html_with_tables)
        assert len(result["tables"]) > 0

    def test_handles_encoding_error(self, gbk_html_file):
        result = parse_html(gbk_html_file)
        assert len(result["rawText"]) > 0

    def test_truncates_very_long_html(self):
        # 超过 100k 字符的 HTML 截断到 100k
        ...
```

**Git:** `feat(parser): HTML parser with BeautifulSoup + encoding fallback`

---

### T2-2：DOCX 解析器（0.5 天）
**SDD 规格：**
- 输入：DOCX 文件路径
- 输出：`{ rawText, tables, metadata, paragraphCount }`
- 使用 `python-docx` 提取段落文本和表格

**TDD：**
```python
# tests/test_docx_parser.py
class TestDocxParser:
    def test_extracts_paragraphs(self, sample_docx):
        result = parse_docx(sample_docx)
        assert len(result["rawText"]) > 100
        assert result["paragraphCount"] > 0

    def test_extracts_tables(self, docx_with_tables):
        result = parse_docx(docx_with_tables)
        assert len(result["tables"]) > 0
```

**Git:** `feat(parser): DOCX parser with python-docx`

---

### T2-3：LegalChunker 实现（1 天）
**SDD 规格：**
- **两档索引：Child（300-500 tokens）+ Parent（全 Article）**
  - Child：按 Article 边界切分，300-500 tokens。短 Article（< 400 tokens）保持完整。
  - Parent：全 Article 或 Section（最多 2000 tokens），检索时扩展上下文窗口。
  - **Late Chunking 可选**（Jina v2 8k context）：全文档 embedding 后切分向量，保留跨 Article 引用语义。
- **边界检测：正则优先，LLM fallback**
  - EU: `^(Article|Annex|Recital)\s+\d+[a-z]?\b`
  - CN: `^第[一二三四五六七八九十百千零]+[条章节段款]`
  - US: `^§\s*\d+(\.\d+)*\b|^Section\s+\d+`
  - PDF 格式混乱时：`gpt-4o-mini` 每页调用提取 section headers（低成本 fallback）
- **元数据树**：每 chunk 继承完整路径：`REACH → Title II → Article 5 → paragraph 1`
- **跨语言 Prepend**：中英双语标签 `[REACH | 附件XVII | 条目63 | 铅限制 | Lead Restriction]`，提升跨语言检索 10-35%
- **表格处理**：小表格（< 30 行）保留 Markdown 格式 + 周围 article 上下文；大表格（REACH Annex 100+ 行）按行组拆分，header 重复 prepend
- **Overlap**：Article 边界无 overlap（语义独立）；长 Article 内拆分段落时 50-80 token overlap

**TDD：**
```python
# tests/test_legal_chunker.py
class TestLegalChunker:
    def test_article_boundary_split(self, reach_text):
        """按 Article 边界切分，不跨 Article"""
        result = chunk_document(reach_text, metadata)
        for chunk in result["child_chunks"]:
            assert chunk.article_no is not None

    def test_child_size_range(self, reach_text):
        """Child chunk 在 300-500 tokens 范围"""
        result = chunk_document(reach_text, metadata)
        for chunk in result["child_chunks"]:
            tokens = estimate_tokens(chunk.content)
            assert 200 <= tokens <= 600

    def test_short_article_whole(self, gdpr_short_article):
        """短 Article（<400 tokens）保持完整，不被拆分"""
        result = chunk_document(gdpr_short_article, metadata)
        # 只有一个 child，parent 即 article 本身
        assert len(result["child_chunks"]) == 1

    def test_parent_contains_children(self, reach_text):
        """Parent 包含其所有 children 的内容"""
        result = chunk_document(reach_text, metadata)
        for parent in result["parent_chunks"]:
            children = [c for c in result["child_chunks"]
                       if c.parent_id == parent.id]
            assert len(children) >= 1

    def test_metadata_tree(self, reach_text):
        """每个 chunk 继承完整路径元数据"""
        result = chunk_document(reach_text, metadata)
        first = result["child_chunks"][0]
        assert "article_no" in first.metadata
        assert "section_path" in first.metadata  # e.g. ["Title II", "Chapter 3", "Article 5"]

    def test_bilingual_prepend(self, reach_text):
        """中英双语 contextual prepend"""
        result = chunk_document(reach_text, metadata)
        first = result["child_chunks"][0]
        # 应同时包含中英文标签
        assert "REACH" in first.content[:80] or "Article" in first.content[:80]

    def test_table_markdown_serialization(self, doc_with_table):
        """表格序列化为 Markdown 格式"""
        result = chunk_document(doc_with_table, metadata)
        tables = result.get("tables", [])
        for tbl in tables:
            # Markdown 格式：| Header | Header |
            assert "|" in tbl or any("|" in row for row in tbl)
```

**Git:** `feat(chunker): Parent-Child LegalChunker with Article boundary split`

---

### T2-4：批量入库脚本（1 天）
**SDD 规格：**
- 输入：`data/corpus/processed/*.json`
- 流程：JSON → LegalChunker → Cohere Embedding → Qdrant
- Cohere 批量 embedding：每批 96 条（API 限制）
- Parent chunks 存入 `legal_chunks_parents` collection
- 输出：入库统计（child 数、parent 数、跳过数）

**TDD：**
```python
# tests/test_ingestion.py
class TestIngestion:
    def test_cohere_embedding_dimension(self):
        """Cohere embed-multilingual-v3 输出 1024 维"""
        client = cohere.ClientV2(api_key=TEST_KEY)
        resp = client.embed(texts=["test"], model="embed-multilingual-v3.0")
        assert len(resp.embeddings[0]) == 1024

    def test_batch_ingest_creates_points(self, qdrant_client, sample_chunks):
        """入库后 Qdrant 中有对应 points"""
        ingest_chunks(sample_chunks, "legal_chunks")
        count = qdrant_client.count("legal_chunks").count
        assert count >= len(sample_chunks)

    def test_skips_empty_rawtext(self):
        """rawText 为空的文件跳过"""
        ...
```

**预期结果：**
- ~40 个有 rawText 的文件 → ~3000-5000 child chunks
- Parent chunks ~800-1500

**Git:** `feat(ingest): corpus → chunks → Cohere embed → Qdrant pipeline`

---

## Phase 3：检索管线（3 天） — TDD

### T3-1：Cohere Dense Retriever（0.5 天）
**SDD 规格：**
- 使用 `cohere.ClientV2.embed()` 
- 模型：`embed-multilingual-v3.0`，1024 维
- Contextual Prepending 在 embedding 前执行
- 查询向量在 Qdrant 中做 cosine 搜索
- 返回 Top-50

**TDD：**
```python
# tests/test_cohere_embedder.py
class TestCohereEmbedder:
    def test_embed_query_returns_vector(self):
        """查询 embedding 返回 1024 维向量"""
        embedder = CohereEmbedder(api_key=TEST_KEY)
        vec = embedder.embed_query("充电宝铅含量限制")
        assert len(vec) == 1024

    def test_embed_batch(self):
        """批量 embedding 返回正确数量"""
        embedder = CohereEmbedder(api_key=TEST_KEY)
        vecs = embedder.embed_batch(["text1", "text2", "text3"])
        assert len(vecs) == 3
        assert all(len(v) == 1024 for v in vecs)

    def test_search_returns_top_k(self, qdrant_with_data):
        """检索返回指定数量的结果"""
        retriever = CohereDenseRetriever(embedder, qdrant_client)
        results = retriever.search("REACH 铅含量", top_k=10)
        assert len(results) <= 10
```

**Git:** `feat(retrieval): Cohere dense embedder + Qdrant search`

---

### T3-2：jieba BM25 Retriever（0.5 天）
**SDD 规格：**
- jieba 分词，加载法律术语词典
- BM25 索引从 Qdrant payload 的 content 字段构建
- 支持中英文混合查询
- 返回 Top-50

**TDD：**
```python
# tests/test_bm25_retriever.py
class TestBM25Retriever:
    def test_chinese_tokenization(self):
        """中文法律术语正确分词"""
        tokens = tokenize("REACH法规铅含量限制要求")
        assert "REACH" in tokens
        assert "铅" in tokens or "铅含量" in tokens

    def test_bm25_returns_relevant_results(self, bm25_with_data):
        """BM25 返回相关结果"""
        results = bm25.search("CE标识要求", top_k=10)
        assert len(results) > 0
        # 结果中应包含 CE 相关内容
        assert any("CE" in r["content"] for r in results)
```

**Git:** `feat(retrieval): jieba BM25 retriever with legal term dict`

---

### T3-3：RRF 融合 + Must Check（0.5 天）
**SDD 规格：**
- RRF (Reciprocal Rank Fusion)，k=25
- 融合 Dense Top-50 + BM25 Top-50
- Must Check：按产品类别注入强制法规
  - electronics → RoHS, EMC, LVD
  - toy → EN 71, Toy Safety Directive
  - appliance → LVD, ErP

**TDD：**
```python
# tests/test_rrf_fusion.py
class TestRRFFusion:
    def test_rrf_merges_results(self):
        """RRF 合并两个列表，按分数排序"""
        dense = [{"id": "1", "score": 0.9}, {"id": "2", "score": 0.8}]
        bm25 = [{"id": "2", "score": 10}, {"id": "3", "score": 8}]
        fused = rrf_fuse(dense, bm25, k=25)
        # id=2 在两个列表中都出现，应排最高
        assert fused[0]["id"] == "2"

    def test_must_check_injects(self):
        """电子产品类别强制注入 RoHS"""
        results = [{"id": "1", "content": "..."}]
        injected = apply_must_check(results, "electronics")
        # 应包含 RoHS 相关条款
        assert any("RoHS" in r.get("doc_name", "") for r in injected)
```

**Git:** `feat(retrieval): RRF fusion + must_check injection`

---

### T3-4：Cohere Reranker（0.5 天）
**SDD 规格：**
- 使用 `cohere.ClientV2.rerank()`
- 模型：`rerank-multilingual-v3.0`
- 输入：query + Top-20 融合结果
- 输出：Top-10 重排序结果

**TDD：**
```python
# tests/test_cohere_reranker.py
class TestCohereReranker:
    def test_rerank_reorders_results(self):
        """Reranker 重新排序结果"""
        reranker = CohereReranker(api_key=TEST_KEY)
        docs = ["REACH Article 22 铅含量", "GDPR 数据保护", "RoHS 有害物质"]
        results = reranker.rerank("铅含量限制", docs, top_n=2)
        assert len(results) == 2
        # REACH 应排在 GDPR 前面
        assert results[0]["index"] == 0
```

**Git:** `feat(retrieval): Cohere reranker integration`

---

### T3-5：HybridRetriever 组装 + Query Rewrite（1 天）
**SDD 规格：**
- 组装 Dense → BM25 → RRF → Must Check → Rerank → Parent 映射
- Query Rewrite 规则引擎：
  - "充电宝" → "移动电源 移动充电器 power bank"
  - "加湿器" → "超声波加湿器 humidifier mist maker"
- API 端点：`POST /retrieve`

**TDD：**
```python
# tests/test_hybrid_retriever.py
class TestHybridRetriever:
    def test_end_to_end_retrieve(self):
        """端到端检索返回结构化结果"""
        result = hybrid.retrieve(
            query="充电宝铅含量限制",
            product_category="electronics",
            market="EU",
            top_k=5,
        )
        assert len(result["chunks"]) >= 3
        for c in result["chunks"]:
            assert "rerank_score" in c
            assert "content" in c
            assert "doc_name" in c

    def test_query_rewrite(self):
        """查询重写扩展同义词"""
        rewritten = rewrite_query("充电宝出口欧盟")
        assert "移动电源" in rewritten or "power bank" in rewritten.lower()

# tests/test_api_retrieve.py
class TestRetrieveAPI:
    def test_retrieve_endpoint(self, client):
        """POST /retrieve 返回 200"""
        resp = client.post("/retrieve", json={
            "query": "CE 标识要求",
            "category": "electronics",
            "markets": ["EU"],
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "chunks" in data
```

**Git:** `feat(retrieval): HybridRetriever + Query Rewrite + /retrieve endpoint`

---

## Phase 4：报告生成 + 硬门（2 天） — TDD

### T4-1：Citation Verifier（0.5 天）
**SDD 规格：**
- 输入：生成的报告文本 + 检索到的 chunks
- 验证：报告中每个 `[法规名 Article X p.Y]` 引用是否存在于 chunks 中
- 子串匹配（非精确匹配）
- 输出：`{ verified_count, rejected_count, details[] }`

**TDD：**
```python
# tests/test_citation_verifier.py
class TestCitationVerifier:
    def test_valid_citation_passes(self):
        """报告中引用存在于 chunks 中 → verified"""
        report = "铅含量限制参见 [REACH Article 22 p.45]"
        chunks = [{"doc_name": "REACH", "article_no": "Article 22",
                   "page_start": 45, "content": "..."}]
        result = verifier.verify(report, chunks)
        assert result.verified_count == 1

    def test_fabricated_citation_rejected(self):
        """报告中引用不存在于 chunks 中 → rejected"""
        report = "参见 [Fake Regulation Article 99 p.1]"
        chunks = [{"doc_name": "REACH", "article_no": "Article 22",
                   "page_start": 45, "content": "..."}]
        result = verifier.verify(report, chunks)
        assert result.verified_count == 0
        assert result.rejected_count == 1

    def test_hard_gate_decisions(self):
        """硬门决策：0 verified → REJECT, 1-2 → WARN, >=3 → PASS"""
        # 用不同数量的 verified 构造测试
        ...
```

**Git:** `feat(verify): CitationVerifier with hard gate logic`

---

### T4-2：报告生成器（1 天）
**SDD 规格：**
- Claude Sonnet 报告生成
- Prompt 要求每个结论附带 `[法规名 Article X p.Y]` 引用
- 禁止编造未出现在检索结果中的法规
- 输出 Markdown 格式

**TDD：**
```python
# tests/test_report_generator.py
class TestReportGenerator:
    def test_report_contains_citations(self):
        """生成报告包含法规引用"""
        generator = ReportGenerator(api_key=TEST_KEY)
        report = generator.generate(
            product="USB 充电宝",
            markets=["EU"],
            vision_result={"category": "electronics"},
            chunks=[{"doc_name": "REACH", "article_no": "22", ...}],
        )
        assert "[REACH" in report or "Article" in report

    def test_report_rejects_empty_chunks(self):
        """chunks 为空时不生成报告"""
        with pytest.raises(InsufficientContextError):
            generator.generate(product="test", markets=["EU"],
                             vision_result={}, chunks=[])
```

**Git:** `feat(generate): Claude Sonnet compliance report generator`

---

### T4-3：/generate-report 端点（0.5 天）
**SDD 规格：**
- 流程：检索 → 生成 → 验证 → 硬门决策
- 响应：`{ status: "PASS"|"WARN"|"REJECTED", report, verification }`

**TDD：**
```python
# tests/test_api_generate.py
class TestGenerateReportAPI:
    def test_full_pipeline(self, client):
        """POST /generate-report 端到端"""
        resp = client.post("/generate-report", json={
            "query": "充电宝欧盟合规要求",
            "product": "USB 充电宝",
            "category": "electronics",
            "markets": ["EU"],
            "vision_result": {},
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] in ["PASS", "WARN", "REJECTED"]
        if data["status"] != "REJECTED":
            assert len(data["report"]) > 100
```

**Git:** `feat(api): /generate-report endpoint with citation hard gate`

---

## Phase 5：Agentic RAG 编排（2 天） — TDD

> 本阶段引入 LangGraph，将 Phase 3 检索 + Phase 4 报告生成组装为 Agent 循环。
> 不替换已有模块，而是在其之上加编排层。
>
> **研究参考：** `langchain-ai/langgraph` 官方 Agentic RAG / CRAG / Self-RAG 示例；
> `emarcober/rag-agents-langgraph` 多 agent 并行检索；`HuCRAG/CRAG` 纠正性 RAG。

### T5-1：GraphState 定义（0.25 天）
**SDD 规格：**
```python
# orchestrator/state.py
from typing import TypedDict, Annotated
import operator

class GraphState(TypedDict):
    # === 输入 ===
    query: str
    product: str
    category: str
    markets: list[str]
    vision_result: dict

    # === Agent 中间状态 ===
    # Annotated[list, operator.add] 使多个节点的输出自动合并（LangGraph fan-in）
    sub_queries: list[dict]                              # QueryPlanner 输出
    documents: Annotated[list[dict], operator.add]       # 每轮召回自动累加
    generation: str                                      # 当前生成文本
    relevance_score: str                                 # "relevant" | "not_relevant"
    generation_score: str                                # "supported" | "not_supported"
    missing_citations: list[str]                         # 缺失引用列表
    loop_count: int                                      # 当前重试轮次（CRITICAL：防无限循环）

    # === 配置 ===
    max_attempts: int                                    # 最大重试（默认 2）

    # === 最终输出 ===
    final_report: str
    status: str                                          # PASS | WARN | REJECTED
    agent_trace: list[dict]                              # 每步节点名 + 耗时，前端展示进度
```

**设计要点（基于研究）：**
- `documents` 使用 `Annotated[list, operator.add]` — 多轮检索结果自动合并，无需手动 dedup
- `loop_count` 在 QueryRefiner 节点递增（不在 retrieve 节点），防止无限循环
- `agent_trace` 记录每步执行信息，支持 SSE 进度推送

**TDD：**
```python
def test_graph_state_has_all_fields():
    state: GraphState = {
        "query": "test", "product": "", "category": "",
        "markets": ["EU"], "vision_result": {},
        "sub_queries": [], "documents": [],
        "generation": "", "relevance_score": "",
        "generation_score": "", "missing_citations": [],
        "loop_count": 0, "max_attempts": 2,
        "final_report": "", "status": "PENDING",
        "agent_trace": [],
    }
    assert state["loop_count"] == 0

def test_documents_additive_reducer():
    """Annotated[list, operator.add] 自动合并多次输出"""
    # LangGraph 内部测试：两个节点都返回 {"documents": [a]} → state.documents = [a, a]
    ...
```

**Git:** `feat(orchestrator): add GraphState with operator.add reducer + loop_count`

---

### T5-2：QueryPlanner 节点（0.5 天）
**SDD 规格：**
- 输入：`GraphState.query`, `GraphState.markets`
- 处理：
  1. 规则引擎：同义词扩展（"充电宝" → "power bank 移动电源"）
  2. LLM 分解：多市场 → per-market 子查询（可选，无 LLM 时用规则 fallback）
  3. 产品类别 → must_check 法规列表预加载
- 输出：更新 `state.sub_queries`

**TDD：**
```python
# tests/test_graph_nodes.py
class TestQueryPlanner:
    def test_single_market(self):
        state = mk_state(query="CE 标识要求", markets=["EU"])
        result = query_planner_node(state)
        assert len(result["sub_queries"]) == 1
        assert result["sub_queries"][0]["market"] == "EU"

    def test_multi_market_decompose(self):
        state = mk_state(query="充电宝出口欧盟和美国", markets=["EU", "US"])
        result = query_planner_node(state)
        markets = {sq["market"] for sq in result["sub_queries"]}
        assert markets == {"EU", "US"}

    def test_synonym_expansion(self):
        state = mk_state(query="充电宝铅含量", markets=["EU"])
        result = query_planner_node(state)
        expanded = result["sub_queries"][0]["query"]
        assert "power bank" in expanded.lower() or "移动电源" in expanded
```

**Git:** `feat(orchestrator): QueryPlanner node with synonym + market decompose`

---

### T5-3：ParallelRetriever + Synthesis 节点（0.5 天）
**SDD 规格：**
- 使用 LangGraph **`Send()` API** 实现多市场并行扇出（参考 `emarcober/rag-agents-langgraph`）
- `documents` 字段用 `Annotated[list, operator.add]`，多个市场结果自动合并
- 每个 market 子图调用 `HybridRetriever.retrieve()`，结果按 rerank_score 排序
- `synthesis_node`：跨法规归并
  - 标记来源市场和来源法规
  - 必须检查法规（must_check）若未命中则警告
  - 按 `chunk_id` 去重（多市场可能召回相同法规的相同条款）

**Send() 扇出模式（研究推荐）：**
```python
from langgraph.types import Send

def fan_out_markets(state: GraphState) -> list[Send]:
    """多市场并行扇出 — 每个 market 一个独立检索节点"""
    return [
        Send("retrieve_single_market", {"query": sq["query"], "market": sq["market"]})
        for sq in state["sub_queries"]
    ]

# 每个 Send 的结果自动通过 operator.add 合并到 state.documents
```

**TDD：**
```python
class TestParallelRetriever:
    def test_calls_retriever_per_sub_query(self, mock_hybrid):
        state = mk_state(sub_queries=[
            {"market": "EU", "query": "CE 标识"},
            {"market": "US", "query": "FCC 认证"},
        ])
        result = parallel_retriever_node(state)
        assert len(result["chunks"]) > 0
        assert mock_hybrid.call_count == 2

    def test_deduplicates_by_id(self):
        # 两个市场召回相同 chunk → 只保留一个
        ...

class TestSynthesis:
    def test_marks_market_source(self):
        state = mk_state(chunks=[
            {"id": "1", "market": "EU", "doc_name": "REACH"},
            {"id": "2", "market": "US", "doc_name": "TSCA"},
        ])
        result = synthesis_node(state)
        assert result["synthesis"]["markets_covered"] == {"EU", "US"}
```

**Git:** `feat(orchestrator): ParallelRetriever + Synthesis nodes`

---

### T5-4：CitationVerifier 节点 + 条件路由（0.5 天）
**SDD 规格：**
- `citation_verifier_node`：包装 `verify/citation_verifier.py`
- **升级为 NLI Claim Verification**（参考 `vectara/hallucination-leaderboard`，`HuCRAG/CRAG`）：
  1. 将生成文本拆分为原子 claims（spaCy 句子分割 或 LLM 提取）
  2. 每个 claim vs 每个 source chunk，用 DeBERTa-v3-large-mnli 做 NLI 分类：
     - **ENTAILED** → 支持（计数 +1）
     - **CONTRADICTED** → 矛盾（**硬拒绝**，直接 REJECT）
     - **NEUTRAL** → 无依据（标记 UNVERIFIED）
  3. Attribution Score = (ENTAILED / total_claims) × (verified_citations / total_citations)
  4. 硬门：`score >= 0.9` → PASS，`0.7 <= score < 0.9` → WARN，`score < 0.7` → BLOCK
- 输出：更新 `generation_score`, `missing_citations`
- 条件路由 `should_regenerate`：
  - `generation_score == "supported"` 且 `score >= 0.7` → 去 END
  - `loop_count < max_attempts` 且 `score < 0.7` → 去 QueryRefiner（追加检索）
  - `loop_count >= max_attempts` → 强制输出带 WARN 标签

**为什么用 NLI 而非 regex（研究结论）：**
- regex 子串匹配只检查引用标记是否存在，不验证内容是否真实支持
- LLM-as-judge 存在"自己验证自己"的循环依赖
- NLI（DeBERTa）是确定性的、快速的、可审计的，适合合规场景

**TDD：**
```python
class TestCitationVerifierNode:
    def test_pass_goes_to_generate(self):
        state = mk_state(
            draft_report="[REACH Article 22 p.45] 铅含量限制",
            chunks=[{"doc_name": "REACH", "article_no": "22",
                     "page_start": 45, "content": "..."}],
            attempt=0,
        )
        result = citation_verifier_node(state)
        assert result["verification"]["passed_count"] >= 1

    def test_insufficient_triggers_refine(self):
        state = mk_state(
            draft_report="[Fake Article 99 p.1]",
            chunks=[{"doc_name": "REACH", "article_no": "22", ...}],
            attempt=0, max_attempts=2,
        )
        # should_regenerate(state) == "query_refiner"
        ...

    def test_max_attempts_forces_generate(self):
        state = mk_state(attempt=2, max_attempts=2)
        # should_regenerate(state) == "report_generator"
        ...
```

**Git:** `feat(orchestrator): CitationVerifier node + conditional routing edges`

---

### T5-5：QueryRefiner 节点（0.25 天）
**SDD 规格：**
- 输入：`missing_citations` 列表 + 当前 `generation`
- 处理：
  1. **HyDE（Hypothetical Document Embedding）**：用当前 `generation` 作为"假设理想答案"，重新构造查询
  2. 从缺失引用中提取法规名，追加同义词扩展
  3. `loop_count += 1`（在此节点递增，不在 retrieve 节点）
- 输出：扩展后的 `sub_queries`, `loop_count += 1`
- **HyDE 原理（研究推荐）**：当正常查询召回不足时，先让 LLM 生成一个假设性的"理想答案段落"，用这个段落作为 embedding 查询，比原始问题更接近真实文档的措辞，显著提高二轮召回率

**TDD：**
```python
class TestQueryRefiner:
    def test_adds_queries_for_missing_citations(self):
        state = mk_state(
            missing_citations=["GPSR Article 8", "EMC Article 6"],
            sub_queries=[{"market": "EU", "query": "CE 标识"}],
            attempt=0,
        )
        result = query_refiner_node(state)
        assert len(result["sub_queries"]) > len(state["sub_queries"])
        assert result["attempt"] == 1
```

**Git:** `feat(orchestrator): QueryRefiner node for missing citations`

---

### T5-6：LangGraph StateGraph 组装（0.25 天）
**SDD 规格：**
```python
# orchestrator/graph.py
from langgraph.graph import StateGraph, END
from langgraph.types import Send

def build_compliance_graph() -> CompiledStateGraph:
    g = StateGraph(GraphState)

    # 节点
    g.add_node("query_planner",    query_planner_node)
    g.add_node("fan_out_markets",  fan_out_markets)       # Send() 扇出调度
    g.add_node("retrieve",         retrieve_node)          # 每市场独立检索
    g.add_node("synthesis",       synthesis_node)          # 归并去重
    g.add_node("generate",         generate_node)           # Claude Sonnet 报告
    g.add_node("verify",          verify_node)             # NLI claim 验证
    g.add_node("query_refiner",   query_refiner_node)      # HyDE 重查询

    # 入口
    g.set_entry_point("query_planner")

    # 固定边
    g.add_edge("query_planner", "fan_out_markets")

    # ★ 条件扇出：每市场一个 Send → 各自 retrieve → 结果自动合并
    g.add_conditional_edges(
        "fan_out_markets",
        lambda state: [
            Send("retrieve", {"query": sq["query"], "market": sq["market"]})
            for sq in state["sub_queries"]
        ],
    )

    # 归并后生成
    g.add_edge("retrieve", "synthesis")
    g.add_edge("synthesis", "generate")
    g.add_edge("generate", "verify")

    # 条件路由（基于 generation_score + loop_count）
    def should_regenerate(state: GraphState) -> str:
        if state["generation_score"] == "supported":
            return "end"
        if state["loop_count"] < state["max_attempts"]:
            return "refine"
        return "end"  # 达到上限，强制输出 WARN

    g.add_conditional_edges(
        "verify",
        should_regenerate,
        {
            "end":   END,
            "refine": "query_refiner",
        },
    )
    g.add_edge("query_refiner", "fan_out_markets")  # 回到检索

    return g.compile(recursion_limit=15)  # 安全兜底：最多 15 步
```

**关键设计（基于研究）：**
- `recursion_limit=15` 防止任何情况下无限循环
- `loop_count` 在 `query_refiner` 节点递增，retrieve 节点不修改状态
- 多市场结果通过 `Annotated[list, operator.add]` 自动合并，无需手动 dedup
- 使用 `Send()` 而非 `group_by`，保留每个市场的独立执行上下文

---

### T5-7：/scan Agentic 端点（0.25 天）
**SDD 规格：**
- `POST /scan` → 调用 `compliance_graph.invoke()`
- `agent_trace` 记录每步节点名 + 耗时，前端 SSE 推送进度
- `recursion_limit=15` + 120s 超时兜底

**TDD：**
```python
class TestScanAPI:
    def test_scan_returns_agent_trace(self, client):
        resp = client.post("/scan", json={
            "query": "CE 标识要求",
            "category": "electronics",
            "markets": ["EU"],
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "agent_trace" in data
        assert any(step["node"] == "query_planner" for step in data["agent_trace"])

    def test_max_retries_forces_output(self):
        # 达到 max_attempts 后返回带 status=WARN 的报告
        ...

    def test_consecutive_retrieval_bypasses_planner(self):
        # 重试时跳过 query_planner，直接 retrieve
        ...
```

**Git:** `feat(api): /scan endpoint with agent_trace + SSE progress`

---

## Phase 6：前端-后端对接（2 天） — TDD

### T6-1：Next.js API 转发层（1 天）
**SDD 规格：**
- `POST /api/scan` → 转发到 `http://localhost:8000/generate-report`
- `GET /api/scan/[sessionId]` → 轮询 rag-service 状态
- 超时处理：60s 无响应 → failed
- 错误映射：rag-service 错误 → 前端友好消息

**TDD：**
```typescript
// __tests__/api/scan.test.ts
describe('POST /api/scan', () => {
  it('forwards to rag-service and returns sessionId', async () => {
    const formData = new FormData();
    formData.append('images', mockFile);
    formData.append('category', 'electronics');
    formData.append('markets', 'EU,US');

    const response = await POST(createRequest(formData));
    expect(response.status).toBe(202);
    const data = await response.json();
    expect(data.sessionId).toBeDefined();
    expect(data.pollUrl).toContain('/api/scan/');
  });

  it('returns 400 for empty upload', async () => {
    const formData = new FormData();
    const response = await POST(createRequest(formData));
    expect(response.status).toBe(400);
  });
});
```

**Git:** `feat(api): forward scan requests to rag-service`

---

### T6-2：前端 UI 适配（1 天）
**SDD 规格：**
- 结果页展示 RAG 报告（Markdown 渲染）
- 引用状态徽章：PASS (绿) / WARN (黄) / REJECTED (红)
- 法规引用可点击跳转（如有 sourceUrl）
- 进度条阶段文字对齐 rag-service 实际进度
- 加载态、错误态、空态完善

**验收标准：**
- [ ] 上传图片 → 等待 → 显示 RAG 报告，全流程可跑
- [ ] 报告中法规引用高亮显示
- [ ] 引用验证状态清晰可见
- [ ] 加载失败有重试按钮
- [ ] 移动端响应式正常

**Git:** `feat(ui): adapt result page for RAG report display`

---

## ~~旧 Phase 6：多市场查询分解~~ → 已合并至 Phase 5 T5-2 QueryPlanner

> 多市场分解 + 并行检索 + 结果归并已作为 QueryPlanner / ParallelRetriever / Synthesis 节点
> 实现在 Phase 5 Agentic RAG 编排中，不再单独成阶段。

---

## Phase 7：评估管线（2 天） — TDD

### T7-1：Ground-Truth 测试集（0.5 天）
**SDD 规格：**
- 从语料库自动生成 200+ 测试用例
- 每个用例：`question + ground_truth_answer + source_document + market`
- 关键/非关键分类，关键用例覆盖 REACH + GPSR + EMC 跨法规场景
- 参考 `RAGAS` 格式：测试集含 ground truth answers 供 Recall@K 计算

**Commit:** `feat(eval): auto-generate 200+ ground-truth test set`

---

### T7-2：评估脚本（1 天）
**SDD 规格：**
- **RAGAS 框架**（`explodinggradients/ragas`）：
  - `faithfulness`: 报告中 % 的 claims 有 source 支撑（NLI-based，线下）
  - `answer_relevancy`: 报告是否回答了原始问题
  - `context_precision`: 召回的 docs 有多少实际相关
  - `context_recall`: ground truth 的 % 被召回 docs 覆盖
- **线下 NLI 验证**：用 DeBERTa-v3-large-mnli 跑 faithfulness，不依赖 LLM-as-judge
- 目标：Recall ≥ 90%, Faithfulness ≥ 95%, Hallucination ≤ 2%
- 输出：JSON 报告 + 控制台摘要 + HTML 可视化（可选）

**Git:** `feat(eval): evaluation pipeline with metrics`

---

### T7-3：CI 集成（0.5 天）
**SDD 规格：**
- GitHub Actions / 本地脚本
- Push 时自动运行评估
- 门禁：Recall ≥ 85%, Hallucination ≤ 5%

**Git:** `ci: add RAG evaluation gate`

---

## 任务总表 + 依赖图

```
Phase 0 (数据清理) ✅          Phase 1 (环境)
T0-1 Git Init ──┐          T1-1 Python venv ──┐
T0-2 Fix rawText ─┤ ✅      T1-2 Qdrant ────────┤
T0-3 Quality ────┘ ✅       T1-3 Env vars ──────┤
                            T1-4 Skeleton ──────┘
                                    │
                                    ▼
                           Phase 2 (语料库)
                    T2-1 HTML Parser ──┐
                    T2-2 DOCX Parser ──┤
                    T2-3 LegalChunker ─┤ (depends on T2-1,2)
                    T2-4 Ingestion ────┘ (depends on T2-3)
                                    │
                    ┌───────────────┘
                    ▼
            Phase 3 (检索管线)
            T3-1 Dense Retriever
            T3-2 BM25 Retriever      ←┐
            T3-3 RRF + Must Check     │ 独立并行
            T3-4 Cohere Reranker     ←┘
            T3-5 HybridRetriever 组装 (depends on T3-1~4)
                    │
                    ▼
            Phase 4 (报告生成 + 硬门)
            T4-1 Citation Verifier
            T4-2 Report Generator
            T4-3 /generate-report endpoint
                    │
                    ▼
            Phase 5 (Agentic RAG 编排) ★ 新增
            T5-1 GraphState
            T5-2 QueryPlanner 节点   ←─┐
            T5-3 ParallelRetriever     │ 可并行开发
            T5-4 CitationVerifier 节点 ←┘
            T5-5 QueryRefiner
            T5-6 LangGraph 组装 (depends on T5-1~5)
            T5-7 /scan endpoint (depends on T5-6)
                    │
                    ▼
            Phase 6 (前后端对接)
            T6-1 API 转发层
            T6-2 UI 适配
                    │
                    ▼
            Phase 7 (评估)
            T7-1 Test Set
            T7-2 Eval Script
            T7-3 CI Gate
```

---

## 里程碑

| 周 | Phase | 交付物 | 验收标准 |
|----|-------|--------|---------|
| W1 D1 | P0+P1 | Git 初始化 + 数据修复 + 环境搭建 | 91% 数据覆盖，Qdrant healthz OK |
| W1 D2-4 | P2 | 语料库管线 | ~5000 child chunks 入库，REACH 可检索 |
| W2 D1-3 | P3 | 检索管线 | HybridRetriever 端到端可跑，召回率 > 85% |
| W2 D4-5 | P4 | 报告生成 | CitationVerifier 硬门生效，报告含引用 |
| W3 D1-2 | P5 | Agentic RAG | LangGraph Agent 循环可跑，多市场查询可分解 |
| W3 D3-4 | P6 | 前后端对接 | 上传图片 → Agent trace → RAG 报告 |
| W3 D5 | P7 | 评估 | 200+ 测试集，recall > 90%，hallucination < 2% |

**总计：~3 周**

---

## 风险与对策

| 风险 | 概率 | 影响 | 对策 |
|------|------|------|------|
| Cohere API 限流 | 中 | 中 | 批量 96 条/次，加 retry + exponential backoff |
| Cohere API 延迟 | 低 | 中 | 本地缓存 embedding 结果，避免重复请求 |
| HTML 解析质量参差 | 高 | 中 | BeautifulSoup + 正则 fallback，人工抽检 |
| Claude 幻觉引用 | 高 | 高 | CitationVerifier 硬门拒绝 + Agent 循环补救 |
| jieba 误切法律术语 | 中 | 中 | 加载法律术语词典（REACH, RoHS, GPSR 等） |
| Qdrant 内存不足 | 低 | 低 | 5000 chunks × 1024 dim ≈ 20MB，无压力 |
| Python 3.10 兼容性 | 低 | 低 | 所选依赖均支持 3.10 |
| LangGraph 循环死锁 | 低 | 高 | max_attempts 硬上限（默认 2），超时 120s 兜底 |
| Agent 循环延迟累积 | 中 | 中 | 单轮检索 < 10s，2 轮 < 25s，SSE 推送进度 |
| LLM 多市场分解质量 | 中 | 中 | 规则 fallback + 单市场时跳过 LLM 分解 |
