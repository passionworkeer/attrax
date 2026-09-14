/**
 * Unit tests for `lib/report-export-modules/profit-render-model.ts`
 *
 * Covers the unified ProfitRenderModel that backs both the `/profit/[sessionId]`
 * page and the PDF/DOCX export buttons. The whole point of this model is that
 * a downloaded report reads byte-for-byte the same as the page the user just
 * saw — so the tests below pin down:
 *
 *   - title / subtitle for zh & en locales
 *   - 4 metric cards in both `bare` and `compliant` modes
 *   - bare-mode caveat renders only when profitMode === "bare"
 *   - 6 chain cost nodes (with retail baseline = 128) for both modes
 *   - cost board diagnostic strings
 *   - risk exposure items (4 entries, with icon rotation)
 *   - backend LLM markdown block only when synthesized
 *   - localized filename basename (exportBasename)
 *   - currency symbol detection from FinancialSummary
 */
import { describe, expect, it } from 'vitest'
import type { ScanResult } from '@/lib/types'
import type { FinancialSummary } from '@/lib/types.blaze-hawks'
import {
  buildProfitRenderModel,
} from '@/lib/report-export-modules/profit-render-model'

function makeScanResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    retailBaseline: 66.93,
    bareRetailBaseline: 54.44,
    sessionId: 'sess_test_001',
    scanTime: '2026-07-21T10:00:00.000Z',
    productName: '便携式蓝牙音箱',
    productNameEn: 'Portable Bluetooth Speaker',
    targetMarkets: ['EU', 'US'],
    productCategory: 'electronics',
    images: [],
    documents: [],
    generatedAt: '2026-07-21T10:00:00.000Z',
    complianceScore: 78,
    scoreGrade: 'B',
    riskPoints: [],
    checklist: [],
    ...overrides,
  }
}

function makeFinancialSummary(overrides: Partial<FinancialSummary> = {}): FinancialSummary {
  return {
    estimatedHeroicProfit: '¥11.48',
    trueNetProfit: '¥23.97',
    complianceCost: '¥7.46',
    monthlyNetProfit: '¥71910',
    targetVolumeLabel: '销量基准 3,000 台 / 月',
    riskExposureItems: [
      '罚款金额取决于违法行为与辖区，未提供适用罚则，不作数字估算',
      '全店永久封停',
      '货物强制扣毁',
      '跨境集体诉讼',
    ],
    costBreakdown: [
      { itemId: 'cost_01', label: '采购 BOM（壳料 + PCB + 电池）', amount: '¥18.50', detail: '壳料 + PCB + 电池等原材料采购' },
      { itemId: 'cost_02', label: '物流头程 + 尾程', amount: '¥12.00', detail: '头程海运/空运 + 尾程派送' },
      { itemId: 'cost_03', label: '平台抽佣', amount: '—', detail: '亚马逊 / 主流平台抽佣(已折入 total)' },
      { itemId: 'cost_04', label: '合规成本', amount: '¥7.46', detail: '认证 + EPR + 标签整改一次性费用摊销' },
      { itemId: 'cost_05', label: '广告与营销', amount: '—', detail: '品牌投放 + 站内推广(已折入 total)' },
      { itemId: 'cost_06', label: '退货与售后预留', amount: '¥5.00', detail: '退货 + 售后保修预留' },
    ],
    ...overrides,
  }
}

// ─── Title & subtitle ──────────────────────────────────────────────────────
describe('buildProfitRenderModel — header', () => {
  it('uses page-style title in Chinese locale', () => {
    const m = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: makeFinancialSummary(),
      profitMode: 'compliant',
      locale: 'zh',
    })
    expect(m.title).toBe('合规整改成本与风险影响')
  })

  it('uses English title when locale is en', () => {
    const m = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: makeFinancialSummary(),
      profitMode: 'compliant',
      locale: 'en',
    })
    expect(m.title).toBe('Compliance Cost and Risk Impact')
  })

  it('builds subtitle from market · product · target volume in zh', () => {
    const m = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: makeFinancialSummary(),
      profitMode: 'compliant',
      locale: 'zh',
    })
    expect(m.subtitle).toBe('EU+US 市场 · 便携式蓝牙音箱 · 销量基准 3,000 台 / 月')
  })

  it('builds subtitle in en using English product name and English volume label', () => {
    const m = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: makeFinancialSummary({ targetVolumeLabelEn: 'Baseline volume 3,000 units / month' }),
      profitMode: 'compliant',
      locale: 'en',
    })
    expect(m.subtitle).toBe('EU+US market · Portable Bluetooth Speaker · Baseline volume 3,000 units / month')
  })

  it('picks English product name when locale is en', () => {
    const m = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: makeFinancialSummary(),
      profitMode: 'compliant',
      locale: 'en',
    })
    expect(m.productName).toBe('Portable Bluetooth Speaker')
  })
})

// ─── Currency detection ────────────────────────────────────────────────────
describe('buildProfitRenderModel — currency', () => {
  it('detects ¥ from FinancialSummary amounts', () => {
    const m = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: makeFinancialSummary(),
      profitMode: 'compliant',
      locale: 'zh',
    })
    expect(m.currencySymbol).toBe('¥')
  })

  it('detects $ when trueNetProfit uses $', () => {
    const m = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: makeFinancialSummary({
        estimatedHeroicProfit: '$3.59',
        trueNetProfit: '$11.48',
        complianceCost: '$7.46',
        monthlyNetProfit: '$34,440',
      }),
      profitMode: 'compliant',
      locale: 'en',
    })
    expect(m.currencySymbol).toBe('$')
  })
})

// ─── 4 metric cards (compliant mode) ───────────────────────────────────────
describe('buildProfitRenderModel — metric cards (compliant)', () => {
  it('renders 4 cards in compliant mode with the documented labels', () => {
    const m = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: makeFinancialSummary(),
      profitMode: 'compliant',
      locale: 'zh',
    })
    expect(m.metrics).toHaveLength(4)
    expect(m.metrics[0]!.label).toBe('未整改预估单件收益')
    expect(m.metrics[0]!.value).toBe('¥11.48')
    expect(m.metrics[0]!.tone).toBe('green')
    expect(m.metrics[0]!.unit).toBe('/单个产品')
    expect(m.metrics[0]!.bareRiskCaveat).toBeUndefined()

    expect(m.metrics[1]!.label).toBe('合规后单件净收益')
    expect(m.metrics[1]!.value).toBe('¥23.97')
    expect(m.metrics[1]!.isCore).toBe(true)

    expect(m.metrics[2]!.label).toBe('单产品合规总成本')
    expect(m.metrics[2]!.value).toBe('¥7.46')

    expect(m.metrics[3]!.label).toBe('合规后预估月度净收益')
    expect(m.metrics[3]!.value).toBe('¥71910')
  })

  it('renders English labels when locale is en', () => {
    const m = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: makeFinancialSummary(),
      profitMode: 'compliant',
      locale: 'en',
    })
    expect(m.metrics[0]!.label).toBe('Estimated Net Before Remediation')
    expect(m.metrics[1]!.label).toBe('Net After Compliance')
    expect(m.metrics[3]!.unit).toBe('/month')
  })
})

// ─── 4 metric cards (bare mode) + bare caveat ─────────────────────────────
describe('buildProfitRenderModel — metric cards (bare)', () => {
  // J07 (2026-09-14 §4.6): fine figures need jurisdiction/violation/source
  // inputs; the exposure card now states 待确认 instead of ¥180万.
  it('renders the bare-mode card set: heroic / ¥0 / 待确认 / 先整改', () => {
    const m = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: makeFinancialSummary(),
      profitMode: 'bare',
      locale: 'zh',
    })
    expect(m.metrics).toHaveLength(4)
    expect(m.metrics[0]!.value).toBe('¥11.48') // estimatedHeroicProfit carried over
    expect(m.metrics[1]!.value).toBe('¥0')      // surface compliance cost
    expect(m.metrics[1]!.isCore).toBe(true)     // featured card in bare mode
    expect(m.metrics[2]!.value).toBe('待确认')
    expect(m.metrics[3]!.value).toBe('先整改')
    expect(m.metrics[3]!.tone).toBe('alert')
  })

  it('J07 regression: bare-mode export never carries a hard-coded fine figure', () => {
    for (const locale of ['zh', 'en'] as const) {
      const m = buildProfitRenderModel({
        result: makeScanResult(),
        financialSummary: makeFinancialSummary(),
        profitMode: 'bare',
        locale,
      })
      const joined = [
        ...m.metrics.map((card) => `${card.label}|${card.value}|${card.unit ?? ''}`),
        ...m.riskExposureItems.map((item) => item.label),
      ].join('|')
      expect(joined).not.toContain('¥180万')
      expect(joined).not.toContain('¥1.8M')
      expect(joined).not.toContain('单日最高罚款')
      expect(joined).not.toContain('Daily maximum fine')
    }
  })

  it('attaches the bare-risk caveat only to the first card in bare mode', () => {
    const m = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: makeFinancialSummary(),
      profitMode: 'bare',
      locale: 'zh',
    })
    expect(m.metrics[0]!.bareRiskCaveat).toBe(
      '↑ 此数未扣除期望风险敞口（潜在罚款 / 扣押 / 召回）'
    )
    expect(m.bareRiskCaveat).toBe('↑ 此数未扣除期望风险敞口（潜在罚款 / 扣押 / 召回）')
    // Other cards in bare mode must NOT carry the caveat.
    expect(m.metrics[1]!.bareRiskCaveat).toBeFalsy()
    expect(m.metrics[2]!.bareRiskCaveat).toBeFalsy()
    expect(m.metrics[3]!.bareRiskCaveat).toBeFalsy()
  })

  it('omits the bare-risk caveat entirely in compliant mode', () => {
    const m = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: makeFinancialSummary(),
      profitMode: 'compliant',
      locale: 'zh',
    })
    expect(m.bareRiskCaveat).toBeNull()
    m.metrics.forEach((card) => {
      expect(card.bareRiskCaveat).toBeFalsy()
    })
  })

  it('renders the English bare-mode caveat when locale is en', () => {
    const m = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: makeFinancialSummary(),
      profitMode: 'bare',
      locale: 'en',
    })
    expect(m.metrics[0]!.bareRiskCaveat).toBe(
      '↑ Does not deduct expected risk exposure (potential fines, seizure, recall)'
    )
  })

  it('keeps the selected bare scenario costs intact', () => {
    const m = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: makeFinancialSummary(),
      profitMode: 'bare',
      locale: 'zh',
    })
    expect(m.chainNodes[3]!.label).toContain('合规成本')
    expect(m.chainNodes[3]!.amount).toBe(7.46)
  })

  it('keeps all chain nodes populated in compliant mode', () => {
    const m = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: makeFinancialSummary(),
      profitMode: 'compliant',
      locale: 'zh',
    })
    expect(m.chainNodes[3]!.amount).toBe(7.46)
  })
})

// ─── Chain cost / cost board / retail baseline ────────────────────────────
describe('buildProfitRenderModel — cost chain', () => {
  it('uses the financial summary baseline instead of a hard-coded value', () => {
    const m = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: makeFinancialSummary(),
      profitMode: 'compliant',
      locale: 'zh',
    })
    expect(m.costBoard.retailBaselineLabel).toBe('售价基线 ¥66.93')
  })

  it('computes finalNetNumber as retail baseline − total chain cost', () => {
    const m = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: makeFinancialSummary(),
      profitMode: 'compliant',
      locale: 'zh',
    })
    // Total chain cost = 18.5 + 12 + 0 + 7.46 + 0 + 5 = 42.96
    // finalNet = 66.93 − 42.96 = 23.97
    expect(m.costBoard.finalNetNumber).toBeCloseTo(23.97, 2)
  })

  it('emits marginSignal that flips wording when finalNetShare crosses 10%', () => {
    const high = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: makeFinancialSummary(),
      profitMode: 'compliant',
      locale: 'zh',
    })
    expect(high.costBoard.finalNetShare).toBeGreaterThan(10)
    expect(high.costBoard.marginSignal).toContain('接近健康线')

    const low = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: makeFinancialSummary({
        retailBaseline: 130,
        costBreakdown: [
          { itemId: 'cost_01', label: 'A', amount: '¥120', detail: 'd1' },
          { itemId: 'cost_02', label: 'B', amount: '¥5', detail: 'd2' },
          { itemId: 'cost_03', label: 'C', amount: '—', detail: 'd3' },
          { itemId: 'cost_04', label: 'D', amount: '¥0.50', detail: 'd4' },
          { itemId: 'cost_05', label: 'E', amount: '—', detail: 'd5' },
          { itemId: 'cost_06', label: 'F', amount: '¥1', detail: 'd6' },
        ],
      }),
      profitMode: 'compliant',
      locale: 'zh',
    })
    expect(low.costBoard.finalNetShare).toBeLessThan(10)
    expect(low.costBoard.marginSignal).toContain('仍需谨慎')
  })

  it('identifies the largest cost driver from the chain', () => {
    const m = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: makeFinancialSummary(),
      profitMode: 'compliant',
      locale: 'zh',
    })
    expect(m.costBoard.dominantCost.label).toContain('BOM')
    expect(m.costBoard.dominantCost.amountLabel).toBe('¥19')
    expect(m.costBoard.dominantCost.shareLabel).toMatch(/^\d+\.\d+%$/)
  })
})

// ─── Risk exposure items ──────────────────────────────────────────────────
describe('buildProfitRenderModel — risk exposure', () => {
  it('emits the same 4 strings the UI page renders', () => {
    const m = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: makeFinancialSummary(),
      profitMode: 'compliant',
      locale: 'zh',
    })
    // J07: qualitative exposure — no invented fine figure in the list.
    expect(m.riskExposureItems.map((r) => r.label)).toEqual([
      '罚款金额取决于违法行为与辖区，未提供适用罚则，不作数字估算',
      '全店永久封停',
      '货物强制扣毁',
      '跨境集体诉讼',
    ])
  })

  it('rotates icons: gavel / xcircle / shield / gavel (matches page.tsx)', () => {
    const m = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: makeFinancialSummary(),
      profitMode: 'compliant',
      locale: 'zh',
    })
    expect(m.riskExposureItems.map((r) => r.icon)).toEqual([
      'gavel',
      'xcircle',
      'shield',
      'gavel',
    ])
  })

  it('falls back to riskExposureItems when en variant is missing', () => {
    const m = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: makeFinancialSummary(),
      profitMode: 'compliant',
      locale: 'en',
    })
    // No riskExposureItemsEn in the fixture → falls back to the zh list.
    expect(m.riskExposureItems).toHaveLength(4)
  })

  it('uses riskExposureItemsEn when present and locale is en', () => {
    const m = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: makeFinancialSummary({
        riskExposureItemsEn: [
          'Fine amounts depend on violation and jurisdiction',
          'Permanent store suspension',
          'Mandatory cargo seizure',
          'Cross-border class action',
        ],
      }),
      profitMode: 'compliant',
      locale: 'en',
    })
    expect(m.riskExposureItems.map((r) => r.label)).toEqual([
      'Fine amounts depend on violation and jurisdiction',
      'Permanent store suspension',
      'Mandatory cargo seizure',
      'Cross-border class action',
    ])
  })
})

// ─── Stacked bar legend ────────────────────────────────────────────────────
describe('buildProfitRenderModel — stacked bar legend', () => {
  it('contains one entry per chain node plus a final-net entry', () => {
    const m = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: makeFinancialSummary(),
      profitMode: 'compliant',
      locale: 'zh',
    })
    expect(m.stackLegend).toHaveLength(7) // 6 chain + 1 final
    const finalEntry = m.stackLegend[m.stackLegend.length - 1]!
    expect(finalEntry.isFinal).toBe(true)
    expect(finalEntry.label).toBe('最终净利润')
  })
})

// ─── Backend LLM section (synthesized-only) ────────────────────────────────
describe('buildProfitRenderModel — backend LLM block', () => {
  it('omits backendMarkdown by default (caller does not pass __includeBackendMarkdown)', () => {
    const m = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: makeFinancialSummary(),
      profitMode: 'compliant',
      locale: 'zh',
    })
    expect(m.backendMarkdown).toBeNull()
  })

  it('attaches backendMarkdown only when summary carries __includeBackendMarkdown=true', () => {
    const fs = makeFinancialSummary() as FinancialSummary & {
      _backendMarkdown?: string
      __includeBackendMarkdown?: boolean
    }
    fs._backendMarkdown = '## 后端 LLM 输出\n真实成本分析: 充电宝 ¥11.48 / 单件'
    fs.__includeBackendMarkdown = true
    const m = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: fs,
      profitMode: 'compliant',
      locale: 'zh',
    })
    expect(m.backendMarkdown).toContain('后端 LLM 输出')
    expect(m.backendMarkdownBadge).toBe('后端真实输出')
    expect(m.backendMarkdownTitle).toContain('完整成本叙述')
  })

  it('renders English backend badge when locale is en', () => {
    const fs = makeFinancialSummary() as FinancialSummary & {
      _backendMarkdown?: string
      __includeBackendMarkdown?: boolean
    }
    fs._backendMarkdown = '## Backend LLM\nReal cost: $11.48 / unit'
    fs.__includeBackendMarkdown = true
    const m = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: fs,
      profitMode: 'compliant',
      locale: 'en',
    })
    expect(m.backendMarkdownBadge).toBe('Real backend output')
    expect(m.backendMarkdownTitle).toContain('Full cost narrative')
  })
})

// ─── Filename / exportBasename ─────────────────────────────────────────────
describe('buildProfitRenderModel — export filename', () => {
  it('localizes the export basename', () => {
    const zh = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: makeFinancialSummary(),
      profitMode: 'compliant',
      locale: 'zh',
    })
    const en = buildProfitRenderModel({
      result: makeScanResult(),
      financialSummary: makeFinancialSummary(),
      profitMode: 'compliant',
      locale: 'en',
    })
    expect(zh.exportBasename).toBe('合规整改成本与风险影响')
    expect(en.exportBasename).toBe('Compliance Cost and Risk Impact')
  })
})

// ─── Session meta passthrough ──────────────────────────────────────────────
describe('buildProfitRenderModel — session meta', () => {
  it('passes through sessionId and generatedAt unchanged', () => {
    const m = buildProfitRenderModel({
      result: makeScanResult({ sessionId: 'sess_xyz', generatedAt: '2026-07-21T10:00:00.000Z' }),
      financialSummary: makeFinancialSummary(),
      profitMode: 'compliant',
      locale: 'zh',
    })
    expect(m.sessionId).toBe('sess_xyz')
    expect(m.generatedAt).toBe('2026-07-21T10:00:00.000Z')
  })
})
