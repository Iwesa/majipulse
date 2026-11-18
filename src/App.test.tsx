import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { en } from './strings/en'
import { FakeAuthService, renderApp, signedIn } from './test/fakeServices'

describe('App (smoke)', () => {
  it('renders the home page inside the app shell for a signed-in user', async () => {
    renderApp('/', { auth: new FakeAuthService(signedIn('reporter')) })
    const heading = await screen.findByRole('heading', { level: 1, name: en.home.title })
    expect(screen.getByRole('main')).toContainElement(heading)
    expect(screen.getByRole('link', { name: en.layout.skipToContent })).toBeInTheDocument()
    expect(screen.getByText(en.layout.offlineHelp)).toBeInTheDocument()
  })
})
