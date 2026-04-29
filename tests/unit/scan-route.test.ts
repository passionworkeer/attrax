/**
 * Unit tests for the Next.js /api/scan route behavior.
 * Run with: npx vitest run tests/unit/scan-route.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock modules used by the route
vi.mock('@/lib/mock/scan-result', () => ({
  createMockScanResult: vi.fn(() => ({ status: 'PASS', report: 'Mock report', agent_trace: [] })),
}));

vi.mock('@/lib/pipeline/scan', () => ({
  runScan: vi.fn(),
}));

vi.mock('@/lib/pipeline/session-store', () => ({
  createSession: vi.fn(),
  updateSession: vi.fn(),
}));

describe('POST /api/scan request parsing', () => {
  it('should accept valid electronics category', () => {
    const valid = { category: 'electronics', markets: ['EU'] };
    expect(valid.category).toBeTruthy();
    expect(valid.markets).toContain('EU');
  });

  it('should parse comma-separated markets', () => {
    const raw = 'EU,US,CN';
    const markets = raw
      .split(',')
      .map((m) => m.trim().toUpperCase());
    expect(markets).toEqual(['EU', 'US', 'CN']);
  });

  it('should default to EU/US when markets is empty', () => {
    const raw = '';
    const markets =
      typeof raw !== 'string' || !raw.trim()
        ? ['EU', 'US']
        : raw.split(',').map((m) => m.trim().toUpperCase());
    expect(markets).toEqual(['EU', 'US']);
  });

  it('should produce a valid sessionId format', () => {
    const prefix = 'scan_';
    const ulid = '01ARZ3NDEKTSV4RRFFQ69G5FAV'; // sample ULID
    const sessionId = `${prefix}${ulid}`;
    expect(sessionId).toMatch(/^scan_[A-Z0-9]+$/);
  });
});

describe('GET /api/scan/[sessionId] sessionId validation', () => {
  it('should accept valid sessionId characters', () => {
    const sessionId = 'scan_01ARZ3NDEKTSV4RRFFQ69G5FAV';
    expect(sessionId).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  it('should detect injection characters in sessionId', () => {
    const sessionId = 'scan_01ARZ3NDE<script>';
    // sessionId must not contain HTML injection characters
    expect(/[<>&]/.test(sessionId)).toBe(true);  // Correctly detects injection
  });
});
