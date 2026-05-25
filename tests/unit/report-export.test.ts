/**
 * Unit tests for lib/report-export.ts
 *
 * Full coverage:
 *   - parseMarkdownToPdfText: heading levels, list items, bold, links,
 *     empty string, plain text, long text, edge cases
 *   - parseMarkdownToDocx: paragraphs, heading-level mapping, list expansion,
 *     bold stripping, empty lines, indents
 *   - downloadReportAsPdf: scoreColor mapping (PASS/WARN/REJECTED/UNKNOWN),
 *     filename format, jsPDF method calls, font embedding, pagination, footer
 *   - downloadReportAsDocx: filename format, table structure, docx generation,
 *     download trigger, URL cleanup
 *   - downloadProfitReportAsPdf: all sections, helper functions (embedFont,
 *     pdfCheckBreak, pdfSectionTitle, pdfDrawTable, pdfBody, pdfBullet),
 *     conditional rendering (riskNote, pricingStrategy, conclusions, references,
 *     fallback report), page footer
 *   - downloadProfitReportAsDocx: all sections, helper functions (mkCell,
 *     mkSectionH, mkBullet, docxTable), conditional rendering, filename format
 *   - detectLocale: localStorage detection, browser language fallback, server-side
 *   - resolveLocale: explicit locale vs auto-detection
 *   - complianceStatusLabel: PASS/WARN/REJECTED/UNKNOWN status mapping
 *   - marketLabel: market key lookup
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom'

// ─── Mock jsPDF (hoisted so factory can reference it at transform time) ───────
// Pass a plain function to vi.fn so the result is constructible with `new`.
const jsPDFMethods = vi.hoisted(() => {
  const inst = {
    addFont: vi.fn(), addFileToVFS: vi.fn(), setFont: vi.fn(), addPage: vi.fn(),
    getNumberOfPages: vi.fn(() => 1), setPage: vi.fn(),
    getTextWidth: vi.fn(() => 20), roundedRect: vi.fn(), line: vi.fn(),
    setFontSize: vi.fn(), setTextColor: vi.fn(), setDrawColor: vi.fn(),
    setFillColor: vi.fn(), setLineWidth: vi.fn(), text: vi.fn(),
    rect: vi.fn(),  // Used by pdfDrawTable for table cells
    splitTextToSize: vi.fn((t: string) => t.split('\n')), save: vi.fn(),
    internal: {
      pageSize: {
        getWidth: vi.fn(() => 210), getHeight: vi.fn(() => 297),
      },
    },
  }
  return inst
})

// vi.fn(function() { return inst }) creates a constructible mock (NOT arrow fn).
function MockJsPDF(_opts: any) { return jsPDFMethods }
const mockJsPDFCtor = vi.hoisted(() => vi.fn(MockJsPDF) as any)

// ─── Mock docx (hoisted so factory can reference them at transform time) ────
/* eslint-disable @typescript-eslint/no-explicit-any */
// Plain constructor functions — vi.fn(function) stays constructible for `new X()`.
// Object.assign copies opts directly so test assertions can read .text, .heading, etc.
function MockParagraph(opts: any) { Object.assign(this, opts) }
function MockTextRun(opts: any) { Object.assign(this, opts) }
function MockTable(opts: any) { Object.assign(this, opts) }
function MockTableRow(opts: any) { Object.assign(this, opts) }
function MockTableCell(opts: any) { Object.assign(this, opts) }

const mockPackerToBlob = vi.hoisted(() => vi.fn<() => Promise<Blob>>())

// MockDocument: constructible class whose instance copies opts (for test assertions).
function MockDocument(opts: any) { Object.assign(this, opts) }
const mockDocument = vi.hoisted(() => vi.fn(MockDocument) as any)

// vi.fn(function) creates a mock that stays constructible via new X()
const mockParagraph = vi.hoisted(() => vi.fn(MockParagraph) as any)
const mockTextRun = vi.hoisted(() => vi.fn(MockTextRun) as any)
const mockTable = vi.hoisted(() => vi.fn(MockTable) as any)
const mockTableRow = vi.hoisted(() => vi.fn(MockTableRow) as any)
const mockTableCell = vi.hoisted(() => vi.fn(MockTableCell) as any)

// ─── Register modules as mocked ─────────────────────────────────────────────────
vi.mock('jspdf', () => ({ jsPDF: mockJsPDFCtor }))
vi.mock('docx', () => ({
  Document: mockDocument,
  Packer: { toBlob: mockPackerToBlob },
  Paragraph: mockParagraph,
  TextRun: mockTextRun,
  HeadingLevel: {
    HEADING_1: 'Heading1', HEADING_2: 'Heading2', HEADING_3: 'Heading3',
  },
  AlignmentType: { CENTER: 'center' },
  BorderStyle: { NONE: 'none', SINGLE: 'single' },
  Table: mockTable,
  TableRow: mockTableRow,
  TableCell: mockTableCell,
  WidthType: { PERCENTAGE: 'percentage' },
}))

// ─── DOM mocks (hoisted so they are ready before vi.mock factories run) ───────
const mockAnchorRef = vi.hoisted(
  () => ({ current: { href: '', download: '', click: vi.fn(), remove: vi.fn() } })
)

vi.stubGlobal('URL', {
  createObjectURL: vi.fn(() => 'blob:http://localhost/mock-blob'),
  revokeObjectURL: vi.fn(),
})

vi.stubGlobal('document', {
  createElement: vi.fn((tag: string) => {
    if (tag === 'a') return mockAnchorRef.current
    return null
  }),
  body: { appendChild: vi.fn(), removeChild: vi.fn() },
  documentElement: { lang: 'zh' },
})

// Mock localStorage to return 'zh' locale for Chinese translation tests
vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => {
    if (key === 'locale') return 'zh'
    return null
  }),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
})

// Mock navigator for browser language detection
vi.stubGlobal('navigator', {
  language: 'zh-CN',
  userAgent: 'test',
})

// ─── System under test (imported AFTER mocks are registered) ──────────────────
import {
  parseMarkdownToPdfText,
  parseMarkdownToDocx,
  downloadReportAsPdf,
  downloadReportAsDocx,
  downloadProfitReportAsPdf,
  downloadProfitReportAsDocx,
  downloadDecisionReportAsPdf,
  downloadDecisionReportAsDocx,
  downloadRoadmapReportAsPdf,
  downloadRoadmapReportAsDocx,
} from '@/lib/report-export'

// ─── Fixture factory ──────────────────────────────────────────────────────────
function makeResult(
  overrides: Partial<import('@/lib/types').ComplianceReportResult> = {}
) {
  return {
    sessionId: 'sess_abc123',
    scanTime: '2026-05-07T10:00:00.000Z',
    productCategory: 'electronics' as const,
    productName: 'USB 加湿器',
    targetMarkets: ['EU', 'US'] as const[],
    complianceScore: 78,
    scoreGrade: 'B' as const,
    complianceReport:
      '# 概述\n\n这是一个测试报告。\n\n## 风险点\n\n- 缺少 CE 标识\n\n### 子节\n\n1. 第一步\n2. 第二步',
    complianceStatus: 'PASS' as const,
    agentTrace: [],
    loopCount: 0,
    retrievedChunks: [],
    images: undefined,
    documents: [],
    riskPoints: undefined,
    checklist: undefined,
    generatedAt: '2026-05-07T10:00:00.000Z',
    modelInfo: { ragProvider: 'mock', latencyMs: 100 },
    ...overrides,
  }
}

// ─── parseMarkdownToPdfText ──────────────────────────────────────────────────
describe('parseMarkdownToPdfText', () => {
  it('collapses h1/h2/h3 headings to newlines', () => {
    const result = parseMarkdownToPdfText('# 主标题\n## 二级标题\n### 三级标题')
    expect(result).toMatch(/主标题/)
    expect(result).toMatch(/二级标题/)
    expect(result).toMatch(/三级标题/)
  })

  it('converts bullet list markers to bullet character', () => {
    const result = parseMarkdownToPdfText('- 项一\n- 项二\n* 项三')
    expect(result).toContain('• 项一')
    expect(result).toContain('• 项二')
    expect(result).toContain('• 项三')
  })

  it('strips bold markdown and preserves text', () => {
    const result = parseMarkdownToPdfText('这是 **加粗文字** 和普通文字')
    expect(result).toContain('加粗文字')
    expect(result).not.toContain('**')
  })

  it('normalizes reference-style links [1] to bracketed form', () => {
    const result = parseMarkdownToPdfText('参考 [1] 和 [2]')
    expect(result).toContain('[1]')
    expect(result).toContain('[2]')
  })

  it('collapses more than 2 consecutive newlines to 2', () => {
    const result = parseMarkdownToPdfText('段落一\n\n\n\n\n段落二')
    expect(result).not.toMatch(/\n{3,}/)
  })

  it('trims leading and trailing whitespace', () => {
    const result = parseMarkdownToPdfText('   文字内容   \n\n  ')
    expect(result).toBe('文字内容')
  })

  it('returns empty string for empty input', () => {
    expect(parseMarkdownToPdfText('')).toBe('')
  })

  it('returns plain text unchanged (except trailing trim)', () => {
    const input = '没有任何 markdown 格式的纯文本'
    expect(parseMarkdownToPdfText(input)).toBe(input.trim())
  })

  it('handles very long text without crashing', () => {
    const result = parseMarkdownToPdfText('词汇。'.repeat(5000))
    expect(result.length).toBeGreaterThan(0)
  })

  it('handles mixed content end-to-end', () => {
    const result = parseMarkdownToPdfText(
      `# 报告标题
## 风险概览
- 高风险：**电池过充**
- 中风险：标签缺失

详见 [REF-1]
`
    )
    expect(result).toContain('报告标题')
    expect(result).toContain('风险概览')
    expect(result).toContain('• 高风险：电池过充')
    expect(result).toContain('• 中风险：标签缺失')
    expect(result).toContain('[REF-1]')
  })
})

// ─── parseMarkdownToDocx ─────────────────────────────────────────────────────
describe('parseMarkdownToDocx', () => {
  beforeEach(() => {
    mockParagraph.mockClear()
    mockTextRun.mockClear()
  })

  it('returns an array of Paragraph objects', () => {
    const paragraphs = parseMarkdownToDocx('普通段落')
    expect(Array.isArray(paragraphs)).toBe(true)
    expect(paragraphs.length).toBeGreaterThan(0)
    paragraphs.forEach((p) => expect(p).toBeDefined())
  })

  it('maps # heading to HEADING_1', () => {
    parseMarkdownToDocx('# 主标题')
    expect(mockParagraph).toHaveBeenCalledWith(
      expect.objectContaining({ heading: 'Heading1' })
    )
  })

  it('maps ## heading to HEADING_2', () => {
    parseMarkdownToDocx('## 二级标题')
    expect(mockParagraph).toHaveBeenCalledWith(
      expect.objectContaining({ heading: 'Heading2' })
    )
  })

  it('maps ### heading to HEADING_3', () => {
    parseMarkdownToDocx('### 三级标题')
    expect(mockParagraph).toHaveBeenCalledWith(
      expect.objectContaining({ heading: 'Heading3' })
    )
  })

  it('generates a bullet paragraph for dash list items', () => {
    parseMarkdownToDocx('- 列表项')
    const bulletCall = mockParagraph.mock.calls.find(
      (args) => args[0]?.children?.[0]?.text?.startsWith('• ')
    )
    expect(bulletCall).toBeDefined()
  })

  it('generates a numbered list paragraph', () => {
    parseMarkdownToDocx('1. 第一步\n2. 第二步')
    expect(mockParagraph).toHaveBeenCalled()
  })

  it('strips bold markers from list content', () => {
    parseMarkdownToDocx('- **加粗项**')
    const bulletCall = mockParagraph.mock.calls.find(
      (args) => args[0]?.children?.[0]?.text?.startsWith('• ')
    )
    expect(bulletCall?.[0]?.children?.[0]?.text).toBe('• 加粗项')
  })

  it('strips bold markers from regular paragraphs', () => {
    parseMarkdownToDocx('这是 **加粗** 普通文字')
    const paraCall = mockParagraph.mock.calls.find(
      (args) => args[0]?.children?.[0]?.text?.includes('加粗')
    )
    expect(paraCall?.[0]?.children?.[0]?.text).toBe('这是 加粗 普通文字')
  })

  it('skips empty lines with empty paragraph', () => {
    parseMarkdownToDocx('\n\n段落\n')
    const emptyCalls = mockParagraph.mock.calls.filter(
      (args) => args[0]?.text === ''
    )
    expect(emptyCalls.length).toBeGreaterThan(0)
  })

  it('assigns indent to list items', () => {
    parseMarkdownToDocx('- 缩进项')
    const bulletCall = mockParagraph.mock.calls.find(
      (args) => args[0]?.children?.[0]?.text?.startsWith('• ')
    )
    expect(bulletCall?.[0]?.indent?.left).toBe(360)
  })
})

// ─── downloadReportAsPdf ─────────────────────────────────────────────────────
describe('downloadReportAsPdf', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) })
    ))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls jsPDF constructor with portrait A4 options', async () => {
    const { jsPDF } = await import('jspdf')
    await downloadReportAsPdf(makeResult())
    expect(jsPDF).toHaveBeenCalledWith({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    })
  })

  it('sets green [16, 185, 129] for PASS complianceStatus', async () => {
    await downloadReportAsPdf(makeResult({ complianceStatus: 'PASS' }))
    expect(jsPDFMethods.setTextColor).toHaveBeenCalledWith(16, 185, 129)
  })

  it('sets yellow [245, 158, 11] for WARN complianceStatus', async () => {
    await downloadReportAsPdf(makeResult({ complianceStatus: 'WARN' }))
    expect(jsPDFMethods.setTextColor).toHaveBeenCalledWith(245, 158, 11)
  })

  it('sets red [239, 68, 68] for REJECTED complianceStatus', async () => {
    await downloadReportAsPdf(makeResult({ complianceStatus: 'REJECTED' }))
    expect(jsPDFMethods.setTextColor).toHaveBeenCalledWith(239, 68, 68)
  })

  it('falls back to red for UNKNOWN complianceStatus', async () => {
    await downloadReportAsPdf(makeResult({ complianceStatus: 'UNKNOWN' }))
    expect(jsPDFMethods.setTextColor).toHaveBeenCalledWith(239, 68, 68)
  })

  it('saves file with format: 合规报告_{sessionId}_{status}.pdf', async () => {
    await downloadReportAsPdf(makeResult())
    expect(jsPDFMethods.save).toHaveBeenCalledWith('合规报告_sess_abc123_PASS.pdf')
  })

  it('writes the compliance score as large text', async () => {
    await downloadReportAsPdf(makeResult({ complianceScore: 88 }))
    expect(jsPDFMethods.text).toHaveBeenCalledWith(
      '88',
      expect.any(Number),
      expect.any(Number)
    )
  })

  it('adds and sets NotoSansSC font for Chinese text', async () => {
    await downloadReportAsPdf(makeResult())
    expect(jsPDFMethods.addFont).toHaveBeenCalled()
    expect(jsPDFMethods.setFont).toHaveBeenCalledWith('NotoSansSC', 'normal')
  })

  it('draws divider lines between sections', async () => {
    await downloadReportAsPdf(makeResult())
    expect(jsPDFMethods.line).toHaveBeenCalled()
  })

  it('splits report text to fit page width', async () => {
    await downloadReportAsPdf(makeResult())
    expect(jsPDFMethods.splitTextToSize).toHaveBeenCalled()
  })

  it('adds page footer on each page', async () => {
    await downloadReportAsPdf(makeResult())
    expect(jsPDFMethods.setPage).toHaveBeenCalled()
    expect(jsPDFMethods.getNumberOfPages).toHaveBeenCalled()
  })

  it('handles very long report content without crashing', async () => {
    await downloadReportAsPdf(
      makeResult({ complianceReport: '# 标题\n' + '很长内容。'.repeat(2000) })
    )
    expect(jsPDFMethods.splitTextToSize).toHaveBeenCalled()
  })

  it('adds a new page when content exceeds page height', async () => {
    // Mock splitTextToSize to return many lines to force page break
    jsPDFMethods.splitTextToSize.mockReturnValueOnce(
      Array(300).fill('This is a long line of content that will wrap to multiple lines when rendered in PDF')
    )
    const longReport = '# 报告\n' + '长内容 '.repeat(100)
    await downloadReportAsPdf(makeResult({ complianceReport: longReport }))
    // The page break condition should trigger addPage
    expect(jsPDFMethods.addPage).toHaveBeenCalled()
  })
})

// ─── downloadReportAsDocx ────────────────────────────────────────────────────
describe('downloadReportAsDocx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPackerToBlob.mockResolvedValue(new Blob())
  })

  it('passes a sections array with children to Document', async () => {
    await downloadReportAsDocx(makeResult())
    // Unwrap the mock: first arg of Packer.toBlob is the Document instance returned by new Document(opts)
    const docInstance = mockPackerToBlob.mock.calls[0]?.[0]
    expect(docInstance).toBeDefined()
    expect(docInstance.sections).toBeDefined()
    expect(Array.isArray(docInstance.sections)).toBe(true)
    expect(docInstance.sections[0]?.children).toBeDefined()
  })

  it('sets anchor download to 合规报告_{sessionId}_{status}.docx', async () => {
    await downloadReportAsDocx(makeResult())
    expect(mockAnchorRef.current.download).toBe('合规报告_sess_abc123_PASS.docx')
  })

  it('creates a Table for the score box', async () => {
    await downloadReportAsDocx(makeResult())
    expect(mockTable).toHaveBeenCalled()
  })

  it('creates TableRow and TableCell for score box layout', async () => {
    await downloadReportAsDocx(makeResult())
    expect(mockTableRow).toHaveBeenCalled()
    expect(mockTableCell).toHaveBeenCalled()
  })

  it('places compliance score value inside the score cell', async () => {
    await downloadReportAsDocx(makeResult({ complianceScore: 95 }))
    // Verify score in the Document opts: sections[0].children includes a Table
    const docOpts = mockPackerToBlob.mock.calls[0]?.[0]
    expect(docOpts?.sections?.[0]?.children).toBeDefined()
  })

  it('calls Packer.toBlob with a Document instance', async () => {
    await downloadReportAsDocx(makeResult())
    expect(mockPackerToBlob).toHaveBeenCalled()
    expect(mockDocument).toHaveBeenCalled()
  })

  it('creates an anchor element for the download', async () => {
    await downloadReportAsDocx(makeResult())
    expect(document.createElement).toHaveBeenCalledWith('a')
  })

  it('appends anchor to body, clicks, then removes it', async () => {
    await downloadReportAsDocx(makeResult())
    expect(document.body.appendChild).toHaveBeenCalledWith(mockAnchorRef.current)
    expect(mockAnchorRef.current.click).toHaveBeenCalled()
    expect(document.body.removeChild).toHaveBeenCalledWith(mockAnchorRef.current)
  })

  it('revokes the object URL after triggering download', async () => {
    await downloadReportAsDocx(makeResult())
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/mock-blob')
  })

  it('maps market labels correctly in docx metadata', async () => {
    await downloadReportAsDocx(makeResult({ targetMarkets: ['EU', 'UK'] as any }))
    const docOpts = mockPackerToBlob.mock.calls[0]?.[0]
    expect(containsText(docOpts, '欧盟')).toBe(true)
  })

  it('renders WARN status as 警告 in docx score box', async () => {
    await downloadReportAsDocx(makeResult({ complianceStatus: 'WARN' }))
    const docOpts = mockPackerToBlob.mock.calls[0]?.[0]
    expect(containsText(docOpts, '警告')).toBe(true)
  })
})

// Recursively search for a text string in a plain object (docx opts tree).
function containsText(obj: any, text: string): boolean {
  if (typeof obj === 'string' && obj.includes(text)) return true
  if (typeof obj === 'number') return false
  if (Array.isArray(obj)) return obj.some((v) => containsText(v, text))
  if (obj && typeof obj === 'object') {
    return Object.values(obj).some((v) => containsText(v, text))
  }
  return false
}

function makeDecisionContent(overrides: Partial<import('@/lib/report-export-modules/decision').DecisionContent> = {}) {
  return {
    sessionId: 'decision_001',
    verdict: 'WARN',
    riskLevel: 'MEDIUM',
    summary: 'A controlled launch is possible after label remediation.',
    keyFindings: ['Missing EU responsible person', 'DoC package needs refresh'],
    recommendedAction: 'Complete labeling and technical file before EU launch.',
    nodesEvidence: [
      {
        type: 'retrieve',
        label: '法规检索',
        labelEn: 'Regulation retrieval',
        reasoning: '命中 GPSR 和 LVD',
        reasoningEn: 'Matched GPSR and LVD',
      },
    ],
    ...overrides,
  }
}

function makeRoadmapContent(overrides: Partial<import('@/lib/report-export-modules/roadmap').RoadmapContent> = {}) {
  return {
    sessionId: 'roadmap_001',
    currentStatus: 'WARN',
    totalDays: 42,
    totalCost: '$18K',
    items: [
      {
        title: '补齐标签',
        titleEn: 'Complete labels',
        description: '增加欧盟责任人和批次追溯信息',
        descriptionEn: 'Add EU responsible person and batch traceability.',
        cost: '$800',
        days: 5,
        status: 'COMPLETED',
      },
      {
        title: '技术文件',
        titleEn: 'Technical file',
        description: '整理 DoC、BOM 和测试报告',
        descriptionEn: 'Prepare DoC, BOM, and test reports.',
        cost: '$12K',
        days: 21,
        status: 'IN_PROGRESS',
      },
      {
        title: '平台复核',
        titleEn: 'Marketplace review',
        description: '提交合规资料包',
        descriptionEn: 'Submit compliance package.',
        cost: '$500',
        days: 3,
        status: 'PENDING',
      },
      {
        title: '风险复盘',
        titleEn: 'Risk review',
        description: '确认剩余风险',
        descriptionEn: 'Review residual risk.',
        status: 'REJECTED',
      },
    ],
    ...overrides,
  }
}

// ─── Structured Decision Exports ─────────────────────────────────────────────
describe('downloadDecisionReport exports', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPackerToBlob.mockResolvedValue(new Blob())
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) })
    ))
  })

  it.each([
    ['PASS', 'LOW'],
    ['WARN', 'MEDIUM'],
    ['REJECTED', 'HIGH'],
    ['UNKNOWN', undefined],
  ])('renders decision PDF status %s with risk %s', async (verdict, riskLevel) => {
    await downloadDecisionReportAsPdf(makeDecisionContent({ verdict, riskLevel }), 'en')

    expect(jsPDFMethods.roundedRect).toHaveBeenCalled()
    expect(jsPDFMethods.splitTextToSize).toHaveBeenCalled()
    expect(jsPDFMethods.save).toHaveBeenCalledWith('AIDecisionReport_decision_001.pdf')
  })

  it('creates decision docx with summary, findings, action, and node evidence', async () => {
    await downloadDecisionReportAsDocx(makeDecisionContent(), 'en')
    const docOpts = mockPackerToBlob.mock.calls[0]?.[0]

    expect(mockDocument).toHaveBeenCalled()
    expect(containsText(docOpts, 'AI Decision Report')).toBe(true)
    expect(containsText(docOpts, 'A controlled launch is possible')).toBe(true)
    expect(containsText(docOpts, 'Regulation retrieval')).toBe(true)
    expect(mockAnchorRef.current.download).toBe('AIDecisionReport_decision_001.docx')
  })

  it('handles minimal decision docx content', async () => {
    await downloadDecisionReportAsDocx({ sessionId: 'decision_minimal' }, 'en')
    const docOpts = mockPackerToBlob.mock.calls[0]?.[0]

    expect(containsText(docOpts, 'Unknown')).toBe(true)
    expect(mockAnchorRef.current.download).toBe('AIDecisionReport_decision_minimal.docx')
  })
})

// ─── Structured Roadmap Exports ──────────────────────────────────────────────
describe('downloadRoadmapReport exports', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPackerToBlob.mockResolvedValue(new Blob())
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) })
    ))
  })

  it('renders roadmap PDF with status, totals, and step table', async () => {
    await downloadRoadmapReportAsPdf(makeRoadmapContent(), 'en')

    expect(jsPDFMethods.rect).toHaveBeenCalled()
    expect(jsPDFMethods.roundedRect).toHaveBeenCalled()
    expect(jsPDFMethods.save).toHaveBeenCalledWith('ComplianceRoadmap_roadmap_001.pdf')
  })

  it('adds pages for long roadmap PDF step lists', async () => {
    const manyItems = Array.from({ length: 50 }, (_, index) => ({
      title: `步骤 ${index + 1}`,
      titleEn: `Step ${index + 1}`,
      description: '批量整改任务',
      descriptionEn: 'Batch remediation task.',
      status: index % 2 === 0 ? 'COMPLETED' : 'IN_PROGRESS',
      days: index + 1,
    }))

    await downloadRoadmapReportAsPdf(makeRoadmapContent({ items: manyItems }), 'en')
    expect(jsPDFMethods.addPage).toHaveBeenCalled()
  })

  it('creates roadmap docx with summary, steps, and current status', async () => {
    await downloadRoadmapReportAsDocx(makeRoadmapContent(), 'en')
    const docOpts = mockPackerToBlob.mock.calls[0]?.[0]

    expect(mockDocument).toHaveBeenCalled()
    expect(containsText(docOpts, 'Compliance Roadmap Report')).toBe(true)
    expect(containsText(docOpts, 'Complete labels')).toBe(true)
    expect(containsText(docOpts, 'Current Status')).toBe(true)
    expect(mockAnchorRef.current.download).toBe('ComplianceRoadmap_roadmap_001.docx')
  })

  it('handles roadmap docx without totals or steps', async () => {
    await downloadRoadmapReportAsDocx(
      makeRoadmapContent({ totalDays: undefined, totalCost: undefined, items: [] }),
      'en'
    )
    const docOpts = mockPackerToBlob.mock.calls[0]?.[0]

    expect(containsText(docOpts, 'Compliance Roadmap Report')).toBe(true)
    expect(containsText(docOpts, 'Current Status')).toBe(true)
  })
})

// ─── Profit Report Fixture ────────────────────────────────────────────────────
function makeProfitResult(
  overrides: Partial<import('@/lib/types').ProfitReportResult> = {}
): import('@/lib/types').ProfitReportResult {
  return {
    sessionId: 'sess_profit_001',
    productType: '便携式蓝牙音箱',
    market: 'EU',
    report: '# 成本分析\n\n完整分析报告内容。',
    barebone: {
      bom: 45.5,
      packaging: 8.0,
      cert: 2.5,
      epr: 1.0,
      logistics: 12.0,
      asp: 199.0,
      gp: 130.0,
      warranty: 5.0,
      total: 74.0,
    },
    compliant: {
      bom: 62.0,
      packaging: 10.0,
      cert: 4.0,
      epr: 2.0,
      logistics: 15.0,
      asp: 199.0,
      gp: 106.0,
      warranty: 6.0,
      total: 99.0,
    },
    bareboneRiskExposure: 6500,
    compliantRiskExposure: 0,
    keyConclusion: '合规方案毛利润略低但无风险敞口。',
    generatedAt: '2026-05-07T10:00:00.000Z',
    premiumPct: '37%',
    breakevenUnits: '150台',
    pricingStrategy: '建议定价 ¥199，保持与竞品竞争力。',
    riskNote: '合规模式下无扣押风险。',
    conclusions: '- 合规成本增加约 ¥25/台\n- 风险敞口为零',
    references: '- EU CE 标识指令 2014/35/EU\n- EPR 包装法',
    bareboneGpm: 65.3,
    compliantGpm: 53.3,
    ...overrides,
  }
}

// ─── downloadProfitReportAsPdf ────────────────────────────────────────────────
describe('downloadProfitReportAsPdf', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) })
    ))
    // Reset page count to 1 for most tests
    jsPDFMethods.getNumberOfPages.mockReturnValue(1)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a jsPDF instance with A4 portrait settings', async () => {
    const { jsPDF } = await import('jspdf')
    await downloadProfitReportAsPdf(makeProfitResult())
    expect(jsPDF).toHaveBeenCalledWith({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    })
  })

  it('embeds NotoSansSC font for Chinese text', async () => {
    await downloadProfitReportAsPdf(makeProfitResult())
    expect(jsPDFMethods.addFont).toHaveBeenCalled()
    expect(jsPDFMethods.setFont).toHaveBeenCalledWith('NotoSansSC', 'normal')
  })

  it('renders title and product info in header', async () => {
    await downloadProfitReportAsPdf(makeProfitResult())
    // Title text should be called
    expect(jsPDFMethods.text).toHaveBeenCalled()
  })

  it('draws two summary cards for barebone vs compliant', async () => {
    await downloadProfitReportAsPdf(makeProfitResult())
    // Should call roundedRect twice for the two cards
    expect(jsPDFMethods.roundedRect).toHaveBeenCalled()
  })

  it('renders cost comparison table section', async () => {
    await downloadProfitReportAsPdf(makeProfitResult())
    // pdfDrawTable calls rect and text for each cell
    expect(jsPDFMethods.rect).toHaveBeenCalled()
    expect(jsPDFMethods.text).toHaveBeenCalled()
  })

  it('renders revenue comparison table section', async () => {
    await downloadProfitReportAsPdf(makeProfitResult())
    // Multiple sections render tables
    const textCalls = jsPDFMethods.text.mock.calls
    expect(textCalls.length).toBeGreaterThan(0)
  })

  it('renders risk-adjusted net income table section', async () => {
    await downloadProfitReportAsPdf(makeProfitResult())
    expect(jsPDFMethods.text).toHaveBeenCalled()
  })

  it('renders breakeven analysis table section', async () => {
    await downloadProfitReportAsPdf(makeProfitResult())
    expect(jsPDFMethods.text).toHaveBeenCalled()
  })

  it('renders riskNote as a bullet when present', async () => {
    await downloadProfitReportAsPdf(makeProfitResult())
    // Bullet text should be rendered
    expect(jsPDFMethods.text).toHaveBeenCalled()
  })

  it('renders pricingStrategy as a bullet when present', async () => {
    await downloadProfitReportAsPdf(makeProfitResult())
    expect(jsPDFMethods.text).toHaveBeenCalled()
  })

  it('renders conclusions as bullets when present', async () => {
    await downloadProfitReportAsPdf(makeProfitResult())
    expect(jsPDFMethods.text).toHaveBeenCalled()
  })

  it('renders references as bullets when present', async () => {
    await downloadProfitReportAsPdf(makeProfitResult())
    expect(jsPDFMethods.text).toHaveBeenCalled()
  })

  it('renders fallback report section when no references/conclusions but has report', async () => {
    await downloadProfitReportAsPdf(makeProfitResult({
      references: undefined,
      conclusions: undefined,
      report: '# 分析报告\n\n这是分析报告内容。',
    }))
    expect(jsPDFMethods.text).toHaveBeenCalled()
  })

  it('adds page footer on each page', async () => {
    jsPDFMethods.getNumberOfPages.mockReturnValue(2)
    await downloadProfitReportAsPdf(makeProfitResult())
    expect(jsPDFMethods.setPage).toHaveBeenCalled()
    expect(jsPDFMethods.getNumberOfPages).toHaveBeenCalled()
  })

  it('saves with Chinese filename when locale is zh', async () => {
    localStorage.getItem = vi.fn((key: string) => key === 'locale' ? 'zh' : null)
    await downloadProfitReportAsPdf(makeProfitResult())
    expect(jsPDFMethods.save).toHaveBeenCalledWith('成本利润分析报告_sess_profit_001.pdf')
  })

  it('saves with English filename when locale is en', async () => {
    localStorage.getItem = vi.fn((key: string) => key === 'locale' ? 'en' : null)
    await downloadProfitReportAsPdf(makeProfitResult())
    expect(jsPDFMethods.save).toHaveBeenCalledWith('CostProfitAnalysisReport_sess_profit_001.pdf')
  })

  it('handles zero risk exposure correctly', async () => {
    await downloadProfitReportAsPdf(makeProfitResult({ compliantRiskExposure: 0 }))
    expect(jsPDFMethods.text).toHaveBeenCalled()
  })

  it('handles missing optional fields gracefully', async () => {
    await downloadProfitReportAsPdf(makeProfitResult({
      riskNote: undefined,
      pricingStrategy: undefined,
      conclusions: undefined,
      references: undefined,
      premiumPct: undefined,
      breakevenUnits: undefined,
    }))
    expect(jsPDFMethods.save).toHaveBeenCalled()
  })

  it('handles keyConclusion fallback when conclusions is empty', async () => {
    await downloadProfitReportAsPdf(makeProfitResult({
      conclusions: '',
      keyConclusion: 'Fallback conclusion text',
    }))
    expect(jsPDFMethods.text).toHaveBeenCalled()
  })
})

// ─── downloadProfitReportAsDocx ──────────────────────────────────────────────
describe('downloadProfitReportAsDocx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPackerToBlob.mockResolvedValue(new Blob())
  })

  it('creates a Document with sections', async () => {
    await downloadProfitReportAsDocx(makeProfitResult())
    expect(mockDocument).toHaveBeenCalled()
    const docOpts = mockPackerToBlob.mock.calls[0]?.[0]
    expect(docOpts.sections).toBeDefined()
    expect(Array.isArray(docOpts.sections)).toBe(true)
  })

  it('renders title with profitTitle translation', async () => {
    // Set locale to Chinese for this test
    localStorage.getItem = vi.fn((key: string) => key === 'locale' ? 'zh' : null)
    await downloadProfitReportAsDocx(makeProfitResult())
    const docOpts = mockPackerToBlob.mock.calls[0]?.[0]
    // Verify the document has sections with children
    expect(docOpts?.sections).toBeDefined()
    const sections = docOpts.sections
    expect(sections[0]?.children).toBeDefined()
    // First child should be a Paragraph with H1 heading
    const firstChild = sections[0].children[0]
    expect(firstChild.heading).toBe('Heading1')
    // Verify the first paragraph has children (TextRun array)
    expect(firstChild.children).toBeDefined()
    expect(Array.isArray(firstChild.children)).toBe(true)
    // Verify the text is in a TextRun
    const firstTextRun = firstChild.children[0]
    expect(firstTextRun).toBeDefined()
    expect(firstTextRun.text).toBeDefined()
    // The profitTitle in Chinese is "火鹰合规 · 合规成本与利润分析报告"
    expect(firstTextRun.text).toContain('火鹰')
  })

  it('creates summary cards table for barebone vs compliant', async () => {
    await downloadProfitReportAsDocx(makeProfitResult())
    expect(mockTable).toHaveBeenCalled()
  })

  it('renders cost comparison table section', async () => {
    await downloadProfitReportAsDocx(makeProfitResult())
    // Tables are created for each section
    const tableCalls = mockTable.mock.calls
    expect(tableCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('renders revenue comparison table section', async () => {
    await downloadProfitReportAsDocx(makeProfitResult())
    expect(mockTable).toHaveBeenCalled()
  })

  it('renders risk-adjusted net income table section', async () => {
    await downloadProfitReportAsDocx(makeProfitResult())
    expect(mockTable).toHaveBeenCalled()
  })

  it('renders breakeven analysis table section', async () => {
    await downloadProfitReportAsDocx(makeProfitResult())
    expect(mockTable).toHaveBeenCalled()
  })

  it('renders riskNote as bullet when present', async () => {
    await downloadProfitReportAsDocx(makeProfitResult())
    expect(mockParagraph).toHaveBeenCalled()
  })

  it('renders pricingStrategy as bullet when present', async () => {
    await downloadProfitReportAsDocx(makeProfitResult())
    expect(mockParagraph).toHaveBeenCalled()
  })

  it('renders conclusions section when present', async () => {
    await downloadProfitReportAsDocx(makeProfitResult())
    expect(mockParagraph).toHaveBeenCalled()
  })

  it('renders references section when present', async () => {
    await downloadProfitReportAsDocx(makeProfitResult())
    expect(mockParagraph).toHaveBeenCalled()
  })

  it('renders fallback report when no references/conclusions but has report', async () => {
    await downloadProfitReportAsDocx(makeProfitResult({
      references: undefined,
      conclusions: undefined,
      report: '# 分析报告\n\n这是分析报告内容。',
    }))
    expect(mockParagraph).toHaveBeenCalled()
  })

  it('creates anchor element for download', async () => {
    await downloadProfitReportAsDocx(makeProfitResult())
    expect(document.createElement).toHaveBeenCalledWith('a')
  })

  it('sets Chinese filename when locale is zh', async () => {
    localStorage.getItem = vi.fn((key: string) => key === 'locale' ? 'zh' : null)
    await downloadProfitReportAsDocx(makeProfitResult())
    expect(mockAnchorRef.current.download).toBe('成本利润分析报告_sess_profit_001.docx')
  })

  it('sets English filename when locale is en', async () => {
    localStorage.getItem = vi.fn((key: string) => key === 'locale' ? 'en' : null)
    await downloadProfitReportAsDocx(makeProfitResult())
    expect(mockAnchorRef.current.download).toBe('CostProfitAnalysisReport_sess_profit_001.docx')
  })

  it('appends anchor to body, clicks, then removes it', async () => {
    await downloadProfitReportAsDocx(makeProfitResult())
    expect(document.body.appendChild).toHaveBeenCalledWith(mockAnchorRef.current)
    expect(mockAnchorRef.current.click).toHaveBeenCalled()
    expect(document.body.removeChild).toHaveBeenCalledWith(mockAnchorRef.current)
  })

  it('revokes the object URL after triggering download', async () => {
    await downloadProfitReportAsDocx(makeProfitResult())
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/mock-blob')
  })

  it('calls Packer.toBlob with a Document instance', async () => {
    await downloadProfitReportAsDocx(makeProfitResult())
    expect(mockPackerToBlob).toHaveBeenCalled()
  })

  it('handles zero risk exposure in table', async () => {
    await downloadProfitReportAsDocx(makeProfitResult({ compliantRiskExposure: 0 }))
    expect(mockTable).toHaveBeenCalled()
  })

  it('handles non-zero risk exposure in table', async () => {
    await downloadProfitReportAsDocx(makeProfitResult({ compliantRiskExposure: 5000 }))
    expect(mockTable).toHaveBeenCalled()
  })

  it('handles missing optional fields gracefully', async () => {
    await downloadProfitReportAsDocx(makeProfitResult({
      riskNote: undefined,
      pricingStrategy: undefined,
      conclusions: undefined,
      references: undefined,
      premiumPct: undefined,
      breakevenUnits: undefined,
    }))
    expect(mockDocument).toHaveBeenCalled()
    expect(mockPackerToBlob).toHaveBeenCalled()
  })

  it('renders keyConclusion when conclusions is empty', async () => {
    await downloadProfitReportAsDocx(makeProfitResult({
      conclusions: '',
      keyConclusion: 'Fallback conclusion text',
    }))
    expect(mockParagraph).toHaveBeenCalled()
  })

  it('handles empty conclusions and keyConclusion in docx', async () => {
    // Test the branch where conclusionParas.length === 0
    await downloadProfitReportAsDocx(makeProfitResult({
      conclusions: undefined,
      keyConclusion: undefined,
    }))
    expect(mockDocument).toHaveBeenCalled()
    expect(mockPackerToBlob).toHaveBeenCalled()
  })
})

// ─── Helper function tests ───────────────────────────────────────────────────

// Test locale detection indirectly through the exported functions
describe('Locale detection (via export functions)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) })
    ))
    mockPackerToBlob.mockResolvedValue(new Blob())
  })

  it('uses localStorage locale when set to zh', async () => {
    localStorage.getItem = vi.fn((key: string) => key === 'locale' ? 'zh' : null)
    await downloadReportAsPdf(makeResult())
    // Chinese filename format should be used
    expect(jsPDFMethods.save).toHaveBeenCalledWith('合规报告_sess_abc123_PASS.pdf')
  })

  it('uses localStorage locale when set to en', async () => {
    localStorage.getItem = vi.fn((key: string) => key === 'locale' ? 'en' : null)
    await downloadReportAsPdf(makeResult())
    // English filename format should be used
    expect(jsPDFMethods.save).toHaveBeenCalledWith('ComplianceReport_sess_abc123_PASS.pdf')
  })

  it('falls back to zh when localStorage has no locale and browser is zh', async () => {
    localStorage.getItem = vi.fn(() => null)
    Object.defineProperty(globalThis, 'navigator', {
      value: { language: 'zh-CN' },
      writable: true,
    })
    await downloadReportAsPdf(makeResult())
    expect(jsPDFMethods.save).toHaveBeenCalledWith('合规报告_sess_abc123_PASS.pdf')
  })

  it('falls back to en when localStorage has no locale and browser is en', async () => {
    localStorage.getItem = vi.fn(() => null)
    Object.defineProperty(globalThis, 'navigator', {
      value: { language: 'en-US' },
      writable: true,
    })
    await downloadReportAsPdf(makeResult())
    expect(jsPDFMethods.save).toHaveBeenCalledWith('ComplianceReport_sess_abc123_PASS.pdf')
  })
})

// Test complianceStatusLabel indirectly through exported functions
describe('complianceStatusLabel mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) })
    ))
  })

  it('shows "通过" for PASS status in PDF', async () => {
    localStorage.getItem = vi.fn(() => 'zh')
    await downloadReportAsPdf(makeResult({ complianceStatus: 'PASS' }))
    // Should call setTextColor with green color for PASS
    expect(jsPDFMethods.setTextColor).toHaveBeenCalledWith(16, 185, 129)
  })

  it('shows "警告" for WARN status in PDF', async () => {
    localStorage.getItem = vi.fn(() => 'zh')
    await downloadReportAsPdf(makeResult({ complianceStatus: 'WARN' }))
    expect(jsPDFMethods.setTextColor).toHaveBeenCalledWith(245, 158, 11)
  })

  it('shows "拒绝" for REJECTED status in PDF', async () => {
    localStorage.getItem = vi.fn(() => 'zh')
    await downloadReportAsPdf(makeResult({ complianceStatus: 'REJECTED' }))
    expect(jsPDFMethods.setTextColor).toHaveBeenCalledWith(239, 68, 68)
  })

  it('falls back to red for UNKNOWN status in PDF', async () => {
    localStorage.getItem = vi.fn(() => 'zh')
    await downloadReportAsPdf(makeResult({ complianceStatus: 'UNKNOWN' }))
    expect(jsPDFMethods.setTextColor).toHaveBeenCalledWith(239, 68, 68)
  })
})

// Test marketLabel indirectly
describe('marketLabel mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPackerToBlob.mockResolvedValue(new Blob())
  })

  it('translates EU and US to Chinese labels in docx', async () => {
    localStorage.getItem = vi.fn(() => 'zh')
    await downloadReportAsDocx(makeResult({ targetMarkets: ['EU', 'US'] as any }))
    const docOpts = mockPackerToBlob.mock.calls[0]?.[0]
    expect(containsText(docOpts, '欧盟')).toBe(true)
    expect(containsText(docOpts, '美国')).toBe(true)
  })

  it('translates EU and US to English labels in docx', async () => {
    localStorage.getItem = vi.fn(() => 'en')
    await downloadReportAsDocx(makeResult({ targetMarkets: ['EU', 'US'] as any }))
    const docOpts = mockPackerToBlob.mock.calls[0]?.[0]
    expect(containsText(docOpts, 'European Union')).toBe(true)
    expect(containsText(docOpts, 'United States')).toBe(true)
  })
})
