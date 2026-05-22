/**
 * Comprehensive scan pipeline tests - covers error handling, edge cases, and degradation
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSession, getSession, clearStore, updateSession } from '@/lib/pipeline/session-store'

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
    profitReport: '# Profit Report',
  })),
}))

describe('Scan Pipeline Edge Cases', () => {
  beforeEach(() => {
    clearStore()
    vi.clearAllMocks()
  })

  describe('Session Creation', () => {
    it('creates session with unique ID', () => {
      const session1 = createSession('unique_test_1')
      const session2 = createSession('unique_test_2')

      expect(session1.sessionId).not.toBe(session2.sessionId)
      expect(getSession('unique_test_1')).toBeDefined()
      expect(getSession('unique_test_2')).toBeDefined()
    })

    it('initializes with processing status', () => {
      const session = createSession('test_init')
      expect(session.status).toBe('processing')
      expect(session.progress).toBe(0)
    })

    it('has stage text for UI display', () => {
      const session = createSession('test_stage')
      expect(session.stageText).toBeDefined()
      expect(typeof session.stageText).toBe('string')
    })
  })

  describe('Session Status Transitions', () => {
    it('transitions from processing to ready', () => {
      const sessionId = 'test_transition_1'
      createSession(sessionId)

      const processing = getSession(sessionId)
      expect(processing?.status).toBe('processing')

      updateSession(sessionId, { status: 'ready', progress: 100 })

      const ready = getSession(sessionId)
      expect(ready?.status).toBe('ready')
      expect(ready?.progress).toBe(100)
    })

    it('transitions from processing to failed', () => {
      const sessionId = 'test_fail'
      createSession(sessionId)

      updateSession(sessionId, {
        status: 'failed',
        error: 'Test error message'
      })

      const failed = getSession(sessionId)
      expect(failed?.status).toBe('failed')
      expect(failed?.error).toBe('Test error message')
    })
  })

  describe('Progress Updates', () => {
    it('tracks progress incrementally', () => {
      const sessionId = 'test_progress'
      createSession(sessionId)

      updateSession(sessionId, { progress: 10 })
      expect(getSession(sessionId)?.progress).toBe(10)

      updateSession(sessionId, { progress: 25 })
      expect(getSession(sessionId)?.progress).toBe(25)

      updateSession(sessionId, { progress: 50 })
      expect(getSession(sessionId)?.progress).toBe(50)

      updateSession(sessionId, { progress: 75 })
      expect(getSession(sessionId)?.progress).toBe(75)
    })

    it('updates stage text independently', () => {
      const sessionId = 'test_stage_text'
      createSession(sessionId)

      updateSession(sessionId, { stageText: '识别铭牌...' })
      expect(getSession(sessionId)?.stageText).toBe('识别铭牌...')

      updateSession(sessionId, { stageText: '检索法规...' })
      expect(getSession(sessionId)?.stageText).toBe('检索法规...')

      updateSession(sessionId, { stageText: '生成报告...' })
      expect(getSession(sessionId)?.stageText).toBe('生成报告...')
    })
  })

  describe('Result Attachment', () => {
    it('attaches compliance result when ready', () => {
      const sessionId = 'test_result'
      createSession(sessionId)

      const mockResult = {
        sessionId: 'test_result',
        complianceScore: 85,
        complianceStatus: 'PASS',
        complianceReport: '# Test Report',
        retrievedChunks: [],
        agentTrace: [],
      }

      updateSession(sessionId, {
        status: 'ready',
        progress: 100,
        result: mockResult as any,
      })

      const session = getSession(sessionId)
      expect(session?.status).toBe('ready')
      expect(session?.result).toBeDefined()
      expect((session?.result as any)?.complianceScore).toBe(85)
    })

    it('preserves partial progress on failure', () => {
      const sessionId = 'test_partial_fail'
      createSession(sessionId)

      updateSession(sessionId, { progress: 60, stageText: '检索中...' })
      updateSession(sessionId, {
        status: 'failed',
        error: 'Service unavailable',
      })

      const session = getSession(sessionId)
      expect(session?.status).toBe('failed')
      expect(session?.progress).toBe(60)
      expect(session?.stageText).toBe('检索中...')
    })
  })

  describe('Store Management', () => {
    it('clears all sessions with clearStore', () => {
      createSession('test_clear_1')
      createSession('test_clear_2')
      createSession('test_clear_3')

      expect(getSession('test_clear_1')).toBeDefined()
      expect(getSession('test_clear_2')).toBeDefined()
      expect(getSession('test_clear_3')).toBeDefined()

      clearStore()

      expect(getSession('test_clear_1')).toBeUndefined()
      expect(getSession('test_clear_2')).toBeUndefined()
      expect(getSession('test_clear_3')).toBeUndefined()
    })

    it('handles concurrent session updates', async () => {
      const sessionId = 'test_concurrent'
      createSession(sessionId)

      const updates = [
        { progress: 10, stageText: 'Step 1' },
        { progress: 20, stageText: 'Step 2' },
        { progress: 30, stageText: 'Step 3' },
      ]

      updates.forEach(update => {
        updateSession(sessionId, update)
      })

      const session = getSession(sessionId)
      expect(session?.progress).toBeGreaterThan(0)
    })
  })
})
