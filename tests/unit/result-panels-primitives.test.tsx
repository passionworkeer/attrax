/**
 * Tests for the new files added in P2 #6 and P2-Plus iterations.
 * Pattern follows tests/unit/result-extracted-components.test.tsx.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'
import { formatBytes } from '@/lib/format'
import {
  AnimatedEntry,
  ConfidenceBadge,
  ProgressBar,
  RiskBadge,
  StatusIcon,
} from '@/components/trace/DecisionTreePrimitives'
import { TranslationProvider } from '@/lib/i18n'

function renderInProvider(node: React.ReactNode) {
  return render(<TranslationProvider>{node}</TranslationProvider>)
}

describe('formatBytes', () => {
  it('returns bytes for values under 1 KB', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('returns KB for values between 1 KB and 1 MB', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024 - 1)).toMatch(/^1023\.9 KB$|^1024\.0 KB$/)
  })

  it('returns MB for values at or above 1 MB', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB')
  })
})

describe('StatusIcon', () => {
  it('renders nothing for unknown status', () => {
    const { container } = render(<StatusIcon status="unknown" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders pending spinner', () => {
    const { container } = render(<StatusIcon status="pending" />)
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders success check icon', () => {
    const { container } = render(<StatusIcon status="success" />)
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('renders error X icon', () => {
    const { container } = render(<StatusIcon status="error" />)
    expect(container.querySelector('svg')).toBeInTheDocument()
  })
})

describe('ProgressBar', () => {
  it('clamps progress to 0..100', () => {
    const { container } = render(<ProgressBar progress={150} />)
    // The inner fill has the unique `h-full` class.
    const fill = container.querySelector('.h-full') as HTMLElement
    expect(fill.style.width).toBe('100%')
  })

  it('clamps negative progress to 0', () => {
    const { container } = render(<ProgressBar progress={-10} />)
    const fill = container.querySelector('.h-full') as HTMLElement
    expect(fill.style.width).toBe('0%')
  })

  it('renders the default color when none provided', () => {
    const { container } = render(<ProgressBar progress={50} />)
    const fill = container.querySelector('.h-full') as HTMLElement
    expect(fill.className).toContain('bg-blue-500')
  })

  it('accepts a custom color class', () => {
    const { container } = render(<ProgressBar progress={50} color="bg-red-500" />)
    const fill = container.querySelector('.h-full') as HTMLElement
    expect(fill.className).toContain('bg-red-500')
  })
})

describe('ConfidenceBadge', () => {
  it('returns null when confidence is missing', () => {
    const { container } = render(<ConfidenceBadge />)
    expect(container.firstChild).toBeNull()
  })

  it('returns null when confidence is 0', () => {
    const { container } = render(<ConfidenceBadge confidence={0} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the percentage when confidence is 0.87', () => {
    render(<ConfidenceBadge confidence={0.87} />)
    expect(screen.getByText('87%')).toBeInTheDocument()
  })

  it('rounds to the nearest integer', () => {
    render(<ConfidenceBadge confidence={0.876} />)
    expect(screen.getByText('88%')).toBeInTheDocument()
  })
})

describe('RiskBadge', () => {
  it('returns null when count is 0', () => {
    const { container } = render(<RiskBadge level="high" count={0} locale="en" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders High label in English', () => {
    render(<RiskBadge level="high" count={3} locale="en" />)
    expect(screen.getByText(/3 High/)).toBeInTheDocument()
  })

  it('renders 高 label in Chinese', () => {
    render(<RiskBadge level="high" count={2} locale="zh" />)
    expect(screen.getByText(/2 高/)).toBeInTheDocument()
  })

  it('renders Med label', () => {
    render(<RiskBadge level="medium" count={1} locale="en" />)
    expect(screen.getByText(/1 Med/)).toBeInTheDocument()
  })

  it('renders Low label', () => {
    render(<RiskBadge level="low" count={5} locale="en" />)
    expect(screen.getByText(/5 Low/)).toBeInTheDocument()
  })
})

describe('AnimatedEntry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders children inside a transition wrapper', () => {
    const { container } = render(
      <AnimatedEntry>
        <span data-testid="child">content</span>
      </AnimatedEntry>,
    )
    expect(container.querySelector('[data-testid="child"]')).toBeInTheDocument()
  })

  it('starts invisible (opacity-0) and becomes visible after the delay', () => {
    const { container } = render(
      <AnimatedEntry delay={50}>
        <span>content</span>
      </AnimatedEntry>,
    )
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('opacity-0')
    act(() => {
      vi.advanceTimersByTime(60)
    })
    expect(wrapper.className).toContain('opacity-100')
  })
})
