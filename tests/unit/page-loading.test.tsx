/**
 * Smoke tests for the per-page Next.js loading.tsx files. Each loading.tsx is
 * a thin wrapper around PageSkeleton with a route-specific label; this file
 * exercises them all to ensure the wrappers wire through correctly.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

import UploadLoading from '@/app/upload/loading'
import BurningLoading from '@/app/burning/[sessionId]/loading'
import ResultLoading from '@/app/result/[sessionId]/loading'

vi.mock('@/components/blaze-hawks/locale', () => ({
  useBlazeLocale: () => ({ locale: 'en' }),
}))

const EXPECTED: Array<{ name: string; Component: React.ComponentType; label: string; spinnerCount: number }> = [
  { name: 'upload', Component: UploadLoading, label: 'Preparing your product upload…', spinnerCount: 0 },
  { name: 'burning', Component: BurningLoading, label: 'Initializing scan…', spinnerCount: 2 },
  { name: 'result', Component: ResultLoading, label: 'Loading report…', spinnerCount: 2 },
]

describe('Page-level loading.tsx wrappers', () => {
  for (const { name, Component, label, spinnerCount } of EXPECTED) {
    it(`${name}: renders the route-specific label`, () => {
      render(<Component />)
      expect(screen.getByText(label)).toBeInTheDocument()
    })

    it(`${name}: renders the expected loading treatment`, () => {
      const { container } = render(<Component />)
      expect(container.querySelectorAll('.animate-spin').length).toBe(spinnerCount)
    })
  }
})
