import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createSession,
  updateSession,
  getSession,
  publicSession,
  clearStore,
} from '@/lib/pipeline/session-store'
import type { ScanStatus } from '@/lib/types'
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync, readdirSync, rmdirSync } from 'fs'
import { join } from 'path'

const fsMock = vi.hoisted(() => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  rmdirSync: vi.fn(),
}))

// Mock fs module
vi.mock('fs', () => ({
  ...fsMock,
  default: fsMock,
}))

function isSessionPath(path: unknown): boolean {
  return String(path).replace(/\\/g, '/').includes('data/sessions')
}

const mockMkdirSync = vi.mocked(mkdirSync)
const mockWriteFileSync = vi.mocked(writeFileSync)
const mockReadFileSync = vi.mocked(readFileSync)
const mockUnlinkSync = vi.mocked(unlinkSync)
const mockExistsSync = vi.mocked(existsSync)
const mockReaddirSync = vi.mocked(readdirSync)

describe('Session Store', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    clearStore()
    // Default: session dir does not exist
    mockExistsSync.mockReturnValue(false)
    mockReaddirSync.mockReturnValue([])
  })

  afterEach(() => {
    clearStore()
    vi.restoreAllMocks()
  })

  describe('createSession', () => {
    it('rejects invalid session ids during file lookup', () => {
      expect(() => getSession('../bad')).toThrow('Invalid sessionId')
    })

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

    it('persists session to file', () => {
      createSession('test_persist')

      expect(mockMkdirSync).toHaveBeenCalled()
      expect(mockWriteFileSync).toHaveBeenCalled()
    })

    it('sets TTL timer', () => {
      const originalSetTimeout = globalThis.setTimeout
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

      createSession('test_timer')

      expect(setTimeoutSpy).toHaveBeenCalled()
      expect(clearTimeoutSpy).not.toHaveBeenCalled()
    })

    it('clears existing timer when recreating session', () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

      // Create first session
      createSession('test_recreate')

      const firstTimer = setTimeoutSpy.mock.results[0].value

      // Create again with same id
      createSession('test_recreate')

      // clearTimeout should be called with the first timer
      expect(clearTimeoutSpy).toHaveBeenCalledWith(firstTimer)
    })

    it('overwrites existing session with same id', () => {
      createSession('test_session_3')
      createSession('test_session_3')

      const store = globalThis.__scanStore
      const sessions = Array.from(store?.values() ?? [])
      const matching = sessions.filter(s => s.sessionId === 'test_session_3')

      expect(matching).toHaveLength(1)
    })

    it('cleans up file on TTL expiry', async () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
      mockExistsSync.mockReturnValue(true)

      createSession('test_expiry')

      // Find the timer callback
      const timerCallback = setTimeoutSpy.mock.calls[0][0] as () => void

      // Simulate timer expiry
      await timerCallback()

      // File should be deleted
      expect(mockUnlinkSync).toHaveBeenCalled()
    })
  })

  describe('updateSession', () => {
    it('updates session progress', () => {
      createSession('test_session_4')
      updateSession('test_session_4', { progress: 50 })

      const session = getSession('test_session_4')
      expect(session?.progress).toBe(50)
    })

    it('persists update to file', () => {
      createSession('test_persist_update')
      updateSession('test_persist_update', { progress: 75 })

      expect(mockWriteFileSync).toHaveBeenCalledTimes(4) // temp + final writes for create + update
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
        error: 'Vision service unavailable',
      })

      const session = getSession('test_session_7')
      expect(session?.status).toBe('failed')
      expect(session?.error).toBe('Vision service unavailable')
    })

    it('attaches result when ready', () => {
      createSession('test_session_8')
      const mockResult = {
        sessionId: 'test_session_8',
        scanTime: '2026-04-27T10:00:00.000Z',
        productCategory: 'electronics' as const,
        targetMarkets: ['EU' as const] as const,
        complianceScore: 75,
        scoreGrade: 'B' as const,
        images: [],
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
      // Should not throw, just warn
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      updateSession('non_existent_session', { progress: 50 })

      expect(consoleSpy).toHaveBeenCalled()
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

    it('preserves profit report scenarios in public session payloads', () => {
      createSession('test_profit_reports')
      const profitReports = [{ sessionId: 'test_profit_reports', scenario: 'standard' }]

      updateSession('test_profit_reports', {
        profitReport: profitReports[0] as ScanStatus['profitReport'],
        profitReports: profitReports as ScanStatus['profitReports'],
      })

      const session = getSession('test_profit_reports')
      expect(session).toBeDefined()

      const payload = publicSession(session as ScanStatus)
      expect(payload.profitReport).toEqual(profitReports[0])
      expect(payload.profitReports).toEqual(profitReports)
    })

    it('restores session from file if not in memory', () => {
      // Create session and clear memory
      createSession('test_file_restore')
      const store = globalThis.__scanStore
      store?.delete('test_file_restore')

      // Mock file exists and is valid
      mockExistsSync.mockImplementation((path) => {
        if (isSessionPath(path)) {
          return true
        }
        return false
      })

      const sessionData = {
        sessionId: 'test_file_restore',
        status: 'processing',
        progress: 25,
        stageText: 'From file',
        _timestamp: Date.now(),
      }
      mockReadFileSync.mockReturnValue(JSON.stringify(sessionData))

      // Now update should find it in file
      updateSession('test_file_restore', { progress: 50 })

      expect(mockReadFileSync).toHaveBeenCalled()
    })

    it('logs warning when session not found anywhere', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      updateSession('completely_missing', { progress: 50 })

      expect(consoleWarnSpy).toHaveBeenCalled()
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

    it('restores session from file if not in memory', () => {
      // Create session
      createSession('test_restore')

      // Clear memory but file exists
      const store = globalThis.__scanStore
      store?.delete('test_restore')

      mockExistsSync.mockImplementation((path) => {
        if (isSessionPath(path)) {
          return true
        }
        return false
      })

      const sessionData = {
        sessionId: 'test_restore',
        status: 'processing',
        progress: 50,
        stageText: 'Restored',
        _timestamp: Date.now(),
      }
      mockReadFileSync.mockReturnValue(JSON.stringify(sessionData))

      const session = getSession('test_restore')

      expect(session).toBeDefined()
      expect(session?.progress).toBe(50)
      expect(session?.stageText).toBe('Restored')
    })

    it('restores TTL timer when loading from file', () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

      createSession('test_timer_restore')

      // Clear memory
      const store = globalThis.__scanStore
      store?.delete('test_timer_restore')

      mockExistsSync.mockImplementation((path) => {
        if (isSessionPath(path)) {
          return true
        }
        return false
      })

      const sessionData = {
        sessionId: 'test_timer_restore',
        status: 'processing',
        progress: 30,
        stageText: 'Timer test',
        _timestamp: Date.now(),
      }
      mockReadFileSync.mockReturnValue(JSON.stringify(sessionData))

      getSession('test_timer_restore')

      // Should have set a new timer (clearTimeout was called with old, setTimeout called for new)
      expect(setTimeoutSpy).toHaveBeenCalled()
    })

    it('skips expired session from file', () => {
      mockExistsSync.mockImplementation((path) => {
        if (isSessionPath(path)) {
          return true
        }
        return false
      })

      // Session is expired (timestamp too old)
      const oldSession = {
        sessionId: 'test_expired',
        status: 'processing',
        progress: 10,
        stageText: 'Old',
        _timestamp: Date.now() - 4000 * 60 * 60, // 4 hours ago (> 1 hour TTL)
      }
      mockReadFileSync.mockReturnValue(JSON.stringify(oldSession))

      const session = getSession('test_expired')

      expect(session).toBeUndefined()
      expect(mockUnlinkSync).toHaveBeenCalled()
    })

    it('handles malformed JSON in file', () => {
      mockExistsSync.mockImplementation((path) => {
        if (isSessionPath(path)) {
          return true
        }
        return false
      })

      mockReadFileSync.mockImplementation(() => {
        throw new Error('Parse error')
      })

      const session = getSession('test_malformed')

      expect(session).toBeUndefined()
    })

    it('returns undefined when file does not exist', () => {
      mockExistsSync.mockReturnValue(false)

      const session = getSession('test_no_file')

      expect(session).toBeUndefined()
    })
  })

  describe('clearStore', () => {
    it('clears all sessions from memory', () => {
      createSession('clear_1')
      createSession('clear_2')

      clearStore()

      expect(getSession('clear_1')).toBeUndefined()
      expect(getSession('clear_2')).toBeUndefined()
    })

    it('clears all timers', () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

      createSession('timer_clear_1')
      createSession('timer_clear_2')

      clearStore()

      expect(clearTimeoutSpy).toHaveBeenCalled()
    })

    it('cleans up session files when clearing store', () => {
      mockExistsSync.mockReturnValue(true)
      mockReaddirSync.mockReturnValue(['session1.json', 'session2.json'])

      clearStore()

      expect(mockUnlinkSync).toHaveBeenCalled()
    })

    it('handles errors when cleaning files gracefully', () => {
      mockExistsSync.mockReturnValue(true)
      mockReaddirSync.mockReturnValue(['error.json'])
      mockUnlinkSync.mockImplementation(() => {
        throw new Error('Delete failed')
      })

      // Should not throw
      expect(() => clearStore()).not.toThrow()
    })
  })

  describe('File persistence', () => {
    it('creates session directory if not exists', () => {
      mockExistsSync.mockReturnValue(false)

      createSession('test_mkdir')

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringMatching(/data[\\/]sessions/),
        { recursive: true }
      )
    })

    it('writes session with timestamp', () => {
      createSession('test_timestamp')

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('_timestamp'),
        'utf-8'
      )
    })

    it('handles file write errors gracefully', () => {
      mockWriteFileSync.mockImplementation(() => {
        throw new Error('Write failed')
      })

      // Should not throw for create
      expect(() => createSession('test_write_error')).not.toThrow()
    })
  })

  describe('cleanStaleFiles', () => {
    it('skips directory if not exists', () => {
      mockExistsSync.mockReturnValue(false)

      // Module is loaded on import, so just verify no error
      expect(() => clearStore()).not.toThrow()
    })

    it('cleans stale files on module load', () => {
      mockExistsSync.mockImplementation((path) => {
        if (isSessionPath(path)) {
          return true
        }
        return false
      })

      const staleFile = {
        fileName: 'stale.json',
        session: {
          sessionId: 'stale',
          status: 'processing',
          progress: 0,
          stageText: '',
          _timestamp: Date.now() - 4000 * 60 * 60, // 4 hours ago
        },
      }

      mockReaddirSync.mockReturnValue(['stale.json', 'valid.json'])
      mockReadFileSync.mockReturnValue(JSON.stringify(staleFile.session))

      clearStore() // This triggers cleanStaleFiles on module reload

      // Should have deleted stale file
      expect(mockUnlinkSync).toHaveBeenCalled()
    })

    it('skips non-json files', () => {
      mockExistsSync.mockImplementation((path) => {
        if (isSessionPath(path)) {
          return true
        }
        return false
      })

      mockReaddirSync.mockReturnValue(['readme.txt', 'data.json'])

      clearStore()

      // Only .json files should be processed
      const jsonCalls = mockUnlinkSync.mock.calls.filter(
        (call) => (call[0] as string).endsWith('.json')
      )
      expect(jsonCalls.length).toBeGreaterThan(0)
      expect(mockUnlinkSync.mock.calls.some((call) => (call[0] as string).endsWith('readme.txt'))).toBe(false)
    })

    it('handles malformed files gracefully', () => {
      mockExistsSync.mockImplementation((path) => {
        if (isSessionPath(path)) {
          return true
        }
        return false
      })

      mockReaddirSync.mockReturnValue(['malformed.json'])

      let callCount = 0
      mockReadFileSync.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          throw new Error('Invalid JSON')
        }
        return '{}'
      })

      // Should not throw
      expect(() => clearStore()).not.toThrow()
    })

    it('handles directory read errors gracefully', () => {
      mockReaddirSync.mockImplementation(() => {
        throw new Error('Permission denied')
      })

      // Should not throw
      expect(() => clearStore()).not.toThrow()
    })
  })

  describe('Timer cleanup', () => {
    it('removes file when timer expires', async () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
      mockExistsSync.mockReturnValue(true)

      createSession('test_timer_cleanup')

      const timerCallback = setTimeoutSpy.mock.calls[0][0] as () => void

      // Verify file exists before expiry
      mockExistsSync.mockReturnValue(true)

      await timerCallback()

      expect(mockUnlinkSync).toHaveBeenCalled()
    })

    it('handles file deletion errors in timer gracefully', async () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
      mockExistsSync.mockReturnValue(true)
      mockUnlinkSync.mockImplementation(() => {
        throw new Error('Delete failed')
      })

      createSession('test_timer_error')

      const timerCallback = setTimeoutSpy.mock.calls[0][0] as () => void

      // Should not throw
      expect(() => timerCallback()).not.toThrow()
    })

    it('clears session from store when timer expires', async () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

      createSession('test_store_cleanup')

      const timerCallback = setTimeoutSpy.mock.calls[0][0] as () => void

      await timerCallback()

      expect(getSession('test_store_cleanup')).toBeUndefined()
    })
  })

  describe('getSession from file - timer restoration', () => {
    it('clears existing timer before setting new one', () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

      createSession('test_clear_timer')

      // Clear memory but file exists
      const store = globalThis.__scanStore
      store?.delete('test_clear_timer')

      mockExistsSync.mockImplementation((path) => {
        if (isSessionPath(path)) {
          return true
        }
        return false
      })

      const sessionData = {
        sessionId: 'test_clear_timer',
        status: 'processing',
        progress: 40,
        stageText: 'Timer test',
        _timestamp: Date.now(),
      }
      mockReadFileSync.mockReturnValue(JSON.stringify(sessionData))

      getSession('test_clear_timer')

      // clearTimeout should be called to clear the old timer
      expect(clearTimeoutSpy).toHaveBeenCalled()
    })

    it('sets timer with correct remaining time', () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

      createSession('test_remaining_time')

      const store = globalThis.__scanStore
      store?.delete('test_remaining_time')

      mockExistsSync.mockImplementation((path) => {
        if (isSessionPath(path)) {
          return true
        }
        return false
      })

      // Session was created 30 minutes ago (so 30 minutes remaining)
      const sessionData = {
        sessionId: 'test_remaining_time',
        status: 'processing',
        progress: 20,
        stageText: 'Remaining time test',
        _timestamp: Date.now() - 30 * 60 * 1000, // 30 minutes ago
      }
      mockReadFileSync.mockReturnValue(JSON.stringify(sessionData))

      getSession('test_remaining_time')

      // Timer should be set with remaining time
      const timerDelay = setTimeoutSpy.mock.calls.at(-1)?.[1] as number
      expect(timerDelay).toBeGreaterThan(0)
      expect(timerDelay).toBeLessThanOrEqual(60 * 60 * 1000) // Less than full TTL
    })

    it('does not set timer if no remaining time', () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

      createSession('test_no_remaining')

      const store = globalThis.__scanStore
      store?.delete('test_no_remaining')

      mockExistsSync.mockImplementation((path) => {
        if (isSessionPath(path)) {
          return true
        }
        return false
      })

      // Session is already expired
      const sessionData = {
        sessionId: 'test_no_remaining',
        status: 'processing',
        progress: 10,
        stageText: 'No remaining',
        _timestamp: Date.now() - 70 * 60 * 1000, // 70 minutes ago (> 60 min TTL)
      }
      mockReadFileSync.mockReturnValue(JSON.stringify(sessionData))

      const initialTimerCount = setTimeoutSpy.mock.calls.length

      getSession('test_no_remaining')

      // Should not set a new timer since time has expired
      // Note: getSession still returns the session, but doesn't set a timer
      expect(setTimeoutSpy.mock.calls.length).toBe(initialTimerCount)
    })
  })
})
