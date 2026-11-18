import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { cn } from './cn'
import { useOnlineStatus } from './useOnlineStatus'

function Probe() {
  return <p>{useOnlineStatus() ? 'online' : 'offline'}</p>
}

describe('useOnlineStatus', () => {
  it('follows navigator.onLine and online/offline events', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    render(<Probe />)
    expect(screen.getByText('online')).toBeInTheDocument()

    onLine.mockReturnValue(false)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(screen.getByText('offline')).toBeInTheDocument()

    onLine.mockReturnValue(true)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(screen.getByText('online')).toBeInTheDocument()
  })
})

describe('cn', () => {
  it('joins truthy class names', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b')
  })
})
