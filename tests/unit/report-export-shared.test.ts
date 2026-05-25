import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectLocale, embedFont } from '@/lib/report-export-modules/shared'

describe('report export shared helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('falls back to zh when locale detection runs without a browser window', () => {
    vi.stubGlobal('window', undefined)

    expect(detectLocale()).toBe('zh')
  })

  it('embeds the font with the jsPDF addFont fallback path', async () => {
    const doc = {
      addFont: vi.fn(),
      setFont: vi.fn(),
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        arrayBuffer: async () => new Uint8Array([65, 66, 67]).buffer,
      })
    )

    await embedFont(doc as never)

    expect(doc.addFont).toHaveBeenCalledWith('QUJD', 'NotoSansSC', 'normal')
    expect(doc.setFont).toHaveBeenCalledWith('NotoSansSC', 'normal')
  })
})
