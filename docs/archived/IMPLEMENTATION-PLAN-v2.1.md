# 火鹰合规 RAG 系统实施计划 — 已归档

> **状态**：已归档
> **归档时间**：2026-05-07
> **归档原因**：本计划描述的技术路线（Cohere/Qdrant/Docling）未按计划实现，已变更为 Ollama/FAISS/pdfplumber 路线。实际路线见 `docs/RAG-ARCHITECTURE-v3.md`。

> 基准文档：RAG-ARCHITECTURE-v2.1
> 创建时间：2026-04-29
> 预估工期：8 周（Phase 0-3 + 评估优化）

---

## 目录

1. [Phase 0：环境准备（1 天）](#phase-0环境准备1-天)
2. [Phase 1：语料库构建（3 天）](#phase-1语料库构建3-天)
3. [Phase 2：检索管线（4 天）](#phase-2检索管线4-天)
4. [Phase 3：报告生成 + 硬门（3 天）](#phase-3报告生成--硬门3-天)
5. [Phase 4：多市场查询分解（2 天）](#phase-4多市场查询分解2-天)
6. [Phase 5：评估管线（3 天）](#phase-5评估管线3-天)
7. [Phase 6：HTML 扩展 + 前端集成（3 天）](#phase-6html-扩展--前端集成3-天)
8. [Phase 7：优化增强（持续）](#phase-7优化增强持续)
9. [任务总表](#任务总表)
10. [风险与对策](#风险与对策)

---

## Phase 0：环境准备（1 天）

### T0-1：Python 环境初始化

```bash
# 创建 venv（在项目根目录）
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

# 安装核心依赖
pip install \
  fastapi uvicorn \
  FlagEmbedding torch \
  qdrant-client \
  rank_bm25 jieba \
  docling \
  anthropic \
  pydantic python-dotenv

# requirements.txt 导出
pip freeze > requirements.txt
```

**验证点：**
```bash
python -c "from FlagEmbedding import BGEM3FlagModel; print('BGE-M3 OK')"
python -c "from docling import DocumentConverter; print('Docling OK')"
python -c "from qdrant_client import QdrantClient; print('Qdrant client OK')"
python -c "import jieba; print(jieba.lcut('REACH Article 22 铅含量')); print('jieba OK')"
```

### T0-2：Docker Qdrant 部署

```bash
docker pull qdrant/qdrant
docker run -d \
  --name qdrant \
  -p 6333:6333 \
  -p 6334:6334 \
  -v qdrant_storage:/qdrant/storage \
  qdrant/qdrant

# 验证
curl http://localhost:6333/healthz
```

### T0-3：创建 Qdrant Collection

```python
# scripts/init_collections.py

from qdrant_client import QdrantClient
from qdrant_client.http import models

client = QdrantClient(host="localhost", port=6333)

# Child chunks collection（带向量）
client.create_collection(
    collection_name="legal_chunks",
    vectors_config={
        "dense": models.VectorParams(
            size=1024,           # BGE-M3 dense 维度
            distance=models.Distance.COSINE,
        ),
    },
    # payload 索引（加速过滤）
)

client.create_payload_index(
    collection_name="legal_chunks",
    field_name="doc_name",
    field_schema=models.PayloadSchemaType.KEYWORD,
)
client.create_payload_index(
    collection_name="legal_chunks",
    field_name="jurisdiction",
    field_schema=models.PayloadSchemaType.KEYWORD,
)
client.create_payload_index(
    collection_name="legal_chunks",
    field_name="article_no",
    field_schema=models.PayloadSchemaType.KEYWORD,
)
client.create_payload_index(
    collection_name="legal_chunks",
    field_name="parent_id",
    field_schema=models.PayloadSchemaType.KEYWORD,
)

# Parent chunks collection（无向量，仅存储）
client.create_collection(
    collection_name="legal_chunks_parents",
    vectors_config={},  # 无向量
)

print("Collections created: legal_chunks, legal_chunks_parents")
```

### T0-4：创建项目骨架

```
rag-service/
├── main.py                     # FastAPI 入口（lifespan 全局初始化）
├── requirements.txt
├── config.py                   # 环境变量配置
│
├── parser/                     # 文档解析
│   ├── __init__.py
│   └── docling_parser.py       # Docling → text + page_map + tables
│
├── chunker/                    # 分块
│   ├── __init__.py
│   ├── legal_chunker.py        # Parent-Child LegalChunker
│   └── table_processor.py      # 表格双重字段
│
├── retrieval/                  # 检索管线
│   ├── __init__.py
│   ├── dense_retriever.py      # BGE-M3 Dense 检索
│   ├── bm25_retriever.py       # jieba BM25
│   ├── fusion.py               # RRF 融合
│   ├── reranker.py             # BGE-Reranker
│   ├── must_check.py           # must_check 强制注入
│   ├── query_rewrite.py        # Query Rewrite 规则
│   ├── query_decomposer.py     # LLM Query 分解（多市场）
│   └── hybrid_retriever.py     # 混合检索主类
│
├── verify/                     # 引用验证
│   ├── __init__.py
│   └── citation_verifier.py    # Citation 硬门
│
├── generate/                   # 报告生成
│   ├── __init__.py
│   └── report_generator.py     # Claude Sonnet 报告生成
│
├── eval/                       # 评估（新增）
│   ├── __init__.py
│   ├── test_set.json           # Ground-truth 测试集
│   ├── run_eval.py             # 评估主脚本
│   └── metrics.py              # 自定义指标（FNR、hallucination）
│
└── tests/                      # 单元测试
    ├── __init__.py
    ├── test_legal_chunker.py
    ├── test_bm25_retriever.py
    ├── test_citation_verifier.py
    ├── test_rrf_fusion.py
    └── test_query_rewrite.py
```

---

## Phase 1：语料库构建（3 天）

### T1-1：Docling 解析器（1 天）

**目标：** 替换 `scripts/batch_parse_corpus.py`，输出标准化 JSON（含 page_map）。

```python
# rag-service/parser/docling_parser.py

from pathlib import Path
from docling.document_converter import DocumentConverter


class DoclingParser:
    """使用 Docling 解析 PDF/DOCX/HTML → 结构化 JSON。"""

    def __init__(self):
        self.converter = DocumentConverter()

    def parse(self, file_path: str) -> dict:
        """
        解析文件，返回标准格式：
        {
            "rawText": str,
            "pageMap": [(page_num, char_offset), ...],
            "tables": [{"headers": [...], "rows": [[...]]}],
            "metadata": {"doc_name": str, "jurisdiction": str}
        }
        """
        result = self.converter.convert(file_path)
        doc = result.document

        # 提取纯文本
        raw_text = doc.export_to_markdown()

        # 构建 page_map
        page_map = self._build_page_map(doc)

        # 提取表格
        tables = self._extract_tables(doc)

        return {
            "rawText": raw_text,
            "pageMap": page_map,
            "tables": tables,
            "metadata": self._infer_metadata(file_path, raw_text),
        }

    def _build_page_map(self, doc) -> list[tuple[int, int]]:
        """
        构建 (page_num, char_offset) 映射。
        Docling 的 DocumentStream 包含每页的起始字符偏移量。
        """
        page_map = []
        offset = 0
        for page in doc.pages:
            page_text = page.export_to_markdown()
            page_map.append((page.page_no, offset))
            offset += len(page_text)
        return page_map

    def _extract_tables(self, doc) -> list[dict]:
        """提取表格为结构化数据，保留坐标信息。"""
        tables = []
        for table in doc.tables:
            rows = []
            for row in table.rows:
                cells = [cell.text for cell in row.cells]
                rows.append(cells)
            tables.append({
                "headers": rows[0] if rows else [],
                "rows": rows[1:] if len(rows) > 1 else [],
            })
        return tables

    def _infer_metadata(self, file_path: str, text: str) -> dict:
        """从文件路径和内容推断元数据。"""
        path = Path(file_path)
        doc_name = path.stem
        jurisdiction = "EU"  # 默认，可从内容检测
        for marker, j in [("EU", "EU"), ("Regulation", "EU"),
                          ("美国", "US"), ("FCC", "US"),
                          ("中国", "CN"), ("GB ", "CN")]:
            if marker in text[:2000]:
                jurisdiction = j
                break
        return {"doc_name": doc_name, "jurisdiction": jurisdiction}
```

**验证点：**
```python
parser = DoclingParser()
result = parser.parse("data/全部法规/欧盟/REACH_(EC)_1907-2006.pdf")
assert len(result["rawText"]) > 500_000
assert len(result["pageMap"]) > 100
assert result["pageMap"][0][1] == 0  # 第一页偏移量为 0
print(f"REACH: {len(result['rawText'])} chars, {len(result['pageMap'])} pages")
```

### T1-2：LegalChunker 实现（1 天）

**目标：** 按 Article 边界分块，支持 EU（Article/第X条/§）三种模式。

复用 `RAG-ARCHITECTURE-v2.md` 中已修复的 `_assign_ids`、`_make_child`（含 page_map 推断）、`_split_into_children` 代码。

**关键文件：** `rag-service/chunker/legal_chunker.py`

（完整代码见 RAG-ARCHITECTURE-v2.md 第 3.3 节，已修复全部 bug）

**验证点：**
```python
chunker = LegalChunker()
result = chunker.chunk_document(reach_text, {
    "doc_name": "REACH_(EC)_1907-2006",
    "jurisdiction": "EU",
    "page_map": parser_result["pageMap"],
})
print(f"Children: {len(result['child_chunks'])}")
print(f"Parents:  {len(result['parent_chunks'])}")
# 验证页码不全为 0
for c in result["child_chunks"][:5]:
    print(f"  {c.article_no}: p.{c.page_start}-{c.page_end}")
```

### T1-3：批量入库脚本（1 天）

**目标：** 遍历 `data/corpus/processed/` 所有 JSON，分块 → BGE-M3 embedding → Qdrant。

```python
# scripts/build_corpus.py

from pathlib import Path
from rag_service.parser.docling_parser import DoclingParser
from rag_service.chunker.legal_chunker import LegalChunker
from scripts.ingest_to_qdrant import ingest_chunks, chunk_id_to_uuid
import json

parser = DoclingParser()
chunker = LegalChunker()

corpus_dir = Path("data/corpus/processed")
all_child_chunks = []
all_parent_chunks = []

for json_file in corpus_dir.glob("*.json"):
    doc = json.loads(json_file.read_text(encoding="utf-8"))
    raw_text = doc.get("rawText", "")
    if not raw_text or len(raw_text) < 100:
        print(f"SKIP {json_file.name} (empty/short)")
        continue

    page_map = doc.get("pageMap", [])
    metadata = {
        "doc_name": doc.get("fileName", json_file.stem),
        "jurisdiction": doc.get("metadata", {}).get("detectedMarkets", ["EU"])[0],
        "page_map": page_map,
    }

    result = chunker.chunk_document(raw_text, metadata)
    all_child_chunks.extend(result["child_chunks"])
    all_parent_chunks.extend(result["parent_chunks"])
    print(f"{json_file.name}: {len(result['child_chunks'])} child, "
          f"{len(result['parent_chunks'])} parent")

# 批量入库
print(f"\nTotal: {len(all_child_chunks)} child + {len(all_parent_chunks)} parent")
ingest_chunks([c.to_dict() for c in all_child_chunks], "legal_chunks")

# Parent 入库（无向量）
from rag_service.storage.parent_store import store_parents
store_parents(all_parent_chunks, "legal_chunks_parents")
```

**验证点：**
```bash
python scripts/build_corpus.py
# 预期：EU 18 个 PDF + 9 个 DOCX，约 3000-5000 child chunks
```

---

## Phase 2：检索管线（4 天）

### T2-1：BGE-M3 Dense Retriever（1 天）

**关键文件：** `rag-service/retrieval/dense_retriever.py`

（完整代码见 RAG-ARCHITECTURE-v2.md 第 4.2 节）

**注意：** BGE-M3 首次加载会从 HuggingFace 下载模型（~2GB）。建议提前下载：
```bash
python -c "from FlagEmbedding import BGEM3FlagModel; BGEM3FlagModel('BAAI/bge-m3-multilingual')"
```

### T2-2：jieba BM25 Retriever（0.5 天）

（完整代码见 RAG-ARCHITECTURE-v2.md 第 4.3 节，已修复 `import re`）

### T2-3：RRF 融合（0.5 天）

（完整代码见 RAG-ARCHITECTURE-v2.md 第 4.4 节）

### T2-4：BGE-Reranker（0.5 天）

（完整代码见 RAG-ARCHITECTURE-v2.md 第 4.6 节，Cohere 已替换为 BGE-Reranker）

### T2-5：Must Check + HybridRetriever 组装（1.5 天）

（完整代码见 RAG-ARCHITECTURE-v2.md 第 4.5 + 4.7 节）

**验证点（端到端）：**
```python
from rag_service.retrieval.hybrid_retriever import HybridLegalRetriever
# ... 初始化所有组件（见 main.py lifespan）

result = hybrid_retriever.retrieve(
    query="充电宝铅含量限制 REACH",
    product_category="electronics",
    market="EU",
    top_k=5,
)
assert len(result["chunks"]) >= 3
for c in result["chunks"]:
    print(f"  [{c['rerank_score']:.3f}] {c['doc_name']} - {c['article_no']}")
```

---

## Phase 3：报告生成 + 硬门（3 天）

### T3-1：Citation Verifier（1 天）

（完整代码见 RAG-ARCHITECTURE-v2.md 第 6 章，已修复子串匹配 bug）

### T3-2：报告生成器（1 天）

```python
# rag-service/generate/report_generator.py

import anthropic
import os


COMPLIANCE_PROMPT = """你是一位资深产品合规分析师。
根据以下检索到的法规条款，为用户产品生成合规报告。

要求：
1. 每个结论必须附带引用，格式：[法规名 Article X p.Y]
2. 不得编造未出现在检索结果中的法规条款
3. 如检索结果不足以判断，明确标注"信息不足"
4. 按风险等级分类：高风险/中风险/低风险/合规

产品信息：{product}
目标市场：{markets}
Vision 识别结果：{vision_result}

检索到的法规条款：
{chunks}

请生成结构化合规报告（Markdown格式）。"""


class ComplianceReportGenerator:
    def __init__(self):
        self.client = anthropic.Anthropic(
            api_key=os.environ.get("ANTHROPIC_API_KEY")
        )

    def generate(
        self,
        product: str,
        markets: list[str],
        vision_result: dict,
        chunks: list[dict],
    ) -> str:
        """生成合规报告。"""
        chunks_text = "\n\n".join([
            f"---\n来源：{c['doc_name']} | {c['article_no']} | "
            f"p.{c['page_start']}-{c['page_end']}\n{c['content']}"
            for c in chunks
        ])

        prompt = COMPLIANCE_PROMPT.format(
            product=product,
            markets=", ".join(markets),
            vision_result=str(vision_result),
            chunks=chunks_text,
        )

        response = self.client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text
```

### T3-3：Generate-Report 端点（1 天）

```python
# main.py 中的 /generate-report 端点（完整代码见 RAG-ARCHITECTURE-v2.md 第 10 章）

# 流程：检索 → 生成 → 引用验证 → 硬门决策
# verified >= 3 → PASS（返回报告）
# verified 1-2  → WARN（返回报告 + 警告）
# verified = 0  → REJECTED（拒绝生成）
```

---

## Phase 4：多市场查询分解（2 天）

### T4-1：Query Decomposer（1 天）

**目标：** 将 "充电宝出口欧盟和美国需要哪些法规" 分解为按市场的子查询。

```python
# rag-service/retrieval/query_decomposer.py

import anthropic
import json
import os


DECOMPOSE_PROMPT = """你是一位合规检索专家。
将以下查询分解为按目标市场独立的子查询。

原始查询：{query}
检测到的市场：{markets}

支持的市场：EU, US, UK, CN, SG, VN, MY, ID, SA, AE

输出 JSON 格式：
{{
    "sub_queries": [
        {{"market": "EU", "query": "...", "priority": 1, "expected_regs": ["GPSR", "REACH"]}},
        {{"market": "US", "query": "...", "priority": 1, "expected_regs": ["FCC", "UL"]}}
    ],
    "reasoning": "..."
}}

规则：
- 每个子查询包含产品 + 市场 + 法规需求上下文
- priority: 1=核心法规，2=关联标准，3=参考指南
- expected_regs: 列出最可能适用的法规名称"""


class QueryDecomposer:
    def __init__(self):
        self.client = anthropic.Anthropic(
            api_key=os.environ.get("ANTHROPIC_API_KEY")
        )

    def decompose(
        self,
        query: str,
        markets: list[str],
    ) -> list[dict]:
        """
        分解查询为市场子查询。
        返回 [{"market": str, "query": str, "priority": int}]
        """
        prompt = DECOMPOSE_PROMPT.format(
            query=query,
            markets=", ".join(markets),
        )

        response = self.client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )

        result = json.loads(response.content[0].text)
        return result.get("sub_queries", [])
```

### T4-2：多市场检索 + 结果合并（1 天）

```python
# 在 hybrid_retriever.py 中扩展

async def retrieve_multi_market(
    self,
    query: str,
    product_category: str,
    markets: list[str],
    top_k: int = 10,
) -> dict:
    """
    多市场并行检索。
    1. 分解查询为 per-market 子查询
    2. 并行执行每个市场的检索
    3. 合并去重，优先高关联性结果
    """
    decomposer = QueryDecomposer()
    sub_queries = decomposer.decompose(query, markets)

    # 并行执行各市场检索
    import asyncio
    tasks = [
        asyncio.to_thread(
            self.retrieve,
            sq["query"],
            product_category,
            sq["market"],
            top_k=5,  # 每个市场取 Top-5
        )
        for sq in sub_queries
    ]
    results = await asyncio.gather(*tasks)

    # 合并去重
    seen_ids = set()
    merged = []
    for market_result in results:
        for chunk in market_result["chunks"]:
            chunk_id = chunk["id"]
            if chunk_id not in seen_ids:
                seen_ids.add(chunk_id)
                chunk["source_market"] = market_result.get("market")
                merged.append(chunk)

    # 按 rerank_score 排序
    merged.sort(key=lambda x: x.get("rerank_score", 0), reverse=True)

    return {
        "chunks": merged[:top_k],
        "markets_searched": [sq["market"] for sq in sub_queries],
        "sub_queries": sub_queries,
    }
```

---

## Phase 5：评估管线（3 天）

### T5-1：Ground-Truth 测试集构建（1 天）

**目标：** 从现有语料库自动生成 200+ 测试用例。

```python
# rag-service/eval/build_test_set.py

import json
import re
from pathlib import Path
from datetime import datetime

REGULATORY_PATTERNS = [
    r"(必须|应当|要求|需要)[^。]{10,80}",
    r"(禁止|不得|不可|严禁)[^。]{10,80}",
    r"(罚款|处以|没收|吊销)[^。]{10,80}",
    r"Article\s+\d+[^\n]{20,200}",
    r"(浓度|限量|限值|不得超过)[^。]{10,80}",
]


def build_test_set(corpus_dir: str, output_path: str, target: int = 200):
    """从语料库自动生成 ground-truth 测试集。"""
    test_cases = []

    for json_file in Path(corpus_dir).rglob("*.json"):
        doc = json.loads(json_file.read_text(encoding="utf-8"))
        raw_text = doc.get("rawText", "")
        if not raw_text:
            continue

        metadata = doc.get("metadata", {})
        markets = metadata.get("detectedMarkets", ["EU"])

        for pattern in REGULATORY_PATTERNS:
            matches = re.findall(pattern, raw_text)
            for match in matches[:3]:
                test_cases.append({
                    "id": f"tc_{len(test_cases):04d}",
                    "question": "",  # 留空，后续用 LLM 生成
                    "ground_truth_answer": match.strip(),
                    "source_document": doc.get("fileName", json_file.stem),
                    "market": markets[0] if markets else "EU",
                    "is_critical": any(kw in match for kw in ["禁止", "不得", "罚款"]),
                    "difficulty": "medium",
                })

    # 平衡采样
    import random
    random.seed(42)
    random.shuffle(test_cases)
    test_cases = test_cases[:target]

    output = {
        "version": "1.0",
        "created": datetime.now().isoformat(),
        "total": len(test_cases),
        "test_cases": test_cases,
    }
    Path(output_path).write_text(json.dumps(output, ensure_ascii=False, indent=2))
    print(f"Generated {len(test_cases)} test cases -> {output_path}")
    return test_cases


if __name__ == "__main__":
    build_test_set("data/corpus/processed", "rag-service/eval/test_set.json")
```

### T5-2：评估主脚本（1 天）

```python
# rag-service/eval/run_eval.py

import json
from pathlib import Path
from rag_service.retrieval.hybrid_retriever import HybridLegalRetriever
from rag_service.generate.report_generator import ComplianceReportGenerator
from rag_service.verify.citation_verifier import CitationVerifier


def run_evaluation(test_set_path: str, hybrid_retriever, generator, verifier):
    """运行评估并输出报告。"""
    test_set = json.loads(Path(test_set_path).read_text(encoding="utf-8"))
    cases = test_set["test_cases"]

    results = {
        "total": len(cases),
        "retrieval_hit": 0,
        "citation_verified": 0,
        "hallucination_detected": 0,
        "failures": [],
    }

    for case in cases:
        question = case.get("question", case["ground_truth_answer"][:100])

        # 检索
        retrieve_result = hybrid_retriever.retrieve(
            query=question,
            product_category="default",
            market=case.get("market", "EU"),
            top_k=5,
        )
        chunks = retrieve_result["chunks"]

        # 判断是否命中
        source_doc = case["source_document"]
        hit = any(source_doc in c.get("doc_name", "") for c in chunks)
        if hit:
            results["retrieval_hit"] += 1

        # 生成报告 + 验证
        report = generator.generate(
            product="测试产品",
            markets=[case.get("market", "EU")],
            vision_result={},
            chunks=chunks,
        )
        verification = verifier.verify_report(report, chunks)
        if verification.verified_count >= 1:
            results["citation_verified"] += 1
        if verification.verified_count == 0:
            results["hallucination_detected"] += 1

        if not hit or verification.verified_count == 0:
            results["failures"].append({
                "case_id": case["id"],
                "question": question[:80],
                "hit": hit,
                "verified": verification.verified_count,
                "source_doc": source_doc,
            })

    # 计算指标
    n = results["total"]
    results["recall"] = results["retrieval_hit"] / n
    results["citation_accuracy"] = results["citation_verified"] / n
    results["hallucination_rate"] = results["hallucination_detected"] / n

    # 打印报告
    print(f"\n{'='*50}")
    print(f"  RAG 评估报告  ({n} 测试用例)")
    print(f"{'='*50}")
    print(f"  检索命中率:     {results['recall']:.1%}  (目标 >= 90%)")
    print(f"  引用准确率:     {results['citation_accuracy']:.1%}  (目标 >= 95%)")
    print(f"  幻觉率:         {results['hallucination_rate']:.1%}  (目标 <= 2%)")
    print(f"  失败用例数:     {len(results['failures'])}")
    print(f"{'='*50}\n")

    return results
```

### T5-3：CI 集成 + 指标门禁（1 天）

```yaml
# .github/workflows/rag-eval.yml
name: RAG Evaluation

on:
  push:
    branches: [main]
    paths: ['rag-service/**']

jobs:
  evaluate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }

      - name: Install deps
        run: pip install -r rag-service/requirements.txt

      - name: Run evaluation
        run: python rag-service/eval/run_eval.py

      - name: Check thresholds
        run: |
          python -c "
          import json
          r = json.load(open('eval_results.json'))
          assert r['recall'] >= 0.85, f'Recall {r[\"recall\"]} < 85%'
          assert r['hallucination_rate'] <= 0.05, f'Hallucination {r[\"hallucination_rate\"]} > 5%'
          print('All thresholds passed')
          "
```

---

## Phase 6：HTML 扩展 + 前端集成（3 天）

### T6-1：HTML rawText 修复（1 天）

**前置条件：** `batch_parse_corpus.py` 的 HTML 解析器需修复 rawText 未写入 JSON 的问题。

```python
# 在 batch_parse_corpus.py 的 parse_html() 里：
# 原来：只返回 metadata，不写 rawText
# 修复：将 rawText 写入 output JSON

def parse_html(file_path: str) -> dict:
    # ... 现有解析逻辑 ...
    return {
        "rawText": raw_text,  # ← 必须写入，不能只存在局部变量里
        "metadata": metadata,
    }
```

### T6-2：Next.js → rag-service 转发（1 天）

```typescript
// src/app/api/scan/route.ts

export async function POST(req: NextRequest) {
  const body = await req.json();

  // 转发到 rag-service
  const response = await fetch("http://localhost:8000/generate-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: body.query || "合规检查",
      product: body.product,
      category: body.category,
      markets: body.markets,
      vision_result: body.visionResult,
    }),
  });

  const result = await response.json();

  // 转换为前端 ScanResult 格式
  return NextResponse.json({
    status: result.status,
    report: result.report,
    verification: result.verification_result,
  });
}
```

### T6-3：前端 UI 适配（1 天）

- 报告页面展示 Markdown 格式报告（已有渲染能力）
- 引用状态徽章：PASS（绿）/ WARN（黄）/ REJECTED（红）
- 多市场结果按 tab 切换（如适用）

---

## Phase 7：优化增强（持续）

### 7.1 LightRAG 实体抽取（v3.0，待定）

**适用条件：**
- 语料库 > 1000 篇文档
- 需要跨法规的多跳查询（如 "REACH 里哪些条款引用了 RoHS Annex II"）
- 需要 obligation tracking

**评估：** Phase 5 评估管线运行后，分析失败用例是否集中在多跳场景。如果是，再引入 LightRAG。

### 7.2 Infinity 混合检索（v3.0，待定）

**适用条件：**
- BGE-M3 的 ColBERT 向量需要存储
- Qdrant 的 dense-only 检索 Recall@10 < 85%

**评估：** Infinity 的 dense+sparse+tensor 三路检索 Recall@10 提升约 2-3%，但增加 3x 存储开销。需权衡收益。

### 7.3 RAGAS 自动评估（v3.0）

```python
# 使用 RAGAS 进行更精细的评估
from ragas import evaluate
from ragas.metrics import faithfulness, answer_relevancy, context_precision

result = evaluate(
    dataset=eval_dataset,
    metrics=[faithfulness, answer_relevancy, context_precision],
)
```

---

## 任务总表

| 阶段 | 任务 | 耗时 | 依赖 | 验证方式 |
|------|------|------|------|---------|
| **P0** | Python 环境 | 0.5d | 无 | pip 验证 |
| **P0** | Docker Qdrant | 0.5d | 无 | /healthz |
| **P0** | 创建 Collection | 0.5d | Qdrant | curl 查询 |
| **P0** | 项目骨架 | 0.5d | 无 | 目录结构 |
| **P1** | Docling 解析器 | 1d | P0 | REACH 解析成功 |
| **P1** | LegalChunker | 1d | P1-1 | chunk 数量/页码 |
| **P1** | 批量入库 | 1d | P1-2 | Qdrant count |
| **P2** | BGE-M3 Retriever | 1d | P0 | embed 测试 |
| **P2** | jieba BM25 | 0.5d | P0 | 分词测试 |
| **P2** | RRF 融合 | 0.5d | 无 | 单元测试 |
| **P2** | BGE-Reranker | 0.5d | P0 | rerank 测试 |
| **P2** | HybridRetriever | 1.5d | P2-1~4 | 端到端查询 |
| **P3** | CitationVerifier | 1d | P2 | 验证逻辑 |
| **P3** | ReportGenerator | 1d | P0 | 报告生成 |
| **P3** | /generate-report | 1d | P3-1,2 | 端到端测试 |
| **P4** | QueryDecomposer | 1d | P0 | 分解测试 |
| **P4** | 多市场检索 | 1d | P4-1, P2 | 合并验证 |
| **P5** | 测试集构建 | 1d | P1 | 200+ 用例 |
| **P5** | 评估脚本 | 1d | P5-1 | 指标输出 |
| **P5** | CI 集成 | 1d | P5-2 | 门禁通过 |
| **P6** | HTML 修复 | 1d | P1 | rawText 存在 |
| **P6** | Next.js 转发 | 1d | P3 | /api/scan 测试 |
| **P6** | 前端 UI | 1d | P6-2 | UI 截图 |

**总计：~18 天，约 3.5 周**

---

## 风险与对策

| 风险 | 概率 | 影响 | 对策 |
|------|------|------|------|
| BGE-M3 首次加载慢（GPU/CPU） | 高 | 低 | 预下载模型，lifespan 异步加载 |
| EU PDF 解析失败（非纯文本） | 中 | 高 | 保留 pdfplumber 作为降级方案 |
| Claude Sonnet 幻觉引用 | 高 | 高 | CitationVerifier 硬门拒绝 |
| jieba 分词误切法律术语 | 中 | 中 | 加载法律术语词典 |
| Qdrant 存储 1024 维 × 5000 chunk | 低 | 低 | ~20MB，无压力 |
| 多市场查询 LLM 分解不准确 | 中 | 中 | 规则引擎 fallback |
| GPU 内存不足（BGE-M3 + Reranker） | 中 | 高 | 使用 FP16；CPU 降级模式 |

---

## 里程碑

| 周 | 目标 | 交付物 |
|----|------|--------|
| W1 | 环境 + 语料库 | Qdrant 运行，EU 18 PDF 入库，chunk 含页码 |
| W2 | 检索管线 | 端到端检索可跑，召回率 > 85% |
| W3 | 报告生成 | /generate-report 可用，CitationVerifier 硬门生效 |
| W4 | 多市场 + 评估 | 200+ 测试集，recall > 90%，hallucination < 5% |
| W5+ | HTML 扩展 + 前端 | 35 个 HTML 入库，Next.js 完整对接 |
