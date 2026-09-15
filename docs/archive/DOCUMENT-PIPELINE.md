# Document Processing Pipeline - Design Document

> ⚠️ **SUPERSEDED — 历史设计 spec**。本文档描述的"前端 docparser 模块 + `lib/pipeline/scan.ts` 集成 Reporter"流程未落地，相关代码（`lib/pipeline/scan.ts` + `components/upload/UploadForm.tsx`）已于 2026-09-10 删除。当前权威实现在后端 `rag_service/parser/docx_parser.py` + `rag_service/parser/html_parser.py`，由 FastAPI 在扫描时直接调用；前端不再计划独立的 docparser 模块。

> 文档版本：1.1
> 创建时间：2026-04-28
> 更新时间：2026-05-07
> 状态：部分实现（Python 侧已集成，前端 docparser 模块待实现）

## 1. Overview

**Goal**: Allow users to upload product images AND regulatory documents (PDF/HTML/DOCX), then receive a structured compliance report that combines visual analysis of products with authoritative regulatory text.

**Current state**: The existing pipeline (`lib/pipeline/scan.ts`) processes product images through Vision AI and matches against a static mock regulation set. Regulatory documents are not yet supported.

**New capability**: The Document Pipeline extracts text/tables from uploaded regulatory files, stores them as structured JSON, and injects that content as context into the LLM — without requiring a vector database.

---

## 0.1 当前状态

| 模块 | 状态 | 说明 |
|------|------|------|
| PDF 解析（pdfplumber） | ✅ 已实现 | `rag_service/parser/` 集成 pdfplumber |
| DOCX 解析（python-docx） | ✅ 已实现 | `rag_service/parser/` 集成 python-docx |
| HTML 解析 | ✅ 已实现 | `rag_service/parser/` 集成 BeautifulSoup |
| 前端 docparser 模块 | ❌ 待实现 | `lib/docparser/` 下 TypeScript 模块尚未创建 |
| `POST /api/documents` | ❌ 待实现 | `app/api/documents/route.ts` 尚未创建 |
| `lib/docparser/context.ts` | ❌ 待实现 | LLM markdown 上下文组装器 |
| `lib/docparser/doc-store.ts` | ❌ 待实现 | 服务端 doc JSON 存储（TTL 1h） |
| `lib/pipeline/reporter.ts` | ❌ 待实现 | Vision + regulatory doc LLM 报告生成器 |
| `lib/pipeline/scan.ts` 集成 | ⚠️ 需修改 | 接受 `docSessionId` 并调用 Reporter |

**Python 侧已集成文件（`rag_service/parser/`）：**
- `pdfplumber` — PDF 文本 + 表格提取
- `mammoth` — DOCX 解析
- `BeautifulSoup4` — HTML 解析
- `python-docx` — DOCX 段落和表格提取

**前端待实现文件（`lib/docparser/`）：**
- `parser.ts` — 统一入口，按 MIME 类型路由
- `pdf-parser.ts` — PDF 解析（可调用 Python 后端或纯 TS 实现）
- `html-parser.ts` — HTML 清理与结构化
- `docx-parser.ts` — DOCX 解析
- `merger.ts` — 多文档合并
- `context.ts` — LLM markdown 组装
- `doc-store.ts` — 服务端 doc 存储（TTL 1h）
- `keywords.ts` — 市场/法规关键词检测
- `index.ts` — 公共 API 导出

---

## 0.2 与现有 scan.ts 的集成说明

当前 `lib/pipeline/scan.ts` 的调用链路：

```
POST /api/scan
    │
    ▼
lib/pipeline/scan.ts
    │
    ├─ Vision 分析（mimoTalk 多模态）
    │
    ├─ POST http://localhost:8001/scan  （调用 RAG 服务）
    │         │
    │         ▼
    │   LangGraph 8 节点管线
    │         │
    └─◄── 返回 ScanResponse
              │
              ▼
         返回前端结果
```

**集成 docparser 后的链路：**

```
POST /api/documents（上传文件）
    │
    ▼
lib/docparser/parser.ts → Python 解析（pdfplumber/mammoth/BS4）
    │
    ▼
doc-store.ts（存储 parsed JSON，TTL 1h，返回 docSessionId）
    │
    ▼
POST /api/scan（带上 docSessionId）
    │
    ▼
lib/pipeline/scan.ts
    │
    ├─ Vision 分析（不变）
    ├─ docSessionId → doc-store 获取 RegulatoryDocSet
    ├─ context.ts 组装 markdown 上下文
    ├─ reporter.ts 生成报告（Vision + regulatory doc context）
    └─ 返回结果
```

关键变更点：
- `scan.ts` 新增参数 `docSessionId?: string`
- 新增 `lib/docparser/context.ts` → 将 `RegulatoryDocSet` 组装为 markdown
- 新增 `lib/pipeline/reporter.ts` → 接收 `VisionOutput + regulatoryContext` 调用 LLM
- RAG 管线不变，复用现有 FAISS + BM25 检索（regulatory doc 作为补充上下文）

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          User Flow                                      │
│                                                                         │
│  [Upload Page]  ───  images + documents  ───►  [API: POST /api/scan]   │
│                                                          │             │
│                                                          ▼             │
│  ┌─────────────────────────────────────────────────────┐ │             │
│  │              Document Pipeline (Phase 1)            │ │             │
│  │                                                      │ │             │
│  │  [DOC]  ──►  PDF Parser  ──┐                        │ │             │
│  │  [HTM]  ──►  HTML Parser  ──┼──►  Merger  ──►  doc.json  │             │
│  │  [DOCX] ──►  DOCX Parser  ──┘                        │ │             │
│  │                                                      │ │             │
│  └─────────────────────────────────────────────────────┘ │             │
│                                                          │             │
│                                                          ▼             │
│  ┌─────────────────────────────────────────────────────┐ │             │
│  │            Scan Pipeline (Phase 2, existing)         │ │             │
│  │                                                      │ │             │
│  │  [images]  ──►  Vision AI  ──┐                       │ │             │
│  │                               ├──►  Reporter  ──►  ScanResult  │      │
│  │  [doc.json]  ──►  Context   ─┘                       │             │
│  └─────────────────────────────────────────────────────┘              │
│                              │                                          │
│                              ▼                                          │
│                    [GET /api/scan/:id]  ──►  [Result Page]             │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Module Breakdown

### 3.1 Document Upload API (`app/api/documents/route.ts`)

**Responsibility**: Accept PDF/HTML/DOCX files, validate type/size, delegate parsing.

**Accepts**: `multipart/form-data` with up to 10 files, max 20MB each.
**Outputs**: A `docSessionId` referencing a server-side JSON blob.
**Stores**: Parsed JSON in `globalThis.__docStore` (TTL: 1 hour, same as scan sessions).

### 3.2 Document Parser (`lib/docparser/parser.ts` / Python equivalent)

**Responsibility**: Extract text and structured tables from PDF, HTML, DOCX.

Each parser implements:
```
parse(fileBuffer: Buffer, mimeType: string) => Promise<ParseResult>

interface ParseResult {
  fileName: string;
  pages: Array<{
    pageNumber?: number;
    heading?: string;   // detected section title
    text: string;
    tables: Array<Array<Array<string>>>;  // 2D grid
  }>;
  metadata: {
    title?: string;
    author?: string;
    pageCount?: number;
    source: string;
  };
  rawText: string;  // full concatenated text for keyword search
}
```

Parser priority (fallback chain):
1. **PDF**: `pdfminer.six` for text extraction → `pymupdf` as fallback → OCR via `pytesseract` (last resort for scanned PDFs)
2. **DOCX**: `python-docx` reads paragraph + table structure directly
3. **HTML**: `BeautifulSoup` with fallback to regex stripping for malformed HTML

### 3.3 Document Merger (`lib/docparser/merger.ts`)

**Responsibility**: Combine multiple `ParseResult` objects into a single `RegulatoryDocSet`.

```
interface RegulatoryDocSet {
  docSessionId: string;
  documents: Array<{
    fileName: string;
    sourceType: "pdf" | "docx" | "html";
    parsedAt: string;
    sections: Array<{
      heading: string;
      level: number;     // h1=1, h2=2, etc.
      content: string;
      tables: Array<...>;
      relevantKeywords: string[];  // extracted for quick filtering
    }>;
  }>;
  summary: {
    totalSections: number;
    totalTables: number;
    detectedMarkets: ("EU" | "US" | "UK")[];
    detectedProducts: string[];
  };
}
```

The merger deduplicates sections with identical headings, tags market/language hints, and generates `relevantKeywords` by scanning for terms like "CE", "FCC", "RoHS", "REACH", "UKCA", "voltage", "frequency", etc.

### 3.4 Context Assembler (`lib/docparser/context.ts`)

**Responsibility**: Convert `RegulatoryDocSet` into a compact string suitable for LLM context injection.

Given LLM context windows (128K–200K tokens), a 20-page regulatory PDF typically yields <50K tokens of extracted text. Strategy:
- **Full mode**: Inject all sections with tables as markdown
- **Filtered mode** (for very large docs): Inject only sections matching detected product keywords
- Output format: Markdown with clear section headers, table in `|` format, source file attribution

### 3.5 Reporter Module (`lib/pipeline/reporter.ts`) — NEW

**Responsibility**: Take Vision AI output + RegulatoryDocSet context, call LLM to generate final report.

```
interface ReporterInput {
  visionResult: VisionOutput;
  regulatoryContext: string;  // markdown string from Context Assembler
  category: ProductCategory;
  markets: Market[];
}
```

The LLM prompt instructs it to cross-reference detected risk points against regulatory text, flag violations by article/section number, and derive checklist items from actual requirements rather than hardcoded rules.

### 3.6 Existing Modules (updated)

| Module | Change |
|--------|--------|
| `lib/pipeline/scan.ts` | Integrate `ReporterInput`, call Reporter instead of stub |
| `lib/types.ts` | Add `RegulatoryDocSet`, `DocSession`, `ParseResult` types |
| `lib/schemas.ts` | Add Zod schemas for document-related input/output |
| `app/api/scan/route.ts` | Support optional `docSessionId` in form data |
| `app/api/documents/route.ts` | NEW: document upload endpoint |

---

## 4. Data Flow Diagram

```
User Upload
     │
     ├── Product Images ──────────────────────────────────┐
     │                                                      │
     └── Regulatory Docs ──► [Upload API]                  │
                                   │                        │
                                   ▼                        │
                           [Document Parser]                │
                            PDF │ HTML │ DOCX              │
                                   │                        │
                                   ▼                        │
                          [Document Merger]                │
                                   │                        │
                                   ▼                        │
                          [docStore] ───── [DocSessionId] ──┤
                                                       │   │
                                                       ▼   ▼
                                              [Scan Pipeline]
                                                       │
                                  ┌────────────────────┴───┐
                                  ▼                        ▼
                           [Vision AI]           [Context Assembler]
                                  │                        │
                                  ▼                        ▼
                               Vision                  regulatory
                               Output                   markdown
                                  │                        │
                                  └──────────┬─────────────┘
                                             ▼
                                      [Reporter LLM]
                                             │
                                             ▼
                                      ScanResult JSON
                                             │
                                             ▼
                                    [GET /api/scan/:id]
                                             │
                                             ▼
                                    [Result Page Render]
```

---

## 5. Technology Choices

### Document Parsing

| Format | Primary Library | Fallback | Rationale |
|--------|----------------|----------|-----------|
| PDF (text-based) | `pdfminer.six` | `pymupdf` (PyMuPDF) | No binary blob, extracts text + position |
| PDF (scanned/image) | `pytesseract` via `pillow` | — | Last resort; requires Tesseract OCR binary |
| DOCX | `python-docx` | — | Direct XML traversal, no external binary |
| HTML | `beautifulsoup4` | `lxml` parser | Robust tag navigation; lxml for speed |

All libraries are pip-installable and have no C++ compiler dependency on Windows.

### Structured Output

JSON emitted by the parser is versioned (`"version": "1.0"`) and includes a schemaUri field for future schema registry compatibility.

### LLM Integration (Reporter)

Uses the **existing** `@anthropic-ai/sdk` / `@google/generative-ai` / `openai` packages already in `package.json`. No new AI dependencies required.

---

## 6. File Structure

```
attrax/
├── scripts/                          # Standalone Python tools
│   └── parse_regulation.py           # Document parsing demo (this task)
│
├── app/api/
│   ├── documents/
│   │   └── route.ts                  # NEW: POST /api/documents  (upload docs)
│   │   └── [docSessionId]/
│   │       └── route.ts              # NEW: GET /api/documents/:docSessionId
│   └── scan/
│       └── route.ts                  # MODIFIED: accept docSessionId param
│
├── lib/
│   ├── docparser/                    # NEW: document processing module
│   │   ├── parser.ts                 # Entry point; routes to format-specific parsers
│   │   ├── pdf-parser.ts             # PDF text/table extraction
│   │   ├── html-parser.ts            # HTML parsing + cleanup
│   │   ├── docx-parser.ts            # DOCX parsing + table extraction
│   │   ├── merger.ts                 # Combines multiple parse results
│   │   ├── context.ts                # Assembles LLM-ready markdown context
│   │   ├── doc-store.ts              # Server-side doc JSON storage (TTL 1h)
│   │   ├── keywords.ts               # Market/regulation keyword detection
│   │   └── index.ts                  # Public API surface
│   │
│   ├── pipeline/
│   │   ├── scan.ts                   # MODIFIED: accept docSessionId, call Reporter
│   │   └── reporter.ts               # NEW: LLM report generation from vision + doc
│   │
│   ├── types.ts                      # MODIFIED: add Document types
│   └── schemas.ts                    # MODIFIED: add Document Zod schemas
│
└── docs/
    └── DOCUMENT-PIPELINE.md          # This document
```

---

## 7. API Contract Changes

### NEW: POST /api/documents

**Purpose**: Upload regulatory documents and get a `docSessionId` for later scan.

**Request**: `multipart/form-data`
```
files: File[] (up to 10, max 20MB each)
```

**Response 200**:
```json
{
  "docSessionId": "doc_01JXXXXX",
  "fileCount": 3,
  "files": [
    { "name": "CE-General-Requirements.pdf", "type": "pdf", "pages": 12 },
    { "name": "FCC-47-CFR-15.pdf", "type": "pdf", "pages": 8 },
    { "name": "UKCA-Guidance.html", "type": "html", "pages": 1 }
  ],
  "summary": {
    "totalSections": 45,
    "totalTables": 7,
    "detectedMarkets": ["EU", "US", "UK"],
    "detectedProducts": ["electronics", "battery-powered"]
  }
}
```

**Error 400**:
```json
{
  "error": {
    "code": "UNSUPPORTED_FORMAT",
    "message": "Only PDF, HTML, DOCX files are supported."
  }
}
```

### MODIFIED: POST /api/scan (existing)

Add optional field to `multipart/form-data`:
```
docSessionId?: string   # Reference to uploaded regulatory documents
```

When `docSessionId` is provided, the scan pipeline fetches the parsed doc JSON from `docStore` and injects it into the Reporter as context. Without it, falls back to the existing Vision AI only pipeline.

### NEW: GET /api/documents/[docSessionId]

**Purpose**: Retrieve parsed document content (for preview/debug).

**Response 200**: Full `RegulatoryDocSet` JSON (same structure as internal docStore).

**Error 404**: Session not found or expired.

---

## 8. New TypeScript Types (additions to `lib/types.ts`)

```typescript
// Document parsing
export type DocSourceType = "pdf" | "html" | "docx";

export interface DocPage {
  pageNumber?: number;
  heading?: string;
  text: string;
  tables: string[][][];
}

export interface ParseResult {
  fileName: string;
  sourceType: DocSourceType;
  pages: DocPage[];
  metadata: {
    title?: string;
    author?: string;
    pageCount?: number;
    source: string;
  };
  rawText: string;
}

// Document storage
export interface DocSession {
  docSessionId: string;
  files: Array<{
    name: string;
    type: DocSourceType;
    pages: number;
  }>;
  summary: {
    totalSections: number;
    totalTables: number;
    detectedMarkets: Market[];
    detectedProducts: string[];
  };
  parsedAt: string;
}

// Internal pipeline types
export interface RegulatoryDocSet {
  docSessionId: string;
  documents: Array<{
    fileName: string;
    sourceType: DocSourceType;
    parsedAt: string;
    sections: DocSection[];
  }>;
  summary: {
    totalSections: number;
    totalTables: number;
    detectedMarkets: Market[];
    detectedProducts: string[];
  };
}

export interface DocSection {
  heading: string;
  level: number;
  content: string;
  tables: string[][][];
  relevantKeywords: string[];
}

// Reporter input
export interface ReporterInput {
  visionResult: VisionOutput;
  regulatoryContext: string;  // markdown
  category: ProductCategory;
  markets: Market[];
}
```

---

## 9. Priority Ordering

### Phase 1 — Core Parsing (1-2 days)
1. Implement `scripts/parse_regulation.py` — standalone demo, validates approach
2. Implement `lib/docparser/parser.ts` — unified interface, routes by mime type
3. Implement `lib/docparser/pdf-parser.ts`, `html-parser.ts`, `docx-parser.ts`
4. Implement `lib/docparser/merger.ts` + `doc-store.ts`
5. Implement `app/api/documents/route.ts` — upload endpoint

**Verification**: Upload a real PDF/DOCX, check JSON output is correct.

### Phase 2 — Integration (1-2 days)
6. Add types to `lib/types.ts` and schemas to `lib/schemas.ts`
7. Implement `lib/docparser/context.ts` — markdown assembler
8. Implement `lib/pipeline/reporter.ts` — LLM report generation
9. Modify `lib/pipeline/scan.ts` to accept and forward `docSessionId`
10. Modify `app/api/scan/route.ts` to accept `docSessionId` param

**Verification**: Full end-to-end with real documents — scan result includes citations to uploaded doc sections.

### Phase 3 — Polish (0.5-1 day)
11. Add progress stages for document parsing in scan status
12. Implement `GET /api/documents/[docSessionId]` for preview
13. Error handling: corrupted files, oversized uploads, parse failures
14. Update `docs/PRD.md` with new feature

---

## 10. Constraints & Non-Goals

**In Scope:**
- PDF, HTML, DOCX parsing with text + table extraction
- Structured JSON output for LLM context injection
- Integration with existing scan pipeline
- Server-side storage with TTL

**Out of Scope (NOT planned):**
- Vector database / embedding-based retrieval
- Persistent database integration
- Real-time collaborative document editing
- OCR preprocessing pipeline (Phase 3 at earliest)
- DOC / ODT / RTF support (v2)

**Key Assumptions:**
- Regulatory documents are primarily text-based (not scanned image PDFs)
- Context window of target LLM (>128K tokens) can accommodate full parsed text
- Server has sufficient memory for concurrent document parsing (max ~10 files × 20MB)

---

*Document version: 1.1*
*Created: 2026-04-28*
*Updated: 2026-05-07*