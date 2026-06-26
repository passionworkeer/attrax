/**
 * Tests for lib/pipeline/upload-storage.ts
 *
 * Mocks `fs` to avoid touching real data/uploads and logs/ in the repo.
 * Verifies sha-derived filenames, filename sanitization, best-effort write
 * failures (skipped silently), activity log appending, and recursive cleanup
 * helpers.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHash } from 'crypto'

// Provide a stable in-memory fs mock so we never touch real disk.
const fsMock = vi.hoisted(() => {
  const files = new Map<string, Buffer | string>()
  const dirs = new Set<string>()
  return {
    files,
    dirs,
    existsSync: vi.fn((p: string) => {
      const s = String(p)
      if (files.has(s)) return true
      return dirs.has(s)
    }),
    mkdirSync: vi.fn((p: string) => {
      dirs.add(String(p))
    }),
    readdirSync: vi.fn((p: string) => {
      const s = String(p)
      const out: string[] = []
      // naive: return direct children
      const prefix = s.endsWith('/') || s.endsWith('\\') ? s : s + '/'
      for (const k of files.keys()) {
        if (k.startsWith(prefix)) {
          const rest = k.slice(prefix.length)
          if (rest && !rest.includes('/') && !rest.includes('\\')) {
            out.push(rest)
          }
        }
      }
      for (const d of dirs) {
        if (d.startsWith(prefix)) {
          const rest = d.slice(prefix.length)
          if (rest && !rest.includes('/') && !rest.includes('\\')) {
            out.push(rest)
          }
        }
      }
      return Array.from(new Set(out))
    }),
    rmSync: vi.fn((p: string) => {
      const s = String(p)
      // remove dir and any files underneath
      for (const k of Array.from(files.keys())) {
        if (k === s || k.startsWith(s.endsWith('/') ? s : s + '/')) {
          files.delete(k)
        }
      }
      for (const d of Array.from(dirs)) {
        if (d === s || d.startsWith(s.endsWith('/') ? s : s + '/')) {
          dirs.delete(d)
        }
      }
      files.delete(s)
      dirs.delete(s)
    }),
    appendFileSync: vi.fn((p: string, data: string) => {
      const s = String(p)
      files.set(s, (files.get(s) as string ?? '') + data)
    }),
    writeFileSync: vi.fn((p: string, data: Buffer | string) => {
      files.set(String(p), Buffer.isBuffer(data) ? data : String(data))
    }),
  }
})

vi.mock('fs', () => ({ ...fsMock, default: fsMock }))

import {
  saveUploadsForSession,
  removeUploadsForSession,
  removeAllUploads,
  logUserActivity,
  UPLOAD_DIR,
  ACTIVITY_LOG,
  type SavedUploadKind,
} from '@/lib/pipeline/upload-storage'

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}
function sha12(buf: Buffer): string {
  return sha256(buf).slice(0, 12)
}
function fileEntry(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  kind: SavedUploadKind,
) {
  return { buffer, originalName, mimeType, kind }
}

describe('upload-storage', () => {
  beforeEach(() => {
    fsMock.files.clear()
    fsMock.dirs.clear()
    vi.clearAllMocks()
  })

  describe('saveUploadsForSession', () => {
    it('空数组直接返回 [] 且不创建目录', () => {
      const result = saveUploadsForSession('s1', [])
      expect(result).toEqual([])
      expect(fsMock.mkdirSync).not.toHaveBeenCalled()
    })

    it('正常写入图片并返回 SavedUpload', () => {
      const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
      const result = saveUploadsForSession('s1', [
        fileEntry(buf, 'photo.jpg', 'image/jpeg', 'image'),
      ])
      expect(result).toHaveLength(1)
      const r = result[0]
      expect(r.originalName).toBe('photo.jpg')
      expect(r.savedAs).toBe(`${sha12(buf)}_photo.jpg`)
      expect(r.size).toBe(buf.length)
      expect(r.mimeType).toBe('image/jpeg')
      expect(r.kind).toBe('image')
      expect(r.sha256).toBe(sha256(buf))
      expect(r.savedPath).toContain('s1')
      // writeFileSync 被调用一次，写入 buffer
      expect(fsMock.writeFileSync).toHaveBeenCalled()
    })

    it('相同内容不同原名的两个文件 → 共享 sha12 前缀', () => {
      const buf = Buffer.from('hello-world')
      const result = saveUploadsForSession('s1', [
        fileEntry(buf, 'a.png', 'image/png', 'image'),
        fileEntry(buf, 'b.png', 'image/png', 'image'),
      ])
      const prefix = sha12(buf)
      expect(result[0].savedAs).toBe(`${prefix}_a.png`)
      expect(result[1].savedAs).toBe(`${prefix}_b.png`)
    })

    it('非 ASCII / 特殊字符文件名被替换为下划线', () => {
      const buf = Buffer.from('x')
      // 源码：每个 [^a-zA-Z0-9._-] 字符各自替换为 _
      const orig = '中文 名字/路径?.jpg'
      const result = saveUploadsForSession('s1', [
        fileEntry(buf, orig, 'image/jpeg', 'image'),
      ])
      const expectedSanitized = orig.replace(/[^a-zA-Z0-9._-]/g, '_')
      expect(result[0].savedAs).toBe(`${sha12(buf)}_${expectedSanitized}`)
    })

    it('文件名超长被截断到 80 字符', () => {
      const buf = Buffer.from('y')
      const longName = 'a'.repeat(200) + '.jpg'
      const result = saveUploadsForSession('s1', [
        fileEntry(buf, longName, 'image/jpeg', 'image'),
      ])
      const sanitized = result[0].savedAs.slice(sha12(buf).length + 1)
      expect(sanitized.length).toBe(80)
    })

    it('document kind 透传', () => {
      const buf = Buffer.from('pdf')
      const result = saveUploadsForSession('s1', [
        fileEntry(buf, 'manual.pdf', 'application/pdf', 'document'),
      ])
      expect(result[0].kind).toBe('document')
    })

    it('多文件全部写入', () => {
      const result = saveUploadsForSession('s1', [
        fileEntry(Buffer.from('a'), 'a.jpg', 'image/jpeg', 'image'),
        fileEntry(Buffer.from('b'), 'b.jpg', 'image/jpeg', 'image'),
        fileEntry(Buffer.from('c'), 'c.pdf', 'application/pdf', 'document'),
      ])
      expect(result).toHaveLength(3)
      expect(fsMock.writeFileSync).toHaveBeenCalledTimes(3)
    })

    it('写入抛错时该文件被跳过，其它文件继续，整体不抛错', () => {
      fsMock.writeFileSync.mockImplementationOnce(() => {
        throw new Error('disk full')
      })
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const result = saveUploadsForSession('s1', [
        fileEntry(Buffer.from('fail'), 'a.jpg', 'image/jpeg', 'image'),
        fileEntry(Buffer.from('ok'), 'b.jpg', 'image/jpeg', 'image'),
      ])
      expect(result).toHaveLength(1)
      expect(result[0].originalName).toBe('b.jpg')
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })
  })

  describe('removeUploadsForSession', () => {
    it('目录不存在时静默返回不抛错', () => {
      expect(() =>
        removeUploadsForSession('never-exists'),
      ).not.toThrow()
      expect(fsMock.rmSync).not.toHaveBeenCalled()
    })

    it('目录存在时调用 rmSync 递归删除', () => {
      const sessionDir = `${UPLOAD_DIR}\\sess-rm`.replace(/\//g, '\\')
      // 用 mock 占位：让 existsSync 对该 dir 返回 true
      // 注意：源码用的是 join(UPLOAD_DIR, sessionId)
      const pathSep = /win32|win32/.test(process.platform) ? '\\' : '/'
      // 简单同时加入两种分隔形式以兼容
      fsMock.dirs.add(`${UPLOAD_DIR}/sess-rm`)
      fsMock.dirs.add(`${UPLOAD_DIR}\\sess-rm`)

      removeUploadsForSession('sess-rm')
      expect(fsMock.rmSync).toHaveBeenCalled()
    })
  })

  describe('removeAllUploads', () => {
    it('UPLOAD_DIR 不存在时静默返回', () => {
      // 默认 mock state：UPLOAD_DIR 既不是 file 也不是 dir
      expect(() => removeAllUploads()).not.toThrow()
      expect(fsMock.rmSync).not.toHaveBeenCalled()
    })

    it('UPLOAD_DIR 存在时枚举子项并逐个 rmSync', () => {
      // UPLOAD_DIR 自身必须存在（existsSync 返回 true），才会进入 readdirSync 分支
      fsMock.dirs.add(UPLOAD_DIR)
      fsMock.dirs.add(`${UPLOAD_DIR}/a`)
      fsMock.dirs.add(`${UPLOAD_DIR}/b`)
      removeAllUploads()
      expect(fsMock.rmSync).toHaveBeenCalled()
      const calls = fsMock.rmSync.mock.calls.map((c) => String(c[0]))
      expect(calls.some((p) => p.includes('a'))).toBe(true)
      expect(calls.some((p) => p.includes('b'))).toBe(true)
    })

    it('readdir 抛错时不抛出（best-effort）', () => {
      fsMock.dirs.add(UPLOAD_DIR)
      fsMock.readdirSync.mockImplementationOnce(() => {
        throw new Error('permission denied')
      })
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(() => removeAllUploads()).not.toThrow()
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })
  })

  describe('logUserActivity', () => {
    it('追加一行 JSON 到 ACTIVITY_LOG', () => {
      const entry = {
        ts: new Date().toISOString(),
        event: 'scan_started' as const,
        sessionId: 'sess-log',
        category: 'electronics',
        markets: ['EU'],
        fileCount: 2,
        totalBytes: 1234,
      }
      logUserActivity(entry)
      expect(fsMock.appendFileSync).toHaveBeenCalledWith(
        ACTIVITY_LOG,
        expect.stringContaining('"sessionId":"sess-log"'),
        'utf-8',
      )
      expect(fsMock.appendFileSync).toHaveBeenCalledWith(
        ACTIVITY_LOG,
        expect.stringContaining('"event":"scan_started"'),
        'utf-8',
      )
    })

    it('合法 event 类型透传 scan_completed / scan_failed', () => {
      for (const event of ['scan_completed', 'scan_failed'] as const) {
        logUserActivity({ ts: 't', event, sessionId: 'sess-' + event })
      }
      const calls = fsMock.appendFileSync.mock.calls
      expect(calls.some((c) => String(c[1]).includes('"event":"scan_completed"'))).toBe(true)
      expect(calls.some((c) => String(c[1]).includes('"event":"scan_failed"'))).toBe(true)
    })

    it('appendFileSync 抛错时静默（best-effort）', () => {
      fsMock.appendFileSync.mockImplementationOnce(() => {
        throw new Error('disk full')
      })
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(() =>
        logUserActivity({ ts: 't', event: 'scan_started', sessionId: 'x' }),
      ).not.toThrow()
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('同时创建 logs 目录（ensureDir）', () => {
      logUserActivity({ ts: 't', event: 'scan_started', sessionId: 'x' })
      // ensureDir 用 mkdirSync recursive
      expect(fsMock.mkdirSync).toHaveBeenCalledWith(
        expect.stringMatching(/logs/),
        { recursive: true },
      )
    })
  })
})
