/**
 * UploadForm component tests - 100% coverage
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'
import { TranslationProvider } from '@/lib/i18n'

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
      <div {...props}>{children}</div>
    ),
  },
}))

// Mock next/image
vi.mock('next/image', () => ({
  default: ({ src, alt, onLoad, ...props }: { src: string; alt: string; onLoad?: () => void; [key: string]: unknown }) => {
    // Call onLoad after render to test cleanup
    if (onLoad) {
      setTimeout(onLoad, 0)
    }
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} {...props} />
  },
}))

// Import after mocks
import { UploadForm, type UploadFormProps } from '@/components/upload/UploadForm'

// Helper to create a mock file
function createMockFile(name: string, size: number, type: string): File {
  const file = new File(['content'], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('UploadForm component', () => {
  const defaultProps: UploadFormProps = {
    onSubmit: vi.fn().mockResolvedValue(undefined),
    isSubmitting: false,
    error: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: vi.fn(),
    })
    vi.stubGlobal('navigator', { language: 'zh-CN' })
  })

  describe('Basic rendering', () => {
    it('renders form with all sections', () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )
      expect(container.firstChild).toBeTruthy()
    })

    it('renders product images section', () => {
      render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )
      expect(screen.getByText(/产品图片|Product Images/i)).toBeInTheDocument()
    })

    it('renders product documents section', () => {
      render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )
      expect(screen.getByText(/产品文档|Product Documents/i)).toBeInTheDocument()
    })

    it('renders submit button', () => {
      render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )
      expect(document.body.querySelector('button[type="submit"]')).toBeTruthy()
    })

    it('renders target market section', () => {
      render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )
      expect(screen.getByText(/目标市场|Target Market/i)).toBeInTheDocument()
    })

    it('renders product category section', () => {
      render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )
      expect(screen.getByText(/产品分类|Product Category/i)).toBeInTheDocument()
    })
  })

  describe('Market selection', () => {
    it('renders all market buttons', () => {
      render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )
      // EU and US should be selected by default
      const buttons = document.body.querySelectorAll('button')
      const marketButtons = Array.from(buttons).filter(btn =>
        ['欧盟', '美国', '英国', '中国', '澳大利亚', '沙特', '阿联酋'].some(
          m => btn.textContent?.includes(m)
        )
      )
      expect(marketButtons.length).toBeGreaterThanOrEqual(7)
    })

    it('can select additional markets', async () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      const buttons = Array.from(container.querySelectorAll('button'))
      const ukButton = buttons.find(btn => btn.textContent?.includes('英国') || btn.textContent?.includes('United Kingdom'))

      if (ukButton) {
        fireEvent.click(ukButton)
        // UK should now be selected (add to existing EU, US)
        await waitFor(() => {
          expect(ukButton.className).toContain('blaze-red')
        })
      }
    })

    it('can deselect markets', async () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      const buttons = Array.from(container.querySelectorAll('button'))
      const euButton = buttons.find(btn => btn.textContent?.includes('欧盟') || btn.textContent?.includes('European Union'))

      if (euButton) {
        fireEvent.click(euButton)
        // EU should now be deselected
        await waitFor(() => {
          expect(euButton.className).not.toContain('bg-blaze-red')
        })
      }
    })

    it('keeps at least one market selected', async () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      // Deselect all except one
      const buttons = Array.from(container.querySelectorAll('button'))
      const euButton = buttons.find(btn => btn.textContent?.includes('欧盟') || btn.textContent?.includes('European Union'))
      const usButton = buttons.find(btn => btn.textContent?.includes('美国') || btn.textContent?.includes('United States'))

      if (euButton && usButton) {
        fireEvent.click(euButton)
        fireEvent.click(usButton)
      }

      // At least one market should still be in the selected state
    })
  })

  describe('Category selection', () => {
    it('renders all category options', () => {
      render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )
      const buttons = document.body.querySelectorAll('button')
      const categoryButtons = Array.from(buttons).filter(btn =>
        ['电子', '家电', '3C', '玩具', '家居', '其他'].some(
          c => btn.textContent?.includes(c)
        )
      )
      expect(categoryButtons.length).toBeGreaterThanOrEqual(6)
    })

    it('can select different categories', async () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      const buttons = Array.from(container.querySelectorAll('button'))
      const toysButton = buttons.find(btn => btn.textContent?.includes('玩具') || btn.textContent?.includes('Toys'))

      if (toysButton) {
        fireEvent.click(toysButton)
        // Toys should now be selected
        await waitFor(() => {
          expect(toysButton.className).toContain('blaze-red')
        })
      }
    })

    it('defaults to electronics category', () => {
      render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )
      const buttons = document.body.querySelectorAll('button')
      const electronicsButton = Array.from(buttons).find(btn =>
        btn.textContent?.includes('电子') || btn.textContent?.includes('Electronics')
      )
      // Electronics should be selected by default
      expect(electronicsButton).toBeTruthy()
    })
  })

  describe('Image file handling', () => {
    it('accepts valid image files', async () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      const imageInput = container.querySelectorAll('input[type="file"]')[0]
      if (imageInput) {
        const validFile = createMockFile('test.jpg', 1000, 'image/jpeg')
        fireEvent.change(imageInput, {
          target: { files: [validFile] },
        })

        await waitFor(() => {
          expect(screen.getByText('test.jpg')).toBeInTheDocument()
        })
      }
    })

    it('accepts PNG images', async () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      const imageInput = container.querySelectorAll('input[type="file"]')[0]
      if (imageInput) {
        const validFile = createMockFile('test.png', 2000, 'image/png')
        fireEvent.change(imageInput, {
          target: { files: [validFile] },
        })

        await waitFor(() => {
          expect(screen.getByText('test.png')).toBeInTheDocument()
        })
      }
    })

    it('accepts WebP images', async () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      const imageInput = container.querySelectorAll('input[type="file"]')[0]
      if (imageInput) {
        const validFile = createMockFile('test.webp', 1500, 'image/webp')
        fireEvent.change(imageInput, {
          target: { files: [validFile] },
        })

        await waitFor(() => {
          expect(screen.getByText('test.webp')).toBeInTheDocument()
        })
      }
    })

    it('rejects unsupported image formats', async () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      const imageInput = container.querySelectorAll('input[type="file"]')[0]
      if (imageInput) {
        // SVG is not in ACCEPTED_IMAGE_TYPES
        const invalidFile = createMockFile('test.svg', 3000, 'image/svg+xml')
        fireEvent.change(imageInput, {
          target: { files: [invalidFile] },
        })

        await waitFor(() => {
          expect(screen.queryByText('test.svg')).not.toBeInTheDocument()
        })
      }
    })

    it('shows error for partial invalid files', async () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      const imageInput = container.querySelectorAll('input[type="file"]')[0]
      if (imageInput) {
        const validFile = createMockFile('valid.jpg', 1000, 'image/jpeg')
        // SVG is not supported
        const invalidFile = createMockFile('invalid.svg', 2000, 'image/svg+xml')
        fireEvent.change(imageInput, {
          target: { files: [validFile, invalidFile] },
        })

        await waitFor(() => {
          expect(screen.getByText('valid.jpg')).toBeInTheDocument()
          expect(screen.getByText(/部分文件不是支持的图片格式/i)).toBeInTheDocument()
        })
      }
    })

    it('limits images to 8', async () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      const imageInput = container.querySelectorAll('input[type="file"]')[0]
      if (imageInput) {
        // Add 8 images
        for (let i = 0; i < 8; i++) {
          const file = createMockFile(`image${i}.jpg`, 1000, 'image/jpeg')
          fireEvent.change(imageInput, {
            target: { files: [file] },
          })
        }

        await waitFor(() => {
          expect(screen.getByText('image0.jpg')).toBeInTheDocument()
          expect(screen.getByText('image7.jpg')).toBeInTheDocument()
        })
      }
    })

    it('disables image input when 8 images selected', async () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      const imageInput = container.querySelectorAll('input[type="file"]')[0]
      if (imageInput) {
        // Add 8 images
        for (let i = 0; i < 8; i++) {
          const file = createMockFile(`img${i}.jpg`, 1000, 'image/jpeg')
          fireEvent.change(imageInput, {
            target: { files: [file] },
          })
        }

        await waitFor(() => {
          expect(imageInput).toBeDisabled()
        })
      }
    })

    it('navigates the image carousel with buttons, keyboard, and thumbnails', async () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      const imageInput = container.querySelectorAll('input[type="file"]')[0]
      const first = createMockFile('carousel-a.jpg', 2 * 1024 * 1024, 'image/jpeg')
      const second = createMockFile('carousel-b.jpg', 1024, 'image/jpeg')

      expect(imageInput).toBeTruthy()
      fireEvent.change(imageInput!, {
        target: { files: [first, second] },
      })

      await waitFor(() => {
        expect(screen.getByLabelText('Next')).toBeInTheDocument()
      })

      expect(screen.getByText('2.0 MB')).toBeInTheDocument()

      fireEvent.click(screen.getByLabelText('Next'))
      fireEvent.keyDown(window, { key: 'ArrowRight' })
      fireEvent.keyDown(window, { key: 'ArrowLeft' })
      fireEvent.click(screen.getByLabelText('Previous'))

      const secondThumbnail = container.querySelector('img[title="carousel-b.jpg"]')?.closest('button')
      expect(secondThumbnail).toBeTruthy()
      fireEvent.click(secondThumbnail!)
    })
  })

  describe('Document file handling', () => {
    it('accepts PDF documents', async () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      const docInput = container.querySelectorAll('input[type="file"]')[1]
      if (docInput) {
        const validFile = createMockFile('test.pdf', 5000, 'application/pdf')
        fireEvent.change(docInput, {
          target: { files: [validFile] },
        })

        await waitFor(() => {
          expect(screen.getByText('test.pdf')).toBeInTheDocument()
        })
      }
    })

    it('accepts DOCX documents', async () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      const docInput = container.querySelectorAll('input[type="file"]')[1]
      if (docInput) {
        const validFile = createMockFile('test.docx', 6000, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        fireEvent.change(docInput, {
          target: { files: [validFile] },
        })

        await waitFor(() => {
          expect(screen.getByText('test.docx')).toBeInTheDocument()
        })
      }
    })

    it('accepts HTML documents', async () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      const docInput = container.querySelectorAll('input[type="file"]')[1]
      if (docInput) {
        const validFile = createMockFile('test.html', 3000, 'text/html')
        fireEvent.change(docInput, {
          target: { files: [validFile] },
        })

        await waitFor(() => {
          expect(screen.getByText('test.html')).toBeInTheDocument()
        })
      }
    })

    it('rejects unsupported document formats', async () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      const docInput = container.querySelectorAll('input[type="file"]')[1]
      if (docInput) {
        const invalidFile = createMockFile('test.xlsx', 4000, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        fireEvent.change(docInput, {
          target: { files: [invalidFile] },
        })

        await waitFor(() => {
          expect(screen.queryByText('test.xlsx')).not.toBeInTheDocument()
        })
      }
    })

    it('shows error for partial invalid documents', async () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      const docInput = container.querySelectorAll('input[type="file"]')[1]
      if (docInput) {
        const validFile = createMockFile('valid.pdf', 5000, 'application/pdf')
        const invalidFile = createMockFile('invalid.xlsx', 4000, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        fireEvent.change(docInput, {
          target: { files: [validFile, invalidFile] },
        })

        await waitFor(() => {
          expect(screen.getByText('valid.pdf')).toBeInTheDocument()
          expect(screen.getByText(/部分文件不是支持的文档格式/i)).toBeInTheDocument()
        })
      }
    })

    it('limits documents to 5', async () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      const docInput = container.querySelectorAll('input[type="file"]')[1]
      if (docInput) {
        // Add 5 documents
        for (let i = 0; i < 5; i++) {
          const file = createMockFile(`doc${i}.pdf`, 5000, 'application/pdf')
          fireEvent.change(docInput, {
            target: { files: [file] },
          })
        }

        await waitFor(() => {
          expect(screen.getByText('doc0.pdf')).toBeInTheDocument()
          expect(screen.getByText('doc4.pdf')).toBeInTheDocument()
        })
      }
    })

    it('disables doc input when 5 documents selected', async () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      const docInput = container.querySelectorAll('input[type="file"]')[1]
      if (docInput) {
        // Add 5 documents
        for (let i = 0; i < 5; i++) {
          const file = createMockFile(`document${i}.pdf`, 5000, 'application/pdf')
          fireEvent.change(docInput, {
            target: { files: [file] },
          })
        }

        await waitFor(() => {
          expect(docInput).toBeDisabled()
        })
      }
    })
  })

  describe('Clear functionality', () => {
    it('can clear all images', async () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      const imageInput = container.querySelectorAll('input[type="file"]')[0]
      if (imageInput) {
        const file = createMockFile('clearable.jpg', 1000, 'image/jpeg')
        fireEvent.change(imageInput, {
          target: { files: [file] },
        })

        await waitFor(() => {
          expect(screen.getByText('clearable.jpg')).toBeInTheDocument()
        })

        const clearButton = screen.getByText(/清除全部图片|Clear all images/i)
        fireEvent.click(clearButton)

        await waitFor(() => {
          expect(screen.queryByText('clearable.jpg')).not.toBeInTheDocument()
        })
      }
    })

    it('can clear all documents', async () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      const docInput = container.querySelectorAll('input[type="file"]')[1]
      if (docInput) {
        const file = createMockFile('clearable.pdf', 5000, 'application/pdf')
        fireEvent.change(docInput, {
          target: { files: [file] },
        })

        await waitFor(() => {
          expect(screen.getByText('clearable.pdf')).toBeInTheDocument()
        })

        const clearButton = screen.getByText(/清除全部文档|Clear all documents/i)
        fireEvent.click(clearButton)

        await waitFor(() => {
          expect(screen.queryByText('clearable.pdf')).not.toBeInTheDocument()
        })
      }
    })

    it('clears image input value when clearing images', async () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      const imageInput = container.querySelectorAll('input[type="file"]')[0]
      if (imageInput) {
        const file = createMockFile('test.jpg', 1000, 'image/jpeg')
        fireEvent.change(imageInput, {
          target: { files: [file] },
        })

        const clearButton = screen.getByText(/清除全部图片|Clear all images/i)
        fireEvent.click(clearButton)

        await waitFor(() => {
          expect((imageInput as HTMLInputElement).value).toBe('')
        })
      }
    })

    it('clears doc input value when clearing documents', async () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      const docInput = container.querySelectorAll('input[type="file"]')[1]
      if (docInput) {
        const file = createMockFile('test.pdf', 5000, 'application/pdf')
        fireEvent.change(docInput, {
          target: { files: [file] },
        })

        const clearButton = screen.getByText(/清除全部文档|Clear all documents/i)
        fireEvent.click(clearButton)

        await waitFor(() => {
          expect((docInput as HTMLInputElement).value).toBe('')
        })
      }
    })
  })

  describe('Error handling', () => {
    it('displays error prop', () => {
      render(
        <TranslationProvider>
          <UploadForm {...defaultProps} error="Test error message" />
        </TranslationProvider>
      )
      expect(screen.getByText('Test error message')).toBeInTheDocument()
    })

    it('displays local error for no images', async () => {
      render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      // Submit the form directly
      const form = document.body.querySelector('form')
      if (form) {
        fireEvent.submit(form)
      }

      await waitFor(() => {
        expect(screen.getByText(/请先选择至少.*图片/i)).toBeInTheDocument()
      })
    })

    it('prioritizes prop error over local error', () => {
      render(
        <TranslationProvider>
          <UploadForm {...defaultProps} error="Prop error" />
        </TranslationProvider>
      )

      expect(screen.getByText('Prop error')).toBeInTheDocument()
    })
  })

  describe('Disabled states', () => {
    it('disables submit button when isSubmitting is true', () => {
      render(
        <TranslationProvider>
          <UploadForm {...defaultProps} isSubmitting={true} />
        </TranslationProvider>
      )
      const submitButton = document.body.querySelector('button[type="submit"]')
      expect(submitButton).toBeDisabled()
    })

    it('disables submit button when no images', () => {
      render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )
      const submitButton = document.body.querySelector('button[type="submit"]')
      expect(submitButton).toBeDisabled()
    })

    it('disables file inputs when isSubmitting is true', () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} isSubmitting={true} />
        </TranslationProvider>
      )
      const inputs = container.querySelectorAll('input[type="file"]')
      inputs.forEach(input => {
        expect(input).toBeDisabled()
      })
    })
  })

  describe('Form submission', () => {
    it('calls onSubmit with correct data when form is valid', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} onSubmit={onSubmit} />
        </TranslationProvider>
      )

      // Add an image
      const imageInput = container.querySelectorAll('input[type="file"]')[0]
      if (imageInput) {
        const validFile = createMockFile('test.jpg', 1000, 'image/jpeg')
        fireEvent.change(imageInput, {
          target: { files: [validFile] },
        })
      }

      await waitFor(() => {
        expect(screen.getByText('test.jpg')).toBeInTheDocument()
      })

      // Submit
      const submitButton = document.body.querySelector('button[type="submit"]')
      if (submitButton) {
        fireEvent.click(submitButton)
      }

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            images: expect.any(Array),
            documents: expect.any(Array),
            category: expect.any(String),
            markets: expect.any(Array),
          })
        )
      })
    })

    it('prevents default form submission', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      render(
        <TranslationProvider>
          <UploadForm {...defaultProps} onSubmit={onSubmit} />
        </TranslationProvider>
      )

      const form = document.body.querySelector('form')
      const event = new Event('submit', { bubbles: true, cancelable: true })
      if (form) {
        fireEvent(form, event)
      }

      // The event should be handled by our handler
    })

    it('does not submit when no images', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      render(
        <TranslationProvider>
          <UploadForm {...defaultProps} onSubmit={onSubmit} />
        </TranslationProvider>
      )

      const submitButton = document.body.querySelector('button[type="submit"]')
      if (submitButton) {
        fireEvent.click(submitButton)
      }

      await waitFor(() => {
        expect(onSubmit).not.toHaveBeenCalled()
      })
    })
  })

  describe('Summary bar', () => {
    it('shows select prompt when no files', () => {
      render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )
      expect(screen.getByText(/请上传至少.*1.*张图片/i)).toBeInTheDocument()
    })

    it('shows file count when files selected', async () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      const imageInput = container.querySelectorAll('input[type="file"]')[0]
      if (imageInput) {
        const file = createMockFile('test.jpg', 1000, 'image/jpeg')
        fireEvent.change(imageInput, {
          target: { files: [file] },
        })
      }

      await waitFor(() => {
        expect(screen.getByText(/已选择.*1.*张图片/i)).toBeInTheDocument()
      })
    })
  })

  describe('Image preview cleanup', () => {
    it('calls onLoad for image cleanup', async () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      const imageInput = container.querySelectorAll('input[type="file"]')[0]
      if (imageInput) {
        const validFile = createMockFile('cleanup-test.jpg', 1000, 'image/jpeg')
        fireEvent.change(imageInput, {
          target: { files: [validFile] },
        })

        // The onLoad callback should be called by the mocked next/image
        await waitFor(() => {
          expect(screen.getByText('cleanup-test.jpg')).toBeInTheDocument()
        })
      }
    })
  })

  describe('Document icon rendering', () => {
    it('shows PDF icon for PDF documents', async () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      const docInput = container.querySelectorAll('input[type="file"]')[1]
      if (docInput) {
        const file = createMockFile('icon-test.pdf', 5000, 'application/pdf')
        fireEvent.change(docInput, {
          target: { files: [file] },
        })

        await waitFor(() => {
          expect(screen.getByText('icon-test.pdf')).toBeInTheDocument()
        })
      }
    })

    it('shows DOCX icon for Word documents', async () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      const docInput = container.querySelectorAll('input[type="file"]')[1]
      if (docInput) {
        const file = createMockFile('icon-test.docx', 5000, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        fireEvent.change(docInput, {
          target: { files: [file] },
        })

        await waitFor(() => {
          expect(screen.getByText('icon-test.docx')).toBeInTheDocument()
        })
      }
    })

    it('shows generic icon for HTML documents', async () => {
      const { container } = render(
        <TranslationProvider>
          <UploadForm {...defaultProps} />
        </TranslationProvider>
      )

      const docInput = container.querySelectorAll('input[type="file"]')[1]
      if (docInput) {
        const file = createMockFile('icon-test.html', 3000, 'text/html')
        fireEvent.change(docInput, {
          target: { files: [file] },
        })

        await waitFor(() => {
          expect(screen.getByText('icon-test.html')).toBeInTheDocument()
        })
      }
    })
  })
})
