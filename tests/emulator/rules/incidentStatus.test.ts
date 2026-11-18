// Incident status transitions (T2.11b, AC19).
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, serverTimestamp, setDoc, updateDoc, type Firestore } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { ORG_A, ORG_B, T, UID, WP_A, WP_B, as, createEnv, dbOf, incident, seed } from './setup'

type Status = 'new' | 'triaged' | 'in_progress' | 'resolved'
const STATUSES: Status[] = ['new', 'triaged', 'in_progress', 'resolved']
const ALLOWED: Array<[Status, Status]> = [
  ['new', 'triaged'],
  ['triaged', 'in_progress'],
  ['in_progress', 'resolved'],
]
const ID = '6c4d5e6f-3a4b-4c7d-8e9f-1a2b3c4d5e6f'

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

/** Puts an incident in `status` with serverRevision 5, bypassing rules. */
async function incidentIn(
  status: Status,
  organizationId: string = ORG_A,
  waterPointId: string = WP_A,
  reporterId: string = UID.reporterA,
) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const data: Record<string, unknown> = { ...incident(organizationId, reporterId, waterPointId), status, serverRevision: 5 }
    if (status !== 'new') data.lastStatusChange = { by: UID.techA, at: T, from: 'new', to: status }
    await setDoc(doc(dbOf(ctx), 'incidents', ID), data)
  })
}

/** A well-formed status update; `extra` overrides any field. */
const statusUpdate = (db: Firestore, uid: string, from: Status, to: Status, extra: Record<string, unknown> = {}) =>
  updateDoc(doc(db, 'incidents', ID), {
    status: to,
    lastStatusChange: { by: uid, at: serverTimestamp(), from, to },
    serverRevision: 6,
    updatedAt: serverTimestamp(),
    ...extra,
  })

describe('allowed transitions', () => {
  for (const uid of [UID.adminA, UID.techA]) {
    for (const [from, to] of ALLOWED) {
      it(`${uid}: ${from} -> ${to}`, async () => {
        await incidentIn(from)
        await assertSucceeds(statusUpdate(as(env, uid), uid, from, to))
      })
    }
  }
})

describe('denied transitions', () => {
  const allowed = new Set(ALLOWED.map(([f, t]) => `${f}>${t}`))
  const denied = STATUSES.flatMap((from) => STATUSES.map((to) => [from, to] as const)).filter(
    ([f, t]) => !allowed.has(`${f}>${t}`),
  )
  // Skips (new -> in_progress, new -> resolved, triaged -> resolved), every reversal, and same-status writes.
  for (const [from, to] of denied) {
    it(`${from} -> ${to}`, async () => {
      await incidentIn(from)
      await assertFails(statusUpdate(as(env, UID.adminA), UID.adminA, from, to))
    })
  }

  it('unknown status value', async () => {
    await incidentIn('new')
    await assertFails(
      updateDoc(doc(as(env, UID.adminA), 'incidents', ID), {
        status: 'closed',
        lastStatusChange: { by: UID.adminA, at: serverTimestamp(), from: 'new', to: 'closed' },
        serverRevision: 6,
        updatedAt: serverTimestamp(),
      }),
    )
  })
})

describe('who may change status', () => {
  it('reporters cannot change status, including on their own incident', async () => {
    await incidentIn('new')
    await assertFails(statusUpdate(as(env, UID.reporterA), UID.reporterA, 'new', 'triaged'))
  })
  it('another organization’s administrator cannot change status', async () => {
    await incidentIn('new')
    await assertFails(statusUpdate(as(env, UID.adminB), UID.adminB, 'new', 'triaged'))
  })
  it('administrators cannot change status in another organization', async () => {
    await incidentIn('new', ORG_B, WP_B, UID.reporterB)
    await assertFails(statusUpdate(as(env, UID.adminA), UID.adminA, 'new', 'triaged'))
  })
})

describe('a status update may change only status metadata', () => {
  const changes: Array<[string, Record<string, unknown>]> = [
    ['description', { description: 'Changed during triage' }],
    ['organizationId', { organizationId: ORG_B }],
    ['reporterId', { reporterId: UID.reporterA2 }],
    ['ai', { ai: { suggested: {}, inferenceSource: 'IN_CLOUD', model: 'x', generatedAt: T } }],
    ['confirmedFields', { confirmedFields: ['severity'] }],
    ['severity', { severity: 'high' }],
  ]
  for (const [field, extra] of changes) {
    it(`denies changing ${field}`, async () => {
      await incidentIn('new')
      await assertFails(statusUpdate(as(env, UID.techA), UID.techA, 'new', 'triaged', extra))
    })
  }

  it('denies a wrong lastStatusChange.from', async () => {
    await incidentIn('new')
    await assertFails(
      statusUpdate(as(env, UID.techA), UID.techA, 'new', 'triaged', {
        lastStatusChange: { by: UID.techA, at: serverTimestamp(), from: 'in_progress', to: 'triaged' },
      }),
    )
  })
  it('denies a lastStatusChange.by that is not the caller', async () => {
    await incidentIn('new')
    await assertFails(statusUpdate(as(env, UID.techA), UID.adminA, 'new', 'triaged'))
  })
  it('denies a client-chosen lastStatusChange.at', async () => {
    await incidentIn('new')
    await assertFails(
      statusUpdate(as(env, UID.techA), UID.techA, 'new', 'triaged', {
        lastStatusChange: { by: UID.techA, at: T, from: 'new', to: 'triaged' },
      }),
    )
  })
  it('denies a missing or wrong serverRevision increment', async () => {
    await incidentIn('new')
    await assertFails(statusUpdate(as(env, UID.techA), UID.techA, 'new', 'triaged', { serverRevision: 5 }))
    await assertFails(statusUpdate(as(env, UID.techA), UID.techA, 'new', 'triaged', { serverRevision: 7 }))
  })
  it('denies a client-chosen updatedAt', async () => {
    await incidentIn('new')
    await assertFails(statusUpdate(as(env, UID.techA), UID.techA, 'new', 'triaged', { updatedAt: T }))
  })
})
