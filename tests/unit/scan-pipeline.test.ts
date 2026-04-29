import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { runScan } from '@/lib/pipeline/scan'
import { createSession, getSession, clearStore } from '@/lib/pipeline/session-store'

describe('Scan Pipeline', () => {
  beforeEach(() => {
    clearStore()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('runScan', () => {
    it('updates session to failed when real pipeline not available', async () => {
      const sessionId = 'test_pipeline_session'
      createSession(sessionId)

      const runPromise = runScan(sessionId, {
        images: [{
          buffer: Buffer.from('fake image data'),
          originalName: 'test.jpg',
          mimeType: 'image/jpeg',
        }],
        category: 'electronics',
        markets: ['EU'],
      })

      vi.advanceTimersByTime(2000)
      await runPromise

      const session = getSession(sessionId)
      expect(session?.status).toBe('failed')
      expect(session?.error).toContain('真实 Vision 管线')
    })

    it('accepts different product categories', async () => {
      const categories = ['electronics', 'appliance', '3c', 'toy', 'home', 'other'] as const

      for (const category of categories) {
        const sessionId = `test_${category}`
        createSession(sessionId)

        const runPromise = runScan(sessionId, {
          images: [{
            buffer: Buffer.from('test'),
            originalName: 'test.jpg',
            mimeType: 'image/jpeg',
          }],
          category,
          markets: ['EU'],
        })

        vi.advanceTimersByTime(2000)
        await runPromise

        const session = getSession(sessionId)
        expect(session).toBeDefined()
      }
    })

    it('accepts different market combinations', async () => {
      const marketsList = [
        ['EU'],
        ['US'],
        ['UK'],
        ['EU', 'US'],
        ['EU', 'US', 'UK'],
      ]

      for (const markets of marketsList) {
        const sessionId = `test_markets_${markets.join('_')}`
        createSession(sessionId)

        const runPromise = runScan(sessionId, {
          images: [{
            buffer: Buffer.from('test'),
            originalName: 'test.jpg',
            mimeType: 'image/jpeg',
          }],
          category: 'electronics',
          markets,
        })

        vi.advanceTimersByTime(2000)
        await runPromise

        const session = getSession(sessionId)
        expect(session).toBeDefined()
      }
    })

    it('handles empty images array', async () => {
      const sessionId = 'test_empty_images'
      createSession(sessionId)

      const runPromise = runScan(sessionId, {
        images: [],
        category: 'electronics',
        markets: ['EU'],
      })

      vi.advanceTimersByTime(2000)
      await runPromise

      const session = getSession(sessionId)
      expect(session?.status).toBe('failed')
    })
  })
})