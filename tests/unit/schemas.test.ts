import { describe, it, expect } from 'vitest'
import {
  MarketSchema,
  ProductCategorySchema,
  FlameLevelSchema,
  SeveritySchema,
  ScoreGradeSchema,
  BoundingBoxSchema,
  ImageAssetSchema,
  RegulationRefSchema,
  RiskPointSchema,
  ChecklistItemSchema,
  ScanResultSchema,
  ComplianceReportResultSchema,
  ScanStatusSchema,
  StartScanRequestSchema,
} from '@/lib/schemas'

describe('MarketSchema', () => {
  it('accepts valid markets', () => {
    expect(MarketSchema.parse('EU')).toBe('EU')
    expect(MarketSchema.parse('US')).toBe('US')
    expect(MarketSchema.parse('UK')).toBe('UK')
    expect(MarketSchema.parse('CN')).toBe('CN')
    expect(MarketSchema.parse('AU')).toBe('AU')
    expect(MarketSchema.parse('SA')).toBe('SA')
    expect(MarketSchema.parse('AE')).toBe('AE')
    expect(MarketSchema.parse('JP')).toBe('JP')
    expect(MarketSchema.parse('BR')).toBe('BR')
  })

  it('rejects invalid markets', () => {
    expect(() => MarketSchema.parse('XX')).toThrow()
    expect(() => MarketSchema.parse('')).toThrow()
  })
})

describe('ProductCategorySchema', () => {
  it('accepts valid categories', () => {
    const valid = ['electronics', 'appliance', '3c', 'toy', 'home', 'other']
    valid.forEach(cat => {
      expect(ProductCategorySchema.parse(cat)).toBe(cat)
    })
  })

  it('rejects invalid categories', () => {
    expect(() => ProductCategorySchema.parse('clothing')).toThrow()
  })
})

describe('FlameLevelSchema', () => {
  it('accepts valid levels', () => {
    expect(FlameLevelSchema.parse(1)).toBe(1)
    expect(FlameLevelSchema.parse(2)).toBe(2)
    expect(FlameLevelSchema.parse(3)).toBe(3)
  })

  it('rejects invalid levels', () => {
    expect(() => FlameLevelSchema.parse(0)).toThrow()
    expect(() => FlameLevelSchema.parse(4)).toThrow()
  })
})

describe('SeveritySchema', () => {
  it('accepts valid severities', () => {
    expect(SeveritySchema.parse('critical')).toBe('critical')
    expect(SeveritySchema.parse('warning')).toBe('warning')
    expect(SeveritySchema.parse('info')).toBe('info')
  })

  it('rejects invalid severities', () => {
    expect(() => SeveritySchema.parse('error')).toThrow()
  })
})

describe('ScoreGradeSchema', () => {
  it('accepts valid grades', () => {
    expect(ScoreGradeSchema.parse('A')).toBe('A')
    expect(ScoreGradeSchema.parse('B')).toBe('B')
    expect(ScoreGradeSchema.parse('C')).toBe('C')
    expect(ScoreGradeSchema.parse('D')).toBe('D')
  })

  it('rejects invalid grades', () => {
    expect(() => ScoreGradeSchema.parse('E')).toThrow()
  })
})

describe('BoundingBoxSchema', () => {
  it('accepts valid bbox', () => {
    const bbox = { x: 0.5, y: 0.5, w: 0.2, h: 0.3 }
    expect(BoundingBoxSchema.parse(bbox)).toEqual(bbox)
  })

  it('rejects bbox with values < 0', () => {
    expect(() => BoundingBoxSchema.parse({ x: -0.1, y: 0.5, w: 0.2, h: 0.3 })).toThrow()
  })

  it('rejects bbox with values > 1', () => {
    expect(() => BoundingBoxSchema.parse({ x: 0.5, y: 1.5, w: 0.2, h: 0.3 })).toThrow()
  })
})

describe('ImageAssetSchema', () => {
  it('accepts valid image asset', () => {
    const asset = {
      imageId: 'img_01',
      url: '/mock-fixtures/test.jpg',
      thumbnail: '/mock-fixtures/test_thumb.jpg',
      width: 1200,
      height: 900,
      angleHint: 'front',
    }
    expect(ImageAssetSchema.parse(asset)).toEqual(asset)
  })

  it('accepts asset without angleHint', () => {
    const asset = {
      imageId: 'img_01',
      url: '/mock-fixtures/test.jpg',
      thumbnail: '/mock-fixtures/test_thumb.jpg',
      width: 1200,
      height: 900,
    }
    expect(ImageAssetSchema.parse(asset)).toEqual(asset)
  })

  it('rejects asset with empty imageId', () => {
    const asset = {
      imageId: '',
      url: '/mock-fixtures/test.jpg',
      thumbnail: '/mock-fixtures/test_thumb.jpg',
      width: 1200,
      height: 900,
    }
    expect(() => ImageAssetSchema.parse(asset)).toThrow()
  })
})

describe('RegulationRefSchema', () => {
  it('accepts valid regulation reference', () => {
    const reg = {
      regId: 'EU-CE-001',
      code: 'CE',
      name: 'CE 标识通用要求',
      nameEn: 'CE Marking General Requirements',
      market: 'EU' as const,
      summary: '欧盟市场需要 CE 标识',
      sourceUrl: 'https://eur-lex.europa.eu/',
      severity: 'critical' as const,
    }
    expect(RegulationRefSchema.parse(reg)).toEqual(reg)
  })

  it('rejects invalid sourceUrl', () => {
    const reg = {
      regId: 'EU-CE-001',
      code: 'CE',
      name: 'CE 标识通用要求',
      market: 'EU' as const,
      summary: '欧盟市场需要 CE 标识',
      sourceUrl: 'not-a-url',
      severity: 'critical' as const,
    }
    expect(() => RegulationRefSchema.parse(reg)).toThrow()
  })
})

describe('RiskPointSchema', () => {
  it('accepts valid risk point', () => {
    const risk = {
      riskId: 'risk_01',
      title: '缺少 CE 标识',
      description: '产品铭牌未显示 CE 标识',
      severity: 'critical' as const,
      flameLevel: 1 as const,
      confidence: 0.95,
      imageId: 'img_01',
      bbox: { x: 0.3, y: 0.4, w: 0.2, h: 0.1 },
      regulations: [],
      recommendedAction: '补齐 CE 标识',
    }
    expect(RiskPointSchema.parse(risk)).toEqual(risk)
  })

  it('rejects confidence outside 0-1', () => {
    const risk = {
      riskId: 'risk_01',
      title: 'Test',
      description: 'Test description',
      severity: 'critical' as const,
      flameLevel: 1 as const,
      confidence: 1.5,
      imageId: 'img_01',
      bbox: { x: 0.3, y: 0.4, w: 0.2, h: 0.1 },
      regulations: [],
      recommendedAction: 'Test action',
    }
    expect(() => RiskPointSchema.parse(risk)).toThrow()
  })
})

describe('ChecklistItemSchema', () => {
  it('accepts valid checklist item', () => {
    const item = {
      itemId: 'check_01',
      category: 'CE 认证',
      title: '准备技术文件',
      requiredMaterials: ['产品规格书', '测试报告'],
      recommendedLab: 'SGS',
      estimatedCost: '¥5000',
      estimatedTime: '2 周',
      isFree: false,
    }
    expect(ChecklistItemSchema.parse(item)).toEqual(item)
  })

  it('accepts free item', () => {
    const item = {
      itemId: 'check_01',
      category: '标签整改',
      title: '补充多语言警示',
      requiredMaterials: ['包装图稿'],
      isFree: true,
    }
    expect(ChecklistItemSchema.parse(item)).toEqual(item)
  })
})

describe('ScanResultSchema', () => {
  it('accepts valid scan result', () => {
    const result = {
      sessionId: 'scan_01JXXXXX',
      scanTime: '2026-04-27T10:00:00.000Z',
      productCategory: 'electronics' as const,
      productName: 'USB 智能加湿器',
      targetMarkets: ['EU' as const, 'US' as const],
      complianceScore: 45,
      scoreGrade: 'D' as const,
      images: [],
      documents: [],
      riskPoints: [],
      checklist: [],
      generatedAt: '2026-04-27T10:00:05.000Z',
    }
    expect(ScanResultSchema.parse(result)).toEqual(result)
  })

  it('rejects complianceScore > 100', () => {
    const result = {
      sessionId: 'scan_01JXXXXX',
      scanTime: '2026-04-27T10:00:00.000Z',
      productCategory: 'electronics' as const,
      targetMarkets: ['EU' as const],
      complianceScore: 150,
      scoreGrade: 'D' as const,
      images: [],
      documents: [],
      riskPoints: [],
      checklist: [],
      generatedAt: '2026-04-27T10:00:05.000Z',
    }
    expect(() => ScanResultSchema.parse(result)).toThrow()
  })
})

describe('ScanStatusSchema', () => {
  it('accepts processing status', () => {
    const status = {
      sessionId: 'scan_01JXXXXX',
      status: 'processing' as const,
      progress: 30,
      stageText: '识别铭牌...',
    }
    expect(ScanStatusSchema.parse(status)).toEqual(status)
  })

  it('accepts ready status with result', () => {
    const status = {
      sessionId: 'scan_01JXXXXX',
      status: 'ready' as const,
      progress: 100,
      stageText: '完成',
      result: {
        sessionId: 'scan_01JXXXXX',
        scanTime: '2026-04-27T10:00:00.000Z',
        productCategory: 'electronics' as const,
        targetMarkets: ['EU' as const],
        complianceScore: 45,
        scoreGrade: 'D' as const,
        images: [],
        documents: [],
        riskPoints: [],
        checklist: [],
        generatedAt: '2026-04-27T10:00:05.000Z',
      },
    }
    expect(ScanStatusSchema.parse(status)).toEqual(status)
  })

  it('accepts ready status with compliance report result and profit scenarios', () => {
    const status = {
      sessionId: 'scan_01JXXXXX',
      status: 'ready' as const,
      progress: 100,
      stageText: '瀹屾垚',
      result: {
        sessionId: 'scan_01JXXXXX',
        scanTime: '2026-04-27T10:00:00.000Z',
        productCategory: 'electronics' as const,
        targetMarkets: ['EU' as const],
        complianceScore: 82,
        scoreGrade: 'B' as const,
        complianceReport: '## Report',
        complianceStatus: 'PASS' as const,
        agentTrace: [{ node: 'retrieve' }],
        loopCount: 1,
        retrievedChunks: [
          { regId: 'EU-LVD', docName: 'LVD', articleNo: 'Art. 4', region: 'EU', score: 0.91 },
        ],
        documents: [],
        generatedAt: '2026-04-27T10:00:05.000Z',
        modelInfo: { ragProvider: 'mimotalk', latencyMs: 3000 },
        source: 'fallback' as const,
      },
      profitReport: { sessionId: 'scan_01JXXXXX' },
      profitReports: [{ sessionId: 'scan_01JXXXXX', scenario: 'standard' }],
    }
    expect(ComplianceReportResultSchema.parse(status.result)).toEqual(status.result)
    expect(ScanStatusSchema.parse(status)).toEqual(status)
  })

  it('accepts failed status with error', () => {
    const status = {
      sessionId: 'scan_01JXXXXX',
      status: 'failed' as const,
      progress: 20,
      stageText: '扫描失败',
      error: 'Vision AI 服务不可用',
    }
    expect(ScanStatusSchema.parse(status)).toEqual(status)
  })

  it('rejects invalid status value', () => {
    const status = {
      sessionId: 'scan_01JXXXXX',
      status: 'unknown' as any,
      progress: 50,
      stageText: '测试',
    }
    expect(() => ScanStatusSchema.parse(status)).toThrow()
  })
})

describe('StartScanRequestSchema', () => {
  it('applies default values', () => {
    const request = StartScanRequestSchema.parse({
      imageCount: 3,
    })
    expect(request.category).toBe('electronics')
    expect(request.markets).toEqual(['EU', 'US'])
  })

  it('accepts valid request', () => {
    const request = StartScanRequestSchema.parse({
      category: 'appliance',
      markets: ['US', 'UK'],
      imageCount: 5,
    })
    expect(request.category).toBe('appliance')
    expect(request.markets).toEqual(['US', 'UK'])
    expect(request.imageCount).toBe(5)
  })

  it('rejects imageCount > 8', () => {
    expect(() => StartScanRequestSchema.parse({
      imageCount: 10,
    })).toThrow()
  })

  it('rejects imageCount < 1', () => {
    expect(() => StartScanRequestSchema.parse({
      imageCount: 0,
    })).toThrow()
  })
})

// SessionIdSchema + AccessTokenSchema added in the 16-round audit
// (June 2026) to harden [sessionId] routes against path-traversal
// and to lock the access-token contract. These tests pin those rules.

import { SessionIdSchema, AccessTokenSchema } from '@/lib/schemas'

describe('SessionIdSchema — guards [sessionId] dynamic routes', () => {
  it('accepts a valid ULID-style id', () => {
    const id = 'scan_01KVM7WF5EA6QFZGF68EFV1BBT'
    expect(SessionIdSchema.parse(id)).toBe(id)
  })

  it('accepts a generic valid id (alphanumeric + underscore)', () => {
    // SessionIdSchema is strict Crockford base32 (excludes I, L, O, U)
    // to match ULID format. The 26-char body is uppercase + digits only.
    // Use a real ULID: 01ARZ3NDEKTSV4RRFFQ69G5FAV
    const id = 'scan_01ARZ3NDEKTSV4RRFFQ69G5FAV'
    expect(SessionIdSchema.parse(id)).toBe(id)
  })

  it('rejects path-traversal attempts (the bug that caused 500s)', () => {
    expect(() => SessionIdSchema.parse('../etc/passwd')).toThrow()
    expect(() => SessionIdSchema.parse('..%2F..%2Fetc%2Fpasswd')).toThrow()
    expect(() => SessionIdSchema.parse('../../admin')).toThrow()
    expect(() => SessionIdSchema.parse('scan_/etc/passwd')).toThrow()
  })

  it('rejects empty / too short', () => {
    expect(() => SessionIdSchema.parse('')).toThrow()
    expect(() => SessionIdSchema.parse('scan_')).toThrow()
    expect(() => SessionIdSchema.parse('x')).toThrow()
  })

  it('rejects too long (DoS guard)', () => {
    expect(() => SessionIdSchema.parse('scan_' + 'a'.repeat(100))).toThrow()
  })

  it('rejects special chars', () => {
    expect(() => SessionIdSchema.parse('scan_<script>')).toThrow()
    expect(() => SessionIdSchema.parse('scan_a;b')).toThrow()
    expect(() => SessionIdSchema.parse('scan_a b')).toThrow() // space
  })
})

describe('AccessTokenSchema', () => {
  it('accepts a real base64url token (43-44 chars)', () => {
    const tok = 'cT5bdiCW4yKM5u2pomCHZIIUocVRLAGAp-k6a5bvoR0'
    expect(AccessTokenSchema.parse(tok)).toBe(tok)
  })

  it('rejects too short (DoS guard)', () => {
    expect(() => AccessTokenSchema.parse('short')).toThrow()
  })

  it('rejects too long (DoS guard)', () => {
    expect(() => AccessTokenSchema.parse('a'.repeat(200))).toThrow()
  })

  it('rejects non-base64url chars (e.g. +, /, =)', () => {
    expect(() => AccessTokenSchema.parse('abc+def/==')).toThrow()
    expect(() => AccessTokenSchema.parse('has space here')).toThrow()
  })
})
