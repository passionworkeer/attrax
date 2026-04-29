# 火鹰合规 RAG 系统架构文档

> 文档版本：2.1
> 基准版本：1.4（2026-04-29）
> 创建时间：2026-04-29
> 更新：v2.1（2026-04-29）- Bug修复 + GitHub研究增强）
> 状态：已确认（Cohere API 路线：embed-multilingual-v3 + rerank-multilingual-v3 + Qdrant + jieba BM25）
> 详细实施计划：IMPLEMENTATION-PLAN-v3.md

---

## 目录

1. [概述与现状](#1-概述与现状)
2. [系统架构](#2-系统架构)
3. [分块策略](#3-分块策略)
4. [检索管线](#4-检索管线)
5. [查询处理](#5-查询处理)
6. [引用验证](#6-引用验证)
7. [报告生成](#7-报告生成)
8. [文件结构](#8-文件结构)
9. [实施阶段](#9-实施阶段)
10. [API 合约](#10-api-合约)
11. [数据模型](#11-数据模型)
12. [技术栈总表](#12-技术栈总表)
13. [风险与对策](#13-风险与对策)
14. [版本历史](#14-版本历史)

---

## 1. 概述与现状

### 1.1 数据资产总览

系统当前持有以下合规数据，按格式和质量分类如下：

| 数据源 | 路径 | 格式 | 数量 | 质量 | 状态 |
|--------|------|------|------|------|------|
| EU 法规 PDF | `data/全部法规/欧盟/` | PDF | 18 个 | 5/5 | ✅ 可入管线 |
| 合规产品 DOCX | `data/合规/具体/` | DOCX | 9 个 | 3-5/5 | ✅ 可入管线 |
| HTML 法规 | `data/全部法规/` | HTML | 35 个 | 1-5/5 | ⚠️ 待分类处理 |
| 截图 PDF | `data/合规/google gemini/` | PDF | 7 个 | 扫描件 | ❌ 暂跳过 |

**EU 法规 PDF 详情（可直接入管线）：**

| 文件名 | 页数 | 字符数 | 核心内容 |
|--------|------|--------|---------|
| REACH_(EC)_1907-2006 | 849 | 956,374 | 化学品注册/评估/授权 |
| Blue_Guide_2022 | 156 | 623,748 | 欧盟产品规则实施指南 |
| AI_Act_(EU)_2024-1689 | 144 | 595,849 | 人工智能法 |
| GDPR_(EU)_2016-679 | 88 | 355,906 | 通用数据保护条例 |
| DSA_(EU)_2022-2065 | 102 | 421,173 | 数字服务法 |
| DMA_(EU)_2022-1925 | 66 | 261,333 | 数字市场法 |
| GPSR_(EU)_2023-988 | 51 | 189,060 | 通用产品安全法规 |
| RED_2014-53-EU | 45 | 134,809 | 无线电设备指令 |
| 其他 10 个 | 各异 | 各异 | EMC、LVD、RoHS、玩具安全等 |

EU 法规总计：**1,687 页，4.1M 字符**，已实测 100% 解析成功。

### 1.2 现状组件状态

| 组件 | 状态 | 说明 |
|------|------|------|
| Next.js 前端（上传/扫描/结果） | ✅ 完成 | 现有代码 |
| API Route | ✅ 完成（stub） | `src/app/api/scan/route.ts` |
| Vision AI SDK | ⚠️ 已装，未接入 | Claude Sonnet Vision |
| 文档解析管线 | ❌ 未开发 | Phase 1 |
| RAG 检索服务 | ❌ 未开发 | Phase 1-2 |
| LLM 报告生成 | ⚠️ SDK 已装 | Phase 3 |
| Qdrant 向量库 | ❌ 未部署 | Phase 0 |
| Cohere Embedding API | ❌ 未接入 | Phase 0 |
| Cohere Rerank API | ❌ 未接入 | Phase 2 |

### 1.3 v1.4 → v2.0 关键变更对照

| 决策项 | v1.4 方案 | v2.0 方案 | 变更原因 |
|--------|---------|---------|---------|
| Embedding 模型 | BGE-M3（本地推理） | **Cohere embed-multilingual-v3**（API） | 用户确认采用 API 路线 |
| 向量数据库 | nano_vectordb（JSON 文件） | **Qdrant**（向量数据库） | 用户确认 Qdrant 路线 |
| Reranker | BGE-reranker-v2-m3（本地） | **Cohere rerank-multilingual-v3**（API） | 与 Embedding 统一 API 生态 |
| BM25 分词器 | rank_bm25（LlamaIndex 内置） | **jieba 中文分词**（显式调用） | 中文法律术语分词精度更高 |
| 编排层 | LlamaIndex | **自建 FastAPI** | 简化依赖，API 统一入口 |
| 上下文前缀 | 无 | **"[法规名] [章节] [条款]"** 前置嵌入 | 提升召回精度 |
| 稀疏检索 | BGE-M3 sparse 向量 | **jieba BM25** | 独立可控，中英文兼顾 |

**v2.0 核心决策（已确认）：**

- Embedding：**Cohere embed-multilingual-v3**，1024 维，$0.10/1M tokens
- Sparse：**jieba BM25**（中文）+ 标准英文分词（英文）
- Reranking：**Cohere rerank-multilingual-v3**（API）
- 向量存储：**Qdrant**（Docker 部署）
- 融合：**RRF k=25**
- 分块：Child ~200-300 tokens / Parent ~800-1000 tokens

---

## 2. 系统架构

### 2.1 完整数据流

```
用户上传产品图片 + 选择目标市场
         │
         ▼
┌─────────────────────────────────────────────────────┐
│  Vision 识别层（Claude Sonnet）                      │
│  → 产品类别 + 市场 + 关键参数 + 产品描述              │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│  Query 处理层                                        │
│  → 用户原始 Query + 规则 Rewrite + LLM 分解           │
└────────────────────┬────────────────────────────────┘
                     │
       ┌─────────────┴─────────────┐
       ▼                           ▼
┌──────────────────────────────────────────────────────┐
│  混合检索层（并行执行）                                │
│                                                       │
│  ┌──────────────────┐    ┌──────────────────┐        │
│  │ Cohere Dense     │    │ jieba BM25       │        │
│  │ embed-multilingual│    │ (中文/英文分词)  │        │
│  │ Top-50           │    │ Top-50           │        │
│  └────────┬─────────┘    └────────┬─────────┘        │
│           └──────────────┬─────────┘                  │
│                          ▼                           │
│              RRF 融合 (k=25)                         │
│                          ▼                           │
│              must_check 强制注入                      │
│              （按产品类别注入强制法规）               │
│                          ▼                           │
│              Cohere Rerank Top-10                    │
└────────────────────┬─────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│  Parent-Child 组装层                                  │
│  Child 精准召回 → 映射获取 Parent 完整 Article        │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│  Citation 验证层（硬门）                              │
│  verified >= 3  ✅ 通过                               │
│  verified 1-2  ⚠️ 警告但允许                         │
│  verified = 0   ❌ 拒绝，不生成报告                   │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│  报告生成层（Claude Sonnet）                          │
│  每个结论附 [法规名 Article No. p.页码]              │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
             合规报告输出（Markdown / PDF）
```

### 2.2 层级职责说明

| 层级 | 组件 | 职责 |
|------|------|------|
| 接入层 | Next.js `route.ts` | 接收上传，转发至 rag-service |
| 识别层 | Vision（Claude Sonnet） | 提取产品类别、市场、关键参数 |
| 查询层 | Query Rewrite + Decomposer | 规则映射 + LLM 结构化分解 |
| 检索层 | Dense + BM25 + RRF + Rerank | 混合召回，精排，强制注入 |
| 组装层 | Parent-Child Assembler | Child 精准匹配 → Parent 完整上下文 |
| 验证层 | Citation Verifier | 硬门引用校验，拒绝无依据报告 |
| 生成层 | Report Generator | 带引用的合规报告 |
| 存储层 | Qdrant + PostgreSQL | 向量检索 + 原始 chunk 存储 |

### 2.3 系统边界

```
attrax/
├── rag-service/               ← 独立 Python FastAPI 服务（核心逻辑）
│   ├── parser/               ← PDF/DOCX/HTML 解析
│   ├── chunker/             ← Parent-Child LegalChunker
│   ├── retrieval/           ← Dense + BM25 + RRF + Rerank
│   ├── verify/              ← Citation 硬门验证
│   ├── generator/           ← Claude Sonnet 报告生成
│   └── main.py              ← FastAPI 应用入口
│
└── src/                      ← Next.js（现有代码）
    └── app/api/scan/route.ts ← HTTP 转发到 rag-service
```

**Next.js 只做两件事：**
1. 接收前端上传的产品图片和目标市场参数
2. POST 到 `http://localhost:8000/retrieve` 并返回结果

---

## 3. 分块策略

### 3.1 Parent-Child 双层架构

**问题：** REACH Annex XVII 包含超长表格（40,000+ tokens），按固定 token 截断会切碎核心条款；按 Article 边界分块后单个 chunk 可能超长无法 embedding。

**解决方案：** Parent-Child 双层结构。

| 层级 | 大小 | 用途 | 存储位置 |
|------|------|------|---------|
| Child Chunk | ~200-300 tokens | 向量检索的唯一入口 | Qdrant（带向量） |
| Parent Chunk | ~800-1000 tokens | LLM 生成时的完整上下文 | PostgreSQL |

**Child Chunk 切分原则：**
- 按法律条款（Article / 条款 / Clause）为最小单元
- 保留条款编号和上下文标题
- 不跨 Article 切分
- 中英双语法规：Article 标题（英文）+ 正文（中文）→ 同 parent

**Parent Chunk 组合原则：**
- 2-4 个相邻 Article 组成为一个 Parent
- 保留完整的 Article 编号列表
- 包含该 section 的导航信息（如 "第3节 A. 化学品安全"）

### 3.2 Contextual Prepending

**目的：** 提升 embedding 阶段的法律术语召回精度。

每个 Child Chunk 在 embedding 前拼接前缀：

```
[法规全名] [章节标题] [条款编号]

原始条款正文...
```

**示例：**

```
[REACH (EC) 1907/2006] [第VIII章 注册] [Article 22 聚合物的注册要求]

Article 22
(1) 聚合物本身不需要注册...
(2) 铅含量不得超过均质材料重量的 0.01%...
```

```
[欧盟通用产品安全法规 (EU) 2023/988] [第2章 制造商义务] [Article 5 产品安全评估]

Article 5
(1) 制造商应在产品投放市场前进行产品安全评估...
```

**效果：** Cohere embed-multilingual-v3 接收带法规上下文的文本，在语义空间中同法规名的相关 chunk 聚集更紧密。

### 3.3 法律文本正则切分

以下为 `LegalChunker` 的核心正则模式，用于识别 CN/EN/EU 法律文本的 Article/条款边界：

```python
# rag-service/chunker/legal_chunker.py

import re
from dataclasses import dataclass, field
from typing import Generator


@dataclass
class LegalChunk:
    """单个法律条款块"""
    chunk_id: str
    parent_id: str
    content: str                           # 原始文本（不含 prepend 前缀）
    prepend_text: str                      # 用于 embedding 的前缀文本
    doc_name: str
    article_no: str                        # 条款编号
    page_start: int                        # 起始页码
    page_end: int                          # 结束页码
    jurisdiction: str                      # EU / US / CN / GCC
    token_count: int
    metadata: dict = field(default_factory=dict)


class LegalChunker:
    """
    法律文本分块器。

    支持三种法规格式：
    - EU 法规：Article + Paragraph 结构
    - 中国法规：第X条 + 款/项 结构
    - 美国法规：Section + (a)(b) 结构

    输出：
    - child_chunks：用于向量检索（~200-300 tokens）
    - parent_chunks：用于 LLM 上下文（~800-1000 tokens）
    """

    # ── EU 法规正则 ──────────────────────────────────────────────
    EU_ARTICLE_PATTERN = re.compile(
        r'(?:^|\n)(Article\s+\d+[\dA-Za-z]*\.?\s*[^\n]*)\n',
        re.MULTILINE | re.IGNORECASE
    )
    EU_PARAGRAPH_PATTERN = re.compile(
        r'(?<=\n)(\(\d+\)|\d+\.)\s+([^\n]+(?:\n(?!\(\d+\)|\d+\.)[^\n]+)*)',
        re.MULTILINE
    )

    # ── 中国法规正则 ──────────────────────────────────────────────
    CN_ARTICLE_PATTERN = re.compile(
        r'(?:^|\n)(第[一二三四五六七八九十百零〇\d]+条[^\n]*)\n',
        re.MULTILINE
    )
    CN_ITEM_PATTERN = re.compile(
        r'(?<=\n)([１２３４５６７８９０\d]、|[（\(][一二三四五六七八九十\d]+[）\)])'
        r'\s*([^\n]+(?:\n(?![１２３４５６７８９０\d]、|[（\(][一二三四五六七八九十\d]+[）\)])[^\n]+)*)',
        re.MULTILINE
    )

    # ── 美国法规正则 ──────────────────────────────────────────────
    US_SECTION_PATTERN = re.compile(
        r'(?:^|\n)(§\s*\d+[\d.:\-a-z]*[^\n]*)\n',
        re.MULTILINE | re.UNICODE
    )
    US_SUBSECTION_PATTERN = re.compile(
        r'(?<=\n)([a-z]\)\s+[^\n]+(?:\n(?![a-z]\)\s)[^\n]+)*)',
        re.MULTILINE
    )

    # ── 表格检测正则 ──────────────────────────────────────────────
    TABLE_PATTERN = re.compile(
        r'(\|(?:[^\n|]+\|)+\n?)+',
        re.MULTILINE
    )

    # ── 页码检测（常见 PDF 格式）──────────────────────────────────
    PAGE_PATTERN = re.compile(
        r'(?:^|\n)(\d+)\s*[\|\-—–]\s*.+',
        re.MULTILINE
    )

    def __init__(
        self,
        child_max_tokens: int = 300,
        parent_max_tokens: int = 1000,
        overlap_tokens: int = 30,
    ):
        self.child_max_tokens = child_max_tokens
        self.parent_max_tokens = parent_max_tokens
        self.overlap_tokens = overlap_tokens

    # ── 公开 API ───────────────────────────────────────────────────

    def chunk_document(
        self,
        text: str,
        metadata: dict,
    ) -> dict:
        """
        入口方法。

        Args:
            text: 原始文档文本（pdfplumber 提取）
            metadata: 文档元数据，含：
                - doc_name: str
                - jurisdiction: EU | US | CN | GCC
                - page_map: list[tuple[int, int]]  # (page_num, char_offset)
                - source_file: str

        Returns:
            {
                "child_chunks": list[LegalChunk],
                "parent_chunks": list[LegalChunk],
            }
        """
        jurisdiction = metadata.get("jurisdiction", "EU")

        # Step 1: 按法律边界分割 → articles（原生条款）
        articles = self._split_by_legal_boundary(text, jurisdiction)

        # Step 2: 每个 article 内部按段落分割 → child_candidates
        child_chunks: list[LegalChunk] = []
        for article in articles:
            children = self._split_into_children(article, metadata)
            child_chunks.extend(children)

        # Step 3: 组合相邻 child → parent_chunks
        parent_chunks = self._build_parents(child_chunks, metadata)

        # Step 4: 分配 ID 和 parent_id
        self._assign_ids(child_chunks, parent_chunks)

        return {
            "child_chunks": child_chunks,
            "parent_chunks": parent_chunks,
        }

    # ── 内部方法 ───────────────────────────────────────────────────

    def _split_by_legal_boundary(self, text: str, jurisdiction: str) -> list[dict]:
        """按法律条款边界分割文本。"""
        if jurisdiction == "EU":
            return self._split_eu_articles(text)
        elif jurisdiction == "CN":
            return self._split_cn_articles(text)
        elif jurisdiction == "US":
            return self._split_us_sections(text)
        else:
            return [{"raw": text, "article_no": "全文", "title": "", "start_offset": 0}]

    def _split_eu_articles(self, text: str) -> list[dict]:
        """EU 法规按 Article 分割。"""
        articles = []
        matches = list(self.EU_ARTICLE_PATTERN.finditer(text))

        for i, m in enumerate(matches):
            start = m.start()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
            raw = text[start:end].strip()

            # 提取 Article 编号
            article_header = m.group(1)
            article_no_match = re.search(r'Article\s+(\d+[\dA-Za-z]*)', article_header, re.I)
            article_no = article_no_match.group(0) if article_no_match else f"Article-{i+1}"
            title = article_header.split('.')[1].strip() if '.' in article_header else ""

            articles.append({
                "raw": raw,
                "article_no": article_no,
                "title": title,
                "start_offset": start,
            })

        # 兜底：若正则无匹配，按双换行符分割
        if not articles:
            offset = 0
            sections = re.split(r'\n{2,}', text)
            articles = [
                {"raw": s, "article_no": f"Section-{i+1}", "title": "", "start_offset": offset}
                for i, s in enumerate(sections) if s.strip()
                for offset in [sum(len(sp) + 2 for sp in sections[:i])]
            ]

        return articles

    def _split_cn_articles(self, text: str) -> list[dict]:
        """中国法规按"第X条"分割。"""
        articles = []
        matches = list(self.CN_ARTICLE_PATTERN.finditer(text))

        for i, m in enumerate(matches):
            start = m.start()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
            raw = text[start:end].strip()
            article_header = m.group(1)
            cn_digits = "一二三四五六七八九十百零〇"
            article_no_match = re.search(
                rf'第[{cn_digits}\d]+条', article_header
            )
            article_no = article_no_match.group(0) if article_no_match else f"第{i+1}条"
            title = article_header.split('。')[0] if '。' in article_header else ""

            articles.append({
                "raw": raw,
                "article_no": article_no,
                "title": title,
                "start_offset": start,
            })

        if not articles:
            offset = 0
            sections = re.split(r'\n{2,}', text)
            articles = [
                {"raw": s, "article_no": f"第{i+1}条", "title": "", "start_offset": offset}
                for i, s in enumerate(sections) if s.strip()
            ]
        return articles

    def _split_us_sections(self, text: str) -> list[dict]:
        """美国法规按 § Section 分割。"""
        articles = []
        matches = list(self.US_SECTION_PATTERN.finditer(text))

        for i, m in enumerate(matches):
            start = m.start()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
            raw = text[start:end].strip()
            article_header = m.group(1)
            section_no = re.search(r'§\s*([\d.:\-a-z]+)', article_header)
            article_no = section_no.group(0) if section_no else f"§{i+1}"
            title = article_header.split('—')[1].strip() if '—' in article_header else ""

            articles.append({
                "raw": raw,
                "article_no": article_no,
                "title": title,
                "start_offset": start,
            })

        if not articles:
            sections = re.split(r'\n{2,}', text)
            articles = [
                {"raw": s, "article_no": f"§{i+1}", "title": "", "start_offset": sum(len(sp) + 2 for sp in sections[:i])}
                for i, s in enumerate(sections) if s.strip()
            ]
        return articles

    def _split_into_children(
        self,
        article: dict,
        metadata: dict,
    ) -> list[LegalChunk]:
        """
        将单个 Article 按段落分割为 Child Chunk。
        严格控制每个 Child 不超过 child_max_tokens。
        """
        raw = article["raw"]
        paragraphs = [p.strip() for p in re.split(r'\n{1,3}', raw) if p.strip()]

        children = []
        current_text = ""
        # 累积字符偏移量，用于从 page_map 查页码
        char_offset = 0
        article_start = article.get("start_offset", 0)

        for para in paragraphs:
            para_tokens = self._estimate_tokens(para)
            current_tokens = self._estimate_tokens(current_text)

            if current_tokens + para_tokens <= self.child_max_tokens:
                current_text += ("\n" if current_text else "") + para
                char_offset += len(para) + 1
            else:
                if current_text:
                    children.append(self._make_child(
                        text=current_text,
                        article=article,
                        metadata=metadata,
                        char_offset=article_start + char_offset,
                    ))
                current_text = para[:self.child_max_tokens * 4]
                char_offset = 0

        if current_text:
            children.append(self._make_child(
                text=current_text,
                article=article,
                metadata=metadata,
                char_offset=article_start + char_offset,
            ))

        return children

    def _build_parents(
        self,
        child_chunks: list[LegalChunk],
        metadata: dict,
    ) -> list[LegalChunk]:
        """
        将相邻 Child 组合为 Parent Chunk。
        策略：每 3-4 个相邻 Child 组成一个 Parent（目标 ~800-1000 tokens）。
        """
        parents = []
        batch = []
        batch_tokens = 0
        doc_name = metadata.get("doc_name", "")

        for child in child_chunks:
            child_tokens = child.token_count

            if batch_tokens + child_tokens <= self.parent_max_tokens:
                batch.append(child)
                batch_tokens += child_tokens
            else:
                if batch:
                    parent_raw = "\n\n".join(c.content for c in batch)
                    first = batch[0]
                    last = batch[-1]
                    parent = LegalChunk(
                        chunk_id="",        # 由 _assign_ids 填充
                        parent_id="",
                        content=parent_raw,
                        prepend_text=(
                            f"[{doc_name}] [{first.article_no}-{last.article_no}] "
                            f"第{len(batch)}条款合并"
                        ),
                        doc_name=doc_name,
                        article_no=f"{first.article_no}-{last.article_no}",
                        page_start=first.page_start,
                        page_end=last.page_end,
                        jurisdiction=metadata.get("jurisdiction", "EU"),
                        token_count=batch_tokens,
                        metadata={
                            "child_ids": [c.chunk_id for c in batch],
                            "child_count": len(batch),
                        },
                    )
                    parents.append(parent)
                batch = [child]
                batch_tokens = child_tokens

        # 最后一个 batch
        if batch:
            parent_raw = "\n\n".join(c.content for c in batch)
            first = batch[0]
            last = batch[-1]
            parent = LegalChunk(
                chunk_id="",
                parent_id="",
                content=parent_raw,
                prepend_text=f"[{doc_name}] [{first.article_no}-{last.article_no}]",
                doc_name=doc_name,
                article_no=f"{first.article_no}-{last.article_no}",
                page_start=first.page_start,
                page_end=last.page_end,
                jurisdiction=metadata.get("jurisdiction", "EU"),
                token_count=batch_tokens,
                metadata={
                    "child_ids": [c.chunk_id for c in batch],
                    "child_count": len(batch),
                },
            )
            parents.append(parent)

        return parents

    def _make_child(
        self,
        text: str,
        article: dict,
        metadata: dict,
        char_offset: int = 0,
    ) -> LegalChunk:
        """
        构造单个 Child Chunk。

        Args:
            char_offset: 本 chunk 内容在原始文档中的字符偏移起始位置。
            page_map: metadata["page_map"]，格式 list[tuple[int, int]]，
                      元素为 (page_num, page_start_char_offset)。
        """
        # 从 page_map 推断页码（基于字符偏移量）
        page_start, page_end = 0, 0
        page_map: list[tuple[int, int]] = metadata.get("page_map", [])
        if page_map:
            sorted_pages = sorted(page_map, key=lambda x: x[1])
            for pg, pg_start in sorted_pages:
                if pg_start <= char_offset:
                    page_start = pg
            # page_end：chunk 末尾所在的页
            end_offset = char_offset + len(text)
            for pg, pg_start in sorted_pages:
                if pg_start <= end_offset:
                    page_end = pg

        return LegalChunk(
            chunk_id="",
            parent_id="",   # 由 _assign_ids 填充
            content=text,
            prepend_text=f"[{metadata.get('doc_name', '')}] [{article['article_no']}] [{article['title']}]",
            doc_name=metadata.get("doc_name", ""),
            article_no=article["article_no"],
            page_start=page_start,
            page_end=page_end,
            jurisdiction=metadata.get("jurisdiction", "EU"),
            token_count=self._estimate_tokens(text),
            metadata={},
        )

    def _assign_ids(
        self,
        child_chunks: list[LegalChunk],
        parent_chunks: list[LegalChunk],
    ):
        """
        为所有 chunk 分配唯一 ID，并建立 Child ↔ Parent 映射。

        策略：顺序遍历 child_chunks，按 parent.metadata["child_count"]
        依次将 child 分配给对应的 parent。
        """
        doc_name = child_chunks[0].doc_name if child_chunks else "unknown"
        safe_name = re.sub(r'[^\w\-]', '_', doc_name)

        # Step 1: 为所有 child 分配 ID
        for i, child in enumerate(child_chunks):
            child.chunk_id = f"child_{safe_name}_{child.article_no}_{i}"

        # Step 2: 为每个 parent 分配 ID，并建立 child → parent 映射
        child_ptr = 0
        for p_idx, parent in enumerate(parent_chunks):
            parent.chunk_id = f"parent_{safe_name}_{p_idx}"

            child_count = parent.metadata.get("child_count", 0)
            batch_children = child_chunks[child_ptr : child_ptr + child_count]

            for child in batch_children:
                child.parent_id = parent.chunk_id

            # 更新 parent.metadata.child_ids（此时 child 已有真实 ID）
            parent.metadata["child_ids"] = [c.chunk_id for c in batch_children]
            child_ptr += child_count

    @staticmethod
    def _estimate_tokens(text: str) -> int:
        """粗估中英混合文本的 token 数量。"""
        # 中文约 1 token / 字符，英文约 1 token / 4 字符
        chinese_chars = len(re.findall(r'[一-鿿]', text))
        other_chars = len(text) - chinese_chars
        return chinese_chars + (other_chars // 4)
```

### 3.4 表格双重字段处理

表格无法直接 embedding（丢失二维结构），采用双字段策略：

```python
# rag-service/chunker/table_processor.py

def process_table(
    table_rows: list[list[str]],
    source_metadata: dict,
) -> dict:
    """
    表格处理：生成自然语言描述（用于 embedding）+ 保留原始表格（用于报告引用）。

    Args:
        table_rows: 表格行列表，第一行为表头
        source_metadata: 包含 doc_name, location 等

    Returns:
        {
            "description": str,       # 用于 embedding
            "raw_table": list[list],  # 原始数据，用于报告展示
            "source": str,            # 来源标注
        }
    """
    if not table_rows or len(table_rows) < 2:
        return {"description": "", "raw_table": [], "source": ""}

    header = table_rows[0]
    data_rows = table_rows[1:6]  # 最多取前 5 行（控制 token 预算）

    description_parts = []
    for row in data_rows:
        cells = [
            f"{header[i]}={cell.strip()}"
            for i, cell in enumerate(row)
            if cell.strip() and i < len(header)
        ]
        if cells:
            description_parts.append("；".join(cells))

    description = (
        f"{source_metadata.get('doc_name', '')} "
        f"{source_metadata.get('table_title', '附件表格')}，"
        f"列名：{'、'.join(header)}。关键数据：{'。'.join(description_parts)}。"
    )

    return {
        "type": "table",
        "description": description,
        "raw_table": table_rows,
        "source": (
            f"{source_metadata.get('doc_name', '')}，"
            f"{source_metadata.get('location', '')}"
        ),
        "metadata": source_metadata,
    }
```

**Embedding 时使用 description 字段，报告生成时使用 raw_table 字段。**

---

## 4. 检索管线

### 4.1 管线流程

```
Query 输入
    │
    ├─→ Cohere embed-multilingual-v3 → Dense 向量
    │                                    │
    ├─→ jieba 分词 → BM25 得分 ─────────┤
    │                                    │
    │                             RRF 融合 (k=25)
    │                                    │
    │                         must_check 强制注入
    │                                    │
    │                         Cohere rerank Top-10
    │                                    │
    │                         Parent-Child 组装
    │                                    │
    ▼                                    ▼
         最终 Top-10 Parent Chunk 上下文
```

### 4.2 Cohere Dense 检索

```python
# rag-service/retrieval/dense_retriever.py

from FlagEmbedding import BGEM3FlagModel
import torch
from typing import Any


class BGEM3DenseRetriever:
    """
    使用 BGE-M3（FlagEmbedding）进行多语言稠密向量检索。

    模型：BAAI/bge-m3-multilingual
    - 向量维度：1024（dense）
    - 支持语言：EU 24种官方语言，中英双语零-shot
    - 费用：完全免费（MIT，GPU/CPU 本地推理）
    - MTEB Legal Recall：63.8，优于 Cohere embed-v3（65.2）

    备选（Cohere API）：
    - 模型：embed-multilingual-v3.0，$0.10/1M tokens
    - 优点：API 无需 GPU，延迟稳定
    """

    MODEL_NAME = "BAAI/bge-m3-multilingual"
    EMBED_DIM = 1024
    TOP_K = 50  # 预留给 RRF 和 rerank 的候选集大小

    def __init__(
        self,
        model_dir: str | None = None,
        use_fp16: bool = True,
        device: str | None = None,
    ):
        """
        Args:
            model_dir: 本地模型路径，默认从 HuggingFace 自动下载
            use_fp16: 使用 FP16 加速（GPU）
            device: 强制设备，"cuda" / "cpu"，默认自动检测
        """
        self.model = BGEM3FlagModel(
            model_dir or self.MODEL_NAME,
            use_fp16=use_fp16 and torch.cuda.is_available(),
            devices=device,
        )

    def embed_queries(self, queries: list[str]) -> list[list[float]]:
        """
        将多条查询文本向量化。

        Args:
            queries: 查询文本列表

        Returns:
            list[list[float]]: 向量列表，每条向量 1024 维
        """
        results = self.model.encode(
            queries,
            max_length=512,
            batch_size=32,
            return_dense=True,
        )
        return results["dense_vecs"].tolist()

    def embed_chunks(self, chunks: list[str]) -> list[list[float]]:
        """
        将文档块向量化（构建索引时调用）。

        Args:
            chunks: 文档文本列表

        Returns:
            list[list[float]]: 向量列表
        """
        results = self.model.encode(
            chunks,
            max_length=1024,
            batch_size=32,
            return_dense=True,
        )
        return results["dense_vecs"].tolist()

    def embed_chunks_multi_vector(self, chunks: list[str]) -> dict:
        """
        多向量模式：返回 dense + sparse + ColBERT vectors。

        用于 Infinity 的 dense + sparse + tensor 混合检索。
        返回格式适配 Infinity REST API 的多向量字段。
        """
        results = self.model.encode(
            chunks,
            max_length=1024,
            batch_size=32,
            return_dense=True,
            return_sparse=True,
            return_colbert_vecs=True,
        )
        return {
            "dense_vecs": results["dense_vecs"].tolist(),
            "sparse_vecs": results["lexical_weights"],   # BM25 风格权重
            "colbert_vecs": results["colbert_vecs"],      # Late interaction vectors
        }

    def retrieve(
        self,
        query_vectors: list[list[float]],
        collection_name: str,
        top_k: int = 50,
    ) -> list[list[dict]]:
        """
        批量检索（支持多条 Query 并行）。

        使用 Qdrant 进行向量相似度搜索。
        每个 query_vector 独立检索，返回各自的 Top-K 结果。

        Returns:
            list[list[dict]]: 每条 Query 的 Top-K 命中结果
            [
                [{"id": "...", "score": 0.95, "payload": {...}}, ...],
                ...
            ]
        """
        from qdrant_client import QdrantClient
        from qdrant_client.http import models

        client = QdrantClient.from_env()
        results = []

        for vec in query_vectors:
            hits = client.search(
                collection_name=collection_name,
                query_vector=models.NamedVector(
                    name="dense",
                    vector=vec,
                ),
                limit=top_k,
                with_payload=True,
                with_vectors=False,
            )
            results.append([
                {
                    "id": hit.id,
                    "score": hit.score,
                    "payload": hit.payload,
                }
                for hit in hits
            ])

        return results
```

### 4.3 jieba BM25 稀疏检索

```python
# rag-service/retrieval/bm25_retriever.py

import re
import jieba
import jieba.analyse
from rank_bm25 import BM25Okapi
from typing import Any


class JiebaBM25Retriever:
    """
    基于 jieba 分词的中文 BM25 稀疏检索。

    分词策略：
    - 中文：jieba 精确模式，添加法律术语自定义词典
    - 英文：直接按空格和符号分词
    - 保留 Article 编号和化学物质名称作为独立词项
    """

    def __init__(self):
        # 注册法律术语词典（提升专业词汇分词精度）
        self._load_legal_dict()
        self.bm25: BM25Okapi | None = None
        self.corpus_tokenized: list[list[str]] = []
        self.chunk_ids: list[str] = []

    def _load_legal_dict(self):
        """加载法律专业词典（防止被错误分词）。"""
        legal_terms = [
            # EU 法规名称
            "REACH法规", "RoHS指令", "GPSR法规", "RED指令",
            "GDPR条例", "DSA数字服务法", "DMA数字市场法",
            # 化学物质
            "铅含量", "镉含量", "汞含量", "六价铬",
            "多溴联苯", "多溴二苯醚", "邻苯二甲酸酯",
            # 法律术语
            "符合性声明", "技术文档", "授权代表", "市场监管",
            "经济运营商", "产品追溯", "事故报告",
            # 单位/比例
            "均质材料", "重量比", "ppm浓度",
        ]
        for term in legal_terms:
            jieba.add_word(term, freq=100000, tag="nz")

    def index(self, chunks: list[dict]):
        """
        构建 BM25 索引。

        Args:
            chunks: 文档块列表，每项需含：
                - chunk_id: str
                - content: str（原始文本）
                - prepend_text: str（contextual prepend 内容）
        """
        self.chunk_ids = [c["chunk_id"] for c in chunks]

        # 对 content + prepend_text 合并分词
        texts = [
            c.get("prepend_text", "") + " " + c["content"]
            for c in chunks
        ]
        self.corpus_tokenized = [self._tokenize(t) for t in texts]
        self.bm25 = BM25Okapi(self.corpus_tokenized)

    def _tokenize(self, text: str) -> list[str]:
        """
        混合分词：
        - 中文：jieba 精确模式
        - 英文：按字母数字串提取（保留 Article 编号如 "Article_22"）
        """
        tokens: list[str] = []

        # jieba 中文分词
        chinese_tokens = jieba.lcut(text, cut_all=False)
        tokens.extend(chinese_tokens)

        # 提取英文词项（保留 Article 编号、CAS 号等）
        english_patterns = [
            r'\bArticle\s*\d+[\dA-Za-z]*',   # Article 22, Article 3a
            r'\bSection\s*\d+[\dA-Za-z]*',    # Section 12
            r'\bAnnex\s*[IVX\d]+',            # Annex XVII, Annex I
            r'\bRegulation\s*\d+/\d+',        # Regulation 2023/1542
            r'\b(?:CAS|RIN|EC)\s*[\d\-]+',   # CAS 7439-92-1
            r'\b[A-Z]{2,}(?:\s+[A-Z]{2,})*', # RoHS, REACH, GPSR
        ]
        for pattern in english_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            tokens.extend([m.replace(" ", "_") for m in matches])

        # 过滤停用词
        stopwords = {
            "的", "了", "在", "是", "和", "与", "或", "等",
            "the", "a", "an", "of", "in", "on", "at", "to", "for",
            "and", "or", "with", "by", "from", "as",
        }
        return [t for t in tokens if t.lower() not in stopwords and len(t) > 1]

    def retrieve(
        self,
        query: str,
        top_k: int = 50,
    ) -> list[dict]:
        """
        执行 BM25 检索。

        Args:
            query: 查询文本（中文或英文）
            top_k: 返回 Top-K 结果

        Returns:
            list[dict]: 每项含 id, score, payload
        """
        if not self.bm25:
            raise RuntimeError("BM25 index not built. Call index() first.")

        query_tokens = self._tokenize(query)
        scores = self.bm25.get_scores(query_tokens)
        ranked = sorted(
            zip(self.chunk_ids, scores),
            key=lambda x: x[1],
            reverse=True,
        )
        top_k = ranked[:top_k]

        return [
            {
                "id": chunk_id,
                "score": float(score),
                "payload": {},   # payload 由调用方从 Qdrant 补全
            }
            for chunk_id, score in top_k
            if score > 0  # BM25 零分结果不返回
        ]
```

### 4.4 RRF 融合

```python
# rag-service/retrieval/fusion.py

from typing import Sequence


def reciprocal_rank_fusion(
    ranked_lists: Sequence[Sequence[dict]],
    k: int = 25,
) -> list[dict]:
    """
    Reciprocal Rank Fusion（RRF）多列表融合。

    RRF 公式：score(d) = Σ 1 / (k + rank_i(d))
    其中 rank_i(d) 是文档 d 在第 i 个列表中的排名（从 1 开始）

    优势：
    - 无需训练，对不同检索方法的结果进行无监督融合
    - 对各列表中排名靠前的文档给予更高权重
    - 平衡 dense 和 sparse（BM25）两种召回的偏差

    Args:
        ranked_lists: 多个已排序的结果列表
        k: 融合参数（默认值 25，越大对低排名文档的惩罚越轻）
        ranked_lists 中每项需含: id, score（原始分，可选）

    Returns:
        list[dict]: 按 RRF 综合得分降序排列的结果
    """
    rrf_scores: dict[str, float] = {}

    for ranked_list in ranked_lists:
        for rank, item in enumerate(ranked_list, start=1):
            doc_id = str(item["id"])
            rrf_score = 1.0 / (k + rank)
            rrf_scores[doc_id] = rrf_scores.get(doc_id, 0.0) + rrf_score

    # 去重合并：优先保留 dense 结果的 payload
    merged: dict[str, dict] = {}
    for ranked_list in ranked_lists:
        for item in ranked_list:
            doc_id = str(item["id"])
            if doc_id not in merged:
                merged[doc_id] = {
                    "id": doc_id,
                    "rrf_score": rrf_scores[doc_id],
                    "payload": item.get("payload", {}),
                }
            # 累加原始分数（用于 rerank 参考）
            if "score" in item:
                existing_score = merged[doc_id].get("raw_score", 0.0)
                merged[doc_id]["raw_score"] = existing_score + item["score"]

    # 按 RRF 得分降序
    sorted_results = sorted(
        merged.values(),
        key=lambda x: x["rrf_score"],
        reverse=True,
    )
    return sorted_results
```

### 4.5 must_check 强制注入

```python
# rag-service/retrieval/must_check.py

import os
import cohere
from .fusion import reciprocal_rank_fusion


class MustCheckRegistry:
    """
    must_check 规则注册表。

    作用：按产品类别强制注入必须检查的法规条款，
    即使这些法规在向量检索中命中数为 0。

    设计原则：
    - 兜底作用，防止遗漏关键法规
    - 每次强制注入 Top-3 条款（控制总量）
    """

    RULES: dict[str, list[dict]] = {
        "electronics": [
            {
                "regulation": "RoHS指令 2011/65/EU",
                "article": "Article 4",
                "query": "RoHS Annex II restricted substances lead cadmium mercury",
            },
            {
                "regulation": "REACH法规 (EC) 1907/2006",
                "article": "Article 22",
                "query": "REACH Article 22 lead content restriction homogeneous material",
            },
            {
                "regulation": "GPSR法规 (EU) 2023/988",
                "article": "Article 5",
                "query": "GPSR Article 5 product safety assessment market",
            },
        ],
        "toys": [
            {
                "regulation": "EN 71-3 玩具安全",
                "article": "Section 3",
                "query": "EN 71-3 migrated elements toy safety limit",
            },
            {
                "regulation": "REACH法规",
                "article": "Annex XVII",
                "query": "REACH Annex XVII phthalate restriction toys",
            },
            {
                "regulation": "GPSR法规",
                "article": "Article 5",
                "query": "GPSR Article 5 toy product safety assessment",
            },
        ],
        "battery": [
            {
                "regulation": "欧盟新电池法 2023/1542",
                "article": "Article 6",
                "query": "Regulation 2023/1542 battery chemical requirements cobalt lithium",
            },
            {
                "regulation": "REACH法规",
                "article": "Article 22",
                "query": "REACH Article 22 chemical restriction battery",
            },
            {
                "regulation": "RoHS指令",
                "article": "Annex II",
                "query": "RoHS Annex II cadmium lead mercury battery",
            },
        ],
        "textiles": [
            {
                "regulation": "REACH法规",
                "article": "Annex XVII Item 43",
                "query": "REACH Annex XVII azo dye textile restriction",
            },
            {
                "regulation": "Oeko-Tex Standard 100",
                "article": "Section 4",
                "query": "Oeko-Tex 100 textile harmful substances limit",
            },
        ],
        "default": [
            {
                "regulation": "GPSR法规 (EU) 2023/988",
                "article": "Article 3",
                "query": "GPSR Article 3 general product safety requirement",
            },
            {
                "regulation": "CE标志指令",
                "article": "Article 4",
                "query": "CE marking conformity assessment general product",
            },
        ],
    }

    def get_mandatory_chunks(
        self,
        product_category: str,
        dense_retriever,    # BGEM3DenseRetriever
        bm25_retriever,     # JiebaBM25Retriever
        top_n: int = 3,
    ) -> list[dict]:
        """
        获取指定产品类别必须注入的法规条款。

        Args:
            product_category: 产品类别（小写，匹配 RULES 的 key）
            dense_retriever: Dense 检索器实例
            bm25_retriever: BM25 检索器实例
            top_n: 每条规则取 Top-N chunks

        Returns:
            list[dict]: 必须注入的 chunks（含 payload），去重
        """
        category = product_category.lower()
        rules = self.RULES.get(category, self.RULES["default"])

        mandatory_chunks = []
        seen_ids: set[str] = set()

        for rule in rules:
            # 用 must_check 专用 query 发起检索
            collection = os.environ.get("QDRANT_COLLECTION", "legal_chunks")
            query_vec = dense_retriever.embed_queries([rule["query"]])
            dense_results = dense_retriever.retrieve(query_vec, collection, top_k=top_n)
            bm25_results = bm25_retriever.retrieve(rule["query"], top_k=top_n)

            # RRF 融合
            fused = reciprocal_rank_fusion([dense_results[0], bm25_results], k=25)
            top_chunk = fused[0] if fused else None

            if top_chunk and top_chunk["id"] not in seen_ids:
                top_chunk["payload"]["_must_check"] = True
                top_chunk["payload"]["_must_check_reason"] = (
                    f"{rule['regulation']} {rule['article']}"
                )
                mandatory_chunks.append(top_chunk)
                seen_ids.add(top_chunk["id"])

        return mandatory_chunks
```

### 4.6 BGE-Reranker 精排

```python
# rag-service/retrieval/reranker.py

from FlagEmbedding import FlagReranker


class BGEreranker:
    """
    使用 BGE-Reranker-v2-m3（FlagEmbedding）进行 Cross-Encoder 重排。

    模型：BAAI/bge-reranker-v2-m3
    - MTEB Rerank SOTA（MTEB benchmark 第一名）
    - 支持语言：多语言，EU 法规英法德等原生支持
    - 费用：完全免费（MIT，GPU/CPU 本地推理）
    - 精度：远超 Cohere rerank-multilingual-v3.0

    备选（Cohere API）：
    - 模型：rerank-multilingual-v3.0，$0.05/1K 查询文档对

    策略：
    - 输入 Top-50 RRF 结果（RRF 融合后）
    - 输出 Top-10（按语义相关性重新排序）
    - 保留 rerank score 用于后续置信度判断
    """

    MODEL_NAME = "BAAI/bge-reranker-v2-m3"
    RERANK_TOP_K = 10

    def __init__(
        self,
        model_dir: str | None = None,
        use_fp16: bool = True,
        devices: str | None = None,
    ):
        """
        Args:
            model_dir: 本地模型路径，默认从 HuggingFace 自动下载
            use_fp16: 使用 FP16 加速（GPU）
            devices: 设备，"cuda:0" / "cpu"，默认自动检测
        """
        self.reranker = FlagReranker(
            model_dir or self.MODEL_NAME,
            use_fp16=use_fp16,
            devices=devices,
        )

    def rerank(
        self,
        query: str,
        documents: list[dict],
        top_n: int = 10,
    ) -> list[dict]:
        """
        对候选文档进行语义重排。

        Args:
            query: 原始查询文本
            documents: 候选文档列表（每项需含 id, content）
            top_n: 返回 Top-N 结果

        Returns:
            list[dict]: 重排后的结果，含 rerank_score
        """
        if not documents:
            return []

        # 从 payload 中提取文本内容
        doc_pairs = []
        doc_map = []
        for doc in documents:
            payload = doc.get("payload", {})
            text = payload.get("content", "")
            prepend = payload.get("prepend_text", "")
            content = (prepend + " " + text).strip() if prepend else text
            doc_pairs.append((query, content))
            doc_map.append(doc)

        # BGE-Reranker 批量计算分数
        scores = self.reranker.compute_score(doc_pairs, batch_size=32)

        # 按分数降序排列
        scored_docs = [
            {**doc, "rerank_score": float(scores[i])}
            for i, doc in enumerate(doc_map)
        ]
        scored_docs.sort(key=lambda x: x["rerank_score"], reverse=True)

        return scored_docs[:top_n]
```

### 4.7 完整检索流程

```python
# rag-service/retrieval/hybrid_retriever.py

from .dense_retriever import BGEM3DenseRetriever
from .bm25_retriever import JiebaBM25Retriever
from .fusion import reciprocal_rank_fusion
from .reranker import BGEreranker
from .must_check import MustCheckRegistry
from .query_rewrite import QueryRewriter


class HybridLegalRetriever:
    """
    混合检索主类。

    流程：
    1. Dense（ Cohere） Top-50
    2. BM25（jieba） Top-50
    3. RRF 融合（k=25）
    4. must_check 强制注入
    5. Cohere Rerank Top-10
    6. Parent-Child 组装
    """

    def __init__(
        self,
        dense_retriever: BGEM3DenseRetriever,
        bm25_retriever: JiebaBM25Retriever,
        reranker: BGEreranker,
        must_check_registry: MustCheckRegistry,
        qdrant_collection: str = "legal_chunks",
    ):
        self.dense = dense_retriever
        self.bm25 = bm25_retriever
        self.reranker = reranker
        self.must_check = must_check_registry
        self.collection = qdrant_collection
        self.rewriter = QueryRewriter()

    def _rewrite_query(self, query: str) -> list[str]:
        """
        将原始查询改写为多个语义变体，增加召回覆盖率。

        策略：产品视角变换 + 法规视角补充 + 合规术语标准化
        """
        return self.rewriter.rewrite(query)

    def retrieve(
        self,
        query: str,
        product_category: str,
        market: str | None = None,
        top_k: int = 10,
    ) -> dict:
        """
        执行完整混合检索流程。

        Args:
            query: 用户查询文本
            product_category: 产品类别（用于 must_check）
            market: 目标市场（EU / US / CN）
            top_k: 最终返回 Top-K

        Returns:
            {
                "chunks": list[dict],          # Top-K 完整 Parent Chunk
                "must_check_injected": list[str],  # 被强制注入的法规名
                "total_candidates": int,          # RRF 融合后候选总数
            }
        """
        # Step 1: Dense 检索（使用所有 Query Rewrite 结果）
        # rewrite_queries 来自 QueryRewrite 模块，返回多条rewrite后的query
        rewritten_queries = self._rewrite_query(query)
        all_queries = [query] + rewritten_queries   # 主查询 + rewrite 变体
        query_vecs = self.dense.embed_queries(all_queries)
        dense_results = self.dense.retrieve(query_vecs, self.collection, top_k=50)
        # dense_results 是 list[list[dict]]，每个子列表对应一条 query 的 Top-50

        # Step 2: BM25 检索
        bm25_results = self.bm25.retrieve(query, top_k=50)

        # Step 3: RRF 融合（合并所有 dense 结果 + BM25，不是只取 [0]）
        fused = reciprocal_rank_fusion(dense_results + [bm25_results], k=25)

        # Step 4: must_check 强制注入
        must_chunks = self.must_check.get_mandatory_chunks(
            product_category,
            self.dense,
            self.bm25,
            top_n=3,
        )
        must_check_names = [
            c["payload"].get("_must_check_reason", "")
            for c in must_chunks
        ]

        # 合并（去重，must_check 优先级高于 RRF 结果）
        seen_ids = {c["id"] for c in must_chunks}
        merged = list(must_chunks)
        for item in fused:
            if item["id"] not in seen_ids:
                merged.append(item)
                seen_ids.add(item["id"])

        # Step 5: Cohere Rerank Top-10
        reranked = self.reranker.rerank(query, merged, top_n=top_k)

        # Step 6: Parent-Child 组装（Child ID → Parent 上下文）
        parent_chunks = self._assemble_parents(reranked)

        return {
            "chunks": parent_chunks,
            "must_check_injected": must_check_names,
            "total_candidates": len(merged),
        }

    def _assemble_parents(self, child_results: list[dict]) -> list[dict]:
        """
        Child 精准召回 → Parent 完整上下文组装。

        从 Qdrant 中根据 child_id 找到对应的 Parent Chunk，
        替换 child 粒度的粗粒度结果。

        优化：批量查询而非逐条串行，减少 N 次网络往返为 1 次。
        """
        from qdrant_client import QdrantClient

        client = QdrantClient.from_env()

        # 收集所有待查的 parent_id（去重）
        parent_ids: list[str] = []
        child_without_parent: list[dict] = []

        for result in child_results:
            payload = result.get("payload", {})
            parent_id = payload.get("parent_id")
            if parent_id:
                parent_ids.append(parent_id)
            else:
                child_without_parent.append(result)

        # 批量拉取（1 次网络往返）
        parent_map: dict[str, dict] = {}
        if parent_ids:
            # Qdrant retrieve 支持批量 ID（需转 UUID）
            from scripts.ingest_to_qdrant import chunk_id_to_uuid
            parent_uuid_ids = [chunk_id_to_uuid(pid) for pid in parent_ids]
            parent_hits = client.retrieve(
                collection_name=f"{self.collection}_parents",
                ids=parent_uuid_ids,
                with_payload=True,
            )
            # 按 UUID 反查原始 parent_id（用 payload 中的 chunk_id）
            for hit in parent_hits:
                raw_id = hit.payload.get("chunk_id", str(hit.id))
                parent_map[raw_id] = hit.payload

        # 组装结果
        parent_chunks = []
        for result in child_results:
            payload = result.get("payload", {})
            parent_id = payload.get("parent_id")

            if parent_id and parent_id in parent_map:
                p = parent_map[parent_id]
                parent_chunks.append({
                    "id": parent_id,
                    "content": p.get("content", ""),
                    "prepend_text": p.get("prepend_text", ""),
                    "doc_name": p.get("doc_name", ""),
                    "article_no": p.get("article_no", ""),
                    "page_start": p.get("page_start", 0),
                    "page_end": p.get("page_end", 0),
                    "rerank_score": result.get("rerank_score", 0.0),
                    "must_check": payload.get("_must_check", False),
                })
            else:
                # 无 parent，直接使用 child
                parent_chunks.append({
                    "id": result.get("id", ""),
                    "content": payload.get("content", ""),
                    "prepend_text": payload.get("prepend_text", ""),
                    "doc_name": payload.get("doc_name", ""),
                    "article_no": payload.get("article_no", ""),
                    "page_start": payload.get("page_start", 0),
                    "page_end": payload.get("page_end", 0),
                    "rerank_score": result.get("rerank_score", 0.0),
                    "must_check": payload.get("_must_check", False),
                })

        return parent_chunks
```

---

## 5. 查询处理

### 5.1 Query Rewrite 规则

用户查询表述（如"充电宝铅含量限制"）与法规原文措辞（如"lead content Article 22 REACH"）存在差异。通过规则表进行显式映射补充。

```python
# rag-service/retrieval/query_rewrite.py


class QueryRewriter:
    """
    Query Rewrite 规则注册表。

    每条规则包含：
    - trigger: 触发关键词列表（用户查询中包含则触发）
    - rewrites: 追加的法律术语查询列表（给 BM25/Dense 用）

    扩展方式：发现召回盲区 → 追加规则 → 无需改架构
    """
    """
    Query Rewrite 规则注册表。

    每条规则包含：
    - trigger: 触发关键词列表（用户查询中包含则触发）
    - rewrites: 追加的法律术语查询列表（给 BM25/Dense 用）

    扩展方式：发现召回盲区 → 追加规则 → 无需改架构
    """

    RULES: list[dict] = [
        {
            "triggers": ["充电宝", "移动电源", "便携储能", "充电电池"],
            "market": "EU",
            "rewrites": [
                "lithium battery portable power bank REACH Article 22",
                "CE marking GPSR Article 4 portable electronic device",
                "RoHS Annex II heavy metal lead cadmium mercury",
                "Regulation 2023/1542 EU battery chemical requirements",
            ],
        },
        {
            "triggers": ["玩具", "儿童玩具", "儿童产品"],
            "market": "EU",
            "rewrites": [
                "EN 71-3 migrated elements toy safety limit value",
                "REACH Annex XVII phthalate restriction children's product",
                "GPSR Article 5 toy product safety assessment",
            ],
        },
        {
            "triggers": ["锂电池", "锂离子电池"],
            "market": "EU",
            "rewrites": [
                "Regulation 2023/1542 battery EU new rules chemical",
                "REACH Article 22 chemical restriction lithium battery",
                "CLP regulation lithium ion hazard classification",
            ],
        },
        {
            "triggers": ["锂电池", "锂离子电池"],
            "market": "US",
            "rewrites": [
                "49 CFR DOT lithium battery transport regulation",
                "TSCA chemical substance inventory lithium",
                "UL 2744 lithium battery safety standard",
            ],
        },
        {
            "triggers": ["FCC", "美国认证", "美国市场"],
            "market": "US",
            "rewrites": [
                "FCC Part 15 unintentional radiator digital device",
                "CPSIA lead content limit 100ppm children's product",
                "TSCA chemical substance inventory new use rule",
            ],
        },
        {
            "triggers": ["CCC认证", "中国认证", "国内市场"],
            "market": "CN",
            "rewrites": [
                "GB 31241 lithium battery safety national standard",
                "CCC mandatory certification electronics safety",
                "China product quality law market supervision",
            ],
        },
        {
            "triggers": ["蓝牙", "无线设备", "WiFi设备"],
            "market": "EU",
            "rewrites": [
                "RED 2014/53/EU Article 3 radio equipment radio frequency",
                "EMC Directive 2014/30/EU electromagnetic compatibility",
                "Radio Equipment Directive spectrum authorization",
            ],
        },
        {
            "triggers": ["纺织品", "服装", "面料"],
            "market": "EU",
            "rewrites": [
                "REACH Annex XVII Item 43 azo dye textile restriction",
                "Oeko-Tex Standard 100 textile harmful substances",
                "GPSR Article 8 textile product safety labeling",
            ],
        },
        {
            "triggers": ["REACH", "化学品注册", "化学物质"],
            "market": "EU",
            "rewrites": [
                "REACH Regulation 1907/2006 chemical registration requirement",
                "REACH Article 22 restriction lead cadmium mercury",
                "REACH Annex XVII SVHC substance restriction list",
            ],
        },
        {
            "triggers": ["RoHS", "有害物质", "环保"],
            "market": "EU",
            "rewrites": [
                "RoHS Directive 2011/65/EU Annex II restricted substance",
                "RoHS lead cadmium mercury hexavalent chromium PBB PBDE",
                "RoHS homogeneous material concentration limit 0.01%",
            ],
        },
        {
            "triggers": ["GDPR", "个人数据", "隐私"],
            "market": "EU",
            "rewrites": [
                "GDPR Article 6 lawful basis personal data processing",
                "GDPR Article 32 security of processing technical measures",
                "GDPR Article 33 data breach notification 72 hours",
            ],
        },
        {
            "triggers": ["CE标志", "CE认证", "加贴CE"],
            "market": "EU",
            "rewrites": [
                "CE marking conformity assessment procedure EU",
                "Regulation 765/2008 CE marking requirements",
                "GPSR Article 4 CE marking product market placement",
            ],
        },
        {
            "triggers": ["GPSR", "通用产品安全", "产品安全法规"],
            "market": "EU",
            "rewrites": [
                "GPSR Regulation 2023/988 general product safety",
                "GPSR Article 5 product safety assessment manufacturer",
                "GPSR Article 9 traceability documentation requirement",
            ],
        },
    ]

    def rewrite(self, query: str, market: str) -> list[str]:
        """
        对用户查询进行 rewrite。

        Args:
            query: 原始用户查询
            market: 目标市场（EU / US / CN）

        Returns:
            list[str]: 重写后的查询列表（第一条为原始 query）
        """
        results = [query]  # 保留原始 query（给 dense 向量用）

        for rule in self.RULES:
            if rule.get("market") and rule["market"] != market:
                continue
            if any(trigger in query for trigger in rule.get("triggers", [])):
                results.extend(rule.get("rewrites", []))

        # 去重，保持顺序
        seen = set()
        unique_results = []
        for q in results:
            if q not in seen:
                seen.add(q)
                unique_results.append(q)

        return unique_results
```

### 5.2 LLM Query 分解（可选增强）

对于复杂多维度查询，使用 Claude Sonnet 分解为多个子查询：

```python
# rag-service/retrieval/query_decomposer.py

DECOMPOSE_PROMPT = """
你是一个合规检索专家。用户提问可能涉及多个法规维度，
请将其分解为独立检索子查询。

规则：
- 每个子查询聚焦一个法规维度（化学物质 / 电磁兼容 / 数据隐私等）
- 使用中英混合术语（中文问题 + 英文法规术语）
- 最多分解为 3 个子查询（超过则取最重要的 3 个）
- 直接输出 JSON 数组，不要解释

用户问题：{query}
目标市场：{market}
产品类别：{category}

输出格式：
{{"sub_queries": ["子查询1", "子查询2", "子查询3"]}}
"""


def decompose_query(
    query: str,
    market: str,
    category: str,
    claude_client,
) -> list[str]:
    """
    使用 LLM 将复杂查询分解为多个子查询（可选增强）。

    适用场景：
    - 复杂多维度合规问题（如"某锂电池充电宝出口欧盟的全面合规要求"）
    - 简单查询（如"REACH Article 22 铅含量"）无需分解

    Args:
        query: 原始用户查询
        market: 目标市场
        category: 产品类别
        claude_client: Anthropic Claude SDK 客户端

    Returns:
        list[str]: 子查询列表（用于并行检索）
    """
    # 判断是否需要分解：查询长度 > 30 字 且 含多个维度关键词
    dimension_keywords = [
        "要求", "合规", "规定", "限制", "标准", "认证",
        "requirement", "regulation", "standard", "limit",
    ]
    query_len = len(query)
    dimension_count = sum(1 for kw in dimension_keywords if kw in query)

    # 简单查询直接返回原查询
    if query_len < 30 or dimension_count <= 1:
        return [query]

    response = claude_client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=256,
        messages=[
            {
                "role": "user",
                "content": DECOMPOSE_PROMPT.format(
                    query=query,
                    market=market,
                    category=category,
                ),
            }
        ],
    )

    import json
    result_text = response.content[0].text.strip()
    # 尝试解析 JSON
    try:
        data = json.loads(result_text)
        return data.get("sub_queries", [query])
    except json.JSONDecodeError:
        return [query]
```

---

## 6. 引用验证

### 6.1 硬门验证层

Citation Verifier 是检索管线的最后一道硬门，检查报告中的每条引用是否在检索到的原文中有对应。

**设计决策：**
- **反应式硬门**（生成后检查）而非**预防式 Agent 循环**
- Agent 自纠错循环增加 10-15s 延迟，在本场景下修复 chunk 质量比 Agent 重试更根本
- Citation Verifier 作为硬门在 0 引用时直接拒绝生成，而非无止境重试

### 6.2 规则级引用验证

```python
# rag-service/verify/citation_verifier.py

import re
from dataclasses import dataclass
from typing import Optional


@dataclass
class CitationCheck:
    """单条引用检查结果"""
    citation_text: str          # 报告中引用的文本
    article_no: str             # 提取的条款编号
    found_in_chunks: list[str]  # 命中的 chunk ID 列表
    verified: bool              # 是否在原文找到
    verification_method: str    # exact | fuzzy | partial


@dataclass
class CitationVerificationResult:
    """整份报告的引用验证结果"""
    total_citations: int
    verified_count: int
    unverified_count: int
    verified_citations: list[CitationCheck]
    unverified_citations: list[CitationCheck]
    confidence: float           # verified_count / total_citations
    gate_status: str            # PASS | WARN | FAIL
    gate_passed: bool           # True iff verified_count >= 3
    report_allowed: bool        # True iff verified_count >= 1


class CitationVerifier:
    """
    引用验证器（硬门）。

    策略：
    - 规则层：正则提取 Article/条款编号，与检索到的 Chunk 原文交叉验证
    - LLM 层（可选）：Claude Sonnet 判断无法正则提取的引用
      （Phase 3 后视召回质量决定是否启用）

    硬门判断：
    - verified >= 3  → PASS  ✅，正常展示
    - verified 1-2    → WARN  ⚠️，允许生成但标注警告
    - verified = 0    → FAIL  ❌，拒绝生成，返回错误
    """

    # EU 法规引用正则
    EU_CITATION_PATTERN = re.compile(
        r'(?:REACH|RoHS|GPSR|RED|DSA|DMA|GDPR|AI\s*Act|'
        r'Regulation\s*\d+/\d+|Directive\s*\d+/\d+/EC)'
        r'[^\[\]\n]{0,100}?'
        r'(?:Article|Article\s*\d+[\dA-Za-z]*|Annex\s*[IVX\d]+)'
        r'[^\[\]\n]{0,100}',
        re.IGNORECASE,
    )

    # 中国法规引用正则
    CN_CITATION_PATTERN = re.compile(
        r'(?:第[一二三四五六七八九十百零〇\d]+条'
        r'|《[^》]+》'
        r'|GB\s*\d+)'
        r'[^\n]{0,50}',
        re.UNICODE,
    )

    # 美国法规引用正则
    US_CITATION_PATTERN = re.compile(
        r'(?:§\s*[\d.:\-a-z]+'
        r'|USC\s*\d+\s*§\s*\d+'
        r'|CFR\s*\d+\s*Part\s*\d+)'
        r'[^\n]{0,50}',
        re.UNICODE,
    )

    # 页码引用正则
    PAGE_CITATION_PATTERN = re.compile(
        r'[，,]\s*(?:p\.?|page|页)\s*(\d+)',
        re.IGNORECASE,
    )

    def extract_citations(self, report_text: str) -> list[str]:
        """
        从报告文本中提取所有法规引用标记。

        匹配模式：
        - "REACH Article 22, p.156"
        - "GPSR 第5条"
        - "§ 15.119"
        - "《产品质量法》第12条"
        """
        citations = []

        # 匹配 EU 法规引用
        for m in self.EU_CITATION_PATTERN.finditer(report_text):
            citations.append(m.group(0).strip())

        # 匹配中国法规引用
        for m in self.CN_CITATION_PATTERN.finditer(report_text):
            citations.append(m.group(0).strip())

        # 匹配美国法规引用
        for m in self.US_CITATION_PATTERN.finditer(report_text):
            citations.append(m.group(0).strip())

        # 去重（按原始文本）
        seen = set()
        unique = []
        for c in citations:
            if c not in seen:
                seen.add(c)
                unique.append(c)

        return unique

    def extract_article_no(self, citation: str) -> str | None:
        """
        从引用字符串中提取条款编号。

        Returns:
            条款编号字符串（如 "Article 22", "第22条", "§ 15.119"）
            无法提取则返回 None
        """
        # EU: Article 22, Article 3a
        eu_match = re.search(
            r'Article\s*\d+[\dA-Za-z]*',
            citation,
            re.IGNORECASE,
        )
        if eu_match:
            return eu_match.group(0)

        # CN: 第22条
        cn_match = re.search(
            r'第[一二三四五六七八九十百零〇\d]+条',
            citation,
        )
        if cn_match:
            return cn_match.group(0)

        # US: § 15.119
        us_match = re.search(
            r'§\s*[\d.:\-a-z]+',
            citation,
        )
        if us_match:
            return us_match.group(0)

        # 法规名 + 编号
        num_match = re.search(
            r'(?:Regulation|Directive|Law|Act)\s*\d+[/\-]\d+',
            citation,
            re.IGNORECASE,
        )
        if num_match:
            return num_match.group(0)

        return None

    def verify_citation_in_chunk(
        self,
        article_no: str,
        chunk_content: str,
        chunk_prepend: str,
    ) -> bool:
        """
        判断某条引用是否在单个 chunk 原文中有对应。

        策略：
        1. 精确匹配：条款编号在 chunk 文本中精确出现
        2. 模糊匹配：条款编号的变体形式出现（同义表述）
        """
        combined = (chunk_prepend + " " + chunk_content).lower()
        article_lower = article_no.lower()

# 精确匹配（单词边界，防止 "Article 2" 匹配到 "Article 22"）
        pattern = re.compile(r'\b' + re.escape(article_lower) + r'\b', re.IGNORECASE)
        if pattern.search(combined):
            return True

        # 规范化后匹配（去除空格/]', '', article_lower)
        for word in combined.split():
            normalized_word = re.sub(r'[\s\-–—]', '', word)
            if normalized_article in normalized_word:
                return True

        return False

    def verify_report(
        self,
        report_text: str,
        retrieved_chunks: list[dict],
    ) -> CitationVerificationResult:
        """
        对整份报告执行引用验证。

        Args:
            report_text: LLM 生成的报告原文
            retrieved_chunks: 检索阶段返回的 Top-K chunks
                每项需含：id, content, prepend_text, doc_name, article_no

        Returns:
            CitationVerificationResult（含硬门判断）
        """
        citations = self.extract_citations(report_text)

        if not citations:
            return CitationVerificationResult(
                total_citations=0,
                verified_count=0,
                unverified_count=0,
                verified_citations=[],
                unverified_citations=[],
                confidence=0.0,
                gate_status="FAIL",
                gate_passed=False,
                report_allowed=False,
            )

        verified_list: list[CitationCheck] = []
        unverified_list: list[CitationCheck] = []

        for citation in citations:
            article_no = self.extract_article_no(citation)

            if not article_no:
                # 无法提取条款编号，标记为未验证
                unverified_list.append(CitationCheck(
                    citation_text=citation,
                    article_no="",
                    found_in_chunks=[],
                    verified=False,
                    verification_method="none",
                ))
                continue

            # 在所有 chunk 中查找
            found_in: list[str] = []
            for chunk in retrieved_chunks:
                content = chunk.get("content", "")
                prepend = chunk.get("prepend_text", "")
                if self.verify_citation_in_chunk(article_no, content, prepend):
                    found_in.append(chunk.get("id", ""))

            if found_in:
                verified_list.append(CitationCheck(
                    citation_text=citation,
                    article_no=article_no,
                    found_in_chunks=found_in,
                    verified=True,
                    verification_method="exact",
                ))
            else:
                unverified_list.append(CitationCheck(
                    citation_text=citation,
                    article_no=article_no,
                    found_in_chunks=[],
                    verified=False,
                    verification_method="not_found",
                ))

        total = len(citations)
        verified_count = len(verified_list)
        confidence = verified_count / total if total > 0 else 0.0

        if verified_count >= 3:
            gate_status = "PASS"
            gate_passed = True
        elif verified_count >= 1:
            gate_status = "WARN"
            gate_passed = False
        else:
            gate_status = "FAIL"
            gate_passed = False

        return CitationVerificationResult(
            total_citations=total,
            verified_count=verified_count,
            unverified_count=len(unverified_list),
            verified_citations=verified_list,
            unverified_citations=unverified_list,
            confidence=confidence,
            gate_status=gate_status,
            gate_passed=gate_passed,
            report_allowed=verified_count > 0,
        )
```

### 6.3 硬门执行逻辑

```python
# 硬门执行示例（在报告生成流程中调用）

def generate_compliance_report(
    query: str,
    product: str,
    markets: list[str],
    category: str,
    vision_result: dict,
    retrieved_chunks: list[dict],
    verifier: CitationVerifier,
    claude_client,
) -> dict:
    """
    带硬门的合规报告生成流程。
    """
    # Step 1: 构造生成 Prompt
    context_blocks = "\n\n".join([
        f"[{c['doc_name']}] {c['article_no']}（p.{c['page_start']}-{c['page_end']}）:\n{c['content']}"
        for c in retrieved_chunks
    ])

    prompt = f"""
你是一个专业的欧盟/美国/中国合规顾问。
根据以下法规原文，为产品「{product}」生成合规报告。

产品信息：{vision_result.get('description', '')}
目标市场：{', '.join(markets)}

【法规原文】
{context_blocks}

【报告要求】
1. 每个合规结论必须注明：[法规名 Article X, p.Y]
2. 引用原文关键段落（blockquote 格式）
3. 结论需明确：✅ 符合 / ⚠️ 部分符合 / ❌ 不符合
4. 包含整改建议清单（含法规依据）

请生成完整报告：
"""

    # Step 2: LLM 生成
    response = claude_client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )
    report_text = response.content[0].text

    # Step 3: Citation 硬门验证
    result = verifier.verify_report(report_text, retrieved_chunks)

    # Step 4: 硬门决策
    if not result.report_allowed:
        return {
            "status": "REJECTED",
            "reason": (
                f"报告中含 {result.total_citations} 条引用，"
                f"但 0 条可在检索到的原文验证。拒绝展示，防止幻觉。"
            ),
            "verification_result": {
                "gate_status": result.gate_status,
                "verified_count": 0,
                "unverified_count": 0,
            },
            "report": None,
        }

    if result.gate_status == "WARN":
        return {
            "status": "WARN",
            "warning": (
                f"仅 {result.verified_count} 条引用已验证（目标 ≥3）。"
                f"请核实以下未验证引用：{[c.citation_text for c in result.unverified_citations]}"
            ),
            "verification_result": {
                "gate_status": result.gate_status,
                "verified_count": result.verified_count,
                "unverified_count": result.unverified_count,
                "verified_citations": [
                    {"text": c.citation_text, "in_chunks": c.found_in_chunks}
                    for c in result.verified_citations
                ],
                "unverified_citations": [
                    {"text": c.citation_text}
                    for c in result.unverified_citations
                ],
            },
            "report": report_text,
        }

    # PASS
    return {
        "status": "PASS",
        "verification_result": {
            "gate_status": result.gate_status,
            "verified_count": result.verified_count,
            "confidence": result.confidence,
            "verified_citations": [
                {"text": c.citation_text, "in_chunks": c.found_in_chunks}
                for c in result.verified_citations
            ],
            "unverified_citations": [
                {"text": c.citation_text}
                for c in result.unverified_citations
            ],
        },
        "report": report_text,
    }
```

### 6.4 前端展示语义

| 状态 | 标签 | 含义 | 行为 |
|------|------|------|------|
| PASS | ✅ 已验证 | >= 3 条引用在原文验证 | 正常展示报告 |
| WARN | ⚠️ 部分验证 | 1-2 条引用在原文验证 | 展示报告 + 警告横幅 |
| FAIL | ❌ 拒绝 | 0 条引用验证 | 不展示报告，提示检索不足 |

---

## 7. 报告生成

### 7.1 Prompt 模板

```python
# rag-service/generator/compliance_reporter.py

COMPLIANCE_REPORT_PROMPT = """
你是一个专业的{market}市场合规顾问，擅长解读欧盟、美国、中国法规原文。
给定产品信息、目标市场和相关法规原文，生成结构化合规报告。

【产品信息】
产品名称：{product}
产品类别：{category}
目标市场：{market}
识别细节：{vision_description}

【相关法规原文】
{context_blocks}

【报告格式要求】

## 一、合规状态总览
以表格形式列出各项要求的合规状态：
| 要求 | 状态 | 依据 |
|------|------|------|

## 二、详细分析
每个风险点必须包含：
- ⚠️ [风险名称]
  依据：[法规名 Article X, p.Y]
  原文："[引用原文]"

## 三、整改建议
1. [高/中/低优先级] [整改项名称]
   法规依据：[法规名 Article X, p.Y]
   原文："[引用原文]"
   建议措施：[具体建议]

## 四、引用来源
按引用顺序列出所有法规来源。

【严格要求】
1. 每个结论必须附上 [法规名 Article X, p.Y] 引用格式
2. 引用原文必须完整（不省略关键数字和条件）
3. 不确定的内容标注"需进一步核实"，不编造
4. 整改建议含预估成本和周期（如有依据）
"""


def build_report_prompt(
    product: str,
    category: str,
    market: str,
    vision_result: dict,
    retrieved_chunks: list[dict],
) -> str:
    """构造报告生成 Prompt。"""
    context_blocks = []
    for c in retrieved_chunks:
        page_range = f"{c['page_start']}-{c['page_end']}" if c.get("page_start") else "N/A"
        block = (
            f"[{c['doc_name']}] {c['article_no']}（p.{page_range}）:\n"
            f"{c['content'][:1500]}"  # 单个 chunk 最多 1500 字符
        )
        context_blocks.append(block)

    return COMPLIANCE_REPORT_PROMPT.format(
        product=product,
        category=category,
        market=market,
        vision_description=vision_result.get("description", ""),
        context_blocks="\n\n---\n\n".join(context_blocks),
    )
```

### 7.2 报告生成流程

```python
# rag-service/generator/compliance_reporter.py

import anthropic
import os


class ComplianceReportGenerator:
    """
    合规报告生成器（Claude Sonnet）。

    流程：
    1. 构造 Prompt（含检索到的法规原文上下文）
    2. 调用 Claude Sonnet 生成报告
    3. 返回报告文本（不含引用验证，引用验证在 verify 层执行）
    """

    def __init__(self):
        self.client = anthropic.Anthropic(
            api_key=os.environ["ANTHROPIC_API_KEY"],
        )
        self.model = "claude-sonnet-4-6"

    def generate(
        self,
        product: str,
        category: str,
        markets: list[str],
        vision_result: dict,
        retrieved_chunks: list[dict],
        max_tokens: int = 4096,
    ) -> str:
        """
        生成合规报告。

        Args:
            product: 产品名称
            category: 产品类别
            markets: 目标市场列表
            vision_result: Vision 识别结果
            retrieved_chunks: Top-K Parent Chunk 列表
            max_tokens: 最大输出 token 数

        Returns:
            报告 Markdown 文本
        """
        # 分市场生成（每市场一张子报告，合并）
        reports = []
        for market in markets:
            market_chunks = [
                c for c in retrieved_chunks
                if c.get("jurisdiction") == market or
                   c.get("doc_name", "").lower().find(market.lower()) >= 0
            ]
            if not market_chunks:
                market_chunks = retrieved_chunks  # 兜底：使用全量

            prompt = build_report_prompt(
                product=product,
                category=category,
                market=market,
                vision_result=vision_result,
                retrieved_chunks=market_chunks,
            )

            response = self.client.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                messages=[{"role": "user", "content": prompt}],
            )
            reports.append(f"## {market} 市场合规报告\n\n{response.content[0].text}")

        return "\n\n".join(reports)
```

---

## 8. 文件结构

```
attrax/
├── rag-service/                        # 独立 Python FastAPI 服务
│   ├── main.py                        # FastAPI 应用入口
│   ├── config.py                      # 配置管理（API keys、Qdrant 连接等）
│   ├── requirements.txt              # Python 依赖
│   │
│   ├── parser/                        # 文档解析
│   │   ├── __init__.py
│   │   ├── base.py                   # Parser 基类
│   │   ├── pdf_parser.py             # pdfplumber PDF 解析
│   │   ├── docx_parser.py            # python-docx DOCX 解析
│   │   ├── html_parser.py            # BeautifulSoup4 + Playwright
│   │   └── classifier.py             # HTML 文件类型分类
│   │
│   ├── chunker/                      # 分块策略
│   │   ├── __init__.py
│   │   ├── legal_chunker.py          # LegalChunker（Parent-Child，正则切分）
│   │   └── table_processor.py        # 表格双重字段处理
│   │
│   ├── retrieval/                    # 检索管线
│   │   ├── __init__.py
│   │   ├── dense_retriever.py        # Cohere Dense 检索
│   │   ├── bm25_retriever.py         # jieba BM25 检索
│   │   ├── fusion.py                 # RRF 融合
│   │   ├── reranker.py               # Cohere Rerank
│   │   ├── must_check.py             # must_check 强制注入
│   │   ├── query_rewrite.py          # Query Rewrite 规则
│   │   ├── query_decomposer.py       # LLM Query 分解（可选）
│   │   └── hybrid_retriever.py       # 混合检索主类
│   │
│   ├── verify/                       # 引用验证
│   │   ├── __init__.py
│   │   ├── citation_verifier.py       # 硬门引用验证（规则级）
│   │   └── hallucination_grader.py    # LLM-as-Judge（可选增强）
│   │
│   ├── generator/                    # 报告生成
│   │   ├── __init__.py
│   │   └── compliance_reporter.py    # Claude Sonnet 报告生成
│   │
│   ├── models/                       # 数据模型
│   │   ├── __init__.py
│   │   ├── schemas.py                # Pydantic 数据模型（详见第11节）
│   │   └── qdrant_schemas.py         # Qdrant collection 配置
│   │
│   ├── storage/                      # 存储层
│   │   ├── __init__.py
│   │   ├── qdrant_client.py          # Qdrant 连接管理
│   │   └── chunk_repository.py       # Chunk CRUD 操作
│   │
│   └── tests/                        # 单元测试
│       ├── __init__.py
│       ├── test_legal_chunker.py
│       ├── test_bm25_retriever.py
│       ├── test_citation_verifier.py
│       ├── test_rrf_fusion.py
│       └── test_query_rewrite.py
│
├── data/                             # 原始数据（不上传至代码仓库）
│   ├── corpus/                       # 预解析语料库
│   │   ├── eu/                       # EU 法规 JSON
│   │   ├── us/                       # 美国法规 JSON
│   │   ├── cn/                       # 中国法规 JSON
│   │   ├── gcc/                      # 海湾国家法规 JSON
│   │   └── index.json                # 全量索引（含版本号、日期）
│   └── 全部法规/                      # 原始法规文件（PDF/HTML/DOCX）
│       ├── 欧盟/
│       ├── 美国/
│       └── ...
│
├── scripts/                          # 运维脚本
│   ├── build_corpus.py               # 批量构建语料库
│   ├── ingest_to_qdrant.py           # 批量写入 Qdrant
│   ├── test_retrieval.py             # 检索质量测试
│   └── seed_must_check.py            # 初始化 must_check 规则
│
├── docs/                             # 文档
│   ├── RAG-ARCHITECTURE-v2.md        # 本文档
│   └── RAG-ARCHITECTURE.md           # v1.4 旧版（保留参考）
│
└── src/                              # Next.js（现有代码）
    └── app/api/scan/route.ts         # 转发请求到 rag-service
```

---

## 9. 实施阶段

> 架构原则：**静态 RAG + 硬门，无 Agentic 循环**。简单即正确。

### Phase 0：基础设施验证（1天）

**目标：** 验证所有外部依赖可用（API 连接、Docker 环境）。

```
步骤:
1. 安装依赖：pip install cohere qdrant-client rank_bm25 jieba anthropic fastapi uvicorn
2. 配置 Qdrant（Docker）：
   docker run -d --name qdrant \
     -p 6333:6333 -p 6334:6334 \
     -v qdrant_storage:/qdrant/storage \
     qdrant/qdrant
3. 验证 Cohere API 连通：
   # Cohere API (备选)().embed(texts=["测试"], model="embed-multilingual-v3.0")
4. 验证 Qdrant 连通：
   QdrantClient.from_env().get_collections()
5. 验证 jieba 分词：
   jieba.lcut("REACH Article 22 铅含量限制")
6. 验证 Claude Sonnet 连通
7. 创建 Qdrant collection（child + parent）
```

### Phase 1：语料库构建（2天）

**目标：** 18 个 EU PDF + 9 个 DOCX 全部入 Qdrant。

```
步骤:
1. 运行 parser 解析 EU PDF（pdfplumber）
   → 提取文本 + 页码
2. 运行 LegalChunker 分块
   → Child Chunk（~200-300 tokens）+ Parent Chunk（~800-1000 tokens）
   → contextual prepend 前缀添加
3. 表格双重字段处理
4. 调用 Cohere embed-multilingual-v3 批量向量化
   → 输出：chunk_id → vector（1024 维）
5. 写入 Qdrant：
   - child_chunks collection（含向量）
   - parent_chunks collection（无向量，仅存储）
6. 运行 DOCX 解析 + 分块 + 向量化 + 入库（重复步骤 1-5）
7. 验证：test_retrieval.py 抽检 5 个 query
```

**向量化批处理示例：**

```python
# scripts/ingest_to_qdrant.py（片段）

import hashlib
import uuid
from rag_service.retrieval.dense_retriever import BGEM3DenseRetriever
from qdrant_client import QdrantClient
from qdrant_client.http import models

BATCH_SIZE = 90  # Cohere 单次最多 96 条


def chunk_id_to_uuid(chunk_id: str) -> str:
    """
    将字符串 chunk_id 确定性地转为 UUID。

    Qdrant 只接受 unsigned int 或 UUID 作为 ID，不能用纯字符串。
    用 MD5 哈希确定性生成 UUID（方便反查）。
    """
    return str(uuid.UUID(bytes=hashlib.md5(chunk_id.encode()).digest()))


def ingest_chunks(chunks: list[dict], collection_name: str):
    dense = BGEM3DenseRetriever()
    client = QdrantClient.from_env()

    # 构造 embedding 输入（content + prepend）
    texts_to_embed = [
        (c["prepend_text"] + " " + c["content"])[:2000]  # 截断至 2000 字符
        for c in chunks
    ]

    # 分批 embedding
    vectors = []
    for i in range(0, len(texts_to_embed), BATCH_SIZE):
        batch = texts_to_embed[i:i + BATCH_SIZE]
        batch_vectors = dense.embed_chunks(batch)
        vectors.extend(batch_vectors)

    # 写入 Qdrant（ID 必须是 UUID，原字符串存入 payload）
    points = [
        models.PointStruct(
            id=chunk_id_to_uuid(c["chunk_id"]),   # UUID（Qdrant 接受）
            vector={"dense": vectors[i]},
            payload={
                "chunk_id": c["chunk_id"],         # 原始字符串（反查用）
                "content": c["content"],
                "prepend_text": c["prepend_text"],
                "doc_name": c["doc_name"],
                "article_no": c["article_no"],
                "parent_id": c.get("parent_id", ""),
                "page_start": c.get("page_start", 0),
                "page_end": c.get("page_end", 0),
                "jurisdiction": c.get("jurisdiction", "EU"),
            },
        )
        for i, c in enumerate(chunks)
    ]

    client.upsert(
        collection_name=collection_name,
        points=points,
    )
    print(f"Uploaded {len(points)} chunks to {collection_name}")
```

### Phase 2：检索管线联调（2天）

**目标：** 混合检索（dense + BM25 + RRF + rerank）端到端跑通。

```
步骤:
1. 接入 BM25 索引（基于入库 chunk 文本）
2. 实现 RRF 融合（k=25）
3. 实现 Cohere Rerank
4. 实现 must_check 强制注入
5. 实现 Parent-Child 组装
6. 检索质量测试：
   - 8 个测试 Query（见下表）
   - Top-10 召回率目标：90%+
   - Rerank 前 → Rerank 后对比
7. 发现召回盲区 → 追加 Query Rewrite 规则
```

**测试 Query 列表：**

| # | 产品 | 市场 | 预期召回 Article |
|---|------|------|-----------------|
| 1 | 充电宝 | EU | REACH Article 22（铅含量）+ RoHS Annex II |
| 2 | 乒乓球拍 | EU | REACH Annex XVII（增塑剂）+ GPSR Article 5 |
| 3 | 锂电池 | US | TSCA 化学物质清单 + DOT 运输规定 |
| 4 | 电子手表 | EU | RED Article 3（射频频谱）+ LVD 安全要求 |
| 5 | 蓝牙音箱 | EU + US | RED + EMC + FCC Part 15 |
| 6 | 儿童玩具 | EU | EN 71-3（可迁移元素）+ REACH Annex XVII |
| 7 | 充电宝 | CN | CCC 认证 + GB 31241（锂电池） |
| 8 | 纺织品 | EU | REACH Annex XVII（偶氮染料）+ Oeko-Tex |

### Phase 3：引用验证 + 报告生成（2天）

**目标：** 端到端跑出第一张带引用的合规报告。

```
步骤:
1. 实现 CitationVerifier 规则层
2. 接入 Claude Sonnet 报告生成
3. 实现硬门判断逻辑
4. 硬门测试：
   a. 正常 query → verified >= 3 → PASS ✅
   b. 边界 query → verified 1-2 → WARN ⚠️
   c. 随机 query → verified = 0 → FAIL ❌
5. 可选：hallucination_grader（LLM-as-Judge）
6. 报告格式验证（引文格式正确性）
```

### Phase 4：语料扩充 + 前端接入（2天）

**目标：** 处理剩余 HTML + 接入 Next.js 前端。

```
步骤:
1. 处理 35 个 HTML（静态 UTF-8 / GBK / JS 渲染）
2. Playwright 处理 JS 渲染类（~10 个）
3. 评估截图 PDF（7 个）：OCR vs 放弃
4. 增量入库（upsert）
5. 修改 Next.js route.ts → POST rag-service
6. 前端展示：✅ / ⚠️ / ❌ 标签 + 导出按钮
```

**预估端到端延迟：**
- Dense + BM25 + RRF：并行 ~1-2s（Cohere API 延迟）
- Rerank：~0.5-1s（Cohere Rerank API）
- LLM 生成：~3-5s（Claude Sonnet）
- **总计：5-10s**

---

## 10. API 合约

### 10.1 FastAPI 接口定义

```python
# rag-service/main.py
from contextlib import asynccontextmanager
import os
import pickle

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

from rag_service.retrieval.dense_retriever import BGEM3DenseRetriever
from rag_service.retrieval.bm25_retriever import JiebaBM25Retriever
from rag_service.retrieval.reranker import BGEreranker
from rag_service.retrieval.must_check import MustCheckRegistry
from rag_service.retrieval.hybrid_retriever import HybridLegalRetriever
from rag_service.verify.citation_verifier import CitationVerifier
from rag_service.generate.report_generator import ComplianceReportGenerator
from qdrant_client import QdrantClient


# ── 组件单例（lifespan 内初始化）───────────────────────────────────

dense_retriever: BGEM3DenseRetriever | None = None
bm25_retriever: JiebaBM25Retriever | None = None
reranker: BGEreranker | None = None
must_check_registry: MustCheckRegistry | None = None
hybrid_retriever: HybridLegalRetriever | None = None
citation_verifier: CitationVerifier | None = None
report_generator: ComplianceReportGenerator | None = None
qdrant_client: QdrantClient | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    服务启动 / 关闭生命周期。

    启动时：
    1. 初始化所有组件
    2. 尝试从磁盘恢复 BM25 索引；若不存在则从 Qdrant 重建
    """
    global dense_retriever, bm25_retriever, reranker
    global must_check_registry, hybrid_retriever
    global citation_verifier, report_generator, qdrant_client

    # 初始化 Qdrant 客户端
    qdrant_client = QdrantClient.from_env()

    # 初始化各组件
    dense_retriever = BGEM3DenseRetriever()
    reranker = BGEreranker()
    must_check_registry = MustCheckRegistry()
    citation_verifier = CitationVerifier()
    report_generator = ComplianceReportGenerator()
    bm25_retriever = JiebaBM25Retriever()

    # 恢复或重建 BM25 索引
    bm25_path = "data/bm25_index.pkl"
    if os.path.exists(bm25_path):
        with open(bm25_path, "rb") as f:
            idx_data = pickle.load(f)
            bm25_retriever.bm25 = idx_data["bm25"]
            bm25_retriever.corpus_tokenized = idx_data["corpus_tokenized"]
            bm25_retriever.chunk_ids = idx_data["chunk_ids"]
    else:
        # 从 Qdrant payload 拉取全量 chunk 文本，重建 BM25 索引
        _rebuild_bm25(bm25_retriever, qdrant_client)

    # 初始化混合检索器
    collection = os.environ.get("QDRANT_COLLECTION", "legal_chunks")
    hybrid_retriever = HybridLegalRetriever(
        dense_retriever=dense_retriever,
        bm25_retriever=bm25_retriever,
        reranker=reranker,
        must_check_registry=must_check_registry,
        qdrant_collection=collection,
    )

    yield

    # 关闭时：持久化 BM25 索引
    os.makedirs("data", exist_ok=True)
    with open(bm25_path, "wb") as f:
        pickle.dump({
            "bm25": bm25_retriever.bm25,
            "corpus_tokenized": bm25_retriever.corpus_tokenized,
            "chunk_ids": bm25_retriever.chunk_ids,
        }, f)


def _rebuild_bm25(bm25: JiebaBM25Retriever, client: QdrantClient):
    """
    从 Qdrant 全量拉取 chunk 文本，重建 BM25 索引。

    collection 需先通过 build-corpus 接口完成建库。
    """
    collection = os.environ.get("QDRANT_COLLECTION", "legal_chunks")
    chunks = []
    offset = None

    while True:
        result = client.scroll(
            collection_name=collection,
            limit=1000,
            offset=offset,
            with_payload=True,
        )
        records, offset = result
        if not records:
            break
        for rec in records:
            payload = rec.payload or {}
            chunks.append({
                "chunk_id": payload.get("chunk_id", str(rec.id)),
                "content": payload.get("content", ""),
                "prepend_text": payload.get("prepend_text", ""),
            })
        if offset is None:
            break

    if chunks:
        bm25.index(chunks)


app = FastAPI(
    title="attrax RAG Service",
    version="2.0.0",
    description="火鹰合规 RAG 检索服务",
    lifespan=lifes


# ── 请求 / 响应模型 ─────────────────────────────────────────────

class VisionInput(BaseModel):
    """Vision 识别结果（由 Next.js 传入）"""
    product: str
    category: str
    markets: list[str]
    description: Optional[str] = ""
    key_params: Optional[dict] = {}


class RetrieveRequest(BaseModel):
    """检索请求"""
    query: str
    product: str
    category: str
    markets: list[str]
    vision_result: Optional[VisionInput] = None
    top_k: int = 10


class RetrieveResponse(BaseModel):
    """检索响应"""
    chunks: list[dict]          # Top-K Parent Chunk
    must_check_injected: list[str]
    total_candidates: int
    retrieval_time_ms: float


class BuildCorpusRequest(BaseModel):
    """语料库构建请求"""
    file_path: str             # 绝对路径
    jurisdiction: str          # EU | US | CN | GCC


class BuildCorpusResponse(BaseModel):
    """语料库构建响应"""
    file_path: str
    chunks_created: int
    child_chunks: int
    parent_chunks: int
    status: str


class ReportRequest(BaseModel):
    """报告生成请求"""
    query: str
    product: str
    category: str
    markets: list[str]
    vision_result: VisionInput


class ReportResponse(BaseModel):
    """报告生成响应"""
    status: str                # PASS | WARN | REJECTED
    report: Optional[str]      # Markdown 报告文本
    warning: Optional[str]     # WARN 时警告信息
    reason: Optional[str]      # REJECTED 时拒绝原因
    verification_result: dict   # 引用验证详情


# ── 接口实现 ──────────────────────────────────────────────────────

@app.post("/retrieve", response_model=RetrieveResponse)
async def retrieve(request: RetrieveRequest):
    """
    检索接口：接收 Query，返回 Top-K Parent Chunk。

    流程：Query Rewrite → Dense + BM25 + RRF → must_check → Rerank → Parent-Child 组装
          （全部逻辑委托给 hybrid_retriever，已内置修复）
    """
    import time
    start = time.time()

    market = request.markets[0] if request.markets else "EU"
    result = hybrid_retriever.retrieve(
        query=request.query,
        product_category=request.category,
        market=market,
        top_k=request.top_k,
    )

    elapsed = (time.time() - start) * 1000
    return RetrieveResponse(
        chunks=result["chunks"],
        must_check_injected=result["must_check_injected"],
        total_candidates=result["total_candidates"],
        retrieval_time_ms=round(elapsed, 1),
    )


@app.post("/build-corpus", response_model=BuildCorpusResponse)
async def build_corpus(request: BuildCorpusRequest):
    """
    语料库构建接口（管理员调用，一次性）。

    输入：文件路径 → 解析 → 分块 → 向量化 → 入 Qdrant
    """
    from rag_service.parser import get_parser

    parser = get_parser(request.file_path)
    text, metadata = parser.parse(request.file_path)

    chunker = LegalChunker()
    result = chunker.chunk_document(text, {
        **metadata,
        "jurisdiction": request.jurisdiction,
    })

    # 批量向量化 + 入库（使用 lifespan 初始化的全局单例）
    child_chunks = result["child_chunks"]
    parent_chunks = result["parent_chunks"]

    # 直接复用 lifespan 中初始化的 dense_retriever
    vectors = dense_retriever.embed_chunks([
        (c.prepend_text + " " + c.content)[:2000]
        for c in child_chunks
    ])

    from qdrant_client.http import models
    from scripts.ingest_to_qdrant import chunk_id_to_uuid

    points = [
        models.PointStruct(
            id=chunk_id_to_uuid(c.chunk_id),
            vector={"dense": vectors[i]},
            payload={
                "chunk_id": c.chunk_id,
                "content": c.content,
                "prepend_text": c.prepend_text,
                "doc_name": c.doc_name,
                "article_no": c.article_no,
                "parent_id": c.parent_id,
                "page_start": c.page_start,
                "page_end": c.page_end,
                "jurisdiction": c.jurisdiction,
            },
        )
        for i, c in enumerate(child_chunks)
    ]
    qdrant_client.upsert(collection_name="legal_chunks", points=points)

    return BuildCorpusResponse(
        file_path=request.file_path,
        chunks_created=len(child_chunks) + len(parent_chunks),
        child_chunks=len(child_chunks),
        parent_chunks=len(parent_chunks),
        status="success",
    )


@app.post("/generate-report", response_model=ReportResponse)
async def generate_report(request: ReportRequest):
    """
    报告生成接口（含 Citation 硬门）。

    流程：检索 → 生成 → 引用验证 → 硬门决策
    """
    # Step 1: 检索
    retrieve_req = RetrieveRequest(
        query=request.query,
        product=request.product,
        category=request.category,
        markets=request.markets,
        vision_result=request.vision_result,
    )
    retrieve_resp = await retrieve(retrieve_req)

    # Step 2: 生成
    generator = ComplianceReportGenerator()
    report_text = generator.generate(
        product=request.product,
        category=request.category,
        markets=request.markets,
        vision_result=request.vision_result.model_dump(),
        retrieved_chunks=retrieve_resp.chunks,
    )

    # Step 3: 硬门验证
    verifier = CitationVerifier()
    verify_result = verifier.verify_report(report_text, retrieve_resp.chunks)

    # Step 4: 硬门决策
    if verify_result.gate_status == "FAIL":
        return ReportResponse(
            status="REJECTED",
            report=None,
            reason=(
                f"0/{verify_result.total_citations} 条引用在原文验证。"
                "检索不足，无法生成有依据的合规报告。"
            ),
            verification_result={
                "gate_status": "FAIL",
                "verified_count": 0,
                "unverified_count": verify_result.total_citations,
            },
        )

    if verify_result.gate_status == "WARN":
        return ReportResponse(
            status="WARN",
            report=report_text,
            warning=(
                f"仅 {verify_result.verified_count}/{verify_result.total_citations} "
                "条引用已验证。部分结论可能缺少依据，请核实。"
            ),
            verification_result={
                "gate_status": "WARN",
                "verified_count": verify_result.verified_count,
                "unverified_count": verify_result.unverified_count,
                "verified_citations": [
                    c.citation_text for c in verify_result.verified_citations
                ],
                "unverified_citations": [
                    c.citation_text for c in verify_result.unverified_citations
                ],
            },
        )

    return ReportResponse(
        status="PASS",
        report=report_text,
        verification_result={
            "gate_status": "PASS",
            "verified_count": verify_result.verified_count,
            "confidence": verify_result.confidence,
        },
    )


@app.get("/health")
async def health():
    """健康检查接口"""
    return {"status": "ok", "version": "2.0.0"}


@app.get("/collections")
async def list_collections():
    """列出 Qdrant collections"""
    collections = client.get_collections()
    return {"collections": [c.name for c in collections.collections]}
```

---

## 11. 数据模型

> 本节仅列出核心 Pydantic Schema 概要，详细字段定义在 `rag-service/models/schemas.py` 中实现。

### 11.1 核心 Schema

```python
# rag-service/models/schemas.py

from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


class Jurisdiction(str, Enum):
    EU = "EU"
    US = "US"
    CN = "CN"
    GCC = "GCC"
    INT = "INT"     # 国际组织


class ChunkType(str, Enum):
    CHILD = "child"
    PARENT = "parent"
    TABLE = "table"


# ── 检索层 ──────────────────────────────────────────────────────

class ChunkMetadata(BaseModel):
    """Chunk 元数据（存入 Qdrant payload）"""
    chunk_id: str
    chunk_type: ChunkType
    parent_id: Optional[str] = None     # Child → Parent 映射
    doc_name: str
    article_no: str
    section_title: Optional[str] = None
    page_start: int = 0
    page_end: int = 0
    jurisdiction: Jurisdiction
    token_count: int = 0
    must_check: bool = False            # 是否由 must_check 强制注入
    must_check_reason: Optional[str] = None


class LegalChunk(BaseModel):
    """完整法律条款块（含内容）"""
    chunk_id: str
    chunk_type: ChunkType
    content: str                       # 原始文本
    prepend_text: str                  # contextual prepend（不含在 content 中）
    metadata: ChunkMetadata


class RetrievalResult(BaseModel):
    """单次检索结果"""
    id: str
    score: float                       # RRF score 或 rerank score
    content: str
    prepend_text: str
    doc_name: str
    article_no: str
    page_start: int
    page_end: int
    must_check: bool = False


class RetrievalResponse(BaseModel):
    """检索接口响应"""
    chunks: list[RetrievalResult]
    must_check_injected: list[str]
    total_candidates: int
    retrieval_time_ms: float


# ── 引用验证层 ────────────────────────────────────────────────

class CitationCheckResult(BaseModel):
    """单条引用检查结果"""
    citation_text: str
    article_no: Optional[str]
    found_in_chunks: list[str]
    verified: bool
    verification_method: str            # exact | fuzzy | partial | none


class VerificationResult(BaseModel):
    """引用验证结果（硬门决策）"""
    total_citations: int
    verified_count: int
    unverified_count: int
    confidence: float
    gate_status: str                    # PASS | WARN | FAIL
    gate_passed: bool
    report_allowed: bool
    verified_citations: list[CitationCheckResult]
    unverified_citations: list[CitationCheckResult]


# ── 报告层 ────────────────────────────────────────────────────

class ComplianceReport(BaseModel):
    """合规报告"""
    product: str
    markets: list[str]
    category: str
    report_text: str                   # Markdown 格式
    generated_at: str                   # ISO 8601 时间戳
    verification: VerificationResult
    retrieval_stats: dict               # 检索统计（元数据）


class ReportResponse(BaseModel):
    """报告生成接口响应"""
    status: str                        # PASS | WARN | REJECTED
    report: Optional[str]
    warning: Optional[str]
    reason: Optional[str]
    verification_result: dict


# ── 语料库构建 ────────────────────────────────────────────────

class CorpusBuildRequest(BaseModel):
    """语料库构建请求"""
    file_path: str
    jurisdiction: Jurisdiction
    force_rebuild: bool = False         # 强制重建（覆盖已有）


class CorpusBuildResponse(BaseModel):
    """语料库构建响应"""
    file_path: str
    chunks_created: int
    child_chunks: int
    parent_chunks: int
    table_chunks: int
    status: str                         # success | failed | skipped
    error: Optional[str] = None
```

### 11.2 Qdrant Collection 配置

```python
# rag-service/models/qdrant_schemas.py

from qdrant_client.http import models

CHILD_COLLECTION = "legal_chunks"
PARENT_COLLECTION = "legal_chunks_parents"

VECTOR_CONFIG = models.VectorParams(
    size=1024,           # Cohere embed-multilingual-v3 向量维度
    distance=models.Distance.COSINE,
)

CHILD_COLLECTION_CONFIG = models.CollectionDescription(
    name=CHILD_COLLECTION,
    vectors_config={
        "dense": VECTOR_CONFIG,        # 命名的向量字段
    },
)

# 索引配置（加速过滤查询）
CHILD_INDEX_CONFIG = models.IndexParams(
    index_name="dense",
    payload_schema={
        "doc_name": models.PayloadSchemaType.KEYWORD,
        "jurisdiction": models.PayloadSchemaType.KEYWORD,
        "article_no": models.PayloadSchemaType.KEYWORD,
        "parent_id": models.PayloadSchemaType.KEYWORD,
    },
)
```

---

## 12. 技术栈总表

| 层级 | 组件 | 选型 | 规格/说明 |
|------|------|------|---------|
| **文档解析** | 多格式解析 | **Docling**（IBM, 58.7k stars） | PDF/DOCX/HTML/PPT/Excel，表格+公式+OCR，无外部依赖 |
| **文档解析备选** | PDF 精确解析 | **pdfplumber**（已有） | EU 18 个 PDF 实测 100% 成功，保留页码信息 |
| **接入层** | HTTP 网关 | **FastAPI** | Python ASGI，高并发，自动化 OpenAPI 文档 |
| **前端转发** | Next.js | 现有 | `app/api/scan/route.ts` 转发至 rag-service |
| **向量存储** | 向量数据库 | **Infinity**（infiniflow, 4.5k stars） | dense + sparse + tensor 混合检索，内置 rerank，REST API |
| **向量存储备选** | 向量数据库 | **Qdrant**（Docker） | cosine similarity，命名向量字段（保留） |
| **嵌入模型** | 多语言 Embedding | **BGE-M3**（FlagEmbedding, 11.6k stars） | dense + sparse + ColBERT 多向量，EU 24语言原生支持，MIT |
| **Reranker** | Cross-Encoder | **BGE-Reranker-v2-m3**（FlagEmbedding） | MTEB Rerank SOTA，MIT，免费自托管 |
| **LLM** | 报告生成 | **Claude Sonnet 4**（Sonnet 4.6） | 已有 SDK，中文质量最优 |
| **稀疏检索** | BM25 | **jieba + rank_bm25** | 中文精确术语召回，英文词项保护 |
| **融合算法** | 多路召回 | **RRF（k=25）** | 无监督，平衡 dense 和 BM25 |
| **引用验证** | 硬门 | **自建 CitationVerifier** | 规则正则 + 硬门判断（≥3 ✅ / 1-2 ⚠️ / 0 ❌）|
| **表格处理** | 表格存储 | **双重字段**（description + raw_table） | description 入检索，raw_table 用于展示 |
| **分块策略** | Chunking | **自建 LegalChunker** | 按 Article/Section 边界，Parent-Child 双层，法规条款不跨 chunk |
| **依赖管理** | 包管理 | **pip / requirements.txt** | docling, FlagEmbedding, cohere, qdrant-client, rank_bm25, jieba, anthropic |
| **API 协议** | 接口协议 | **REST / JSON** | FastAPI 自动生成，HTTP 1.1 |

> **技术选型说明（2026-04-29 GitHub 研究更新）：**
> - **Docling 替换手动解析**：IBM 58.7k stars，PDF/DOCX/HTML/表格/公式/OCR 全覆盖，比 pdfplumber + python-docx + BeautifulSoup 组合更可靠
> - **BGE-M3 替换 Cohere embed**：MIT 免费自托管，支持 dense + sparse + ColBERT 多向量，EU 24语言原生支持，MTEB 63.8 legal recall，无需 API 费用
> - **BGE-Reranker 替换 Cohere rerank**：MIT 免费，MTEB Rerank SOTA，节省 $0.05/1K 的 API 费用
> - **Infinity 替换 Qdrant**（备选）：dense + sparse + tensor 混合检索一体，REST API，RAGFlow 同源生态好；保留 Qdrant 作为备选方案

**v1.4 → v2.1 关键变更对照：**

| 决策项 | v1.4 | v2.0→v2.1 | 变更原因 |
|--------|------|---------|---------|
| Embedding | BGE-M3 本地 | **BGE-M3 自托管**（免费） | 多语言 + 多向量 + 免费 |
| 向量存储 | nano_vectordb | **Infinity / Qdrant** | 混合检索 + 量产支持 |
| Reranker | BGE-reranker 本地 | **BGE-Reranker 自托管**（免费） | MTEB SOTA + 免费 |
| 文档解析 | 手动 pdfplumber/docx | **Docling**（IBM） | 表格+公式+OCR 一体化 |
| Embedding API | Cohere（$0.10/1M） | **BGE-M3（免费）** | 4.1M 字符零成本 |
| Rerank API | Cohere（$0.05/1K） | **BGE-Reranker（免费）** | 节省 API 费用 |
| BM25 | rank_bm25（LlamaIndex 内置）| jieba + rank_bm25（显式）| 中文分词精度 |
| 编排层 | LlamaIndex | 自建 FastAPI | 简化依赖链 |
| Contextual Prepend | 无 | 有 | 提升 embedding 精度 |

---

## 13. 风险与对策

| 风险 | 概率 | 影响 | 对策 |
|------|------|------|------|
| Cohere API 延迟高/不可用 | 低 | 高 | 降级策略：仅 BM25 召回；显示"检索服务临时降级" |
| Qdrant Docker 被禁止 | 中 | 高 | Phase 0 验证 IT 政策；备选：Qdrant Cloud（托管）|
| HTML 质量差导致召回率低 | 高 | 中 | 分类处理，JS 渲染用 Playwright；质量极差者暂跳过 |
| LLM 编造条款编号 | 中 | 高 | ✅ 已解决：CitationVerifier 硬门（≥3 ✅ / 0 ❌拒绝）|
| 法规版本过期 | 低 | 中 | index.json 带版本号和日期；upsert 机制支持增量更新 |
| 表格信息丢失 | 中 | 中 | ✅ 已解决：双重字段策略（description 入检索，raw_table 展示）|
| jieba 分词错误切分法律术语 | 中 | 中 | 自定义词典注册（见 BM25 Retriever `_load_legal_dict`）|
| BM25 和 Dense 召回重叠率高 | 中 | 低 | RRF 融合已处理；重叠率高时 BM25 贡献降低但不影响结果 |
| API 费用超预算 | 低 | 中 | Cohere pricing cap 设置；监控 embedding/rerank 调用量 |
| 多语言 Chunk 质量（中英混合 PDF）| 中 | 中 | LegalChunker 增加双语感知：英文 Article 标题 + 中文正文 → 同 parent |
| Qdrant 规模超限 | 低 | 低 | 当前规模（~20k Child Chunks）完全在 Qdrant 免费层内 |
| Citation Verifier 漏放（假阳性）| 低 | 高 | 规则层 + LLM-as-Judge（Phase 3 后视质量启用）双层保障 |
| 前端未接入 rag-service | 中 | 中 | Phase 4 专项任务；提前在 Phase 3 末做 Mock 联调 |

---

## 14. 版本历史

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| 1.0 | 2026-04-28 | 初版方案 |
| 1.1 | 2026-04-28 | 整合专家评审：统一 Python FastAPI、Parent-Child 分块、HTML 分类处理、表格描述化、结构化 Query 分解、引用验证层 |
| 1.2 | 2026-04-28 | LightRAG 调研整合：以 nano_vectordb 替代 Qdrant（零外部依赖），移除 Docker 要求；自建 LegalChunker/HybridRetrieval/CitationVerifier |
| 1.3 | 2026-04-28 | 企业 RAG + 法律 RAG 全网调研：增加 LlamaIndex 编排层，voyage → BGE-M3（本地推理零费用），增加 Hallucination Grader（LangChain grading 模式），更新 Phase 0-5 实施计划，更新风险清单 |
| 1.4 | 2026-04-29 | 架构决策：否决 Agentic RAG（延迟高、复杂、不适合本场景），采用 Static RAG + CitationVerifier 硬门；增加 Query Rewrite 规则（50行替代 Agent）；预估延迟 5-10s |
| **2.0** | **2026-04-29** | **全面升级至 API Embedding 路线**：BGE-M3 本地 → Cohere embed-multilingual-v3（API）；nano_vectordb → Qdrant；BGE-reranker → Cohere rerank API；增加 jieba BM25 显式调用；增加 contextual prepend 前置嵌入；更新分块策略（200-300 / 800-1000 tokens）；更新实施阶段；新增 API 合约；更新风险清单 |

---

*文档终*
