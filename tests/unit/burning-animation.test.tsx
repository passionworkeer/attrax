/**
 * BurningAnimation component tests
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, animate, transition, style, className, ...props }: {
      children?: React.ReactNode
      animate?: Record<string, unknown>
      transition?: Record<string, unknown>
      style?: React.CSSProperties
      className?: string
      [key: string]: unknown
    }) => (
      <div
        data-testid="motion-div"
        className={className as string}
        style={style}
        {...props}
      >
        {children}
      </div>
    ),
  },
}))

// Mock useTranslation
vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'animation.eagleReady': 'The eagle is ready!',
        'animation.eagleAnalyzing': 'The eagle is analyzing your product',
        'animation.currentSession': 'Current session:',
        'animation.waitingForTask': 'Waiting for task to start...',
        'scanStages.analyzingImages': 'Analyzing uploaded images',
        'scanStages.backendTimeout': 'Backend service timed out, falling back to demo mode...',
        'scanStages.backendUnavailable': 'Backend service unavailable, falling back to demo mode...',
        'scanStages.demoResultGenerated': 'Demo result generated (offline mode)',
        'scanStages.reportComplete': 'Report generation complete',
        'scanStages.scanPassed': 'Compliance scan passed',
        'scanStages.scanWarning': 'Compliance warning, please review the report',
        'scanStages.scanRisk': 'Compliance risk, attention required',
        'result.reupload': 'Re-upload',
        'result.viewDemo': 'View Demo',
        'errors.backendTimeout': 'Backend service timed out, falling back to demo mode...',
        'errors.backendUnavailable': 'Backend service unavailable, falling back to demo mode...',
        'errors.scanFailed': 'Scan failed.',
      }
      return translations[key] || key
    },
    locale: 'zh' as const,
    setLocale: vi.fn(),
  }),
}))

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

// Import after mocks
import { BurningAnimation, type BurningAnimationProps } from '@/components/burning/BurningAnimation'

describe('BurningAnimation component', () => {
  const defaultProps: BurningAnimationProps = {
    displayProgress: 45,
    stageText: '分析上传图片',
    status: { status: 'processing' },
    completing: false,
    sessionId: 'test-session-123',
    onRetry: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('renders with default state', () => {
      render(<BurningAnimation {...defaultProps} />)
      expect(screen.getByText('The eagle is analyzing your product')).toBeInTheDocument()
      expect(screen.getByText('test-session-123')).toBeInTheDocument()
    })

    it('renders session ID', () => {
      render(<BurningAnimation {...defaultProps} />)
      expect(screen.getByText(/test-session-123/)).toBeInTheDocument()
    })

    it('renders progress percentage', () => {
      render(<BurningAnimation {...defaultProps} />)
      expect(screen.getByText('45%')).toBeInTheDocument()
    })

    it('renders Burning label', () => {
      render(<BurningAnimation {...defaultProps} />)
      expect(screen.getByText('Burning')).toBeInTheDocument()
    })
  })

  describe('Progress display', () => {
    it('displays 0% progress', () => {
      render(<BurningAnimation {...defaultProps} displayProgress={0} />)
      expect(screen.getByText('0%')).toBeInTheDocument()
    })

    it('displays 100% progress', () => {
      render(<BurningAnimation {...defaultProps} displayProgress={100} />)
      expect(screen.getByText('100%')).toBeInTheDocument()
    })
  })

  describe('Completing state', () => {
    it('shows eagle ready message when completing', () => {
      render(<BurningAnimation {...defaultProps} completing={true} />)
      expect(screen.getByText('The eagle is ready!')).toBeInTheDocument()
    })
  })

  describe('Stage text display', () => {
    it('localizes known Chinese backend stage text through i18n', () => {
      render(<BurningAnimation {...defaultProps} stageText="分析上传图片" />)
      expect(screen.getByText('Analyzing uploaded images')).toBeInTheDocument()
      expect(screen.queryByText('分析上传图片')).not.toBeInTheDocument()
    })

    it('localizes known English backend stage text through i18n', () => {
      render(<BurningAnimation {...defaultProps} stageText="Analyzing uploaded images" />)
      expect(screen.getByText('Analyzing uploaded images')).toBeInTheDocument()
    })

    it('displays waiting message when stageText is undefined', () => {
      render(<BurningAnimation {...defaultProps} stageText={undefined} />)
      expect(screen.getByText('Waiting for task to start...')).toBeInTheDocument()
    })

    it('displays report complete when completing', () => {
      render(<BurningAnimation {...defaultProps} completing={true} />)
      expect(screen.getByText('Report generation complete')).toBeInTheDocument()
    })
  })

  describe('Failed state', () => {
    it('shows retry button when status is failed', () => {
      render(
        <BurningAnimation
          {...defaultProps}
          status={{ status: 'failed', error: 'Network error' }}
        />
      )
      expect(screen.getByText('Re-upload')).toBeInTheDocument()
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })

    it('calls onRetry when retry button is clicked', () => {
      const onRetry = vi.fn()
      render(
        <BurningAnimation
          {...defaultProps}
          status={{ status: 'failed' }}
          onRetry={onRetry}
        />
      )
      fireEvent.click(screen.getByText('Re-upload'))
      expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('shows demo link in failed state', () => {
      render(
        <BurningAnimation
          {...defaultProps}
          status={{ status: 'failed' }}
        />
      )
      expect(screen.getByText('View Demo')).toBeInTheDocument()
    })

    it('shows default error message when no error provided', () => {
      render(
        <BurningAnimation
          {...defaultProps}
          status={{ status: 'failed' }}
        />
      )
      expect(screen.getByText('Scan failed.')).toBeInTheDocument()
    })

    it('localizes known failure codes', () => {
      render(
        <BurningAnimation
          {...defaultProps}
          status={{ status: 'failed', error: 'SCAN_FAILED' }}
        />
      )
      expect(screen.getByText('Scan failed.')).toBeInTheDocument()
    })
  })

  describe('Processing state', () => {
    it('renders step dots when processing', () => {
      render(
        <BurningAnimation
          {...defaultProps}
          status={{ status: 'processing' }}
        />
      )
      // Step dots should be present
      const progressSection = document.querySelector('.space-y-4')
      expect(progressSection).toBeInTheDocument()
    })
  })

  describe('Step dots', () => {
    it('shows dots at different progress levels', () => {
      const { rerender } = render(<BurningAnimation {...defaultProps} displayProgress={10} />)

      rerender(<BurningAnimation {...defaultProps} displayProgress={50} />)
      expect(screen.getByText('50%')).toBeInTheDocument()

      rerender(<BurningAnimation {...defaultProps} displayProgress={90} />)
      expect(screen.getByText('90%')).toBeInTheDocument()
    })
  })
})
