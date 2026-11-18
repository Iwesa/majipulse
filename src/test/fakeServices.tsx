// Fake services for UI tests (FICTIONAL data). No Firebase calls.
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import App from '../App'
import type { AppServices } from '../app/servicesContext'
import type { Role } from '../schemas/roles'
import type { AuthService, Session, SessionUser } from '../services/session'
import type { MemberSummary, UserAdminService } from '../services/userAdmin'

export class FakeAuthService implements AuthService {
  private listeners = new Set<(session: Session) => void>()
  current: Session

  constructor(initial: Session = { status: 'signedOut' }) {
    this.current = initial
  }

  subscribe(listener: (session: Session) => void) {
    this.listeners.add(listener)
    listener(this.current)
    return () => {
      this.listeners.delete(listener)
    }
  }

  emit(session: Session) {
    this.current = session
    for (const listener of this.listeners) listener(session)
  }

  signIn = vi.fn<AuthService['signIn']>(async () => {})
  signOut = vi.fn<AuthService['signOut']>(async () => this.emit({ status: 'signedOut' }))
  refreshClaims = vi.fn<AuthService['refreshClaims']>(async () => {})
}

export function sessionUser(role: Role, overrides: Partial<SessionUser> = {}): SessionUser {
  const uid = `uid-${role}`
  return {
    uid,
    email: `${role}@example.org`,
    displayName: `Demo ${role}`,
    organizationId: 'kwale-demo',
    role,
    organizationName: 'Kwale Demo WUA (fictional)',
    organizationDemo: true,
    scope: { organizationId: 'kwale-demo', ownerUid: uid },
    ...overrides,
  }
}

export const signedIn = (role: Role, overrides: Partial<SessionUser> = {}): Session => ({
  status: 'signedIn',
  user: sessionUser(role, overrides),
})

export const MEMBERS: MemberSummary[] = [
  { uid: 'uid-administrator', displayName: 'Demo administrator', email: 'administrator@example.org', role: 'administrator', active: true },
  { uid: 'uid-reporter-1', displayName: 'Demo reporter one', email: 'r1@example.org', role: 'reporter', active: true },
]

export function fakeUserAdmin(overrides: Partial<UserAdminService> = {}): UserAdminService {
  return {
    listMembers: vi.fn(async () => MEMBERS),
    createUser: vi.fn(async () => ({ uid: 'uid-new', passwordResetLink: 'https://example.org/reset?oobCode=FAKE' })),
    setRole: vi.fn(async () => undefined),
    ...overrides,
  }
}

export function renderApp(path: string, services: Partial<AppServices> = {}) {
  const all: AppServices = {
    auth: services.auth ?? new FakeAuthService(),
    userAdmin: services.userAdmin ?? fakeUserAdmin(),
  }
  return { ...render(<App services={all} />, { wrapper: routerAt(path) }), services: all }
}

export function routerAt(path: string) {
  return function Router({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
  }
}
