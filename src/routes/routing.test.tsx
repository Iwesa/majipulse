import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NAV_ITEMS } from '../components/layout/navigation'
import type { Role } from '../schemas/roles'
import { en } from '../strings/en'
import { FakeAuthService, renderApp, signedIn } from '../test/fakeServices'

const ROLES: Role[] = ['administrator', 'technician', 'reporter']

describe('routing and guards (T2.8)', () => {
  it('shows a loading state while the session resolves', () => {
    renderApp('/', { auth: new FakeAuthService({ status: 'loading' }) })
    expect(within(screen.getByRole('main')).getByRole('status')).toHaveTextContent(en.common.loading)
  })

  it('redirects signed-out users to sign-in', async () => {
    renderApp('/incidents')
    expect(await screen.findByRole('heading', { name: en.signIn.title })).toBeInTheDocument()
  })

  it('has no sign-up route or link (R1.4)', async () => {
    renderApp('/sign-up')
    expect(await screen.findByRole('heading', { name: en.signIn.title })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /sign up|register|create account/i })).not.toBeInTheDocument()
  })

  it.each(['noClaims', 'noMember', 'inactive', 'mismatch'] as const)('explains a %s account and offers sign-out', async (reason) => {
    const auth = new FakeAuthService({ status: 'noAccess', reason, email: 'x@example.org' })
    renderApp('/', { auth })
    expect(await screen.findByText(en.access[reason])).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: en.layout.signOut }))
    expect(auth.signOut).toHaveBeenCalledOnce()
  })

  for (const role of ROLES) {
    describe(role, () => {
      for (const item of NAV_ITEMS) {
        const allowed = item.roles.includes(role)
        it(`${allowed ? 'can open' : 'is denied'} ${item.href}`, async () => {
          renderApp(item.href, { auth: new FakeAuthService(signedIn(role)) })
          if (allowed) {
            expect(await screen.findByRole('heading', { level: 1, name: item.key === 'home' ? en.home.title : en.nav[item.key] })).toBeInTheDocument()
            expect(screen.queryByText(en.access.deniedTitle)).not.toBeInTheDocument()
          } else {
            expect(await screen.findByText(en.access.deniedTitle)).toBeInTheDocument()
          }
        })
      }
    })
  }

  it('shows the organization, user, and the demo banner for demo organizations (R10.1)', async () => {
    renderApp('/', { auth: new FakeAuthService(signedIn('reporter')) })
    const banner = await screen.findByRole('banner')
    expect(banner).toHaveTextContent('Kwale Demo WUA (fictional)')
    expect(banner).toHaveTextContent('Demo reporter')
    expect(screen.getByText(en.layout.demoBanner)).toBeInTheDocument()
  })

  it('hides the demo banner for real organizations', async () => {
    renderApp('/', { auth: new FakeAuthService(signedIn('reporter', { organizationDemo: false })) })
    await screen.findByRole('heading', { name: en.home.title })
    expect(screen.queryByText(en.layout.demoBanner)).not.toBeInTheDocument()
  })

  it('shows a not-found page for unknown paths', async () => {
    renderApp('/nowhere', { auth: new FakeAuthService(signedIn('reporter')) })
    expect(await screen.findByText(en.access.notFoundTitle)).toBeInTheDocument()
  })

  it('signing out returns to the sign-in page', async () => {
    const auth = new FakeAuthService(signedIn('technician'))
    renderApp('/', { auth })
    fireEvent.click(await screen.findByRole('button', { name: en.layout.signOut }))
    await waitFor(() => expect(screen.getByRole('heading', { name: en.signIn.title })).toBeInTheDocument())
  })
})
