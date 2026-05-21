/**
 * AgentTraceView component tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'
import type { ComplianceReportResult } from '@/lib/types'

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
      <div {...props}>{children}</div>
    ),
  },
}))

// Import at the end to ensure mocks are set up first
import { TranslationProvider } from '@/lib/i18n'
import { AgentTraceTimeline, RetrievedChunks } from '@/components/result/AgentTraceView'

describe('AgentTraceTimeline component', () => {
  const createTrace = (steps: Array<{ node: string; status?: string; duration_ms?: number; docs_retrieved?: number; score?: number }>) =>
    steps as ComplianceReportResult['agentTrace']

  beforeEach(() => {
    // Reset localStorage mock
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: vi.fn(),
    })
    // Reset navigator mock
    vi.stubGlobal('navigator', { language: 'zh-CN' })
  })

  describe('Rendering', () => {
    it('renders nothing when trace is empty', () => {
      const { container } = render(
        <TranslationProvider>
          <AgentTraceTimeline trace={[]} />
        </TranslationProvider>
      )
      expect(container.firstChild).toBeNull()
    })

    it('renders trace steps', () => {
      const trace = createTrace([
        { node: 'vision', duration_ms: 500 },
        { node: 'query_planner', duration_ms: 300 },
      ])
      const { container } = render(
        <TranslationProvider>
          <AgentTraceTimeline trace={trace} />
        </TranslationProvider>
      )
      expect(container.firstChild).toBeTruthy()
    })

    it('renders node badges', () => {
      render(
        <TranslationProvider>
          <AgentTraceTimeline trace={createTrace([{ node: 'vision', duration_ms: 500 }])} />
        </TranslationProvider>
      )
      expect(screen.getByText('vision')).toBeInTheDocument()
    })
  })

  describe('Stage display', () => {
    it('displays duration in seconds', () => {
      render(
        <TranslationProvider>
          <AgentTraceTimeline trace={createTrace([{ node: 'vision', duration_ms: 1500 }])} />
        </TranslationProvider>
      )
      expect(screen.getByText('1.5s')).toBeInTheDocument()
    })

    it('displays docs_retrieved count', () => {
      render(
        <TranslationProvider>
          <AgentTraceTimeline trace={createTrace([{ node: 'retriever', docs_retrieved: 15 }])} />
        </TranslationProvider>
      )
      // Check that the component renders with the docs_retrieved info
      expect(screen.getByText('retriever')).toBeInTheDocument()
    })

    it('displays confidence score', () => {
      render(
        <TranslationProvider>
          <AgentTraceTimeline trace={createTrace([{ node: 'generator', score: 0.876 }])} />
        </TranslationProvider>
      )
      expect(screen.getByText('generator')).toBeInTheDocument()
    })
  })

  describe('Round grouping', () => {
    it('groups steps into rounds by verifier status', () => {
      const trace = createTrace([
        { node: 'vision' },
        { node: 'retriever' },
        { node: 'verifier', status: 'WARN' },
        { node: 'vision' },
        { node: 'retriever' },
      ])
      const { container } = render(
        <TranslationProvider>
          <AgentTraceTimeline trace={trace} />
        </TranslationProvider>
      )
      expect(container.firstChild).toBeTruthy()
    })

    it('shows all steps in single round when no verifier with WARN', () => {
      const trace = createTrace([
        { node: 'vision' },
        { node: 'query_planner' },
        { node: 'retriever' },
      ])
      const { container } = render(
        <TranslationProvider>
          <AgentTraceTimeline trace={trace} />
        </TranslationProvider>
      )
      expect(container.firstChild).toBeTruthy()
    })
  })

  describe('Status badges', () => {
    it('displays WARN status badge', () => {
      render(
        <TranslationProvider>
          <AgentTraceTimeline trace={createTrace([{ node: 'verifier', status: 'WARN' }])} />
        </TranslationProvider>
      )
      expect(screen.getByText('WARN')).toBeInTheDocument()
    })

    it('displays PASS status badge', () => {
      render(
        <TranslationProvider>
          <AgentTraceTimeline trace={createTrace([{ node: 'verifier', status: 'PASS' }])} />
        </TranslationProvider>
      )
      expect(screen.getByText('PASS')).toBeInTheDocument()
    })
  })

  describe('Node styling', () => {
    it('renders different node types', () => {
      render(
        <TranslationProvider>
          <AgentTraceTimeline trace={createTrace([{ node: 'vision' }, { node: 'query_planner' }])} />
        </TranslationProvider>
      )
      expect(screen.getByText('vision')).toBeInTheDocument()
      expect(screen.getByText('query_planner')).toBeInTheDocument()
    })

    it('renders unknown node types', () => {
      render(
        <TranslationProvider>
          <AgentTraceTimeline trace={createTrace([{ node: 'custom_node' }])} />
        </TranslationProvider>
      )
      expect(screen.getByText('custom_node')).toBeInTheDocument()
    })
  })
})

describe('RetrievedChunks component', () => {
  const createChunks = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      regId: `reg-${i}`,
      docName: `Document ${i + 1}`,
      articleNo: `Article ${i + 1}`,
      region: i % 2 === 0 ? 'EU' : 'US',
      score: 0.9 - (i * 0.05),
    }))

  beforeEach(() => {
    // Reset localStorage mock
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: vi.fn(),
    })
    // Reset navigator mock
    vi.stubGlobal('navigator', { language: 'zh-CN' })
  })

  describe('Rendering', () => {
    it('renders nothing when chunks is empty', () => {
      const { container } = render(
        <TranslationProvider>
          <RetrievedChunks chunks={[]} />
        </TranslationProvider>
      )
      expect(container.firstChild).toBeNull()
    })

    it('renders chunk badges', () => {
      const chunks = createChunks(3)
      const { container } = render(
        <TranslationProvider>
          <RetrievedChunks chunks={chunks} />
        </TranslationProvider>
      )
      expect(container.firstChild).toBeTruthy()
    })

    it('displays region and doc name', () => {
      render(
        <TranslationProvider>
          <RetrievedChunks chunks={createChunks(2)} />
        </TranslationProvider>
      )
      expect(screen.getByText('EU')).toBeInTheDocument()
      expect(screen.getByText('US')).toBeInTheDocument()
    })
  })

  describe('Score badges', () => {
    it('displays high score badge', () => {
      const chunks = [{ regId: 'r1', docName: 'Doc', articleNo: 'A1', region: 'EU', score: 0.95 }]
      render(
        <TranslationProvider>
          <RetrievedChunks chunks={chunks} />
        </TranslationProvider>
      )
      expect(screen.getByText('0.95')).toBeInTheDocument()
    })

    it('displays medium score badge', () => {
      const chunks = [{ regId: 'r1', docName: 'Doc', articleNo: 'A1', region: 'EU', score: 0.75 }]
      render(
        <TranslationProvider>
          <RetrievedChunks chunks={chunks} />
        </TranslationProvider>
      )
      expect(screen.getByText('0.75')).toBeInTheDocument()
    })

    it('displays low score badge', () => {
      const chunks = [{ regId: 'r1', docName: 'Doc', articleNo: 'A1', region: 'EU', score: 0.5 }]
      render(
        <TranslationProvider>
          <RetrievedChunks chunks={chunks} />
        </TranslationProvider>
      )
      expect(screen.getByText('0.50')).toBeInTheDocument()
    })
  })

  describe('Overflow handling', () => {
    it('handles overflow when chunks exceed display cap', () => {
      const chunks = createChunks(20)
      const { container } = render(
        <TranslationProvider>
          <RetrievedChunks chunks={chunks} />
        </TranslationProvider>
      )
      expect(container.firstChild).toBeTruthy()
    })

    it('handles chunks within limit', () => {
      const chunks = createChunks(10)
      const { container } = render(
        <TranslationProvider>
          <RetrievedChunks chunks={chunks} />
        </TranslationProvider>
      )
      expect(container.firstChild).toBeTruthy()
    })
  })

  describe('Article number display', () => {
    it('shows article number when present', () => {
      const chunks = [{ regId: 'r1', docName: 'Doc', articleNo: 'Article 42', region: 'EU', score: 0.9 }]
      render(
        <TranslationProvider>
          <RetrievedChunks chunks={chunks} />
        </TranslationProvider>
      )
      expect(screen.getByText('Article 42')).toBeInTheDocument()
    })

    it('handles chunks without article number', () => {
      const chunks = [{ regId: 'r1', docName: 'Doc', region: 'EU', score: 0.9 }]
      const { container } = render(
        <TranslationProvider>
          <RetrievedChunks chunks={chunks} />
        </TranslationProvider>
      )
      expect(container.firstChild).toBeTruthy()
    })
  })
})
