import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { en } from './strings/en'

describe('App shell (smoke)', () => {
  it('renders the app name from the strings module with Tailwind classes', () => {
    render(<App />)
    const heading = screen.getByRole('heading', { level: 1, name: en.app.name })
    expect(heading).toBeInTheDocument()
    expect(heading).toHaveClass('text-3xl', 'font-bold')
    expect(screen.getByRole('main')).toHaveClass('min-h-screen')
  })
})
