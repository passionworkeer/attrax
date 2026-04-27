import { describe, it, expect } from 'vitest'
import { cn } from '@/lib/utils'

describe('cn utility', () => {
  it('merges class names correctly', () => {
    const result = cn('foo', 'bar')
    expect(result).toContain('foo')
    expect(result).toContain('bar')
  })

  it('handles conditional classes', () => {
    const result = cn('base', false && 'conditional', 'active')
    expect(result).toContain('base')
    expect(result).toContain('active')
    expect(result).not.toContain('conditional')
  })

  it('handles undefined and null', () => {
    const result = cn('base', undefined, null, 'end')
    expect(result).toBe('base end')
  })

  it('handles array input', () => {
    const result = cn(['a', 'b'], 'c')
    expect(result).toContain('a')
    expect(result).toContain('b')
    expect(result).toContain('c')
  })
})