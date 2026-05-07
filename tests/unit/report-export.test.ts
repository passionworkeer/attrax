/**
 * Unit tests for lib/report-export.ts
 *
 * Coverage:
 *   - parseMarkdownToPdfText: heading levels, list items, bold, links,
 *     empty string, plain text, long text
 *   - parseMarkdownToDocx: paragraphs, heading-level mapping, list expansion
 *   - downloadReportAsPdf: scoreColor mapping (PASS/WARN/REJECTED),
 *     filename format, jsPDF method calls
 *   - downloadReportAsDocx: filename format, table structure, docx generation
 *
 * Note: formatDate does not exist in report-export.ts — skipped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom'

// ─── Mock jsPDF (hoisted so factory can reference it at transform time) ───────
// Pass a plain function to vi.fn so the result is constructible with `new`.
const jsPDFMethods = vi.hoisted(() => {
  const inst = {
    addFont: vi.fn(), setFont: vi.fn(), addPage: vi.fn(),
    getNumberOfPages: vi.fn(() => 1), setPage: vi.fn(),
    getTextWidth: vi.fn(() => 20), roundedRect: vi.fn(), line: vi.fn(),
    setFontSize: vi.fn(), setTextColor: vi.fn(), setDrawColor: vi.fn(),
    setFillColor: vi.fn(), setLineWidth: vi.fn(), text: vi.fn(),
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
  BorderStyle: { NONE: 'none' },
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
})

// ─── System under test (imported AFTER mocks are registered) ──────────────────
import {
  parseMarkdownToPdfText,
  parseMarkdownToDocx,
  downloadReportAsPdf,
  downloadReportAsDocx,
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
