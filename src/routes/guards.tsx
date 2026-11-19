import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useIncidents, useSession, useSync } from '../app/servicesContext'
import { useIncidentSync } from '../app/useIncidentSync'
import { useWaterPointRefresh } from '../app/useWaterPointRefresh'
import { SyncIndicator } from '../components/incidents/SyncIndicator'
import { AppShell, MAIN_CONTENT_ID } from '../components/layout/AppShell'
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
  // After a sign-out, the next person to sign in starts at Home instead of the
  // previous user's last page. Only a signed-out visit keeps the return path.
  const [wasSignedIn, setWasSignedIn] = useState(false)
  if (session.status === 'signedIn' && !wasSignedIn) setWasSignedIn(true)

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
    return <Navigate to="/sign-in" replace state={wasSignedIn ? null : { from: location.pathname }} />
  }
  if (session.status === 'noAccess') {
    return (
      <AppShell online={online}>
        <EmptyState
          headingLevel={1}
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
      syncSlot={<SyncIndicator />}
      userSlot={
        <>
          <span>{user.displayName ?? user.email}</span>
          <Button variant="ghost" className="min-h-9 px-2 py-1 text-sm" onClick={() => void signOut()}>
            {en.layout.signOut}
          </Button>
        </>
      }
    >
      <RouteFocus />
      <WaterPointRefresh organizationId={user.organizationId} ownerUid={user.uid} />
      <IncidentSession key={`${user.organizationId}|${user.uid}`} organizationId={user.organizationId} ownerUid={user.uid} />
      <Outlet />
    </AppShell>
  )
}

/**
 * Renders nothing; opens the signed-in user's local reports once per session,
 * then starts sync for them. Keyed by scope, so an account switch remounts it.
 */
function IncidentSession({ organizationId, ownerUid }: { organizationId: string; ownerUid: string }) {
  const openSession = useIncidents((s) => s.openSession)
  const syncEnabled = useSync((s) => s.enabled)
  const [opened, setOpened] = useState(false)
  useEffect(() => {
    let alive = true
    // With sync on, the engine recovers interrupted submissions under its lock.
    void openSession({ organizationId, ownerUid }, { resetInterrupted: !syncEnabled }).then(() => {
      if (alive) setOpened(true)
    })
    return () => {
      alive = false
    }
  }, [openSession, organizationId, ownerUid, syncEnabled])
  return opened && syncEnabled ? <SyncRunner organizationId={organizationId} ownerUid={ownerUid} /> : null
}

function SyncRunner({ organizationId, ownerUid }: { organizationId: string; ownerUid: string }) {
  useIncidentSync(organizationId, ownerUid)
  return null
}

/**
 * Renders nothing. After an in-app navigation, moves focus to the main
 * content so keyboard and screen reader users start at the new page instead
 * of the link they used (the page title updates at the same time). Not on the
 * first render, so the skip link stays first in the tab order on load.
 */
function RouteFocus() {
  const { pathname } = useLocation()
  const previous = useRef(pathname)
  useEffect(() => {
    if (previous.current === pathname) return
    previous.current = pathname
    document.getElementById(MAIN_CONTENT_ID)?.focus({ preventScroll: false })
  }, [pathname])
  return null
}

/** Renders nothing; keeps the water point cache fresh for the signed-in user. */
function WaterPointRefresh({ organizationId, ownerUid }: { organizationId: string; ownerUid: string }) {
  useWaterPointRefresh(organizationId, ownerUid)
  return null
}

/** Shows an access message instead of the page for other roles. */
export function RequireRole({ roles }: { roles: readonly Role[] }) {
  const session = useSession((s) => s.session)
  if (session.status !== 'signedIn') return null
  if (!roles.includes(session.user.role)) {
    return <EmptyState headingLevel={1} title={en.access.deniedTitle} description={en.access.deniedDescription} />
  }
  return <Outlet />
}
