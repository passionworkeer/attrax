/**
 * Button component tests
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'
import { Button, buttonVariants } from '@/components/ui/button'

describe('Button component', () => {
  it('renders with children', () => {
    const { container } = render(<Button>Click me</Button>)
    expect(container.firstChild).toBeTruthy()
    expect(screen.getByText('Click me')).toBeInTheDocument()
  })

  it('renders with different variants', () => {
    const variants = ['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'] as const

    variants.forEach(variant => {
      const { container } = render(<Button variant={variant}>{variant}</Button>)
      expect(container.firstChild).toBeTruthy()
      expect(container.firstChild).toHaveClass('group/button')
    })
  })

  it('renders with different sizes', () => {
    const sizes = ['default', 'sm', 'lg', 'xs', 'icon', 'icon-xs', 'icon-sm', 'icon-lg'] as const

    sizes.forEach(size => {
      const { container } = render(<Button size={size}>Button</Button>)
      expect(container.firstChild).toBeTruthy()
    })
  })

  it('handles click events', () => {
    const handleClick = vi.fn()
    render(<Button onClick={handleClick}>Click</Button>)
    screen.getByRole('button').click()
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('handles disabled state', () => {
    const handleClick = vi.fn()
    render(
      <Button disabled onClick={handleClick}>
        Disabled
      </Button>
    )
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('handles loading state', () => {
    render(<Button disabled>Loading...</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('applies custom className', () => {
    const { container } = render(<Button className="custom-class">Custom</Button>)
    expect(container.firstChild).toHaveClass('custom-class')
  })

  it('renders with data-slot attribute', () => {
    const { container } = render(<Button>Test</Button>)
    expect(container.firstChild).toHaveAttribute('data-slot', 'button')
  })

  it('handles type prop', () => {
    const { container } = render(<Button type="submit">Submit</Button>)
    expect(container.firstChild).toHaveAttribute('type', 'submit')
  })

  it('handles onMouseDown event', () => {
    const handleMouseDown = vi.fn()
    const { container } = render(<Button onMouseDown={handleMouseDown}>Button</Button>)
    fireEvent.mouseDown(screen.getByRole('button'))
    expect(handleMouseDown).toHaveBeenCalledTimes(1)
  })
})

describe('buttonVariants', () => {
  it('returns default classes for default variant and size', () => {
    const result = buttonVariants({})
    expect(result).toContain('bg-primary')
    expect(result).toContain('text-primary-foreground')
  })

  it('returns correct classes for outline variant', () => {
    const result = buttonVariants({ variant: 'outline' })
    expect(result).toContain('border-border')
    expect(result).toContain('bg-background')
  })

  it('returns correct classes for destructive variant', () => {
    const result = buttonVariants({ variant: 'destructive' })
    expect(result).toContain('bg-destructive/10')
    expect(result).toContain('text-destructive')
  })

  it('returns correct classes for link variant', () => {
    const result = buttonVariants({ variant: 'link' })
    expect(result).toContain('text-primary')
    expect(result).toContain('underline-offset-4')
  })

  it('returns correct classes for icon size', () => {
    const result = buttonVariants({ size: 'icon' })
    expect(result).toContain('size-8')
  })

  it('handles combined variant and size', () => {
    const result = buttonVariants({ variant: 'secondary', size: 'lg' })
    expect(result).toContain('bg-secondary')
    expect(result).toContain('h-9')
  })
})
