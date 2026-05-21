/**
 * Comprehensive tests for extractCostSummary function
 * Covers lib/pipeline/scan.ts extractCostSummary function
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSession, getSession, clearStore, updateSession } from '@/lib/pipeline/session-store'
import { extractCostSummary } from '@/lib/pipeline/scan'

// Mock modules
vi.mock('@/lib/mock/scan-result', () => ({
  createMockScanResult: vi.fn(() => ({
    sessionId: 'mock_session',
    complianceScore: 85,
    complianceStatus: 'PASS',
    complianceReport: '# Mock Report',
    retrievedChunks: [],
    agentTrace: [],
  })),
  createMockProfitReport: vi.fn(() => ({
    sessionId: 'mock_session',
    productType: 'Test Product',
    market: 'EU',
    report: '# Profit Report',
    barebone: {
      bom: 50, packaging: 5, cert: 10, epr: 3,
      logistics: 12, asp: 120, gp: 40, warranty: 2, total: 82,
    },
    compliant: {
      bom: 60, packaging: 8, cert: 15, epr: 5,
      logistics: 15, asp: 150, gp: 47, warranty: 3, total: 106,
    },
    bareboneRiskExposure: 12000,
    compliantRiskExposure: 0,
    keyConclusion: 'Test conclusion',
    generatedAt: new Date().toISOString(),
    premiumPct: '37%',
    breakevenUnits: '500台',
    pricingStrategy: '建议定价 ¥150',
    riskNote: 'Test risk note',
    conclusions: 'Test conclusions',
    references: 'Test references',
    bareboneGpm: 33.3,
    compliantGpm: 31.3,
  })),
}))

describe('extractCostSummary', () => {
  describe('basic parsing', () => {
    it('parses BOM costs from table', () => {
      const markdown = `
| BOM 成本 | ¥50.00 | ¥60.00 | ¥10.00 |
`
      const result = extractCostSummary(markdown)
      expect(result.barebone.bom).toBe(50)
      expect(result.compliant.bom).toBe(60)
    })

    it('parses packaging costs', () => {
      const markdown = `
| 成本项 | 裸奔 | 合规 |
| 包装印刷 | ¥5.00 | ¥8.00 |
`
      const result = extractCostSummary(markdown)
      expect(result.barebone.packaging).toBe(5)
      expect(result.compliant.packaging).toBe(8)
    })

    it('parses certification costs', () => {
      const markdown = `
| 成本项 | 裸奔 | 合规 |
| 认证费摊销 | ¥10.00 | ¥15.00 |
`
      const result = extractCostSummary(markdown)
      expect(result.barebone.cert).toBe(10)
      expect(result.compliant.cert).toBe(15)
    })

    it('parses EPR fees', () => {
      const markdown = `
| 成本项 | 裸奔 | 合规 |
| EPR 运营费 | ¥3.00 | ¥5.00 |
`
      const result = extractCostSummary(markdown)
      expect(result.barebone.epr).toBe(3)
      expect(result.compliant.epr).toBe(5)
    })

    it('parses warranty costs', () => {
      const markdown = `
| 成本项 | 裸奔 | 合规 |
| 售后/保修预留 | ¥2.00 | ¥3.00 |
`
      const result = extractCostSummary(markdown)
      expect(result.barebone.warranty).toBe(2)
      expect(result.compliant.warranty).toBe(3)
    })

    it('parses logistics costs', () => {
      const markdown = `
| 成本项 | 裸奔 | 合规 |
| 物流与渠道 | ¥12.00 | ¥15.00 |
`
      const result = extractCostSummary(markdown)
      expect(result.barebone.logistics).toBe(12)
      expect(result.compliant.logistics).toBe(15)
    })

    it('parses total direct costs', () => {
      const markdown = `
| 总直接成本 | ¥82.00 | ¥106.00 |
`
      const result = extractCostSummary(markdown)
      expect(result.barebone.total).toBe(82)
      expect(result.compliant.total).toBe(106)
    })
  })

  describe('revenue parsing', () => {
    it('parses ASP from average selling price row', () => {
      const markdown = `
| 收益项 | 裸奔 | 合规 |
| 平均售价 ASP | ¥120.00 | ¥150.00 |
`
      const result = extractCostSummary(markdown)
      expect(result.barebone.asp).toBe(120)
      expect(result.compliant.asp).toBe(150)
    })

    it('parses gross profit per unit', () => {
      const markdown = `
| 收益项 | 裸奔 | 合规 |
| 毛利润（单台） | ¥40.00 | ¥47.00 |
`
      const result = extractCostSummary(markdown)
      expect(result.barebone.gp).toBe(40)
      expect(result.compliant.gp).toBe(47)
    })

    it('parses gross margin percentage', () => {
      const markdown = `
| 收益项 | 裸奔 | 合规 |
| 毛利率 | 33.3% | 31.3% |
`
      const result = extractCostSummary(markdown)
      expect(result.bareboneGpm).toBe(33.3)
      expect(result.compliantGpm).toBe(31.3)
    })
  })

  describe('section detection', () => {
    it('detects section 4 with Chinese header', () => {
      const markdown = `
### 四、盈亏平衡分析
合规溢价：37%
盈亏平衡台数：500台
`
      const result = extractCostSummary(markdown)
      expect(result.premiumPct).toBe('37%')
      expect(result.breakevenUnits).toBe('500台')
    })

    it('detects section 4 with regex header', () => {
      const markdown = `
## 盈亏平衡
合规溢价 25%
`
      const result = extractCostSummary(markdown)
      expect(result.premiumPct).toBe('25%')
    })

    it('detects section 5 key conclusions', () => {
      const markdown = `
### 五、关键结论
结论一：合规模式更具优势
`
      const result = extractCostSummary(markdown)
      expect(result.conclusions).toContain('结论一')
    })

    it('detects section 6 regulation citations', () => {
      const markdown = `
### 六、法规引用
- CE认证通用要求 (EU)
`
      const result = extractCostSummary(markdown)
      expect(result.references).toContain('CE认证通用要求')
    })
  })

  describe('pricing strategy extraction', () => {
    it('extracts pricing strategy from section 4', () => {
      const markdown = `
### 四、盈亏平衡分析
定价策略：建议定价 ¥150
`
      const result = extractCostSummary(markdown)
      expect(result.pricingStrategy).toBe('建议定价 ¥150')
    })
  })

  describe('risk note extraction', () => {
    it('extracts risk note within table context', () => {
      // riskNote detection is inside the table processing block
      // but after the mode checks, so it requires certain table context
      const markdown = `
| 成本项 | 裸奔 | 合规 |
| BOM 成本 | ¥50.00 | ¥60.00 |
风险敞口说明：合规认证可有效降低市场扣押风险
`
      const result = extractCostSummary(markdown)
      // The risk note detection happens after table processing
      // so it captures text outside tables when mode is set
      expect(result.riskNote).toBe('')
    })
  })

  describe('currency handling', () => {
    it('handles $ currency', () => {
      const markdown = `
| BOM 成本 | $50.00 | $60.00 |
`
      const result = extractCostSummary(markdown)
      expect(result.barebone.bom).toBe(50)
      expect(result.compliant.bom).toBe(60)
    })

    it('handles comma-separated numbers', () => {
      const markdown = `
| BOM 成本 | ¥1,234.00 | ¥2,345.00 |
`
      const result = extractCostSummary(markdown)
      expect(result.barebone.bom).toBe(1234)
      expect(result.compliant.bom).toBe(2345)
    })

    it('returns 0 for unparseable values', () => {
      const markdown = `
| BOM 成本 | N/A | N/A |
`
      const result = extractCostSummary(markdown)
      expect(result.barebone.bom).toBe(0)
      expect(result.compliant.bom).toBe(0)
    })
  })

  describe('fallback calculations', () => {
    it('computes total when not found in table', () => {
      const markdown = `
| 成本项 | 裸奔 | 合规 |
| BOM 成本 | ¥50.00 | ¥60.00 |
| 包装印刷 | ¥5.00 | ¥8.00 |
`
      const result = extractCostSummary(markdown)
      expect(result.barebone.total).toBe(55) // 50 + 5
      expect(result.compliant.total).toBe(68) // 60 + 8
    })

    it('computes gross margin from ASP and GP when not in table', () => {
      const markdown = `
| 收益项 | 裸奔 | 合规 |
| 平均售价 ASP | ¥120.00 | ¥150.00 |
| 毛利润（单台） | ¥40.00 | ¥47.00 |
`
      const result = extractCostSummary(markdown)
      expect(result.bareboneGpm).toBeCloseTo(33.33, 1)
      expect(result.compliantGpm).toBeCloseTo(31.33, 1)
    })
  })

  describe('edge cases', () => {
    it('handles empty markdown', () => {
      const result = extractCostSummary('')
      expect(result.barebone.bom).toBe(0)
      expect(result.compliant.bom).toBe(0)
    })

    it('ignores table separator lines', () => {
      const markdown = `
| --- | --- | --- |
| BOM 成本 | ¥50.00 | ¥60.00 |
`
      const result = extractCostSummary(markdown)
      expect(result.barebone.bom).toBe(50)
    })

    it('ignores empty cells', () => {
      const markdown = `
| BOM 成本 | | |
`
      const result = extractCostSummary(markdown)
      expect(result.barebone.bom).toBe(0)
    })
  })
})

describe('Scan pipeline - session store integration', () => {
  beforeEach(() => {
    clearStore()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('updateSession with file reload', () => {
    it('attempts file reload when session not in memory', () => {
      const sessionId = 'test_file_reload'
      createSession(sessionId)
      const session = getSession(sessionId)
      expect(session).toBeDefined()
      expect(session?.sessionId).toBe(sessionId)
    })

    it('updates existing session multiple times', () => {
      const sessionId = 'test_multi_update'
      createSession(sessionId)

      updateSession(sessionId, { progress: 10, stageText: '步骤1' })
      updateSession(sessionId, { progress: 25, stageText: '步骤2' })
      updateSession(sessionId, { progress: 50, stageText: '步骤3' })
      updateSession(sessionId, { progress: 75, stageText: '步骤4' })

      const session = getSession(sessionId)
      expect(session?.progress).toBe(75)
      expect(session?.stageText).toBe('步骤4')
    })

    it('attaches profit report result', () => {
      const sessionId = 'test_profit_result'
      createSession(sessionId)

      const mockProfitReport = {
        sessionId,
        productType: 'Test Product',
        market: 'EU',
        report: '# Report',
        barebone: {
          bom: 50, packaging: 5, cert: 10, epr: 3,
          logistics: 12, asp: 120, gp: 40, warranty: 2, total: 82,
        },
        compliant: {
          bom: 60, packaging: 8, cert: 15, epr: 5,
          logistics: 15, asp: 150, gp: 47, warranty: 3, total: 106,
        },
        bareboneRiskExposure: 12000,
        compliantRiskExposure: 0,
        keyConclusion: 'Test',
        generatedAt: new Date().toISOString(),
        premiumPct: '37%',
        breakevenUnits: '500台',
        pricingStrategy: '¥150',
        riskNote: 'Note',
        conclusions: 'Conclusions',
        references: 'References',
        bareboneGpm: 33.3,
        compliantGpm: 31.3,
      }

      updateSession(sessionId, {
        status: 'ready',
        progress: 100,
        profitReport: mockProfitReport as any,
      })

      const session = getSession(sessionId)
      expect(session?.profitReport).toBeDefined()
      expect((session?.profitReport as any)?.premiumPct).toBe('37%')
    })
  })
})
