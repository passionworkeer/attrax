import { describe, it, expect } from 'vitest'
import { cn } from '@/lib/utils'

describe('cn utility - advanced cases', () => {
  it('handles empty strings', () => {
    expect(cn('')).toBe('')
    expect(cn('', '')).toBe('')
  })

  it('handles whitespace properly', () => {
    const result = cn('  class1  ', '  class2  ')
    expect(result).toContain('class1')
    expect(result).toContain('class2')
  })

  it('handles duplicate classes', () => {
    const result = cn('foo', 'foo')
    expect(result).toContain('foo')
  })

  it('handles complex conditional logic', () => {
    const isActive = true
    const isDisabled = false
    const hasError = false
    const result = cn(
      'base-class',
      isActive && 'active',
      isDisabled && 'disabled',
      hasError && 'error'
    )
    expect(result).toContain('base-class')
    expect(result).toContain('active')
    expect(result).not.toContain('disabled')
    expect(result).not.toContain('error')
  })

  it('handles object input for conditional classes', () => {
    const classes = { active: true, disabled: false, hidden: true }
    const result = cn('base', classes)
    expect(result).toContain('base')
    expect(result).toContain('active')
    expect(result).not.toContain('disabled')
    expect(result).toContain('hidden')
  })

  it('flattens nested arrays', () => {
    const result = cn(['a', ['b', 'c']], 'd')
    expect(result).toContain('a')
    expect(result).toContain('b')
    expect(result).toContain('c')
    expect(result).toContain('d')
  })

  it('handles mixed input types', () => {
    const result = cn('base', ['array1', 'array2'], { conditional: true }, false && 'ignored')
    expect(result).toContain('base')
    expect(result).toContain('array1')
    expect(result).toContain('array2')
    expect(result).toContain('conditional')
  })
})

describe('cn with Tailwind merge scenarios', () => {
  it('preserves tailwind classes', () => {
    const result = cn('px-4 py-2', 'px-2')
    expect(result).toContain('py-2')
  })

  it('handles tailwind variant combinations', () => {
    const result = cn('flex items-center justify-between', 'justify-start')
    expect(result).toContain('flex')
    expect(result).toContain('items-center')
    expect(result).toContain('justify-start')
  })

  it('preserves non-conflicting tailwind classes', () => {
    const result = cn('text-sm text-red-500', 'bg-blue-500')
    expect(result).toContain('text-sm')
    expect(result).toContain('text-red-500')
    expect(result).toContain('bg-blue-500')
  })
})
