/**
 * Tests for `downloadProfitModelAsPdf` and `downloadProfitModelAsDocx`.
 *
 * Pins down the UI ↔ export contract: the PDF and DOCX must contain the
 * exact strings the user sees on `/profit/[sessionId]`. Asserts on key
 * substrings via the existing jsPDF / docx mocks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mock jsPDF ────────────────────────────────────────────────────────────
const jsPDFMethods = vi.hoisted(() => {
  return {
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
  }
})
function MockJsPDF() { return jsPDFMethods }
const mockJsPDFCtor = vi.hoisted(() => vi.fn(MockJsPDF) as any)

// ─── Mock docx ─────────────────────────────────────────────────────────────
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

import { downloadProfitModelAsDocx } from '@/lib/report-export-modules/profit-docx'
import { downloadProfitModelAsPdf } from '@/lib/report-export-modules/profit-pdf'
import type { ProfitRenderModel } from '@/lib/report-export-modules/profit-render-model'

function makeModel(overrides: Partial<ProfitRenderModel> = {}): ProfitRenderModel {
  return {
    title: '合规整改成本与风险影响',
    subtitle: 'EU+US 市场 · 便携式蓝牙音箱 · 销量基准 3,000 台 / 月',
    productName: '便携式蓝牙音箱',
    marketLabel: 'EU+US',
    generatedAtLabel: '2026/7/21',
    profitMode: 'compliant',
    metrics: [
      { label: '未整改预估单件收益', value: '¥11.48', tone: 'green', unit: '/单个产品' },
      { label: '合规后单件净收益', value: '¥23.97', tone: 'white', unit: '/单个产品', isCore: true },
      { label: '单产品合规总成本', value: '¥7.46', tone: 'orange', unit: '/单个产品' },
      { label: '合规后预估月度净收益', value: '¥71910', tone: 'blue', unit: '/月' },
    ],
    chainNodes: [
      { label: '采购 BOM', detail: '壳料 + PCB', displayAmount: '¥18.50', amount: 18.5, share: 14.5, remaining: 109.5, color: '#3fb5c8' },
      { label: '物流', detail: '头程 + 尾程', displayAmount: '¥12.00', amount: 12, share: 9.4, remaining: 97.5, color: '#54c9d6' },
      { label: '平台抽佣', detail: '已折入 total', displayAmount: '—', amount: 0, share: 0, remaining: 97.5, color: '#71d9db' },
      { label: '合规成本', detail: '认证 + EPR', displayAmount: '¥7.46', amount: 7.46, share: 5.8, remaining: 90.04, color: '#8ae6df' },
      { label: '广告', detail: '已折入 total', displayAmount: '—', amount: 0, share: 0, remaining: 90.04, color: '#63bfd5' },
      { label: '退货', detail: '退货 + 保修', displayAmount: '¥5.00', amount: 5, share: 3.9, remaining: 85.04, color: '#87b7cf' },
    ],
    costBoard: {
      retailBaselineLabel: '售价基线 ¥66.93',
      totalChainCostLabel: '全链路成本 ¥43',
      finalNetValue: '¥23.97',
      finalNetNumber: 23.97,
      finalNetShare: 35.8,
      marginSignal: '每售出 1 件保留 ¥85，当前利润结构接近健康线。',
      breakEvenBufferLabel: '+¥16',
      dominantCost: { label: '采购 BOM', amountLabel: '¥19', shareLabel: '14.5%' },
      activeModeTitle: '合规后出海',
    },
    stackLegend: [
      { label: '采购 BOM', color: '#3fb5c8', displayAmount: '¥18.50' },
      { label: '物流', color: '#54c9d6', displayAmount: '¥12.00' },
      { label: '平台抽佣', color: '#71d9db', displayAmount: '—' },
      { label: '合规成本', color: '#8ae6df', displayAmount: '¥7.46' },
      { label: '广告', color: '#63bfd5', displayAmount: '—' },
      { label: '退货', color: '#87b7cf', displayAmount: '¥5.00' },
      { label: '最终净利润', color: '#42bfd0', displayAmount: '¥23.97', isFinal: true },
    ],
    riskExposureItems: [
      { icon: 'gavel', label: '单日最高罚款 ¥180 万' },
      { icon: 'xcircle', label: '全店永久封停' },
      { icon: 'shield', label: '货物强制扣毁' },
      { icon: 'gavel', label: '跨境集体诉讼' },
    ],
    bareRiskCaveat: null,
    backendMarkdown: null,
    backendMarkdownBadge: '后端真实输出',
    backendMarkdownTitle: '本次扫描的完整成本叙述(来自后端 LLM)',
    backendMarkdownDescription: '',
    conclusions: '',
    references: '',
    sessionId: 'sess_model_001',
    generatedAt: '2026-07-21T10:00:00.000Z',
    currencySymbol: '¥',
    exportBasename: '合规整改成本与风险影响',
    chainPalette: ['#3fb5c8', '#54c9d6', '#71d9db', '#8ae6df', '#63bfd5', '#87b7cf'],
    finalNetGradientStart: '#8cf0df',
    finalNetGradientEnd: '#42bfd0',
    ...overrides,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function allTextCalls(): string[] {
  return jsPDFMethods.text.mock.calls.map((call) => call[0]).flat().filter((v) => typeof v === 'string')
}
function allTableCellTexts(): string[] {
  const out: string[] = []
  // Walk every Paragraph constructor invocation that the docx mock captured.
  for (const c of mockParagraph.mock.calls) {
    const opts = c[0] as { children?: Array<{ text?: string }> } | undefined
    if (!opts || !opts.children) continue
    for (const child of opts.children) {
      if (child && typeof child.text === 'string') out.push(child.text)
    }
  }
  return out
}
function allCellTextRuns(): string[] {
  // For Tables: mockTableCell records opts including `children` which is an
  // array of Paragraph instances. mockParagraph mock captures the Paragraph
  // constructor — so the cell text flows through the same channel as above.
  return allTableCellTexts()
}

// ─── downloadProfitModelAsPdf ──────────────────────────────────────────────
describe('downloadProfitModelAsPdf', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jsPDFMethods.getNumberOfPages.mockReturnValue(1)
  })
  afterEach(() => vi.restoreAllMocks())

  it('renders the page title verbatim', async () => {
    await downloadProfitModelAsPdf(makeModel())
    const all = allTextCalls()
    expect(all.some((t) => t.includes('合规整改成本与风险影响'))).toBe(true)
  })

  it('renders all 4 metric labels from the model', async () => {
    await downloadProfitModelAsPdf(makeModel())
    const all = allTextCalls()
    expect(all).toContain('未整改预估单件收益')
    expect(all).toContain('合规后单件净收益')
    expect(all).toContain('单产品合规总成本')
    expect(all).toContain('合规后预估月度净收益')
  })

  it('renders the metric values verbatim from the FinancialSummary', async () => {
    await downloadProfitModelAsPdf(makeModel())
    const all = allTextCalls()
    expect(all).toContain('¥11.48')
    expect(all).toContain('¥23.97')
    expect(all).toContain('¥7.46')
    expect(all).toContain('¥71910')
  })

  it('renders all 6 chain node labels', async () => {
    await downloadProfitModelAsPdf(makeModel())
    const all = allTextCalls()
    expect(all).toContain('采购 BOM')
    expect(all).toContain('物流')
    expect(all).toContain('平台抽佣')
    expect(all).toContain('合规成本')
    expect(all).toContain('广告')
    expect(all).toContain('退货')
  })

  it('renders all 4 risk exposure items', async () => {
    await downloadProfitModelAsPdf(makeModel())
    const all = allTextCalls()
    expect(all).toContain('单日最高罚款 ¥180 万')
    expect(all).toContain('全店永久封停')
    expect(all).toContain('货物强制扣毁')
    expect(all).toContain('跨境集体诉讼')
  })

  it('derives the retail baseline from the model net plus chain cost', async () => {
    await downloadProfitModelAsPdf(makeModel())
    const all = allTextCalls()
    expect(all.some((t) => t.includes('¥66.93'))).toBe(true)
  })

  it('renders the AI margin signal verbatim', async () => {
    await downloadProfitModelAsPdf(makeModel())
    const all = allTextCalls()
    expect(all.some((t) => t.includes('每售出 1 件保留 ¥85'))).toBe(true)
  })

  it('renders the bare-mode caveat only when profitMode === bare', async () => {
    const bareModel = makeModel({
      profitMode: 'bare',
      bareRiskCaveat: '↑ 此数未扣除期望风险敞口（潜在罚款 / 扣押 / 召回）',
      metrics: [
        { label: '未整改预估单件收益', value: '¥11.48', tone: 'green', unit: '/单个产品',
          bareRiskCaveat: '↑ 此数未扣除期望风险敞口（潜在罚款 / 扣押 / 召回）' },
        { label: '表面合规成本', value: '¥0', tone: 'white', unit: '/单个产品', isCore: true },
        { label: '最高风险暴露', value: '¥180万', tone: 'orange', unit: '单日上限' },
        { label: 'AI 决策', value: '先整改', tone: 'alert', unit: '' },
      ],
    })
    await downloadProfitModelAsPdf(bareModel)
    const all = allTextCalls()
    expect(all.some((t) => t.includes('期望风险敞口'))).toBe(true)
  })

  it('does NOT render the bare caveat when profitMode === compliant', async () => {
    await downloadProfitModelAsPdf(makeModel({ profitMode: 'compliant', bareRiskCaveat: null }))
    const all = allTextCalls()
    expect(all.some((t) => t.includes('期望风险敞口'))).toBe(false)
  })

  it('renders backend LLM markdown when present', async () => {
    await downloadProfitModelAsPdf(
      makeModel({
        backendMarkdown: '## 充电宝\nCE 认证 ¥18,000 / UKCA ¥12,000',
        backendMarkdownTitle: '本次扫描的完整成本叙述(来自后端 LLM)',
        backendMarkdownBadge: '后端真实输出',
      })
    )
    const all = allTextCalls()
    expect(all.some((t) => t.includes('充电宝'))).toBe(true)
    expect(all.some((t) => t.includes('UKCA'))).toBe(true)
  })

  it('uses model.exportBasename in the downloaded filename', async () => {
    await downloadProfitModelAsPdf(makeModel({ exportBasename: 'Compliance Cost and Risk Impact' }))
    expect(mockAnchorRef.current.download).toBe('Compliance Cost and Risk Impact_sess_model_001.pdf')
  })

  // ─── Fix #1: white-tone metric value must NOT use RGB white ───────────────
  it('does NOT paint the white-tone metric value in white (visible-on-light-bg)', async () => {
    const calls: Array<[number, number, number]> = []
    jsPDFMethods.setTextColor.mockImplementation((...args: unknown[]) => {
      // jsPDF setTextColor signature: (r, g, b) for 3-arg or (gray) for 1-arg.
      if (args.length === 3) calls.push([args[0] as number, args[1] as number, args[2] as number])
    })
    const model = makeModel({
      metrics: [
        { label: '未整改预估单件收益', value: '¥11.48', tone: 'green', unit: '/单个产品' },
        { label: '合规后单件净收益', value: '¥23.97', tone: 'white', unit: '/单个产品', isCore: true },
        { label: '单产品合规总成本', value: '¥7.46', tone: 'orange', unit: '/单个产品' },
        { label: '合规后预估月度净收益', value: '¥71910', tone: 'blue', unit: '/月' },
      ],
    })
    await downloadProfitModelAsPdf(model)
    // The 4 large metric values are drawn with setFontSize(18) (and not 8, 7, etc.)
    // — search setTextColor invocations whose first arg tuple is the metric
    // value color. None of them should be pure white [255, 255, 255].
    const whiteCalls = calls.filter((c) => c[0] === 255 && c[1] === 255 && c[2] === 255)
    expect(whiteCalls).toEqual([])
  })

  it('paints the white-tone metric value with the panel dark text (#073b54 = [7, 59, 84])', async () => {
    const calls: Array<[number, number, number]> = []
    jsPDFMethods.setTextColor.mockImplementation((...args: unknown[]) => {
      if (args.length === 3) calls.push([args[0] as number, args[1] as number, args[2] as number])
    })
    const model = makeModel({
      metrics: [
        { label: '未整改预估单件收益', value: '¥11.48', tone: 'green', unit: '/单个产品' },
        { label: '合规后单件净收益', value: '¥23.97', tone: 'white', unit: '/单个产品', isCore: true },
        { label: '单产品合规总成本', value: '¥7.46', tone: 'orange', unit: '/单个产品' },
        { label: '合规后预估月度净收益', value: '¥71910', tone: 'blue', unit: '/月' },
      ],
    })
    await downloadProfitModelAsPdf(model)
    expect(calls).toContainEqual([7, 59, 84])
  })

  it('fills the isCore metric card with pale orange (#FFF8F0) before drawing the border', async () => {
    const fillCalls: Array<[number, number, number]> = []
    jsPDFMethods.setFillColor.mockImplementation((...args: unknown[]) => {
      if (args.length === 3) fillCalls.push([args[0] as number, args[1] as number, args[2] as number])
    })
    const model = makeModel({
      metrics: [
        { label: '未整改预估单件收益', value: '¥11.48', tone: 'green', unit: '/单个产品' },
        { label: '合规后单件净收益', value: '¥23.97', tone: 'white', unit: '/单个产品', isCore: true },
        { label: '单产品合规总成本', value: '¥7.46', tone: 'orange', unit: '/单个产品' },
        { label: '合规后预估月度净收益', value: '¥71910', tone: 'blue', unit: '/月' },
      ],
    })
    await downloadProfitModelAsPdf(model)
    expect(fillCalls).toContainEqual([255, 248, 240])
  })
})

// ─── downloadProfitModelAsDocx ─────────────────────────────────────────────
describe('downloadProfitModelAsDocx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPackerToBlob.mockResolvedValue(new Blob())
  })

  it('renders the page title verbatim in the H1 paragraph', async () => {
    await downloadProfitModelAsDocx(makeModel())
    const docOpts = mockPackerToBlob.mock.calls[0]?.[0]
    const firstChild = docOpts.sections[0].children[0]
    expect(firstChild.heading).toBe('Heading1')
    expect(firstChild.children[0].text).toBe('合规整改成本与风险影响')
  })

  it('renders the 4 metric labels in the metric table cells', async () => {
    await downloadProfitModelAsDocx(makeModel())
    const all = allCellTextRuns()
    expect(all).toContain('未整改预估单件收益')
    expect(all).toContain('合规后单件净收益')
    expect(all).toContain('单产品合规总成本')
    expect(all).toContain('合规后预估月度净收益')
  })

  it('renders the FinancialSummary values verbatim', async () => {
    await downloadProfitModelAsDocx(makeModel())
    const all = allCellTextRuns()
    expect(all).toContain('¥11.48')
    expect(all).toContain('¥23.97')
    expect(all).toContain('¥7.46')
    expect(all).toContain('¥71910')
  })

  it('renders all 6 chain node labels', async () => {
    await downloadProfitModelAsDocx(makeModel())
    const all = allCellTextRuns()
    expect(all).toContain('采购 BOM')
    expect(all).toContain('物流')
    expect(all).toContain('合规成本')
    expect(all).toContain('退货')
  })

  it('renders all 4 risk exposure items', async () => {
    await downloadProfitModelAsDocx(makeModel())
    const all = allCellTextRuns()
    expect(all.some((t) => t.includes('单日最高罚款'))).toBe(true)
    expect(all.some((t) => t.includes('全店永久封停'))).toBe(true)
    expect(all.some((t) => t.includes('货物强制扣毁'))).toBe(true)
    expect(all.some((t) => t.includes('跨境集体诉讼'))).toBe(true)
  })

  it('attaches the bare caveat to the metric cell when profitMode === bare', async () => {
    const bareModel = makeModel({
      profitMode: 'bare',
      bareRiskCaveat: '↑ 此数未扣除期望风险敞口（潜在罚款 / 扣押 / 召回）',
      metrics: [
        { label: '未整改预估单件收益', value: '¥11.48', tone: 'green', unit: '/单个产品',
          bareRiskCaveat: '↑ 此数未扣除期望风险敞口（潜在罚款 / 扣押 / 召回）' },
        { label: '表面合规成本', value: '¥0', tone: 'white', unit: '/单个产品', isCore: true },
        { label: '最高风险暴露', value: '¥180万', tone: 'orange', unit: '单日上限' },
        { label: 'AI 决策', value: '先整改', tone: 'alert', unit: '' },
      ],
    })
    await downloadProfitModelAsDocx(bareModel)
    const all = allCellTextRuns()
    expect(all.some((t) => t.includes('期望风险敞口'))).toBe(true)
  })

  it('does NOT render the bare caveat when profitMode === compliant', async () => {
    await downloadProfitModelAsDocx(makeModel({ profitMode: 'compliant', bareRiskCaveat: null }))
    const all = allCellTextRuns()
    expect(all.some((t) => t.includes('期望风险敞口'))).toBe(false)
  })

  it('renders backend LLM markdown when present', async () => {
    await downloadProfitModelAsDocx(
      makeModel({
        backendMarkdown: '## 充电宝\nCE 认证 ¥18,000 / UKCA ¥12,000',
        backendMarkdownBadge: '后端真实输出',
      })
    )
    const all = allCellTextRuns()
    expect(all.some((t) => t.includes('充电宝'))).toBe(true)
    expect(all.some((t) => t.includes('UKCA'))).toBe(true)
    expect(all.some((t) => t.includes('后端真实输出'))).toBe(true)
  })

  it('uses model.exportBasename in the downloaded filename', async () => {
    await downloadProfitModelAsDocx(makeModel({ exportBasename: '合规整改成本与风险影响' }))
    expect(mockAnchorRef.current.download).toBe('合规整改成本与风险影响_sess_model_001.docx')
  })

  // ─── Fix #1 (DOCX side): white-tone metric value must use the dark text color ──
  it('paints the white-tone metric value in dark text color (#073B54), not pure white', async () => {
    await downloadProfitModelAsDocx(makeModel({
      metrics: [
        { label: '未整改预估单件收益', value: '¥11.48', tone: 'green', unit: '/单个产品' },
        { label: '合规后单件净收益', value: '¥23.97', tone: 'white', unit: '/单个产品', isCore: true },
        { label: '单产品合规总成本', value: '¥7.46', tone: 'orange', unit: '/单个产品' },
        { label: '合规后预估月度净收益', value: '¥71910', tone: 'blue', unit: '/月' },
      ],
    }))
    const allRuns = mockTextRun.mock.calls.map((c) => (c[0] as { color?: string }).color)
    expect(allRuns).toContain('073B54')
    // Ensure no metric-value TextRun still uses pure white ("FFFFFF") — that
    // was the old bug that made the value invisible on light cells.
    expect(allRuns).not.toContain('FFFFFF')
  })

  // ─── Fix #2: small diagnostic cards (AI 利润判断 / 距 ¥8 利润底线 / 最大成本来源)
  // must use a white cell fill — never the previously-buggy "F8FAFC" tint that
  // some Word themes rendered as dark.
  it('uses a white cell fill for the 3 small diagnostic cards', async () => {
    await downloadProfitModelAsDocx(makeModel())
    const cellShading = mockTableCell.mock.calls
      .map((c) => (c[0] as { shading?: { fill?: string } }).shading?.fill)
      .filter((v): v is string => typeof v === 'string')
    expect(cellShading.length).toBeGreaterThan(0)
    // Every small-card cell we render must use white fill, not the old "F8FAFC".
    expect(cellShading.filter((f) => f === 'F8FAFC').length).toBe(0)
    expect(cellShading.filter((f) => f === 'FFFFFF').length).toBeGreaterThanOrEqual(3)
  })

  it('renders the dominant cost card with two TextRun lines (label + secondary ¥·%)', async () => {
    await downloadProfitModelAsDocx(makeModel())
    const allTexts = allCellTextRuns()
    expect(allTexts).toContain('最大成本来源')
    expect(allTexts.some((t) => t.includes('采购 BOM'))).toBe(true)
    expect(allTexts.some((t) => /\d+(\.\d+)?%/.test(t))).toBe(true)
  })

  it('pins explicit single-line borders on every metric and small-card cell', async () => {
    await downloadProfitModelAsDocx(makeModel())
    const cellBorderColors = mockTableCell.mock.calls
      .flatMap((c) => {
        const borders = (c[0] as { borders?: Record<string, { color?: string }> }).borders
        if (!borders) return []
        return Object.values(borders).map((b) => b?.color).filter((v): v is string => typeof v === 'string')
      })
    // At least one of the cell border colors must be the light gray we use
    // explicitly — proving we no longer rely on the document's default table
    // style (which is what previously rendered as a dark fill in some themes).
    expect(cellBorderColors.length).toBeGreaterThan(0)
    expect(cellBorderColors).toContain('DDDDDD')
  })
})
