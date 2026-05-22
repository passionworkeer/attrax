import '@testing-library/jest-dom'
import { afterEach, vi } from 'vitest'

// Mock fetch globally
global.fetch = vi.fn()

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
  }
})()
Object.defineProperty(global, 'localStorage', { value: localStorageMock })

// Mock navigator
Object.defineProperty(global, 'navigator', {
  value: { language: 'zh-CN', userAgent: 'test' },
  writable: true,
})

// Clean up after each test
afterEach(() => {
  vi.clearAllMocks()
})
