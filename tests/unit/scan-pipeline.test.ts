import { describe, it, expect, beforeEach, afterEach, vi, afterAll } from 'vitest'
import { runScan } from '@/lib/pipeline/scan'
import { createSession, getSession, clearStore } from '@/lib/pipeline/session-store'

const MOCK_BODY = {
  status: 'PASS' as const,
  report: '# 报告\n合规通过',
  agent_trace: [{ node: 'retrieve', duration_ms: 120, docs_retrieved: 5, status: 'done' }],
  loop_count: 0,
  documents: [
    { id: 'reg1', doc_name: 'RoHS指令', article_no: 'Art.4', region: 'EU', score: 0.95 },
  ],
}

// Stable fetch mock that always resolves — avoids per-call exhaustion
function mockFetch(body = MOCK_BODY, status = 200) {
  return vi.spyOn(global, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status })
  )
}

describe('Scan Pipeline', () => {
  beforeEach(() => {
    clearStore()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  afterAll(() => {
    vi.useRealTimers()
  })

  describe('runScan', () => {
    it('updates session to failed when rag-service is unreachable', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValueOnce(new TypeError('network error'))

      const sessionId = 'test_network_error'
      createSession(sessionId)

      await runScan(sessionId, {
        images: [{ buffer: Buffer.from('fake'), originalName: 'test.jpg', mimeType: 'image/jpeg' }],
        category: 'electronics',
        markets: ['EU'],
      })

      const session = getSession(sessionId)
      expect(session?.status).toBe('failed')
      expect(session?.error).toBeTruthy()
    })

    it('maps PASS status to ready session', async () => {
      mockFetch({ ...MOCK_BODY, status: 'PASS' })

      const sessionId = 'test_pass'
      createSession(sessionId)

      await runScan(sessionId, {
        images: [{ buffer: Buffer.from('test'), originalName: 'test.jpg', mimeType: 'image/jpeg' }],
        category: 'electronics',
        markets: ['EU'],
      })

      const session = getSession(sessionId)
      expect(session?.status).toBe('ready')
      expect(session?.progress).toBe(100)
    })

    it('maps WARN status to ready session', async () => {
      mockFetch({ ...MOCK_BODY, status: 'WARN' })

      const sessionId = 'test_warn'
      createSession(sessionId)

      await runScan(sessionId, {
        images: [{ buffer: Buffer.from('test'), originalName: 'test.jpg', mimeType: 'image/jpeg' }],
        category: 'toy',
        markets: ['EU', 'US'],
      })

      const session = getSession(sessionId)
      expect(session?.status).toBe('ready')
    })

    it('maps REJECTED status to ready session', async () => {
      mockFetch({ ...MOCK_BODY, status: 'REJECTED' })

      const sessionId = 'test_rejected'
      createSession(sessionId)

      await runScan(sessionId, {
        images: [{ buffer: Buffer.from('test'), originalName: 'test.jpg', mimeType: 'image/jpeg' }],
        category: 'electronics',
        markets: ['UK'],
      })

      const session = getSession(sessionId)
      expect(session?.status).toBe('ready')
    })

    it('accepts all product categories', async () => {
      const categories = ['electronics', 'appliance', '3c', 'toy', 'home', 'other'] as const
      for (const category of categories) {
        mockFetch() // each call gets its own spy
        const sessionId = `test_${category}`
        createSession(sessionId)
        await runScan(sessionId, {
          images: [{ buffer: Buffer.from('test'), originalName: 'test.jpg', mimeType: 'image/jpeg' }],
          category,
          markets: ['EU'],
        })
        const session = getSession(sessionId)
        expect(session?.status).toBe('ready')
      }
    })

    it('accepts all market combinations', async () => {
      const marketsList = [['EU'], ['US'], ['UK'], ['EU', 'US'], ['EU', 'US', 'UK']]
      for (const markets of marketsList) {
        mockFetch()
        const sessionId = `test_markets_${markets.join('_')}`
        createSession(sessionId)
        await runScan(sessionId, {
          images: [{ buffer: Buffer.from('test'), originalName: 'test.jpg', mimeType: 'image/jpeg' }],
          category: 'electronics',
          markets,
        })
        const session = getSession(sessionId)
        expect(session?.status).toBe('ready')
      }
    })

    it('handles empty images array', async () => {
      mockFetch()

      const sessionId = 'test_empty_images'
      createSession(sessionId)

      await runScan(sessionId, {
        images: [],
        category: 'electronics',
        markets: ['EU'],
      })

      const session = getSession(sessionId)
      expect(session?.status).toBe('ready')
    })

    it('stores compliance report result in session', async () => {
      mockFetch()

      const sessionId = 'test_result'
      createSession(sessionId)

      await runScan(sessionId, {
        images: [{ buffer: Buffer.from('test'), originalName: 'test.jpg', mimeType: 'image/jpeg' }],
        category: 'electronics',
        markets: ['EU'],
      })

      const session = getSession(sessionId)
      expect(session?.result).toBeDefined()
      const result = session?.result as Record<string, unknown>
      expect(result).toHaveProperty('complianceReport')
      expect(result).toHaveProperty('complianceStatus', 'PASS')
      expect(result).toHaveProperty('agentTrace')
      expect(result).toHaveProperty('retrievedChunks')
      expect(Array.isArray(result?.retrievedChunks)).toBe(true)
    })
  })
})
