/**
 * Shared setup for Firestore rules tests (FICTIONAL data only).
 * Requires the Firestore emulator (FIRESTORE_EMULATOR_HOST is set by
 * `firebase emulators:exec`).
 */
import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, setDoc, Timestamp, type Firestore } from 'firebase/firestore'

export const PROJECT_ID = 'demo-majipulse'
export const ORG_A = 'kwale-demo'
export const ORG_B = 'pwani-demo'

export const UID = {
  adminA: 'uid-admin-a',
  techA: 'uid-tech-a',
  reporterA: 'uid-reporter-a',
  reporterA2: 'uid-reporter-a2',
  adminB: 'uid-admin-b',
  reporterB: 'uid-reporter-b',
  claimsOnly: 'uid-claims-no-member',
  inactive: 'uid-inactive',
  mismatch: 'uid-role-mismatch',
} as const

type Role = 'administrator' | 'technician' | 'reporter'

/** [uid, org, role, member document] */
const PEOPLE: Array<[string, string, Role, 'active' | 'inactive' | 'none' | 'wrong-role']> = [
  [UID.adminA, ORG_A, 'administrator', 'active'],
  [UID.techA, ORG_A, 'technician', 'active'],
  [UID.reporterA, ORG_A, 'reporter', 'active'],
  [UID.reporterA2, ORG_A, 'reporter', 'active'],
  [UID.adminB, ORG_B, 'administrator', 'active'],
  [UID.reporterB, ORG_B, 'reporter', 'active'],
  [UID.claimsOnly, ORG_A, 'administrator', 'none'],
  [UID.inactive, ORG_A, 'administrator', 'inactive'],
  [UID.mismatch, ORG_A, 'administrator', 'wrong-role'],
]

export const T = Timestamp.fromDate(new Date('2026-03-01T08:00:00Z'))

export const WP_A = 'wp-a-borehole'
export const WP_B = 'wp-b-kiosk'
export const INCIDENT_A = '3f1c2a9e-5b7d-4e2a-9c1f-0a1b2c3d4e5f'
export const INCIDENT_A_TRIAGED = '4a2b3c4d-1e2f-4a5b-8c6d-9e0f1a2b3c4d'
export const INCIDENT_B = '5b3c4d5e-2f3a-4b6c-9d7e-0f1a2b3c4d5e'
export const MUTATION_1 = 'b1c2d3e4-f5a6-4b7c-9d8e-0f1a2b3c4d5e'
export const MUTATION_2 = 'c2d3e4f5-a6b7-4c8d-ae9f-1a2b3c4d5e6f'

export const waterPoint = (organizationId: string, createdBy: string) => ({
  organizationId,
  name: 'Demo Borehole (fictional)',
  type: 'borehole',
  locationDescription: 'Fictional place',
  status: 'working',
  demo: false,
  createdBy,
  createdAt: T,
  updatedAt: T,
})

export const incident = (organizationId: string, reporterId: string, waterPointId: string) => ({
  organizationId,
  waterPointId,
  reporterId,
  demo: false,
  description: 'Handpump gives very little water (fictional).',
  incidentType: 'low_flow',
  severity: 'medium',
  status: 'new',
  baseRevision: 0,
  clientRevision: 1,
  mutationId: MUTATION_1,
  serverRevision: 1,
  clientCreatedAt: T,
  createdAt: T,
  updatedAt: T,
  confirmedFields: [] as string[],
})

export async function createEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
}

/** Writes the baseline fixtures with rules disabled. */
export async function seed(env: RulesTestEnvironment): Promise<void> {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = dbOf(ctx)
    for (const org of [ORG_A, ORG_B]) {
      await setDoc(doc(db, 'organizations', org), {
        name: `${org} (fictional)`,
        county: 'Kwale',
        demo: true,
        createdAt: T,
        createdBy: 'seed',
        bootstrap: { status: 'complete', adminUid: org === ORG_A ? UID.adminA : UID.adminB, startedAt: T, completedAt: T },
      })
    }
    for (const [uid, org, role, state] of PEOPLE) {
      if (state === 'none') continue
      await setDoc(doc(db, 'members', uid), {
        organizationId: org,
        role: state === 'wrong-role' ? 'reporter' : role,
        email: `${uid}@example.org`,
        displayName: uid,
        active: state !== 'inactive',
        createdAt: T,
        updatedAt: T,
      })
    }
    await setDoc(doc(db, 'waterPoints', WP_A), waterPoint(ORG_A, UID.adminA))
    await setDoc(doc(db, 'waterPoints', WP_B), waterPoint(ORG_B, UID.adminB))
    await setDoc(doc(db, 'incidents', INCIDENT_A), incident(ORG_A, UID.reporterA, WP_A))
    await setDoc(doc(db, 'incidents', INCIDENT_A_TRIAGED), {
      ...incident(ORG_A, UID.reporterA, WP_A),
      status: 'triaged',
      serverRevision: 2,
      lastStatusChange: { by: UID.techA, at: T, from: 'new', to: 'triaged' },
    })
    await setDoc(doc(db, 'incidents', INCIDENT_B), incident(ORG_B, UID.reporterB, WP_B))
  })
}

/** Modular Firestore API over a rules test context. */
export const dbOf = (ctx: RulesTestContext): Firestore => ctx.firestore() as unknown as Firestore

const roleOf = (uid: string): [string, Role] => {
  const person = PEOPLE.find(([u]) => u === uid)
  if (!person) throw new Error(`unknown test uid ${uid}`)
  return [person[1], person[2]]
}

/** Firestore for a signed-in user carrying their custom claims. */
export function as(env: RulesTestEnvironment, uid: string): Firestore {
  const [organizationId, role] = roleOf(uid)
  return dbOf(env.authenticatedContext(uid, { organizationId, role }))
}

/** Firestore for a signed-in user with explicit (possibly bad) claims. */
export function withClaims(env: RulesTestEnvironment, uid: string, claims: Record<string, unknown>): Firestore {
  return dbOf(env.authenticatedContext(uid, claims))
}

export const anonymous = (env: RulesTestEnvironment): Firestore => dbOf(env.unauthenticatedContext())
