import { describe, expect, it, vi } from 'vitest'
import {
  ACCEPTED_DOCUMENT_TYPES,
  ACCEPTED_IMAGE_TYPES,
  validateUploadFile,
} from '@/lib/upload-validation'
import { MAX_DOCUMENT_SIZE_BYTES, MAX_IMAGE_SIZE_BYTES } from '@/lib/constants'

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

function makeFile(name: string, type: string, bytes: number[]): File {
  return new File([toArrayBuffer(new Uint8Array(bytes))], name, { type })
}

function oversizedFile(name: string, type: string, size: number): File {
  return {
    name,
    type,
    size,
    slice: vi.fn(),
  } as unknown as File
}

describe('validateUploadFile', () => {
  it('accepts image files with matching mime, extension, and signature', async () => {
    await expect(
      validateUploadFile(makeFile('product.jpg', 'image/jpeg', [0xff, 0xd8, 0xff]), 'image')
    ).resolves.toBeNull()
    await expect(
      validateUploadFile(makeFile('product.png', 'image/png', [0x89, 0x50, 0x4e, 0x47]), 'image')
    ).resolves.toBeNull()
    await expect(
      validateUploadFile(
        makeFile('product.webp', 'image/webp', [
          0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
        ]),
        'image'
      )
    ).resolves.toBeNull()
  })

  it('accepts document files with matching mime, extension, and signature', async () => {
    await expect(
      validateUploadFile(makeFile('manual.pdf', 'application/pdf', [0x25, 0x50, 0x44, 0x46]), 'document')
    ).resolves.toBeNull()
    await expect(
      validateUploadFile(
        makeFile(
          'manual.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          [0x50, 0x4b, 0x03, 0x04]
        ),
        'document'
      )
    ).resolves.toBeNull()
    await expect(
      validateUploadFile(
        makeFile('legacy.docx', 'application/octet-stream', [0x50, 0x4b, 0x05, 0x06]),
        'document'
      )
    ).resolves.toBeNull()
    await expect(
      validateUploadFile(makeFile('page.html', 'text/html', [0x3c, 0x68, 0x31, 0x3e]), 'document')
    ).resolves.toBeNull()
    await expect(
      validateUploadFile(makeFile('notes.txt', 'text/plain', [0x68, 0x69]), 'document')
    ).resolves.toBeNull()
  })

  it('rejects oversized files before reading their contents', async () => {
    const image = oversizedFile('big.jpg', 'image/jpeg', MAX_IMAGE_SIZE_BYTES + 1)
    const document = oversizedFile('big.pdf', 'application/pdf', MAX_DOCUMENT_SIZE_BYTES + 1)

    await expect(validateUploadFile(image, 'image')).resolves.toBe('IMAGE_TOO_LARGE')
    await expect(validateUploadFile(document, 'document')).resolves.toBe('DOCUMENT_TOO_LARGE')
    expect(image.slice).not.toHaveBeenCalled()
    expect(document.slice).not.toHaveBeenCalled()
  })

  it('rejects unsupported mime types or mismatched extensions', async () => {
    await expect(
      validateUploadFile(makeFile('product.gif', 'image/gif', [0x47, 0x49, 0x46]), 'image')
    ).resolves.toBe('UNSUPPORTED_IMAGE_TYPE')
    await expect(
      validateUploadFile(makeFile('product.txt', 'image/png', [0x89, 0x50, 0x4e, 0x47]), 'image')
    ).resolves.toBe('UNSUPPORTED_IMAGE_TYPE')
    await expect(
      validateUploadFile(makeFile('script.js', 'application/javascript', [0x63]), 'document')
    ).resolves.toBe('UNSUPPORTED_DOCUMENT_TYPE')
    await expect(
      validateUploadFile(makeFile('manual.txt', 'application/pdf', [0x25, 0x50, 0x44, 0x46]), 'document')
    ).resolves.toBe('UNSUPPORTED_DOCUMENT_TYPE')
  })

  it('rejects known file types with invalid signatures', async () => {
    await expect(
      validateUploadFile(makeFile('product.jpg', 'image/jpeg', [0x00, 0x00, 0x00]), 'image')
    ).resolves.toBe('INVALID_FILE_SIGNATURE')
    await expect(
      validateUploadFile(makeFile('product.webp', 'image/webp', [0x52, 0x49, 0x46, 0x46]), 'image')
    ).resolves.toBe('INVALID_FILE_SIGNATURE')
    await expect(
      validateUploadFile(makeFile('manual.pdf', 'application/pdf', [0x00, 0x00, 0x00]), 'document')
    ).resolves.toBe('INVALID_FILE_SIGNATURE')
    await expect(
      validateUploadFile(
        makeFile(
          'manual.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          [0x50, 0x4b, 0x01, 0x02]
        ),
        'document'
      )
    ).resolves.toBe('INVALID_FILE_SIGNATURE')
  })

  it('exports accepted mime type lists for the upload UI', () => {
    expect(ACCEPTED_IMAGE_TYPES).toEqual(['image/jpeg', 'image/png', 'image/webp'])
    expect(ACCEPTED_DOCUMENT_TYPES).toContain('application/pdf')
    expect(ACCEPTED_DOCUMENT_TYPES).toContain('text/plain')
  })
})
