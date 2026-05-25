import { describe, it, expect } from 'vitest'
import type { 
  ComplianceReportResult, 
  ProfitReportResult, 
  CostSummary,
  DocumentAsset,
  RegulationRef
} from '@/lib/types'

describe('ComplianceReportResult type', () => {
  it('has required fields', () => {
    const result: ComplianceReportResult = {
      sessionId: 'scan_01',
      scanTime: '2026-04-27T10:00:00.000Z',
      productCategory: 'electronics',
      targetMarkets: ['EU'],
      complianceScore: 85,
      scoreGrade: 'B',
      complianceReport: '# 报告标题\n\n内容...',
      complianceStatus: 'PASS',
      agentTrace: [{ node: 'start' }],
      loopCount: 0,
      retrievedChunks: [],
      documents: [],
      generatedAt: '2026-04-27T10:00:05.000Z',
      modelInfo: { ragProvider: 'mock', latencyMs: 100 }
    }
    expect(result.sessionId).toBe('scan_01')
    expect(result.complianceStatus).toBe('PASS')
    expect(result.complianceReport).toContain('报告标题')
  })

  it('supports WARN status', () => {
    const result: ComplianceReportResult = {
      sessionId: 'scan_01',
      scanTime: '2026-04-27T10:00:00.000Z',
      productCategory: 'electronics',
      targetMarkets: ['EU'],
      complianceScore: 60,
      scoreGrade: 'C',
      complianceReport: '报告内容',
      complianceStatus: 'WARN',
      agentTrace: [],
      loopCount: 1,
      retrievedChunks: [],
      documents: [],
      generatedAt: '2026-04-27T10:00:05.000Z',
      modelInfo: { ragProvider: 'mock', latencyMs: 100 }
    }
    expect(result.complianceStatus).toBe('WARN')
  })

  it('supports REJECTED status', () => {
    const result: ComplianceReportResult = {
      sessionId: 'scan_01',
      scanTime: '2026-04-27T10:00:00.000Z',
      productCategory: 'electronics',
      targetMarkets: ['EU'],
      complianceScore: 30,
      scoreGrade: 'D',
      complianceReport: '报告内容',
      complianceStatus: 'REJECTED',
      agentTrace: [],
      loopCount: 2,
      retrievedChunks: [],
      documents: [],
      generatedAt: '2026-04-27T10:00:05.000Z',
      modelInfo: { ragProvider: 'mock', latencyMs: 100 }
    }
    expect(result.complianceStatus).toBe('REJECTED')
  })

  it('tracks loop count', () => {
    const result: ComplianceReportResult = {
      sessionId: 'scan_01',
      scanTime: '2026-04-27T10:00:00.000Z',
      productCategory: 'electronics',
      targetMarkets: ['EU'],
      complianceScore: 85,
      scoreGrade: 'B',
      complianceReport: '报告',
      complianceStatus: 'PASS',
      agentTrace: [],
      loopCount: 3,
      retrievedChunks: [],
      documents: [],
      generatedAt: '2026-04-27T10:00:05.000Z',
      modelInfo: { ragProvider: 'mock', latencyMs: 100 }
    }
    expect(result.loopCount).toBe(3)
  })
})

describe('CostSummary type', () => {
  it('has all cost fields', () => {
    const costs: CostSummary = {
      bom: 50,
      packaging: 5,
      cert: 10,
      epr: 3,
      logistics: 15,
      asp: 200,
      gp: 117,
      warranty: 5,
      total: 88
    }
    expect(costs.bom).toBe(50)
    expect(costs.asp).toBe(200)
    expect(costs.total).toBe(88)
  })
})

describe('ProfitReportResult type', () => {
  it('has required fields', () => {
    const result: ProfitReportResult = {
      sessionId: 'scan_01',
      productType: 'electronics',
      market: 'EU',
      report: '# 成本利润分析报告',
      barebone: { bom: 50, packaging: 5, cert: 0, epr: 0, logistics: 15, asp: 100, gp: 30, warranty: 0, total: 70 },
      compliant: { bom: 60, packaging: 8, cert: 15, epr: 5, logistics: 15, asp: 150, gp: 47, warranty: 5, total: 108 },
      bareboneRiskExposure: 10000,
      compliantRiskExposure: 500,
      keyConclusion: '合规经营更划算',
      generatedAt: '2026-04-27T10:00:05.000Z',
      premiumPct: '37%',
      breakevenUnits: '100',
      pricingStrategy: '建议溢价销售',
      riskNote: '风险敞口说明',
      conclusions: '结论章节',
      references: '引用章节',
      bareboneGpm: 30,
      compliantGpm: 28
    }
    expect(result.bareboneRiskExposure).toBe(10000)
    expect(result.compliantRiskExposure).toBe(500)
    expect(result.premiumPct).toBe('37%')
  })

  it('calculates margin differences', () => {
    const result: ProfitReportResult = {
      sessionId: 'scan_01',
      productType: 'electronics',
      market: 'EU',
      report: '报告',
      barebone: { bom: 50, packaging: 5, cert: 0, epr: 0, logistics: 15, asp: 100, gp: 30, warranty: 0, total: 70 },
      compliant: { bom: 60, packaging: 8, cert: 15, epr: 5, logistics: 15, asp: 150, gp: 47, warranty: 5, total: 108 },
      bareboneRiskExposure: 10000,
      compliantRiskExposure: 500,
      keyConclusion: '结论',
      generatedAt: '2026-04-27T10:00:05.000Z',
      premiumPct: '50%',
      breakevenUnits: '50',
      pricingStrategy: '溢价',
      riskNote: '风险',
      conclusions: '结论',
      references: '引用',
      bareboneGpm: 30,
      compliantGpm: 31.3
    }
    expect(result.bareboneGpm).toBe(30)
    expect(result.compliantGpm).toBe(31.3)
  })
})

describe('DocumentAsset type', () => {
  it('supports pdf document type', () => {
    const doc: DocumentAsset = {
      documentId: 'doc_01',
      name: '规格书.pdf',
      size: 1024,
      type: 'pdf',
      mimeType: 'application/pdf',
      url: '/uploads/spec.pdf'
    }
    expect(doc.type).toBe('pdf')
  })

  it('supports docx document type', () => {
    const doc: DocumentAsset = {
      documentId: 'doc_02',
      name: '证书.docx',
      size: 2048,
      type: 'docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      url: '/uploads/cert.docx'
    }
    expect(doc.type).toBe('docx')
  })

  it('supports html document type', () => {
    const doc: DocumentAsset = {
      documentId: 'doc_03',
      name: '网页.html',
      size: 512,
      type: 'html',
      mimeType: 'text/html',
      url: '/uploads/page.html'
    }
    expect(doc.type).toBe('html')
  })
})

describe('RegulationRef type', () => {
  it('has required fields', () => {
    const reg: RegulationRef = {
      regId: 'EU-CE-001',
      code: 'CE',
      name: 'CE 标识通用要求',
      market: 'EU',
      summary: '欧盟市场需要 CE 标识',
      sourceUrl: 'https://eur-lex.europa.eu/ce-directive',
      severity: 'critical'
    }
    expect(reg.regId).toBe('EU-CE-001')
    expect(reg.severity).toBe('critical')
  })

  it('supports optional english name', () => {
    const reg: RegulationRef = {
      regId: 'EU-CE-001',
      code: 'CE',
      name: 'CE 标识通用要求',
      nameEn: 'CE Marking General Requirements',
      market: 'EU',
      summary: '欧盟市场需要 CE 标识',
      sourceUrl: 'https://eur-lex.europa.eu/ce-directive',
      severity: 'critical'
    }
    expect(reg.nameEn).toBe('CE Marking General Requirements')
  })
})
