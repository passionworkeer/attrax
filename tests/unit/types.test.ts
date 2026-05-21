import { describe, it, expect } from 'vitest'
import type { ScanResult, ScanStatus, RiskPoint, ImageAsset } from '@/lib/types'

describe('Type definitions', () => {
  describe('ScanResult', () => {
    it('should have required fields', () => {
      const result: ScanResult = {
        sessionId: 'scan_01',
        scanTime: '2026-04-27T10:00:00.000Z',
        productCategory: 'electronics',
        targetMarkets: ['EU'],
        complianceScore: 50,
        scoreGrade: 'C',
        images: [],
        documents: [],
        riskPoints: [],
        checklist: [],
        generatedAt: '2026-04-27T10:00:05.000Z',
      }

      expect(result.sessionId).toBeDefined()
      expect(result.complianceScore).toBeGreaterThanOrEqual(0)
      expect(result.complianceScore).toBeLessThanOrEqual(100)
    })

    it('should support optional productName', () => {
      const result: ScanResult = {
        sessionId: 'scan_01',
        scanTime: '2026-04-27T10:00:00.000Z',
        productCategory: 'electronics',
        productName: 'USB 加湿器',
        targetMarkets: ['EU'],
        complianceScore: 50,
        scoreGrade: 'C',
        images: [],
        documents: [],
        riskPoints: [],
        checklist: [],
        generatedAt: '2026-04-27T10:00:05.000Z',
      }

      expect(result.productName).toBe('USB 加湿器')
    })
  })

  describe('ScanStatus', () => {
    it('should have processing status', () => {
      const status: ScanStatus = {
        sessionId: 'scan_01',
        status: 'processing',
        progress: 50,
        stageText: '正在分析...',
      }

      expect(status.status).toBe('processing')
      expect(status.result).toBeUndefined()
    })

    it('should have ready status with result', () => {
      const status: ScanStatus = {
        sessionId: 'scan_01',
        status: 'ready',
        progress: 100,
        stageText: '完成',
        result: {
          sessionId: 'scan_01',
          scanTime: '2026-04-27T10:00:00.000Z',
          productCategory: 'electronics',
          targetMarkets: ['EU'],
          complianceScore: 85,
          scoreGrade: 'B',
          images: [],
          documents: [],
          riskPoints: [],
          checklist: [],
          generatedAt: '2026-04-27T10:00:05.000Z',
        },
      }

      expect(status.status).toBe('ready')
      expect(status.result).toBeDefined()
    })

    it('should have failed status with error', () => {
      const status: ScanStatus = {
        sessionId: 'scan_01',
        status: 'failed',
        progress: 20,
        stageText: '失败',
        error: '服务不可用',
      }

      expect(status.status).toBe('failed')
      expect(status.error).toBeDefined()
    })
  })

  describe('RiskPoint', () => {
    it('should support critical severity', () => {
      const risk: RiskPoint = {
        riskId: 'risk_01',
        title: '缺少 CE 标识',
        description: '产品需要 CE 标识',
        severity: 'critical',
        flameLevel: 3,
        confidence: 0.95,
        imageId: 'img_01',
        bbox: { x: 0.3, y: 0.4, w: 0.2, h: 0.1 },
        regulations: [],
        recommendedAction: '补齐 CE 标识',
      }

      expect(risk.severity).toBe('critical')
      expect(risk.flameLevel).toBe(3)
    })

    it('should support warning severity', () => {
      const risk: RiskPoint = {
        riskId: 'risk_02',
        title: '标签不完整',
        description: '警示标签需要补充',
        severity: 'warning',
        flameLevel: 2,
        confidence: 0.75,
        imageId: 'img_01',
        bbox: { x: 0.5, y: 0.6, w: 0.1, h: 0.1 },
        regulations: [],
        recommendedAction: '补充警示标签',
      }

      expect(risk.severity).toBe('warning')
    })

    it('should support info severity', () => {
      const risk: RiskPoint = {
        riskId: 'risk_03',
        title: '建议优化',
        description: '可以考虑优化',
        severity: 'info',
        flameLevel: 1,
        confidence: 0.5,
        imageId: 'img_01',
        bbox: { x: 0, y: 0, w: 0.1, h: 0.1 },
        regulations: [],
        recommendedAction: '可选优化',
      }

      expect(risk.severity).toBe('info')
    })
  })

  describe('ImageAsset', () => {
    it('should support front angle hint', () => {
      const asset: ImageAsset = {
        imageId: 'img_01',
        url: '/uploads/test.jpg',
        thumbnail: '/uploads/test_thumb.jpg',
        width: 1200,
        height: 900,
        angleHint: 'front',
      }

      expect(asset.angleHint).toBe('front')
    })

    it('should support nameplate angle hint', () => {
      const asset: ImageAsset = {
        imageId: 'img_02',
        url: '/uploads/nameplate.jpg',
        thumbnail: '/uploads/nameplate_thumb.jpg',
        width: 800,
        height: 600,
        angleHint: 'nameplate',
      }

      expect(asset.angleHint).toBe('nameplate')
    })

    it('should support optional angle hint', () => {
      const asset: ImageAsset = {
        imageId: 'img_03',
        url: '/uploads/generic.jpg',
        thumbnail: '/uploads/generic_thumb.jpg',
        width: 1200,
        height: 900,
      }

      expect(asset.angleHint).toBeUndefined()
    })
  })
})