/**
 * Mock scan result tests - covers mock data creation and transformations
 */
import { describe, it, expect } from 'vitest'
import {
  createMockScanResult,
  createMockProfitReport,
  mockScanResult,
  mockProfitReport,
} from '@/lib/mock/scan-result'

describe('Mock Scan Result', () => {
  it('creates valid mock scan result with default session', () => {
    const result = createMockScanResult()

    expect(result).toBeDefined()
    expect(result.sessionId).toBe('demo')
    expect(result.complianceScore).toBeGreaterThanOrEqual(0)
    expect(result.complianceScore).toBeLessThanOrEqual(100)
  })

  it('creates mock result with custom session id', () => {
    const result = createMockScanResult('custom_session')

    expect(result.sessionId).toBe('custom_session')
  })

  it('creates mock result with another session id', () => {
    const result = createMockScanResult('test_123')

    expect(result.sessionId).toBe('test_123')
  })

  it('includes required fields in mock result', () => {
    const result = createMockScanResult()

    expect(result).toHaveProperty('sessionId')
    expect(result).toHaveProperty('scanTime')
    expect(result).toHaveProperty('productCategory')
    expect(result).toHaveProperty('productName')
    expect(result).toHaveProperty('targetMarkets')
    expect(result).toHaveProperty('complianceScore')
    expect(result).toHaveProperty('scoreGrade')
    expect(result).toHaveProperty('images')
    expect(result).toHaveProperty('documents')
    expect(result).toHaveProperty('riskPoints')
    expect(result).toHaveProperty('generatedAt')
    expect(result).toHaveProperty('modelInfo')
  })

  it('has valid score grade', () => {
    const result = createMockScanResult()

    expect(['A', 'B', 'C', 'D'].includes(result.scoreGrade)).toBe(true)
  })

  it('has multiple target markets', () => {
    const result = createMockScanResult()

    expect(result.targetMarkets).toHaveLength(2)
    expect(result.targetMarkets).toContain('EU')
    expect(result.targetMarkets).toContain('US')
  })

  it('has valid product info', () => {
    const result = createMockScanResult()

    expect(result.productCategory).toBe('electronics')
    expect(result.productName).toBe('USB 智能加湿器')
  })

  it('has images array', () => {
    const result = createMockScanResult()

    expect(Array.isArray(result.images)).toBe(true)
    expect(result.images.length).toBeGreaterThan(0)
  })

  it('has documents array', () => {
    const result = createMockScanResult()

    expect(Array.isArray(result.documents)).toBe(true)
    expect(result.documents.length).toBeGreaterThan(0)
  })

  it('has risk points array', () => {
    const result = createMockScanResult()

    expect(Array.isArray(result.riskPoints)).toBe(true)
    expect(result.riskPoints.length).toBeGreaterThan(0)
  })

  it('has model info', () => {
    const result = createMockScanResult()

    expect(result.modelInfo).toBeDefined()
    expect(result.modelInfo).toHaveProperty('visionProvider')
    expect(result.modelInfo).toHaveProperty('latencyMs')
  })

  it('has scan time in ISO format', () => {
    const result = createMockScanResult()

    expect(result.scanTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('has generated at in ISO format', () => {
    const result = createMockScanResult()

    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })
})

describe('Mock Scan Result Exported Instance', () => {
  it('mockScanResult is defined', () => {
    expect(mockScanResult).toBeDefined()
  })

  it('mockScanResult has valid session id', () => {
    expect(mockScanResult.sessionId).toBe('demo')
  })

  it('mockScanResult can be used in tests', () => {
    expect(mockScanResult.complianceScore).toBeDefined()
    expect(mockScanResult.scoreGrade).toBeDefined()
  })
})

describe('Mock Profit Report', () => {
  it('creates valid mock profit report with default session', () => {
    const result = createMockProfitReport()

    expect(result).toBeDefined()
    expect(result.sessionId).toBe('demo')
    expect(result.report).toBeDefined()
    expect(typeof result.report).toBe('string')
  })

  it('creates profit report with custom session id', () => {
    const result = createMockProfitReport('custom_session')

    expect(result.sessionId).toBe('custom_session')
  })

  it('profit report contains markdown content', () => {
    const result = createMockProfitReport()

    expect(result.report).toContain('#')
  })

  it('profit report is not empty', () => {
    const result = createMockProfitReport()

    expect(result.report.length).toBeGreaterThan(0)
  })

  it('has product type', () => {
    const result = createMockProfitReport()

    expect(result.productType).toBe('USB 智能加湿器')
  })

  it('has market', () => {
    const result = createMockProfitReport()

    expect(result.market).toBe('EU')
  })

  it('has cost summary', () => {
    const result = createMockProfitReport()

    expect(result.barebone).toBeDefined()
    expect(result.compliant).toBeDefined()
  })
})

describe('Mock Profit Report Exported Instance', () => {
  it('mockProfitReport is defined', () => {
    expect(mockProfitReport).toBeDefined()
  })

  it('mockProfitReport has valid session id', () => {
    expect(mockProfitReport.sessionId).toBe('demo')
  })

  it('mockProfitReport has report content', () => {
    expect(mockProfitReport.report).toBeDefined()
    expect(mockProfitReport.report.length).toBeGreaterThan(0)
  })
})
