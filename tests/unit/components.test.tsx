import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card'
import React from 'react'

describe('Button component', () => {
  it('renders with default variant', () => {
    const { container } = render(<Button>Click me</Button>)
    expect(container.firstChild).toBeTruthy()
  })

  it('renders with different variants', () => {
    const variants = ['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'] as const
    variants.forEach(variant => {
      const { container } = render(<Button variant={variant}>Button</Button>)
      expect(container.firstChild).toBeTruthy()
    })
  })

  it('renders with different sizes', () => {
    const sizes = ['default', 'sm', 'lg', 'icon'] as const
    sizes.forEach(size => {
      const { container } = render(<Button size={size}>Button</Button>)
      expect(container.firstChild).toBeTruthy()
    })
  })

  it('handles disabled state', () => {
    const { container } = render(<Button disabled>Disabled</Button>)
    expect(container.firstChild).toHaveAttribute('disabled')
  })
})

describe('Card component', () => {
  it('renders Card with default size', () => {
    const { container } = render(<Card>Card content</Card>)
    expect(container.firstChild).toBeTruthy()
  })

  it('renders CardHeader', () => {
    const { container } = render(<CardHeader>Header</CardHeader>)
    expect(container.firstChild).toBeTruthy()
  })

  it('renders CardTitle', () => {
    const { getByText } = render(<CardTitle>Title</CardTitle>)
    expect(getByText('Title')).toBeTruthy()
  })

  it('renders CardContent', () => {
    const { getByText } = render(<CardContent>Content</CardContent>)
    expect(getByText('Content')).toBeTruthy()
  })

  it('renders CardFooter', () => {
    const { container } = render(<CardFooter>Footer</CardFooter>)
    expect(container.firstChild).toBeTruthy()
  })

  it('renders Card with sm size', () => {
    const { container } = render(<Card size="sm">Small Card</Card>)
    expect(container.firstChild).toBeTruthy()
  })
})
