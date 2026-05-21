import { describe, it, expect, beforeEach } from 'vitest'
import { createSession, updateSession, getSession, clearStore } from '@/lib/pipeline/session-store'
import type { Market, ScanResult, ImageAsset, DocumentAsset, RiskPoint, ChecklistItem } from '@/lib/types'

describe('Session Store', () => {
  beforeEach(() => {
    clearStore()
  })

  describe('createSession', () => {
    it('creates a new session with initial state', () => {
      const session = createSession('test_session_1')

      expect(session.sessionId).toBe('test_session_1')
      expect(session.status).toBe('processing')
      expect(session.progress).toBe(0)
      expect(session.stageText).toBe('准备中…')
      expect(session.result).toBeUndefined()
      expect(session.error).toBeUndefined()
    })

    it('stores session in global map', () => {
      createSession('test_session_2')
      const stored = getSession('test_session_2')

      expect(stored).toBeDefined()
      expect(stored?.sessionId).toBe('test_session_2')
    })

    it('overwrites existing session with same id', () => {
      createSession('test_session_3')
      createSession('test_session_3')

      const store = globalThis.__scanStore
      const sessions = Array.from(store?.values() ?? [])
      const matching = sessions.filter(s => s.sessionId === 'test_session_3')

      expect(matching).toHaveLength(1)
    })
  })

  describe('updateSession', () => {
    it('updates session progress', () => {
      createSession('test_session_4')
      updateSession('test_session_4', { progress: 50 })

      const session = getSession('test_session_4')
      expect(session?.progress).toBe(50)
    })

    it('updates stage text', () => {
      createSession('test_session_5')
      updateSession('test_session_5', { stageText: '识别铭牌...' })

      const session = getSession('test_session_5')
      expect(session?.stageText).toBe('识别铭牌...')
    })

    it('updates status to ready', () => {
      createSession('test_session_6')
      updateSession('test_session_6', { status: 'ready' })

      const session = getSession('test_session_6')
      expect(session?.status).toBe('ready')
    })

    it('updates status to failed with error', () => {
      createSession('test_session_7')
      updateSession('test_session_7', {
        status: 'failed',
        error: 'Vision service unavailable'
      })

      const session = getSession('test_session_7')
      expect(session?.status).toBe('failed')
      expect(session?.error).toBe('Vision service unavailable')
    })

    it('attaches result when ready', () => {
      createSession('test_session_8')
      const mockResult: ScanResult = {
        sessionId: 'test_session_8',
        scanTime: '2026-04-27T10:00:00.000Z',
        productCategory: 'electronics',
        targetMarkets: ['EU'],
        complianceScore: 75,
        scoreGrade: 'B',
        images: [],
        documents: [],
        riskPoints: [],
        checklist: [],
        generatedAt: '2026-04-27T10:00:05.000Z',
      }

      updateSession('test_session_8', {
        status: 'ready',
        result: mockResult,
      })

      const session = getSession('test_session_8')
      expect(session?.status).toBe('ready')
      expect(session?.result).toBeDefined()
      expect(session?.result?.complianceScore).toBe(75)
    })

    it('does nothing for non-existent session', () => {
      // Should not throw
      updateSession('non_existent_session', { progress: 50 })

      const session = getSession('non_existent_session')
      expect(session).toBeUndefined()
    })

    it('merges partial updates', () => {
      createSession('test_session_9')
      updateSession('test_session_9', { progress: 30, stageText: '阶段1' })
      updateSession('test_session_9', { progress: 60, stageText: '阶段2' })

      const session = getSession('test_session_9')
      expect(session?.progress).toBe(60)
      expect(session?.stageText).toBe('阶段2')
    })
  })

  describe('getSession', () => {
    it('retrieves existing session', () => {
      createSession('test_session_10')
      const session = getSession('test_session_10')

      expect(session).toBeDefined()
      expect(session?.sessionId).toBe('test_session_10')
    })

    it('returns undefined for non-existent session', () => {
      const session = getSession('non_existent')
      expect(session).toBeUndefined()
    })

    it('retrieves updated session', () => {
      createSession('test_session_11')
      updateSession('test_session_11', {
        progress: 100,
        status: 'ready',
      })

      const session = getSession('test_session_11')
      expect(session?.progress).toBe(100)
      expect(session?.status).toBe('ready')
    })
  })

  describe('global store persistence', () => {
    it('reuses store across calls', () => {
      createSession('persistent_session')
      updateSession('persistent_session', { progress: 25 })

      // Simulate another "call" by getting the store directly
      const store = globalThis.__scanStore
      const session = store?.get('persistent_session')

      expect(session?.progress).toBe(25)
    })
  })
})