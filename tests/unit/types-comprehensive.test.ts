/**
 * Comprehensive type tests - validates type guards and transformations
 */
import { describe, it, expect } from 'vitest'
import type {
  Market,
  ProductCategory,
  FlameLevel,
  Severity,
  ScoreGrade,
  ComplianceStatus,
  ScanStatus,
  ScanResult,
  ScanStatusResponse,
  StartScanRequest,
  ImageAsset,
  RegulationRef,
  RiskPoint,
  ChecklistItem,
} from '@/lib/types'

describe('Type Guards and Validators', () => {
  describe('Market type', () => {
    it('accepts valid markets', () => {
      const markets: Market[] = ['EU', 'US', 'UK', 'CN', 'AU', 'SA', 'AE', 'JP']
      markets.forEach(m => {
        expect(typeof m).toBe('string')
      })
    })
  })

  describe('ProductCategory type', () => {
    it('accepts valid categories', () => {
      const categories: ProductCategory[] = ['electronics', 'appliance', '3c', 'toy', 'home', 'other']
      categories.forEach(c => {
        expect(typeof c).toBe('string')
      })
    })
  })

  describe('FlameLevel type', () => {
    it('accepts valid levels', () => {
      const levels: FlameLevel[] = [1, 2, 3]
      levels.forEach(l => {
        expect(l).toBeGreaterThanOrEqual(1)
        expect(l).toBeLessThanOrEqual(3)
      })
    })
  })

  describe('Severity type', () => {
    it('accepts valid severities', () => {
      const severities: Severity[] = ['critical', 'warning', 'info']
      severities.forEach(s => {
        expect(['critical', 'warning', 'info'].includes(s)).toBe(true)
      })
    })
  })

  describe('ScoreGrade type', () => {
    it('accepts valid grades', () => {
      const grades: ScoreGrade[] = ['A', 'B', 'C', 'D']
      grades.forEach(g => {
        expect(['A', 'B', 'C', 'D'].includes(g)).toBe(true)
      })
    })
  })

  describe('ComplianceStatus type', () => {
    it('accepts valid statuses', () => {
      const statuses: ComplianceStatus[] = ['PASS', 'WARN', 'REJECTED', 'UNKNOWN']
      statuses.forEach(s => {
        expect(['PASS', 'WARN', 'REJECTED', 'UNKNOWN'].includes(s)).toBe(true)
      })
    })
  })

  describe('ScanStatus type', () => {
    it('accepts valid statuses', () => {
      const statuses: ScanStatus[] = ['pending', 'processing', 'ready', 'failed']
      statuses.forEach(s => {
        expect(['pending', 'processing', 'ready', 'failed'].includes(s)).toBe(true)
      })
    })
  })
})

describe('Object Creation and Transformation', () => {
  it('creates valid ImageAsset object', () => {
    const asset: ImageAsset = {
      imageId: 'img_001',
      url: '/uploads/test.jpg',
      thumbnail: '/uploads/test_thumb.jpg',
      width: 1920,
      height: 1080,
      angleHint: 'front',
    }
    expect(asset.imageId).toBe('img_001')
    expect(asset.width).toBe(1920)
    expect(asset.height).toBe(1080)
  })

  it('creates valid RegulationRef object', () => {
    const reg: RegulationRef = {
      regId: 'EU-CE-001',
      code: 'CE',
      name: 'CE 标识通用要求',
      nameEn: 'CE Marking General Requirements',
      market: 'EU',
      summary: '欧盟市场需要 CE 标识',
      sourceUrl: 'https://eur-lex.europa.eu/',
      severity: 'critical',
    }
    expect(reg.regId).toBe('EU-CE-001')
    expect(reg.market).toBe('EU')
    expect(reg.severity).toBe('critical')
  })

  it('creates valid RiskPoint object', () => {
    const risk: RiskPoint = {
      riskId: 'risk_001',
      title: '缺少 CE 标识',
      description: '产品铭牌未显示 CE 标识',
      severity: 'critical',
      flameLevel: 3,
      confidence: 0.95,
      imageId: 'img_001',
      bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
      regulations: [],
      recommendedAction: '补齐 CE 标识',
    }
    expect(risk.riskId).toBe('risk_001')
    expect(risk.severity).toBe('critical')
    expect(risk.confidence).toBe(0.95)
  })

  it('creates valid ChecklistItem object', () => {
    const item: ChecklistItem = {
      itemId: 'check_001',
      category: 'CE 认证',
      title: '准备技术文件',
      requiredMaterials: ['产品规格书', '测试报告'],
      recommendedLab: 'SGS',
      estimatedCost: '¥5000',
      estimatedTime: '2 周',
      isFree: false,
    }
    expect(item.itemId).toBe('check_001')
    expect(item.isFree).toBe(false)
    expect(item.requiredMaterials).toHaveLength(2)
  })

  it('creates valid ScanResult object', () => {
    const result: ScanResult = {
      sessionId: 'scan_001',
      scanTime: '2026-04-27T10:00:00.000Z',
      productCategory: 'electronics',
      productName: 'USB 加湿器',
      targetMarkets: ['EU', 'US'],
      complianceScore: 85,
      scoreGrade: 'B',
      complianceStatus: 'PASS',
      complianceReport: '# 合规报告\n\n产品符合要求。',
      images: [],
      documents: [],
      riskPoints: [],
      checklist: [],
      generatedAt: '2026-04-27T10:00:05.000Z',
      modelInfo: { ragProvider: 'test', latencyMs: 100 },
    }
    expect(result.sessionId).toBe('scan_001')
    expect(result.complianceScore).toBe(85)
    expect(result.complianceStatus).toBe('PASS')
  })

  it('creates valid StartScanRequest object', () => {
    const request: StartScanRequest = {
      category: 'electronics',
      markets: ['EU', 'US'],
      imageCount: 3,
      documentCount: 1,
    }
    expect(request.category).toBe('electronics')
    expect(request.markets).toHaveLength(2)
    expect(request.imageCount).toBe(3)
  })
})

describe('Nested Object Structures', () => {
  it('handles ScanStatusResponse with ready status', () => {
    const response: ScanStatusResponse = {
      sessionId: 'scan_001',
      status: 'ready',
      progress: 100,
      stageText: '完成',
      result: {
        sessionId: 'scan_001',
        scanTime: '2026-04-27T10:00:00.000Z',
        productCategory: 'electronics',
        productName: 'USB 加湿器',
        targetMarkets: ['EU'],
        complianceScore: 85,
        scoreGrade: 'B',
        complianceStatus: 'PASS',
        complianceReport: '# Report',
        images: [],
        documents: [],
        riskPoints: [],
        checklist: [],
        generatedAt: '2026-04-27T10:00:05.000Z',
        modelInfo: { ragProvider: 'test', latencyMs: 100 },
      },
    }
    expect(response.status).toBe('ready')
    expect(response.result).toBeDefined()
    expect(response.result?.complianceScore).toBe(85)
  })

  it('handles ScanStatusResponse with failed status', () => {
    const response: ScanStatusResponse = {
      sessionId: 'scan_001',
      status: 'failed',
      progress: 30,
      stageText: '扫描失败',
      error: 'Vision AI 服务不可用',
    }
    expect(response.status).toBe('failed')
    expect(response.error).toBe('Vision AI 服务不可用')
    expect(response.result).toBeUndefined()
  })
})
