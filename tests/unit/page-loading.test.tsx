/**
 * Smoke tests for the per-page Next.js loading.tsx files. Each loading.tsx is
 * a thin wrapper around PageSkeleton with a route-specific label; this file
 * exercises them all to ensure the wrappers wire through correctly.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

import UploadLoading from '@/app/upload/loading'
import BurningLoading from '@/app/burning/[sessionId]/loading'
import ResultLoading from '@/app/result/[sessionId]/loading'

const EXPECTED: Array<{ name: string; Component: React.ComponentType; label: string }> = [
  { name: 'upload', Component: UploadLoading, label: 'Loading upload…' },
  { name: 'burning', Component: BurningLoading, label: 'Initializing scan…' },
  { name: 'result', Component: ResultLoading, label: 'Loading report…' },
]

describe('Page-level loading.tsx wrappers', () => {
  for (const { name, Component, label } of EXPECTED) {
    it(`${name}: renders the route-specific label`, () => {
      render(<Component />)
      expect(screen.getByText(label)).toBeInTheDocument()
    })

    it(`${name}: renders two animated spinner rings`, () => {
      const { container } = render(<Component />)
      expect(container.querySelectorAll('.animate-spin').length).toBe(2)
    })
  }
})
