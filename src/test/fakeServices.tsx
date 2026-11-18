// Fake services for UI tests (FICTIONAL data). No Firebase calls.
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import App from '../App'
import type { AppServices } from '../app/servicesContext'
import type { Role, SessionScope } from '../schemas/roles'
import type { WaterPointRecord } from '../schemas/waterPoint'
import { WaterPointServiceError, type WaterPointCache, type WaterPointService } from '../services/waterPoints'
import { openMajiPulseDb } from '../services/offline/db'
import { createIdbIncidentOutbox } from '../services/offline/incidentOutbox'
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

export const T_WP = '2026-03-01T08:00:00.000Z'

export const waterPointRecord = (overrides: Partial<WaterPointRecord> = {}): WaterPointRecord => ({
  id: 'wp-mwamanga',
  organizationId: 'kwale-demo',
  name: 'Mwamanga Borehole (fictional)',
  type: 'borehole',
  locationDescription: 'Beside the fictional primary school',
  ward: 'Demo Ward',
  status: 'working',
  demo: true,
  createdBy: 'uid-administrator',
  createdAt: T_WP,
  updatedAt: T_WP,
  ...overrides,
})

export const WATER_POINTS: WaterPointRecord[] = [
  waterPointRecord(),
  waterPointRecord({ id: 'wp-soko', name: 'Soko Kiosk (fictional)', type: 'kiosk', ward: 'Market Ward', status: 'needs_repair' }),
]

/** In-memory water point service. `fail` makes list/create/update throw. */
export class FakeWaterPointService implements WaterPointService {
  points: WaterPointRecord[]
  fail: WaterPointServiceError | null = null
  private nextId = 1

  constructor(points: WaterPointRecord[] = WATER_POINTS) {
    this.points = [...points]
  }

  list = vi.fn<WaterPointService['list']>(async (scope) => {
    if (this.fail) throw this.fail
    return this.points.filter((p) => p.organizationId === scope.organizationId)
  })

  create = vi.fn<WaterPointService['create']>(async (scope, input) => {
    if (this.fail) throw this.fail
    const id = `wp-new-${this.nextId++}`
    this.points.push({ ...input, id, organizationId: scope.organizationId, demo: false, createdBy: scope.ownerUid, createdAt: T_WP, updatedAt: T_WP })
    return id
  })

  update = vi.fn<WaterPointService['update']>(async (scope, id, input) => {
    if (this.fail) throw this.fail
    const index = this.points.findIndex((p) => p.id === id && p.organizationId === scope.organizationId)
    if (index < 0) throw new WaterPointServiceError('notFound')
    const { ward: _ward, ...rest } = this.points[index]
    void _ward
    this.points[index] = { ...rest, ...input }
  })
}

/** In-memory cache with the same scoping as the IndexedDB one. */
export class FakeWaterPointCache implements WaterPointCache {
  saved = new Map<string, { points: WaterPointRecord[]; cachedAt: string }>()
  private key = (scope: SessionScope) => `${scope.organizationId}|${scope.ownerUid}`
  read = vi.fn<WaterPointCache['read']>(async (scope) => this.saved.get(this.key(scope)) ?? null)
  replace = vi.fn<WaterPointCache['replace']>(async (scope, points, cachedAt) => {
    this.saved.set(this.key(scope), { points: [...points], cachedAt })
  })
}

export function renderApp(path: string, services: Partial<AppServices> = {}) {
  const all: AppServices = {
    auth: services.auth ?? new FakeAuthService(),
    userAdmin: services.userAdmin ?? fakeUserAdmin(),
    waterPoints: services.waterPoints ?? new FakeWaterPointService(),
    waterPointCache: services.waterPointCache ?? new FakeWaterPointCache(),
    // The real IndexedDB outbox on fake-indexeddb, one database per render.
    incidentOutbox: services.incidentOutbox ?? createIdbIncidentOutbox(openMajiPulseDb(`test-${crypto.randomUUID()}`)),
    // No sync unless a test opts in, so reports stay local and predictable.
    ...(services.incidentSync ? { incidentSync: services.incidentSync } : {}),
  }
  return { ...render(<App services={all} />, { wrapper: routerAt(path) }), services: all }
}

export function routerAt(path: string) {
  return function Router({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
  }
}
