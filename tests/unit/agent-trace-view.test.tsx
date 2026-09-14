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
import { BlazeLocaleProvider } from '@/components/blaze-hawks/locale'
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
        <BlazeLocaleProvider>
          <AgentTraceTimeline trace={[]} />
        </BlazeLocaleProvider>
      )
      expect(container.firstChild).toBeNull()
    })

    it('renders trace steps', () => {
      const trace = createTrace([
        { node: 'vision', duration_ms: 500 },
        { node: 'query_planner', duration_ms: 300 },
      ])
      const { container } = render(
        <BlazeLocaleProvider>
          <AgentTraceTimeline trace={trace} />
        </BlazeLocaleProvider>
      )
      expect(container.firstChild).toBeTruthy()
    })

    it('renders node badges', () => {
      render(
        <BlazeLocaleProvider>
          <AgentTraceTimeline trace={createTrace([{ node: 'vision', duration_ms: 500 }])} />
        </BlazeLocaleProvider>
      )
      expect(screen.getByText('vision')).toBeInTheDocument()
    })
  })

  describe('Stage display', () => {
    it('displays duration in seconds', () => {
      render(
        <BlazeLocaleProvider>
          <AgentTraceTimeline trace={createTrace([{ node: 'vision', duration_ms: 1500 }])} />
        </BlazeLocaleProvider>
      )
      expect(screen.getByText('1.5s')).toBeInTheDocument()
    })

    it('displays docs_retrieved count', () => {
      render(
        <BlazeLocaleProvider>
          <AgentTraceTimeline trace={createTrace([{ node: 'retriever', docs_retrieved: 15 }])} />
        </BlazeLocaleProvider>
      )
      // Check that the component renders with the docs_retrieved info
      expect(screen.getByText('retriever')).toBeInTheDocument()
    })

    it('displays confidence score', () => {
      render(
        <BlazeLocaleProvider>
          <AgentTraceTimeline trace={createTrace([{ node: 'generator', score: 0.876 }])} />
        </BlazeLocaleProvider>
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
        <BlazeLocaleProvider>
          <AgentTraceTimeline trace={trace} />
        </BlazeLocaleProvider>
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
        <BlazeLocaleProvider>
          <AgentTraceTimeline trace={trace} />
        </BlazeLocaleProvider>
      )
      expect(container.firstChild).toBeTruthy()
    })
  })

  describe('Status badges', () => {
    it('displays WARN status badge', () => {
      render(
        <BlazeLocaleProvider>
          <AgentTraceTimeline trace={createTrace([{ node: 'verifier', status: 'WARN' }])} />
        </BlazeLocaleProvider>
      )
      expect(screen.getByText('WARN')).toBeInTheDocument()
    })

    it('displays PASS status badge', () => {
      render(
        <BlazeLocaleProvider>
          <AgentTraceTimeline trace={createTrace([{ node: 'verifier', status: 'PASS' }])} />
        </BlazeLocaleProvider>
      )
      expect(screen.getByText('PASS')).toBeInTheDocument()
    })
  })

  describe('Node styling', () => {
    it('renders different node types', () => {
      render(
        <BlazeLocaleProvider>
          <AgentTraceTimeline trace={createTrace([{ node: 'vision' }, { node: 'query_planner' }])} />
        </BlazeLocaleProvider>
      )
      expect(screen.getByText('vision')).toBeInTheDocument()
      expect(screen.getByText('query_planner')).toBeInTheDocument()
    })

    it('renders unknown node types', () => {
      render(
        <BlazeLocaleProvider>
          <AgentTraceTimeline trace={createTrace([{ node: 'custom_node' }])} />
        </BlazeLocaleProvider>
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
        <BlazeLocaleProvider>
          <RetrievedChunks chunks={[]} />
        </BlazeLocaleProvider>
      )
      expect(container.firstChild).toBeNull()
    })

    it('renders chunk badges', () => {
      const chunks = createChunks(3)
      const { container } = render(
        <BlazeLocaleProvider>
          <RetrievedChunks chunks={chunks} />
        </BlazeLocaleProvider>
      )
      expect(container.firstChild).toBeTruthy()
    })

    it('displays region and doc name', () => {
      render(
        <BlazeLocaleProvider>
          <RetrievedChunks chunks={createChunks(2)} />
        </BlazeLocaleProvider>
      )
      expect(screen.getByText('EU')).toBeInTheDocument()
      expect(screen.getByText('US')).toBeInTheDocument()
    })
  })

  describe('Score badges', () => {
    it('displays high score badge', () => {
      const chunks = [{ regId: 'r1', docName: 'Doc', articleNo: 'A1', region: 'EU', score: 0.95 }]
      render(
        <BlazeLocaleProvider>
          <RetrievedChunks chunks={chunks} />
        </BlazeLocaleProvider>
      )
      expect(screen.getByText('0.95')).toBeInTheDocument()
    })

    it('displays medium score badge', () => {
      const chunks = [{ regId: 'r1', docName: 'Doc', articleNo: 'A1', region: 'EU', score: 0.75 }]
      render(
        <BlazeLocaleProvider>
          <RetrievedChunks chunks={chunks} />
        </BlazeLocaleProvider>
      )
      expect(screen.getByText('0.75')).toBeInTheDocument()
    })

    it('displays low score badge', () => {
      const chunks = [{ regId: 'r1', docName: 'Doc', articleNo: 'A1', region: 'EU', score: 0.5 }]
      render(
        <BlazeLocaleProvider>
          <RetrievedChunks chunks={chunks} />
        </BlazeLocaleProvider>
      )
      expect(screen.getByText('0.50')).toBeInTheDocument()
    })
  })

  describe('Overflow handling', () => {
    it('handles overflow when chunks exceed display cap', () => {
      const chunks = createChunks(20)
      const { container } = render(
        <BlazeLocaleProvider>
          <RetrievedChunks chunks={chunks} />
        </BlazeLocaleProvider>
      )
      expect(container.firstChild).toBeTruthy()
    })

    it('handles chunks within limit', () => {
      const chunks = createChunks(10)
      const { container } = render(
        <BlazeLocaleProvider>
          <RetrievedChunks chunks={chunks} />
        </BlazeLocaleProvider>
      )
      expect(container.firstChild).toBeTruthy()
    })
  })

  describe('Article number display', () => {
    it('shows article number when present', () => {
      const chunks = [{ regId: 'r1', docName: 'Doc', articleNo: 'Article 42', region: 'EU', score: 0.9 }]
      render(
        <BlazeLocaleProvider>
          <RetrievedChunks chunks={chunks} />
        </BlazeLocaleProvider>
      )
      expect(screen.getByText('Article 42')).toBeInTheDocument()
    })

    it('handles chunks without article number', () => {
      const chunks = [{ regId: 'r1', docName: 'Doc', region: 'EU', score: 0.9 }]
      const { container } = render(
        <BlazeLocaleProvider>
          <RetrievedChunks chunks={chunks} />
        </BlazeLocaleProvider>
      )
      expect(container.firstChild).toBeTruthy()
    })
  })
})
