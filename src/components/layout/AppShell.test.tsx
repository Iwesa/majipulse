import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Role } from '../../schemas/roles'
import { en } from '../../strings/en'
import { routerAt } from '../../test/fakeServices'
import { AppShell } from './AppShell'
import { NAV_ITEMS, navItemsForRole } from './navigation'

const renderShell = (props: Partial<Parameters<typeof AppShell>[0]> = {}, path = '/') =>
  render(
    <AppShell online {...props}>
      <h1>Page</h1>
    </AppShell>,
    { wrapper: routerAt(path) },
  )

const navLabels = () =>
  within(screen.getByRole('navigation', { name: en.layout.primaryNavigation }))
    .getAllByRole('link')
    .map((link) => link.textContent)

describe('navigation items', () => {
  it('follow the role table', () => {
    const keys = (role: Role) => navItemsForRole(role).map((item) => item.key)
    expect(keys('reporter')).toEqual(['home', 'newReport', 'myReports', 'waterPoints', 'syncStatus'])
    expect(keys('technician')).toEqual([
      'home', 'newReport', 'myReports', 'waterPoints', 'incidents', 'maintenance', 'patterns', 'syncStatus',
    ])
    expect(keys('administrator')).toEqual(NAV_ITEMS.map((item) => item.key))
  })
  it('have unique keys and paths', () => {
    expect(new Set(NAV_ITEMS.map((i) => i.key)).size).toBe(NAV_ITEMS.length)
    expect(new Set(NAV_ITEMS.map((i) => i.href)).size).toBe(NAV_ITEMS.length)
  })
})

describe('AppShell', () => {
  it('has header, main, and footer landmarks and renders children in main', () => {
    renderShell()
    expect(screen.getByRole('banner')).toHaveTextContent(en.app.name)
    expect(within(screen.getByRole('main')).getByRole('heading', { name: 'Page' })).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toHaveTextContent(en.layout.offlineHelp)
  })

  it('has a skip link that targets the focusable main element', () => {
    renderShell()
    const skip = screen.getByRole('link', { name: en.layout.skipToContent })
    const main = screen.getByRole('main')
    expect(skip).toHaveAttribute('href', `#${main.id}`)
    expect(main).toHaveAttribute('tabindex', '-1')
    expect(skip.compareDocumentPosition(screen.getByRole('banner')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows no navigation or menu button without a session', () => {
    renderShell()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.layout.openMenu })).not.toBeInTheDocument()
  })

  it.each([
    ['reporter', [en.nav.home, en.nav.newReport, en.nav.myReports, en.nav.waterPoints, en.nav.syncStatus]],
    ['administrator', NAV_ITEMS.map((item) => en.nav[item.key])],
  ] as const)('renders %s navigation labels from the strings module', (role, labels) => {
    renderShell({ role })
    expect(navLabels()).toEqual(labels)
  })

  it('does not show staff or admin items to reporters', () => {
    renderShell({ role: 'reporter' })
    for (const label of [en.nav.incidents, en.nav.maintenance, en.nav.patterns, en.nav.users]) {
      expect(screen.queryByRole('link', { name: label })).not.toBeInTheDocument()
    }
  })

  it('marks the current page', () => {
    renderShell({ role: 'technician' }, '/incidents')
    expect(screen.getByRole('link', { name: en.nav.incidents })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: en.nav.home })).not.toHaveAttribute('aria-current')
  })

  it('does not mark "My reports" current on the new report page', () => {
    renderShell({ role: 'reporter' }, '/reports/new')
    expect(screen.getByRole('link', { name: en.nav.newReport })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: en.nav.myReports })).not.toHaveAttribute('aria-current')
  })

  it('toggles the mobile menu with aria-expanded', () => {
    renderShell({ role: 'reporter' })
    const toggle = screen.getByRole('button', { name: en.layout.openMenu })
    const nav = screen.getByRole('navigation')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAttribute('aria-controls', nav.id)
    expect(nav).toHaveClass('hidden', 'md:block')

    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: en.layout.closeMenu })).toHaveAttribute('aria-expanded', 'true')
    expect(nav).not.toHaveClass('hidden')
  })

  it('shows connectivity as text, not color alone', () => {
    const { rerender } = renderShell()
    expect(screen.getByText(en.connectivity.online)).toBeInTheDocument()
    rerender(
      <AppShell online={false}>
        <h1>Page</h1>
      </AppShell>,
    )
    expect(screen.getByText(en.connectivity.offline)).toBeInTheDocument()
    expect(screen.getByText(en.connectivity.offline).closest('[role="status"]')).not.toBeNull()
  })

  it('shows the demo banner only when requested', () => {
    renderShell()
    expect(screen.queryByText(en.layout.demoBanner)).not.toBeInTheDocument()
    renderShell({ showDemoBanner: true })
    expect(screen.getByText(en.layout.demoBanner)).toBeInTheDocument()
  })

  it('renders organization and user slots with screen-reader labels', () => {
    renderShell({ organizationSlot: 'Kwale Demo WUA (fictional)', userSlot: 'Demo Reporter' })
    const banner = screen.getByRole('banner')
    expect(banner).toHaveTextContent(`${en.layout.organization}: Kwale Demo WUA (fictional)`)
    expect(banner).toHaveTextContent(`${en.layout.signedInAs} Demo Reporter`)
  })

  it('announces status messages in a polite live region', () => {
    const { container } = renderShell({ statusMessage: 'Report saved on this device' })
    const live = container.querySelector('[aria-live="polite"]')
    expect(live).toHaveTextContent('Report saved on this device')
    expect(live).toHaveAttribute('aria-atomic', 'true')
  })
})
