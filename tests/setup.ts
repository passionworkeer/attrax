import '@testing-library/jest-dom'
import { afterEach, vi } from 'vitest'

// Mock fetch globally
global.fetch = vi.fn()

// Clean up after each test
afterEach(() => {
  vi.clearAllMocks()
})