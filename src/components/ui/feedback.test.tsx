import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { en } from '../../strings/en'
import { Alert } from './Alert'
import { AsyncBoundary, type AsyncState } from './AsyncBoundary'
import { Badge } from './Badge'
import { Button } from './Button'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { Spinner } from './Spinner'

describe('Button', () => {
  it('defaults to type="button" and handles clicks', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toHaveAttribute('type', 'button')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('allows type="submit"', () => {
    render(<Button type="submit">Send</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit')
  })

  it('disables and marks busy while loading, keeping its name', () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('applies variant classes', () => {
    render(<Button variant="danger">Delete</Button>)
    expect(screen.getByRole('button')).toHaveClass('bg-red-700')
  })
})

describe('Badge', () => {
  it('shows its text and hides the decorative icon', () => {
    render(<Badge tone="warning" icon={<svg data-testid="icon" />}>Pending</Badge>)
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByTestId('icon').parentElement).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('Alert', () => {
  it.each([
    ['error', 'alert'],
    ['warning', 'alert'],
    ['info', 'status'],
    ['success', 'status'],
  ] as const)('%s uses role %s', (tone, role) => {
    render(<Alert tone={tone} title="Title">Body</Alert>)
    const alert = screen.getByRole(role)
    expect(alert).toHaveTextContent('Title')
    expect(alert).toHaveTextContent('Body')
  })
})

describe('Spinner', () => {
  it('announces the default loading label', () => {
    render(<Spinner />)
    expect(screen.getByRole('status')).toHaveTextContent(en.common.loading)
  })
  it('announces a custom label', () => {
    render(<Spinner label="Loading water points" />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading water points')
  })
  it('renders nothing announceable when decorative', () => {
    render(<Spinner decorative />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('EmptyState and ErrorState', () => {
  it('EmptyState uses the default title and renders an action', () => {
    render(<EmptyState description="Add the first water point." action={<Button>Add</Button>} />)
    expect(screen.getByRole('heading', { name: en.states.emptyTitle })).toBeInTheDocument()
    expect(screen.getByText('Add the first water point.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })

  it('ErrorState is an alert with defaults and no retry button by default', () => {
    render(<ErrorState />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(en.states.errorTitle)
    expect(alert).toHaveTextContent(en.states.errorDescription)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('ErrorState retry calls back', () => {
    const onRetry = vi.fn()
    render(<ErrorState message="Could not load reports." onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: en.common.retry }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})

describe('AsyncBoundary', () => {
  const renderList = (state: AsyncState<string[]>, onRetry?: () => void) =>
    render(
      <AsyncBoundary state={state} isEmpty={(items) => items.length === 0} onRetry={onRetry}>
        {(items) => (
          <ul>
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </AsyncBoundary>,
    )

  it('loading: shows an announced spinner', () => {
    renderList({ status: 'loading' })
    expect(screen.getByRole('status')).toHaveTextContent(en.common.loading)
  })

  it('error: shows the message and a retry action', () => {
    const onRetry = vi.fn()
    renderList({ status: 'error', message: 'Could not load.' }, onRetry)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load.')
    fireEvent.click(screen.getByRole('button', { name: en.common.retry }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('error: falls back to the default description', () => {
    renderList({ status: 'error' })
    expect(screen.getByRole('alert')).toHaveTextContent(en.states.errorDescription)
  })

  it('offline: explains that a connection is needed', () => {
    renderList({ status: 'offline' })
    expect(screen.getByRole('heading', { name: en.states.offlineTitle })).toBeInTheDocument()
    expect(screen.getByText(en.states.offlineDescription)).toBeInTheDocument()
  })

  it('empty: shows the default empty state', () => {
    renderList({ status: 'ready', data: [] })
    expect(screen.getByRole('heading', { name: en.states.emptyTitle })).toBeInTheDocument()
  })

  it('empty: shows custom empty content', () => {
    render(
      <AsyncBoundary state={{ status: 'ready', data: [] }} isEmpty={(d) => d.length === 0} empty={<p>No reports yet</p>}>
        {() => null}
      </AsyncBoundary>,
    )
    expect(screen.getByText('No reports yet')).toBeInTheDocument()
  })

  it('ready: renders the data', () => {
    renderList({ status: 'ready', data: ['Mwamanga Borehole (fictional)'] })
    expect(screen.getByRole('listitem')).toHaveTextContent('Mwamanga Borehole (fictional)')
  })
})
