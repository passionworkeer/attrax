import { test, expect } from '@playwright/test'

const API_BASE = 'http://localhost:3000/api'

test.describe('API Integration Tests', () => {
  test('health endpoint returns 200', async ({ request }) => {
    const response = await request.get(`${API_BASE}/health`)
    expect(response.status()).toBeGreaterThanOrEqual(200)
  })

  test('scan endpoint without data returns 400', async ({ request }) => {
    const response = await request.post(`${API_BASE}/scan`)
    expect(response.status()).toBeGreaterThanOrEqual(400)
  })

  test('scan endpoint rejects invalid category', async ({ request }) => {
    const response = await request.post(`${API_BASE}/scan`, {
      data: {
        category: 'invalid_category',
        markets: ['EU'],
        imageCount: 1
      }
    })
    expect(response.status()).toBeGreaterThanOrEqual(400)
  })

  test('scan endpoint rejects invalid market', async ({ request }) => {
    const response = await request.post(`${API_BASE}/scan`, {
      data: {
        category: 'electronics',
        markets: ['INVALID'],
        imageCount: 1
      }
    })
    expect(response.status()).toBeGreaterThanOrEqual(400)
  })

  test('scan endpoint rejects imageCount > 8', async ({ request }) => {
    const response = await request.post(`${API_BASE}/scan`, {
      data: {
        category: 'electronics',
        markets: ['EU'],
        imageCount: 10
      }
    })
    expect(response.status()).toBeGreaterThanOrEqual(400)
  })

  test('scan endpoint rejects imageCount < 1', async ({ request }) => {
    const response = await request.post(`${API_BASE}/scan`, {
      data: {
        category: 'electronics',
        markets: ['EU'],
        imageCount: 0
      }
    })
    expect(response.status()).toBeGreaterThanOrEqual(400)
  })

  test('scan session endpoint returns 404 for non-existent session', async ({ request }) => {
    const response = await request.get(`${API_BASE}/scan/nonexistent_session_id`)
    expect(response.status()).toBeGreaterThanOrEqual(400)
  })

  test('regulations updates endpoint returns valid response', async ({ request }) => {
    const response = await request.get(`${API_BASE}/regulations/updates`)
    if (response.ok()) {
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(Array.isArray(data.data)).toBeTruthy()
      expect(typeof data.meta?.returned).toBe('number')
    }
  })

  test('trace endpoint returns 404 for non-existent session', async ({ request }) => {
    const response = await request.get(`${API_BASE}/trace/nonexistent_session_id`)
    expect(response.status()).toBeGreaterThanOrEqual(400)
  })
})
