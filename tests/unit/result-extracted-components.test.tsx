/**
 * Tests for components extracted in P2 #6 (result page split) and P2-Plus
 * (loading skeletons, error boundary). Pattern follows tests/unit/profit-report-view.test.tsx.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'
import { SourceNotice } from '@/components/result/SourceNotice'
import { DownloadButtons } from '@/components/result/DownloadButtons'
import { PageSkeleton } from '@/components/ui/PageSkeleton'
import GlobalError from '@/app/error'
import { TranslationProvider } from '@/lib/i18n'

// next/link needs an href and won't render in jsdom without it; the router
// stub from setup.ts is already in place.
function renderInProvider(node: React.ReactNode) {
  return render(<TranslationProvider>{node}</TranslationProvider>)
}

describe('SourceNotice', () => {
  it('returns null when source is "real"', () => {
    const { container } = renderInProvider(<SourceNotice source="real" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the fallback notice when source is "fallback"', () => {
    renderInProvider(<SourceNotice source="fallback" />)
    // The exact text comes from i18n; assert the className is the fallback
    // variant (amber border) rather than depending on translation strings.
    const notice = document.querySelector('.border-amber-500\\/40')
    expect(notice).toBeInTheDocument()
  })

  it('renders the demo notice when source is "demo"', () => {
    renderInProvider(<SourceNotice source="demo" />)
    const notice = document.querySelector('.border-blaze-cyan\\/40')
    expect(notice).toBeInTheDocument()
  })

  it('returns null when source is undefined', () => {
    const { container } = renderInProvider(<SourceNotice />)
    expect(container.firstChild).toBeNull()
  })
})

describe('DownloadButtons', () => {
  it('renders one button group per locale (zh + en)', () => {
    renderInProvider(
      <DownloadButtons
        onPdf={vi.fn()}
        onDocx={vi.fn()}
        label="Compliance"
      />,
    )
    // Each locale renders a "PDF XX" and a "Word XX" label.
    expect(screen.getByText(/Compliance PDF ZH/)).toBeInTheDocument()
    expect(screen.getByText(/Compliance PDF EN/)).toBeInTheDocument()
    expect(screen.getByText(/Word ZH/)).toBeInTheDocument()
    expect(screen.getByText(/Word EN/)).toBeInTheDocument()
  })

  it('invokes onPdf with the locale when the PDF button is clicked', () => {
    const onPdf = vi.fn()
    const onDocx = vi.fn()
    renderInProvider(
      <DownloadButtons onPdf={onPdf} onDocx={onDocx} label="Profit" />,
    )
    fireEvent.click(screen.getByText(/Profit PDF EN/))
    expect(onPdf).toHaveBeenCalledWith('en')
    fireEvent.click(screen.getByText(/Profit PDF ZH/))
    expect(onPdf).toHaveBeenCalledWith('zh')
  })

  it('invokes onDocx with the locale when the Word button is clicked', () => {
    const onPdf = vi.fn()
    const onDocx = vi.fn()
    renderInProvider(
      <DownloadButtons onPdf={onPdf} onDocx={onDocx} label="Roadmap" />,
    )
    fireEvent.click(screen.getByText(/Word EN/))
    expect(onDocx).toHaveBeenCalledWith('en')
    fireEvent.click(screen.getByText(/Word ZH/))
    expect(onDocx).toHaveBeenCalledWith('zh')
  })
})

describe('PageSkeleton', () => {
  it('renders without a label', () => {
    const { container } = render(<PageSkeleton />)
    // Two animated ring borders should be present.
    expect(container.querySelectorAll('.animate-spin').length).toBe(2)
  })

  it('renders the label when provided', () => {
    render(<PageSkeleton label="Loading scan…" />)
    expect(screen.getByText('Loading scan…')).toBeInTheDocument()
  })
})

describe('GlobalError boundary', () => {
  it('renders the recovery UI when called with an error', () => {
    const reset = vi.fn()
    const error = Object.assign(new Error('boom'), { digest: 'abc123' })
    render(<GlobalError error={error} reset={reset} />)
    expect(screen.getByText(/Something caught fire/)).toBeInTheDocument()
    // The digest renders as a separate text node next to the "digest: "
    // label, so use a regex match to be tolerant of the split text node.
    expect(screen.getByText(/abc123/)).toBeInTheDocument()
  })

  it('invokes reset when the retry button is clicked', () => {
    const reset = vi.fn()
    const error = new Error('boom')
    render(<GlobalError error={error} reset={reset} />)
    fireEvent.click(screen.getByText(/Try again/))
    expect(reset).toHaveBeenCalledOnce()
  })

  it('omits the digest block when error has no digest', () => {
    const reset = vi.fn()
    render(<GlobalError error={new Error('boom')} reset={reset} />)
    // No element should contain "digest: " literal.
    expect(screen.queryByText(/^digest:/)).not.toBeInTheDocument()
  })
})
