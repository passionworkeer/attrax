/**
 * Card component tests - covers lines 50-60 (CardDescription, CardAction)
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
} from '@/components/ui/card'

describe('Card components', () => {
  describe('CardDescription (lines 49-57)', () => {
    it('renders with default styling', () => {
      const { container } = render(<CardDescription>Description text</CardDescription>)
      expect(container.firstChild).toBeTruthy()
      expect(screen.getByText('Description text')).toBeInTheDocument()
    })

    it('renders with custom className', () => {
      const { container } = render(
        <CardDescription className="custom-class">Custom description</CardDescription>
      )
      expect(container.firstChild).toHaveClass('custom-class')
    })

    it('renders description with data-slot attribute', () => {
      const { container } = render(<CardDescription>Test</CardDescription>)
      expect(container.firstChild).toHaveAttribute('data-slot', 'card-description')
    })

    it('renders nested content', () => {
      render(
        <CardDescription>
          <span>Nested content</span>
        </CardDescription>
      )
      expect(screen.getByText('Nested content')).toBeInTheDocument()
    })

    it('renders with additional props spread', () => {
      const { container } = render(
        <CardDescription id="test-id" data-testid="description">
          Test with props
        </CardDescription>
      )
      expect(container.firstChild).toHaveAttribute('id', 'test-id')
      expect(container.firstChild).toHaveAttribute('data-testid', 'description')
    })
  })

  describe('CardAction (lines 59-70)', () => {
    it('renders action element', () => {
      const { container } = render(<CardAction>Action content</CardAction>)
      expect(container.firstChild).toBeTruthy()
      expect(screen.getByText('Action content')).toBeInTheDocument()
    })

    it('renders with data-slot attribute', () => {
      const { container } = render(<CardAction>Test</CardAction>)
      expect(container.firstChild).toHaveAttribute('data-slot', 'card-action')
    })

    it('renders with custom className', () => {
      const { container } = render(
        <CardAction className="action-custom">Custom action</CardAction>
      )
      expect(container.firstChild).toHaveClass('action-custom')
    })

    it('renders action button inside', () => {
      render(
        <CardAction>
          <button type="button">Action Button</button>
        </CardAction>
      )
      expect(screen.getByRole('button', { name: 'Action Button' })).toBeInTheDocument()
    })

    it('renders with additional props', () => {
      const { container } = render(
        <CardAction id="action-id" aria-label="Action area">
          Test
        </CardAction>
      )
      expect(container.firstChild).toHaveAttribute('id', 'action-id')
      expect(container.firstChild).toHaveAttribute('aria-label', 'Action area')
    })
  })

  describe('CardHeader with CardAction integration', () => {
    it('renders CardHeader with CardAction', () => {
      render(
        <CardHeader>
          <CardTitle>Header Title</CardTitle>
          <CardAction>
            <button type="button">Settings</button>
          </CardAction>
        </CardHeader>
      )
      expect(screen.getByText('Header Title')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    })
  })

  describe('Full Card composition', () => {
    it('renders complete card with all subcomponents', () => {
      render(
        <Card data-testid="main-card">
          <CardHeader>
            <CardTitle>Card Title</CardTitle>
            <CardDescription>Card description text</CardDescription>
            <CardAction>
              <button type="button">Action</button>
            </CardAction>
          </CardHeader>
          <CardContent>Main content</CardContent>
          <CardFooter>Footer content</CardFooter>
        </Card>
      )

      expect(screen.getByTestId('main-card')).toBeInTheDocument()
      expect(screen.getByText('Card Title')).toBeInTheDocument()
      expect(screen.getByText('Card description text')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument()
      expect(screen.getByText('Main content')).toBeInTheDocument()
      expect(screen.getByText('Footer content')).toBeInTheDocument()
    })

    it('renders card with sm size', () => {
      const { container } = render(<Card size="sm">Small card</Card>)
      expect(container.firstChild).toHaveAttribute('data-size', 'sm')
    })

    it('renders card with default size', () => {
      const { container } = render(<Card>Default card</Card>)
      expect(container.firstChild).toHaveAttribute('data-size', 'default')
    })
  })
})
