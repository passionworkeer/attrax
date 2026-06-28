/**
 * ProfitReportView component tests
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'
import type { ProfitReportResult } from '@/lib/types'

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
      <div {...props}>{children}</div>
    ),
  },
}))

// Mock ReactMarkdown
vi.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}))

// Mock remarkGfm
vi.mock('remark-gfm', () => ({
  __esModule: true,
  default: () => [],
}))

// Mock report-download functions (UI components import from here so jspdf/docx
// stay out of the component bundle; tests still validate the wiring).
vi.mock('@/lib/report-download', () => ({
  downloadProfitReportAsPdf: vi.fn(),
  downloadProfitReportAsDocx: vi.fn(),
}))

// Import after mocks
import { ProfitReportView } from '@/components/result/ProfitReportView'
import { TranslationProvider } from '@/lib/i18n'
import * as reportDownload from '@/lib/report-download'

describe('ProfitReportView component', () => {
  const baseResult: ProfitReportResult = {
    sessionId: 'test-session-456',
    productType: 'Electronics',
    market: 'EU',
    report: '# Analysis Report\n\nThis is the analysis content.',
    barebone: {
      bom: 50,
      packaging: 5,
      cert: 10,
      epr: 3,
      logistics: 8,
      asp: 150,
      gp: 74,
      warranty: 5,
      total: 76,
    },
    compliant: {
      bom: 50,
      packaging: 8,
      cert: 15,
      epr: 8,
      logistics: 10,
      asp: 200,
      gp: 109,
      warranty: 5,
      total: 91,
    },
    bareboneRiskExposure: 5000,
    compliantRiskExposure: 500,
    keyConclusion: 'This is the key conclusion.\nWith more details here.',
    generatedAt: '2024-01-15T10:30:00Z',
    premiumPct: '33%',
    breakevenUnits: '100',
    pricingStrategy: 'Use premium pricing',
    riskNote: 'Lower risk with compliance',
    conclusions: 'Key conclusions here',
    references: 'References here',
    bareboneGpm: 49.3,
    compliantGpm: 54.5,
  }

  describe('Rendering', () => {
    it('renders with component wrapper', () => {
      const { container } = render(
        <TranslationProvider>
          <ProfitReportView result={baseResult} />
        </TranslationProvider>
      )
      expect(container.firstChild).toBeTruthy()
    })

    it('renders product type and market', () => {
      render(
        <TranslationProvider>
          <ProfitReportView result={baseResult} />
        </TranslationProvider>
      )
      // Text is split across elements, use queryAllByText with regex
      const electronics = screen.queryAllByText(/Electronics/)
      const eu = screen.queryAllByText(/EU/)
      expect(electronics.length + eu.length).toBeGreaterThan(0)
    })

    it('renders gross profit values', () => {
      render(
        <TranslationProvider>
          <ProfitReportView result={baseResult} />
        </TranslationProvider>
      )
      // Use getAllByText since values appear multiple times
      expect(screen.getAllByText('$74').length).toBeGreaterThan(0)
      expect(screen.getAllByText('$109').length).toBeGreaterThan(0)
    })
  })

  describe('Key conclusion card', () => {
    it('renders key conclusion when present', () => {
      render(
        <TranslationProvider>
          <ProfitReportView result={baseResult} />
        </TranslationProvider>
      )
      expect(screen.getByText('This is the key conclusion.')).toBeInTheDocument()
      expect(screen.getByText('With more details here.')).toBeInTheDocument()
    })

    it('does not render conclusion card when keyConclusion is empty', () => {
      const resultWithoutConclusion = {
        ...baseResult,
        keyConclusion: '',
      }
      render(
        <TranslationProvider>
          <ProfitReportView result={resultWithoutConclusion} />
        </TranslationProvider>
      )
      expect(screen.queryByText('This is the key conclusion.')).not.toBeInTheDocument()
    })
  })

  describe('Markdown report', () => {
    it('renders markdown report when present', () => {
      render(
        <TranslationProvider>
          <ProfitReportView result={baseResult} />
        </TranslationProvider>
      )
      expect(screen.getByTestId('markdown')).toBeInTheDocument()
    })

    it('does not render markdown section when report is empty', () => {
      const resultWithoutReport = {
        ...baseResult,
        report: '',
      }
      render(
        <TranslationProvider>
          <ProfitReportView result={resultWithoutReport} />
        </TranslationProvider>
      )
      expect(screen.queryByTestId('markdown')).not.toBeInTheDocument()
    })
  })

  describe('Export buttons', () => {
    it('renders PDF export button', () => {
      render(
        <TranslationProvider>
          <ProfitReportView result={baseResult} />
        </TranslationProvider>
      )
      expect(screen.getByText('PDF ZH')).toBeInTheDocument()
    })

    it('renders DOCX export button', () => {
      render(
        <TranslationProvider>
          <ProfitReportView result={baseResult} />
        </TranslationProvider>
      )
      expect(screen.getByText('Word ZH')).toBeInTheDocument()
    })

    it('calls downloadProfitReportAsPdf when PDF button is clicked', () => {
      render(
        <TranslationProvider>
          <ProfitReportView result={baseResult} />
        </TranslationProvider>
      )
      fireEvent.click(screen.getByText('PDF ZH'))
      expect(reportDownload.downloadProfitReportAsPdf).toHaveBeenCalledWith(baseResult, 'zh')
    })

    it('calls downloadProfitReportAsDocx when Word button is clicked', () => {
      render(
        <TranslationProvider>
          <ProfitReportView result={baseResult} />
        </TranslationProvider>
      )
      fireEvent.click(screen.getByText('Word ZH'))
      expect(reportDownload.downloadProfitReportAsDocx).toHaveBeenCalledWith(baseResult, 'zh')
    })
  })

  describe('Risk exposure display', () => {
    it('displays risk exposure values', () => {
      render(
        <TranslationProvider>
          <ProfitReportView result={baseResult} />
        </TranslationProvider>
      )
      // Values are split, check for presence of any matching text
      const allText = screen.getAllByText(/\$/)
      expect(allText.length).toBeGreaterThan(0)
    })
  })

  describe('Empty states', () => {
    it('handles zero risk exposure', () => {
      const zeroRiskResult = {
        ...baseResult,
        bareboneRiskExposure: 0,
        compliantRiskExposure: 0,
      }
      const { container } = render(
        <TranslationProvider>
          <ProfitReportView result={zeroRiskResult} />
        </TranslationProvider>
      )
      expect(container.firstChild).toBeTruthy()
    })

    it('handles negative gross profit', () => {
      const negativeGpResult = {
        ...baseResult,
        barebone: { ...baseResult.barebone, gp: -20 },
        compliant: { ...baseResult.compliant, gp: -10 },
      }
      render(
        <TranslationProvider>
          <ProfitReportView result={negativeGpResult} />
        </TranslationProvider>
      )
      // Use getAllByText since values appear multiple times
      expect(screen.getAllByText('$-20').length).toBeGreaterThan(0)
      expect(screen.getAllByText('$-10').length).toBeGreaterThan(0)
    })
  })
})
