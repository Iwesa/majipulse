import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { en } from './strings/en'

describe('App (smoke)', () => {
  it('renders the placeholder home page inside the app shell', () => {
    render(<App />)
    const heading = screen.getByRole('heading', { level: 1, name: en.app.name })
    expect(heading).toHaveClass('text-3xl', 'font-bold')
    expect(screen.getByRole('main')).toContainElement(heading)
    expect(screen.getByRole('link', { name: en.layout.skipToContent })).toBeInTheDocument()
    expect(screen.getByText(en.layout.offlineHelp)).toBeInTheDocument()
  })
})
