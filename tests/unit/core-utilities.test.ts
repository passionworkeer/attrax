import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import {
  fail,
  ok,
  unwrapApiData,
} from '@/lib/api-response'
import {
  createAccessToken,
  hashAccessToken,
  tokenFromRequest,
  verifyAccessToken,
} from '@/lib/pipeline/session-auth'
import { requireSessionAccess, sessionPayload } from '@/app/api/session-access'
import { SCAN_STAGE_TEXT, serverT } from '@/lib/server-i18n'
import type { ScanStatus } from '@/lib/types'
import type { StoredScanStatus } from '@/lib/pipeline/session-store'

describe('rate-limit utilities', () => {
  beforeEach(() => {
    globalThis.__rateLimitBuckets = new Map()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-25T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    globalThis.__rateLimitBuckets = undefined
  })

  it('extracts the first forwarded IP and falls back to unknown', () => {
    const forwarded = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
    })
    const noForwarded = new Request('http://localhost')

    expect(clientIp(forwarded)).toBe('203.0.113.7')
    expect(clientIp(noForwarded)).toBe('unknown')
  })

  it('allows all requests in test mode', () => {
    vi.stubEnv('NODE_ENV', 'test')

    expect(checkRateLimit('key', 0, 1000)).toBe(true)
  })

  it('limits repeated production requests until the window resets', () => {
    vi.stubEnv('NODE_ENV', 'production')

    expect(checkRateLimit('scan:ip', 2, 1000)).toBe(true)
    expect(checkRateLimit('scan:ip', 2, 1000)).toBe(true)
    expect(checkRateLimit('scan:ip', 2, 1000)).toBe(false)

    vi.advanceTimersByTime(1001)
    expect(checkRateLimit('scan:ip', 2, 1000)).toBe(true)
  })

  it('creates the shared bucket store lazily', () => {
    vi.stubEnv('NODE_ENV', 'production')
    globalThis.__rateLimitBuckets = undefined

    expect(checkRateLimit('lazy:ip', 1, 1000)).toBe(true)
    expect(globalThis.__rateLimitBuckets).toBeInstanceOf(Map)
    expect(globalThis.__rateLimitBuckets?.has('lazy:ip')).toBe(true)
  })
})

describe('api response utilities', () => {
  it('wraps success and failure responses with the legacy top-level payload shape', async () => {
    const success = ok({ sessionId: 'scan_ok', status: 'processing' }, { status: 202 })
    const successBody = await success.json()

    expect(success.status).toBe(202)
    expect(successBody).toMatchObject({
      success: true,
      data: { sessionId: 'scan_ok', status: 'processing' },
      error: null,
      sessionId: 'scan_ok',
      status: 'processing',
    })

    const failure = fail({ code: 'BAD_INPUT', message: 'Invalid' }, { status: 400 })
    await expect(failure.json()).resolves.toEqual({
      success: false,
      data: null,
      error: { code: 'BAD_INPUT', message: 'Invalid' },
    })
  })

  it('unwraps successful envelopes and leaves non-envelope payloads intact', () => {
    const payload = { success: true, data: { value: 42 }, error: null }
    const legacy = { status: 'ready', progress: 100 }
    const failure = { success: false, data: null, error: { code: 'NOPE', message: 'No' } }

    expect(unwrapApiData<{ value: number }>(payload)).toEqual({ value: 42 })
    expect(unwrapApiData<typeof legacy>(legacy)).toBe(legacy)
    expect(unwrapApiData<typeof failure>(failure)).toBe(failure)
    expect(unwrapApiData(null)).toBeNull()
  })
})

describe('session auth utilities', () => {
  it('creates base64url access tokens and verifies token hashes safely', () => {
    const token = createAccessToken()
    const hash = hashAccessToken(token)

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(verifyAccessToken(token, hash)).toBe(true)
    expect(verifyAccessToken('wrong-token', hash)).toBe(false)
    expect(verifyAccessToken('', hash)).toBe(false)
    expect(verifyAccessToken(token, undefined)).toBe(false)
    expect(verifyAccessToken(token, 'deadbeef')).toBe(false)
  })

  it('reads bearer tokens and ignores query string tokens (security)', () => {
    const bearer = new Request('http://localhost/api/scan/abc?token=query-token', {
      headers: { authorization: 'Bearer header-token' },
    })
    const query = new Request('http://localhost/api/scan/abc?token=query-token')
    const emptyBearer = new Request('http://localhost/api/scan/abc', {
      headers: { authorization: 'Bearer   ' },
    })

    expect(tokenFromRequest(bearer)).toBe('header-token')
    // SECURITY: ?token= in query string MUST be ignored — it would leak to
    // nginx access logs and any downstream log aggregator. See
    // tests/unit/session-auth.test.ts for the authoritative regression guard.
    expect(tokenFromRequest(query)).toBeNull()
    expect(tokenFromRequest(emptyBearer)).toBeNull()
  })
})

describe('session access helpers', () => {
  function makeStoredSession(overrides: Partial<StoredScanStatus> = {}): StoredScanStatus {
    return {
      sessionId: 'scan_secure',
      status: 'ready',
      progress: 100,
      stageText: 'complete',
      createdAt: 0,
      updatedAt: 0,
      expiresAt: Date.now() + 1000,
      ...overrides,
    }
  }

  it('allows sessions without access-token protection', () => {
    const session = makeStoredSession()
    const request = new Request('http://localhost/api/scan/scan_secure')

    expect(requireSessionAccess(request, session)).toBeNull()
  })

  it('allows valid bearer tokens and rejects missing or invalid tokens', async () => {
    const token = 'secret-token'
    const session = makeStoredSession({ accessTokenHash: hashAccessToken(token) })
    const allowed = new Request('http://localhost/api/scan/scan_secure', {
      headers: { authorization: `Bearer ${token}` },
    })
    const denied = new Request('http://localhost/api/scan/scan_secure')

    expect(requireSessionAccess(allowed, session)).toBeNull()

    const response = requireSessionAccess(denied, session)
    expect(response?.status).toBe(401)
    await expect(response?.json()).resolves.toMatchObject({
      success: false,
      error: { code: 'UNAUTHORIZED' },
    })
  })

  it('returns only public session fields while preserving profit scenarios', () => {
    const status: ScanStatus & { accessTokenHash?: string; internal?: string } = {
      sessionId: 'scan_public',
      status: 'ready',
      progress: 100,
      stageText: 'complete',
      result: undefined,
      profitReport: { sessionId: 'scan_public', scenario: 'base' } as ScanStatus['profitReport'],
      profitReports: [{ sessionId: 'scan_public', scenario: 'base' }] as ScanStatus['profitReports'],
      error: undefined,
      accessTokenHash: 'private',
      internal: 'hidden',
    }

    expect(sessionPayload(status)).toEqual({
      sessionId: 'scan_public',
      status: 'ready',
      progress: 100,
      stageText: 'complete',
      result: undefined,
      profitReport: status.profitReport,
      profitReports: status.profitReports,
      error: undefined,
    })
  })
})

describe('server i18n utilities', () => {
  it('returns zh/en translations and falls back to the key', () => {
    expect(serverT('errors.invalidRequest', 'en')).toBe('Invalid request. Please check your uploads and try again.')
    expect(serverT('categories.electronics', 'zh')).not.toBe('categories.electronics')
    expect(serverT('missing.key', 'en')).toBe('missing.key')
  })

  it('replaces template params in fallback or translated strings', () => {
    expect(serverT('Hello {name}', 'en', { name: 'Attrax' })).toBe('Hello Attrax')
  })

  it('exports scan stage text for both supported locales', () => {
    expect(SCAN_STAGE_TEXT.zh.identifyingLabels).toBeTruthy()
    expect(SCAN_STAGE_TEXT.en.reportComplete).toBe('Report complete')
  })
})
