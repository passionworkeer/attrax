/**
 * Tests for `buildProfitRenderModelFromProfitReport` (lib/pipeline/profit-report.ts)
 * and the legacy `downloadProfitReportAsPdf/Docx` wrappers.
 *
 * Why: before this fix, the legacy wrapper rebuilt a *synthetic* FinancialSummary
 * from CostSummary fields with hardcoded `$` symbols — so a result-page "成本利润
 * 说明" export produced completely different numbers than the `/profit/[sessionId]`
 * page export. After this fix, both paths converge on the same `ProfitRenderModel`,
 * so the same fixture must yield the same key strings regardless of which entry
 * point the user clicked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom'

// ─── Mock jsPDF (hoisted) ────────────────────────────────────────────────────
const jsPDFMethods = vi.hoisted(() => ({
  addFont: vi.fn(), addFileToVFS: vi.fn(), setFont: vi.fn(), addPage: vi.fn(),
  getNumberOfPages: vi.fn(() => 1), setPage: vi.fn(),
  getTextWidth: vi.fn(() => 20), roundedRect: vi.fn(), line: vi.fn(),
  setFontSize: vi.fn(), setTextColor: vi.fn(), setDrawColor: vi.fn(),
  setFillColor: vi.fn(), setLineWidth: vi.fn(), text: vi.fn(),
  rect: vi.fn(), splitTextToSize: vi.fn((t: string) => t.split('\n')),
  save: vi.fn(), output: vi.fn(() => ({})),
  internal: {
    pageSize: { getWidth: vi.fn(() => 210), getHeight: vi.fn(() => 297) },
  },
}))
function MockJsPDF(opts: any) { void opts; return jsPDFMethods }
const mockJsPDFCtor = vi.hoisted(() => vi.fn(MockJsPDF) as any)

// ─── Mock docx (hoisted) ─────────────────────────────────────────────────────
function MockParagraph(opts: any) { Object.assign(this, opts) }
function MockTextRun(opts: any) { Object.assign(this, opts) }
function MockTable(opts: any) { Object.assign(this, opts) }
function MockTableRow(opts: any) { Object.assign(this, opts) }
function MockTableCell(opts: any) { Object.assign(this, opts) }
function MockDocument(opts: any) { Object.assign(this, opts) }
const mockPackerToBlob = vi.hoisted(() => vi.fn<() => Promise<Blob>>())
const mockParagraph = vi.hoisted(() => vi.fn(MockParagraph) as any)
const mockTextRun = vi.hoisted(() => vi.fn(MockTextRun) as any)
const mockTable = vi.hoisted(() => vi.fn(MockTable) as any)
const mockTableRow = vi.hoisted(() => vi.fn(MockTableRow) as any)
const mockTableCell = vi.hoisted(() => vi.fn(MockTableCell) as any)
const mockDocument = vi.hoisted(() => vi.fn(MockDocument) as any)

vi.mock('jspdf', () => ({ jsPDF: mockJsPDFCtor }))
vi.mock('docx', () => ({
  Document: mockDocument,
  Packer: { toBlob: mockPackerToBlob },
  Paragraph: mockParagraph,
  TextRun: mockTextRun,
  HeadingLevel: { HEADING_1: 'Heading1', HEADING_2: 'Heading2', HEADING_3: 'Heading3' },
  AlignmentType: { CENTER: 'center' },
  BorderStyle: { NONE: 'none', SINGLE: 'single' },
  Table: mockTable,
  TableRow: mockTableRow,
  TableCell: mockTableCell,
  WidthType: { PERCENTAGE: 'percentage' },
}))

vi.stubGlobal('URL', {
  createObjectURL: vi.fn(() => 'blob:http://localhost/mock-blob'),
  revokeObjectURL: vi.fn(),
})

const mockAnchorRef = vi.hoisted(
  () => ({ current: { href: '', download: '', click: vi.fn(), remove: vi.fn(), style: { display: '' } } })
)

vi.stubGlobal('document', {
  createElement: vi.fn((tag: string) => {
    if (tag === 'a') return mockAnchorRef.current
    return null
  }),
  body: { appendChild: vi.fn(), removeChild: vi.fn() },
  documentElement: { lang: 'zh' },
})

vi.stubGlobal('localStorage', {
  getItem: vi.fn(() => 'zh'),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
})
vi.stubGlobal('navigator', { language: 'zh-CN', userAgent: 'test' })
vi.stubGlobal('fetch', vi.fn(() =>
  Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) })
))

import {
  downloadProfitReportAsPdf,
  downloadProfitReportAsDocx,
} from '@/lib/report-export'
import { buildProfitRenderModelFromProfitReport } from '@/lib/pipeline/profit-report'
import {
  downloadProfitModelAsPdf,
  downloadProfitModelAsDocx,
} from '@/lib/report-download'
import type { ProfitReportResult } from '@/lib/types'

// ─── Helpers ────────────────────────────────────────────────────────────────
function makeLegacyResult(overrides: Partial<ProfitReportResult> = {}): ProfitReportResult {
  return {
    sessionId: 'sess_legacy_001',
    productType: '便携式蓝牙音箱',
    market: 'EU',
    currency: 'CNY',
    report: '## 充电宝 CE 认证 ¥18,000\nUKCA ¥12,000\n',
    barebone: {
      bom: 32.0,
      packaging: 5.5,
      cert: 0,
      epr: 0,
      logistics: 18.5,
      asp: 128.0,
      gp: 11.48,
      warranty: 4.3,
      total: 60.3,
    },
    compliant: {
      bom: 32.0,
      packaging: 7.0,
      cert: 18.0,
      epr: 4.0,
      logistics: 18.5,
      asp: 128.0,
      gp: 23.97,
      warranty: 7.46,
      total: 86.96,
    },
    bareboneRiskExposure: 1800000,
    compliantRiskExposure: 900000,
    keyConclusion: '关键结论:先合规',
    premiumPct: '52%',
    breakevenUnits: '1200 台',
    pricingStrategy: '¥71910',
    riskNote: '单日最高罚款 ¥180 万',
    conclusions: '',
    references: '',
    generatedAt: '2026-07-22T10:00:00.000Z',
    ...overrides,
  }
}

function allTextCalls(): string[] {
  return jsPDFMethods.text.mock.calls.map((call) => call[0]).flat().filter((v) => typeof v === 'string')
}

function allDocxCellTexts(): string[] {
  const out: string[] = []
  for (const c of mockParagraph.mock.calls) {
    const opts = c[0] as { children?: Array<{ text?: string }> } | undefined
    if (!opts || !opts.children) continue
    for (const child of opts.children) {
      if (child && typeof child.text === 'string') out.push(child.text)
    }
  }
  return out
}

// ─── buildProfitRenderModelFromProfitReport (data shape) ────────────────────
describe('buildProfitRenderModelFromProfitReport', () => {
  it('maps barebone.gp → estimatedHeroicProfit, compliant.gp → trueNetProfit', () => {
    const m = buildProfitRenderModelFromProfitReport(makeLegacyResult(), 'zh')
    const hero = m.metrics.find((c) => c.label.includes('未整改预估单件收益'))
    const net = m.metrics.find((c) => c.label.includes('合规后单件净收益'))
    expect(hero?.value).toBe('¥11.48')
    expect(net?.value).toBe('¥23.97')
  })

  it('computes complianceCost from compliant.cert + compliant.epr + packaging delta', () => {
    // (18 + 4) + (7 - 5.5) = 23.5
    const m = buildProfitRenderModelFromProfitReport(makeLegacyResult(), 'zh')
    const cost = m.metrics.find((c) => c.label.includes('合规总成本'))
    expect(cost?.value).toBe('¥23.50')
  })

  it('uses pricingStrategy as monthlyNetProfit', () => {
    const m = buildProfitRenderModelFromProfitReport(makeLegacyResult(), 'zh')
    const monthly = m.metrics.find((c) => c.label.includes('月度净收益'))
    expect(monthly?.value).toBe('¥71910')
  })

  it('populates chain cost breakdown from CostSummary fields', () => {
    const m = buildProfitRenderModelFromProfitReport(makeLegacyResult(), 'zh')
    expect(m.chainNodes).toHaveLength(6)
    const bom = m.chainNodes.find((n) => n.label.includes('BOM'))
    const logistics = m.chainNodes.find((n) => n.label.includes('物流'))
    const compliance = m.chainNodes.find((n) => n.label.includes('合规成本'))
    const warranty = m.chainNodes.find((n) => n.label.includes('退货'))
    expect(bom?.displayAmount).toBe('¥32.00')
    expect(logistics?.displayAmount).toBe('¥18.50')
    expect(compliance?.displayAmount).toBe('¥23.50') // 18 + 4 + (7 - 5.5)
    expect(warranty?.displayAmount).toBe('¥7.46')    // compliant.warranty
  })

  it('emits 4 risk exposure items verbatim', () => {
    const m = buildProfitRenderModelFromProfitReport(makeLegacyResult(), 'zh')
    expect(m.riskExposureItems.map((r) => r.label)).toEqual([
      '单日最高罚款 ¥180 万',
      '全店永久封停',
      '货物强制扣毁',
      '跨境集体诉讼',
    ])
  })

  it('uses the page title (合规整改成本与风险影响)', () => {
    const m = buildProfitRenderModelFromProfitReport(makeLegacyResult(), 'zh')
    expect(m.title).toBe('合规整改成本与风险影响')
    const en = buildProfitRenderModelFromProfitReport(makeLegacyResult(), 'en')
    expect(en.title).toBe('Compliance Cost and Risk Impact')
  })
})

// ─── Legacy wrappers converge with the unified RenderModel path ─────────────
describe('downloadProfitReportAsPdf — legacy wrapper data convergence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jsPDFMethods.getNumberOfPages.mockReturnValue(1)
  })
  afterEach(() => vi.restoreAllMocks())

  it('emits the same key money strings as the unified RenderModel path', async () => {
    const pr = makeLegacyResult()

    // Path A: legacy wrapper (what /result/[sessionId] ProfitReportView calls).
    await downloadProfitReportAsPdf(pr, 'zh')
    const legacyStrings = new Set(allTextCalls())

    // Path B: explicit unified path (what /profit/[sessionId] calls).
    const model = buildProfitRenderModelFromProfitReport(pr, 'zh')
    vi.clearAllMocks()
    jsPDFMethods.getNumberOfPages.mockReturnValue(1)
    await downloadProfitModelAsPdf(model)
    const unifiedStrings = new Set(allTextCalls())

    // Both paths must surface every key money string the user sees on screen.
    // (the wrapper goes through the same builder, so the strings should be
    // identical for the same fixture.) We check substring containment because
    // some chain labels carry extra detail text in the same TextRun.
    const legacyAll = [...legacyStrings]
    const unifiedAll = [...unifiedStrings]
    const containsAll = (pool: string[], needle: string) =>
      pool.some((s) => s.includes(needle))

    const expected = [
      '¥11.48', // hero
      '¥23.97', // net
      '采购 BOM', // chain label
      '物流',     // chain label
      '合规成本', // chain label
      '退货',     // chain label
      '单日最高罚款 ¥180 万', // risk
      '全店永久封停',
      '货物强制扣毁',
      '跨境集体诉讼',
    ]
    for (const s of expected) {
      expect(containsAll(legacyAll, s), `legacy missing: ${s}`).toBe(true)
      expect(containsAll(unifiedAll, s), `unified missing: ${s}`).toBe(true)
    }
  })

  it('emits RMB currency (¥) instead of the legacy $ hardcode', async () => {
    await downloadProfitReportAsPdf(makeLegacyResult({ currency: 'CNY' }), 'zh')
    const all = allTextCalls()
    // Hero/net amounts must use ¥, not the old $XX.XX hardcoded wrapper output.
    expect(all).toContain('¥11.48')
    expect(all).toContain('¥23.97')
  })

  it('localizes filenames the same way as the unified path', async () => {
    await downloadProfitReportAsPdf(makeLegacyResult(), 'zh')
    expect(mockAnchorRef.current.download).toBe('合规整改成本与风险影响_sess_legacy_001.pdf')

    vi.clearAllMocks()
    jsPDFMethods.getNumberOfPages.mockReturnValue(1)
    await downloadProfitReportAsPdf(makeLegacyResult(), 'en')
    expect(mockAnchorRef.current.download).toBe('Compliance Cost and Risk Impact_sess_legacy_001.pdf')
  })
})

// ─── DOCX legacy wrapper ─────────────────────────────────────────────────────
describe('downloadProfitReportAsDocx — legacy wrapper data convergence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPackerToBlob.mockResolvedValue(new Blob())
  })

  it('emits the same key money strings as the unified RenderModel path', async () => {
    const pr = makeLegacyResult()

    await downloadProfitReportAsDocx(pr, 'zh')
    const legacyStrings = new Set(allDocxCellTexts())

    const model = buildProfitRenderModelFromProfitReport(pr, 'zh')
    vi.clearAllMocks()
    mockPackerToBlob.mockResolvedValue(new Blob())
    await downloadProfitModelAsDocx(model)
    const unifiedStrings = new Set(allDocxCellTexts())

    const legacyAll = [...legacyStrings]
    const unifiedAll = [...unifiedStrings]
    const containsAll = (pool: string[], needle: string) =>
      pool.some((s) => s.includes(needle))

    const expected = [
      '¥11.48',
      '¥23.97',
      '采购 BOM',
      '物流',
      '合规成本',
      '退货',
      '单日最高罚款 ¥180 万',
      '全店永久封停',
      '货物强制扣毁',
      '跨境集体诉讼',
    ]
    for (const s of expected) {
      expect(containsAll(legacyAll, s), `legacy DOCX missing: ${s}`).toBe(true)
      expect(containsAll(unifiedAll, s), `unified DOCX missing: ${s}`).toBe(true)
    }
  })

  it('DOCX title comes from the page model (not the legacy cost-profit title)', async () => {
    await downloadProfitReportAsDocx(makeLegacyResult(), 'zh')
    const docOpts = mockPackerToBlob.mock.calls[0]?.[0]
    const firstChild = docOpts.sections[0].children[0]
    expect(firstChild.heading).toBe('Heading1')
    expect(firstChild.children[0].text).toBe('合规整改成本与风险影响')
  })
})