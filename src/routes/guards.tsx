import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useSession } from '../app/servicesContext'
import { AppShell } from '../components/layout/AppShell'
import { Button, EmptyState, Spinner } from '../components/ui'
import { useOnlineStatus } from '../lib/useOnlineStatus'
import type { Role } from '../schemas/roles'
import { en } from '../strings/en'

/**
 * Requires a signed-in member and renders the app shell around the page.
 * Guards are UX only: security rules and functions enforce access.
 */
export function RequireSession() {
  const session = useSession((s) => s.session)
  const signOut = useSession((s) => s.signOut)
  const online = useOnlineStatus()
  const location = useLocation()

  if (session.status === 'loading') {
    return (
      <AppShell online={online}>
        <div className="flex justify-center p-8">
          <Spinner />
        </div>
      </AppShell>
    )
  }
  if (session.status === 'signedOut') {
    return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />
  }
  if (session.status === 'noAccess') {
    return (
      <AppShell online={online}>
        <EmptyState
          title={en.access.noAccessTitle}
          description={en.access[session.reason]}
          action={
            <Button variant="secondary" onClick={() => void signOut()}>
              {en.layout.signOut}
            </Button>
          }
        />
      </AppShell>
    )
  }

  const { user } = session
  return (
    <AppShell
      role={user.role}
      online={online}
      showDemoBanner={user.organizationDemo}
      organizationSlot={user.organizationName ?? user.organizationId}
      userSlot={
        <>
          <span>{user.displayName ?? user.email}</span>
          <Button variant="ghost" className="min-h-9 px-2 py-1 text-sm" onClick={() => void signOut()}>
            {en.layout.signOut}
          </Button>
        </>
      }
    >
      <Outlet />
    </AppShell>
  )
}

/** Shows an access message instead of the page for other roles. */
export function RequireRole({ roles }: { roles: readonly Role[] }) {
  const session = useSession((s) => s.session)
  if (session.status !== 'signedIn') return null
  if (!roles.includes(session.user.role)) {
    return <EmptyState title={en.access.deniedTitle} description={en.access.deniedDescription} />
  }
  return <Outlet />
}
