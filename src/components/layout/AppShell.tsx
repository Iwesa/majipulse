import { Menu, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import type { Role } from '../../schemas/roles'
import { en } from '../../strings/en'
import { ConnectivityIndicator } from './ConnectivityIndicator'
import { DemoBanner } from './DemoBanner'
import { PrimaryNav } from './PrimaryNav'

const MAIN_CONTENT_ID = 'main-content'
const NAV_ID = 'primary-navigation'

interface AppShellProps {
  /** Signed-in user's role. Navigation is hidden when there is no session. */
  role?: Role
  /** Organization name or switcher. Filled in Phase 2. */
  organizationSlot?: ReactNode
  /** Signed-in user name and sign-out control. Filled in Phase 2. */
  userSlot?: ReactNode
  online: boolean
  showDemoBanner?: boolean
  /** Short message announced politely to screen readers, such as "Report saved". */
  statusMessage?: string
  currentPath?: string
  children: ReactNode
}

export function AppShell({
  role,
  organizationSlot,
  userSlot,
  online,
  showDemoBanner = false,
  statusMessage = '',
  currentPath,
  children,
}: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <a
        href={`#${MAIN_CONTENT_ID}`}
        className="sr-only z-50 rounded-md bg-white px-4 py-2 font-medium text-sky-900 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:outline-3 focus:outline-sky-600"
      >
        {en.layout.skipToContent}
      </a>

      <header className="border-b border-slate-300 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          {role && (
            <button
              type="button"
              aria-expanded={menuOpen}
              aria-controls={NAV_ID}
              onClick={() => setMenuOpen((open) => !open)}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-slate-400 md:hidden focus-visible:outline-3 focus-visible:outline-sky-600"
            >
              {menuOpen ? <X aria-hidden="true" className="size-5" /> : <Menu aria-hidden="true" className="size-5" />}
              <span className="sr-only">{menuOpen ? en.layout.closeMenu : en.layout.openMenu}</span>
            </button>
          )}
          <span className="text-xl font-bold text-sky-900">{en.app.name}</span>
          {organizationSlot && (
            <div className="text-sm text-slate-700">
              <span className="sr-only">{en.layout.organization}: </span>
              {organizationSlot}
            </div>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <ConnectivityIndicator online={online} />
            {userSlot && (
              <div className="text-sm text-slate-700">
                <span className="sr-only">{en.layout.signedInAs} </span>
                {userSlot}
              </div>
            )}
          </div>
        </div>
      </header>

      {showDemoBanner && <DemoBanner />}

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col md:flex-row">
        {role && (
          <PrimaryNav
            id={NAV_ID}
            role={role}
            currentPath={currentPath}
            className={cn(
              'border-b border-slate-300 p-3 md:block md:w-60 md:shrink-0 md:border-r md:border-b-0',
              menuOpen ? 'block' : 'hidden',
            )}
          />
        )}
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 p-4 focus:outline-none md:p-6">
          {children}
        </main>
      </div>

      <footer className="border-t border-slate-300 bg-white px-4 py-3">
        <p className="mx-auto max-w-6xl text-sm text-slate-700">{en.layout.offlineHelp}</p>
      </footer>

      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {statusMessage}
      </div>
    </div>
  )
}
