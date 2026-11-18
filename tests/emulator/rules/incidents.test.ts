// Incident create, read, and reporter content updates (T2.11).
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import {
  INCIDENT_A,
  INCIDENT_A_TRIAGED,
  INCIDENT_B,
  MUTATION_1,
  MUTATION_2,
  ORG_A,
  ORG_B,
  T,
  UID,
  WP_A,
  WP_B,
  anonymous,
  as,
  createEnv,
  seed,
} from './setup'

const NEW_ID = '7d5e6f7a-4b5c-4d8e-9f0a-2b3c4d5e6f7a'
const UNUSED_ID = '8e6f7a8b-5c6d-4e9f-8a1b-3c4d5e6f7a8b'
const SUGGESTED = { incidentType: 'no_water', severity: null, occurredAt: null, locationNote: null }

let env: RulesTestEnvironment

beforeAll(async () => {
  env = await createEnv()
})
beforeEach(async () => {
  await seed(env)
})
afterAll(async () => {
  await env.cleanup()
})

const newIncident = (reporterId: string, overrides: Record<string, unknown> = {}) => ({
  organizationId: ORG_A,
  waterPointId: WP_A,
  reporterId,
  demo: false,
  description: 'No water since this morning (fictional).',
  incidentType: 'no_water',
  severity: null,
  status: 'new',
  baseRevision: 0,
  clientRevision: 1,
  mutationId: MUTATION_2,
  serverRevision: 1,
  clientCreatedAt: T,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  confirmedFields: [],
  ...overrides,
})

/** A well-formed reporter content edit of INCIDENT_A (serverRevision 1). */
const contentEdit = (db: Firestore, overrides: Record<string, unknown> = {}) =>
  updateDoc(doc(db, 'incidents', INCIDENT_A), {
    description: 'Edited description (fictional).',
    baseRevision: 1,
    serverRevision: 2,
    clientRevision: 2,
    mutationId: MUTATION_2,
    updatedAt: serverTimestamp(),
    ...overrides,
  })

describe('create', () => {
  it('any member creates an incident as its reporter, in their organization', async () => {
    await assertSucceeds(setDoc(doc(as(env, UID.reporterA), 'incidents', NEW_ID), newIncident(UID.reporterA)))
  })
  it('optional fields and a validated AI block are accepted', async () => {
    const ai = { suggested: SUGGESTED, inferenceSource: 'on_device', model: 'test', generatedAt: T }
    await assertSucceeds(
      setDoc(
        doc(as(env, UID.reporterA), 'incidents', NEW_ID),
        newIncident(UID.reporterA, { occurredAt: T, locationNote: 'By the trough', ai, confirmedFields: ['incidentType'] }),
      ),
    )
  })
  it('accepts a cloud AI block with every suggested field set (T6.6)', async () => {
    const suggested = { incidentType: 'leak', severity: 'high', occurredAt: '2026-03-12T00:00:00.000Z', locationNote: 'near the gate' }
    await assertSucceeds(
      setDoc(
        doc(as(env, UID.reporterA), 'incidents', NEW_ID),
        newIncident(UID.reporterA, { ai: { suggested, inferenceSource: 'in_cloud', model: 'gemini-3.5-flash-lite', generatedAt: T } }),
      ),
    )
  })
  const aiWith = (suggested: Record<string, unknown>) => ({
    ai: { suggested: { ...SUGGESTED, ...suggested }, inferenceSource: 'in_cloud', model: 'm', generatedAt: T },
  })
  it.each([
    ['missing suggested fields', { ai: { suggested: { incidentType: 'leak' }, inferenceSource: 'in_cloud', model: 'm', generatedAt: T } }],
    ['an unknown suggested field', aiWith({ cause: 'worn seal' })],
    ['an unknown suggested type', aiWith({ incidentType: 'burst' })],
    ['an unknown suggested severity', aiWith({ severity: 'critical' })],
    ['an overlong suggested location', aiWith({ locationNote: 'x'.repeat(301) })],
    ['a non-string suggested time', aiWith({ occurredAt: 5 })],
    ['an upper-case inference source', { ai: { suggested: SUGGESTED, inferenceSource: 'IN_CLOUD', model: 'm', generatedAt: T } }],
    ['a missing model', { ai: { suggested: SUGGESTED, inferenceSource: 'in_cloud', generatedAt: T } }],
  ])('denies an AI block with %s (T6.6)', async (_label, overrides) => {
    await assertFails(setDoc(doc(as(env, UID.reporterA), 'incidents', NEW_ID), newIncident(UID.reporterA, overrides)))
  })
  it.each([
    ['another organization', { organizationId: ORG_B }],
    ['a water point in another organization', { waterPointId: WP_B }],
    ['a missing water point', { waterPointId: 'wp-does-not-exist' }],
    ['a water point ID with a slash', { waterPointId: 'x/y' }],
    ['a forged reporter', { reporterId: UID.reporterA2 }],
    ['a non-new status', { status: 'triaged' }],
    ['status history', { lastStatusChange: { by: UID.reporterA, at: T, from: 'new', to: 'triaged' } }],
    ['baseRevision other than 0', { baseRevision: 1 }],
    ['serverRevision other than 1', { serverRevision: 2 }],
    ['demo flag', { demo: true }],
    ['client-chosen createdAt', { createdAt: T }],
    ['client-chosen updatedAt', { updatedAt: T }],
    ['an overlong description', { description: 'd'.repeat(2001) }],
    ['an unknown type', { incidentType: 'burst' }],
    ['an unknown severity', { severity: 'critical' }],
    ['an invalid mutationId', { mutationId: 'not-a-uuid' }],
    ['an unknown confirmed field', { confirmedFields: ['description'] }],
    ['an unknown inference source', { ai: { suggested: {}, inferenceSource: 'HYBRID', model: 'x', generatedAt: T } }],
    ['a cause field', { cause: 'worn seal' }],
  ])('denies %s', async (_label, overrides) => {
    await assertFails(setDoc(doc(as(env, UID.reporterA), 'incidents', NEW_ID), newIncident(UID.reporterA, overrides)))
  })
  it('denies a document ID that is not a UUID', async () => {
    await assertFails(setDoc(doc(as(env, UID.reporterA), 'incidents', 'incident-1'), newIncident(UID.reporterA)))
  })
  it('denies non-members', async () => {
    await assertFails(setDoc(doc(as(env, UID.claimsOnly), 'incidents', NEW_ID), newIncident(UID.claimsOnly)))
    await assertFails(setDoc(doc(anonymous(env), 'incidents', NEW_ID), newIncident('anon')))
  })
})

describe('read', () => {
  it('a get of a nonexistent ID is allowed for members only (sync transactions)', async () => {
    await assertSucceeds(getDoc(doc(as(env, UID.reporterA), 'incidents', UNUSED_ID)))
    await assertFails(getDoc(doc(as(env, UID.claimsOnly), 'incidents', UNUSED_ID)))
    await assertFails(getDoc(doc(anonymous(env), 'incidents', UNUSED_ID)))
  })
  it('reporters read their own incidents but not other reporters’', async () => {
    await assertSucceeds(getDoc(doc(as(env, UID.reporterA), 'incidents', INCIDENT_A)))
    await assertFails(getDoc(doc(as(env, UID.reporterA2), 'incidents', INCIDENT_A)))
  })
  it('staff read all incidents in their organization, not in others', async () => {
    await assertSucceeds(getDoc(doc(as(env, UID.techA), 'incidents', INCIDENT_A)))
    await assertSucceeds(getDoc(doc(as(env, UID.adminA), 'incidents', INCIDENT_A)))
    await assertFails(getDoc(doc(as(env, UID.adminA), 'incidents', INCIDENT_B)))
  })
  it('reporter list queries need both organizationId and reporterId', async () => {
    const db = as(env, UID.reporterA)
    const incidents = collection(db, 'incidents')
    await assertSucceeds(getDocs(query(incidents, where('organizationId', '==', ORG_A), where('reporterId', '==', UID.reporterA))))
    await assertFails(getDocs(query(incidents, where('organizationId', '==', ORG_A))))
    await assertFails(getDocs(query(incidents, where('reporterId', '==', UID.reporterA))))
    await assertFails(getDocs(incidents))
    await assertFails(getDocs(query(incidents, where('organizationId', '==', ORG_A), where('reporterId', '==', UID.reporterA2))))
  })
  it('staff list queries need organizationId', async () => {
    for (const uid of [UID.adminA, UID.techA]) {
      const incidents = collection(as(env, uid), 'incidents')
      await assertSucceeds(getDocs(query(incidents, where('organizationId', '==', ORG_A))))
      await assertFails(getDocs(incidents))
      await assertFails(getDocs(query(incidents, where('organizationId', '==', ORG_B))))
    }
  })
})

describe('reporter content update', () => {
  it('the reporter edits a new incident from the current revision', async () => {
    await assertSucceeds(contentEdit(as(env, UID.reporterA)))
  })
  it('denies a stale baseRevision', async () => {
    await assertFails(contentEdit(as(env, UID.reporterA), { baseRevision: 0 }))
  })
  it('denies a serverRevision that does not advance by exactly one', async () => {
    await assertFails(contentEdit(as(env, UID.reporterA), { serverRevision: 1 }))
    await assertFails(contentEdit(as(env, UID.reporterA), { serverRevision: 3 }))
  })
  it('denies reusing the previous mutationId', async () => {
    await assertFails(contentEdit(as(env, UID.reporterA), { mutationId: MUTATION_1 }))
  })
  it('denies edits after triage', async () => {
    await assertFails(
      updateDoc(doc(as(env, UID.reporterA), 'incidents', INCIDENT_A_TRIAGED), {
        description: 'Too late (fictional).',
        baseRevision: 2,
        serverRevision: 3,
        mutationId: MUTATION_2,
        updatedAt: serverTimestamp(),
      }),
    )
  })
  it('denies other reporters, staff who are not the reporter, and other organizations', async () => {
    await assertFails(contentEdit(as(env, UID.reporterA2)))
    await assertFails(contentEdit(as(env, UID.techA)))
    await assertFails(contentEdit(as(env, UID.adminB)))
  })
  it.each([
    ['organizationId', { organizationId: ORG_B }],
    ['reporterId', { reporterId: UID.reporterA2 }],
    ['status', { status: 'triaged' }],
    ['demo', { demo: true }],
    ['createdAt', { createdAt: serverTimestamp() }],
    ['a water point in another organization', { waterPointId: WP_B }],
    ['client-chosen updatedAt', { updatedAt: T }],
  ])('denies changing %s', async (_label, overrides) => {
    await assertFails(contentEdit(as(env, UID.reporterA), overrides))
  })
  it('nobody deletes incidents from the client', async () => {
    await assertFails(deleteDoc(doc(as(env, UID.reporterA), 'incidents', INCIDENT_A)))
    await assertFails(deleteDoc(doc(as(env, UID.adminA), 'incidents', INCIDENT_A)))
  })
})
