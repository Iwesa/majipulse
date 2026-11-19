// Staff services (Phase 7) against the Firestore emulator and the real
// security rules: scoped queue queries for every filter, status transitions
// (AC19), the maintenance lifecycle (AC10), role limits, and dashboard counts.
// The emulator does not enforce composite indexes; src/services/queryPlans.test.ts
// checks the index file. FICTIONAL data.
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc, type Firestore } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { incidentStatusSchema, type IncidentStatus } from '../../../src/schemas/incident'
import {
  createFirebaseDashboardService,
  createFirebaseMaintenanceService,
  createFirebaseStaffIncidentService,
} from '../../../src/services/firebase/staffServices'
import type { IncidentQueueFilter } from '../../../src/services/queryPlans'

const PROJECT_ID = 'demo-majipulse'
const ORG = 'kwale-demo'
const ORG_B = 'pwani-demo'
const ADMIN = 'uid-admin'
const TECH = 'uid-tech'
const REPORTER = 'uid-reporter'
const ADMIN_B = 'uid-admin-b'
const WP_1 = 'wp-mwamanga'
const WP_2 = 'wp-soko'
const WP_B = 'wp-pwani'
const ROLE: Record<string, [string, string]> = {
  [ADMIN]: [ORG, 'administrator'],
  [TECH]: [ORG, 'technician'],
  [REPORTER]: [ORG, 'reporter'],
  [ADMIN_B]: [ORG_B, 'administrator'],
}
const at = (day: number) => Timestamp.fromDate(new Date(`2026-03-${String(day).padStart(2, '0')}T08:00:00Z`))

let env: RulesTestEnvironment
const dbAs = (uid: string): Firestore => {
  const [organizationId, role] = ROLE[uid]
  return env.authenticatedContext(uid, { organizationId, role }).firestore() as unknown as Firestore
}
const scopeOf = (uid: string) => ({ organizationId: ROLE[uid][0], ownerUid: uid })
const incidentsAs = (uid: string) => createFirebaseStaffIncidentService(dbAs(uid))
const tasksAs = (uid: string) => createFirebaseMaintenanceService(dbAs(uid))

/** [id, org, water point, status, created day] */
const SEED: Array<[string, string, string, IncidentStatus, number]> = [
  ['11111111-1111-4111-8111-111111111111', ORG, WP_1, 'new', 1],
  ['22222222-2222-4222-8222-222222222222', ORG, WP_1, 'triaged', 2],
  ['33333333-3333-4333-8333-333333333333', ORG, WP_2, 'new', 3],
  ['44444444-4444-4444-8444-444444444444', ORG, WP_2, 'in_progress', 4],
  ['55555555-5555-4555-8555-555555555555', ORG, WP_1, 'resolved', 5],
  ['66666666-6666-4666-8666-666666666666', ORG_B, WP_B, 'new', 6],
]
const [NEW_1, , NEW_2] = SEED.map(([id]) => id)
const PREVIOUS: Record<IncidentStatus, IncidentStatus | null> = { new: null, triaged: 'new', in_progress: 'triaged', resolved: 'in_progress' }
const REVISION: Record<IncidentStatus, number> = { new: 1, triaged: 2, in_progress: 3, resolved: 4 }

async function serverDoc(path: string, id: string) {
  let data: Record<string, unknown> | undefined
  await env.withSecurityRulesDisabled(async (ctx) => {
    data = (await getDoc(doc(ctx.firestore() as unknown as Firestore, path, id))).data()
  })
  return data
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: readFileSync('firestore.rules', 'utf8') } })
})
beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore
    for (const [uid, [organizationId, role]] of Object.entries(ROLE)) {
      await setDoc(doc(db, 'members', uid), { organizationId, role, email: `${uid}@example.org`, displayName: uid, active: true, createdAt: at(1), updatedAt: at(1) })
    }
    for (const [id, organizationId] of [[WP_1, ORG], [WP_2, ORG], [WP_B, ORG_B]]) {
      await setDoc(doc(db, 'waterPoints', id), {
        organizationId, name: `${id} (fictional)`, type: 'borehole', locationDescription: 'Fictional', status: 'working',
        demo: true, createdBy: 'seed', createdAt: at(1), updatedAt: at(1),
      })
    }
    for (const [id, organizationId, waterPointId, status, day] of SEED) {
      const previous = PREVIOUS[status]
      await setDoc(doc(db, 'incidents', id), {
        organizationId, waterPointId, reporterId: REPORTER, demo: true,
        description: 'Handpump gives very little water (fictional).', incidentType: 'low_flow', severity: null,
        status, baseRevision: 0, clientRevision: 1, mutationId: crypto.randomUUID(), serverRevision: REVISION[status],
        clientCreatedAt: at(day), createdAt: at(day), updatedAt: at(day), confirmedFields: ['incidentType'],
        ...(previous ? { lastStatusChange: { by: TECH, at: at(day), from: previous, to: status } } : {}),
      })
    }
  })
})
afterAll(async () => {
  await env.cleanup()
})

const filters: IncidentQueueFilter[] = []
for (const status of [null, ...incidentStatusSchema.options]) {
  for (const waterPointId of [null, WP_1]) {
    for (const order of ['newest', 'oldest'] as const) filters.push({ status, waterPointId, order })
  }
}

describe('incident queue queries (T7.1, AC2)', () => {
  it.each(filters.map((f) => [JSON.stringify(f), f] as const))('staff query %s returns only matching incidents of their organization', async (_label, filter) => {
    for (const uid of [ADMIN, TECH]) {
      const list = await incidentsAs(uid).list(scopeOf(uid), filter)
      const expected = SEED.filter(([, org, wp, status]) => org === ORG && (!filter.status || status === filter.status) && (!filter.waterPointId || wp === filter.waterPointId))
        .sort((a, b) => (filter.order === 'newest' ? b[4] - a[4] : a[4] - b[4]))
        .map(([id]) => id)
      expect(list.map((i) => i.id)).toEqual(expected)
    }
  })

  it('a reporter cannot run the staff queue query', async () => {
    await expect(incidentsAs(REPORTER).list(scopeOf(REPORTER), { status: null, waterPointId: null, order: 'newest' })).rejects.toMatchObject({ kind: 'permission' })
  })

  it('another organization sees only its own incidents, and cannot read ours', async () => {
    const list = await incidentsAs(ADMIN_B).list(scopeOf(ADMIN_B), { status: null, waterPointId: null, order: 'newest' })
    expect(list.map((i) => i.organizationId)).toEqual([ORG_B])
    await expect(incidentsAs(ADMIN_B).get(scopeOf(ADMIN_B), NEW_1)).rejects.toMatchObject({ kind: 'permission' })
    // A forged scope is denied by the rules, not just filtered.
    await expect(incidentsAs(ADMIN_B).list({ organizationId: ORG, ownerUid: ADMIN_B }, { status: null, waterPointId: null, order: 'newest' })).rejects.toMatchObject({ kind: 'permission' })
  })
})

describe('status transitions (T7.2, AC19)', () => {
  it('a technician moves new -> triaged -> in_progress -> resolved with server-recorded who and when', async () => {
    const service = incidentsAs(TECH)
    for (const to of ['triaged', 'in_progress', 'resolved'] as const) {
      const current = await service.get(scopeOf(TECH), NEW_1)
      if (!current) throw new Error('missing')
      await service.changeStatus(scopeOf(TECH), current, to)
      const data = await serverDoc('incidents', NEW_1)
      expect(data).toMatchObject({ status: to, serverRevision: current.serverRevision + 1, lastStatusChange: { by: TECH, from: current.status, to } })
      expect((data?.lastStatusChange as { at: unknown }).at).toBeInstanceOf(Timestamp)
      expect(data?.updatedAt).toBeInstanceOf(Timestamp)
    }
    // Content, AI, and confirmations are untouched by status updates.
    expect(await serverDoc('incidents', NEW_1)).toMatchObject({ description: 'Handpump gives very little water (fictional).', confirmedFields: ['incidentType'], baseRevision: 0 })
  })

  it('an administrator can triage too', async () => {
    const current = await incidentsAs(ADMIN).get(scopeOf(ADMIN), NEW_2)
    if (!current) throw new Error('missing')
    await incidentsAs(ADMIN).changeStatus(scopeOf(ADMIN), current, 'triaged')
    expect((await serverDoc('incidents', NEW_2))?.lastStatusChange).toMatchObject({ by: ADMIN, from: 'new', to: 'triaged' })
  })

  it('skips, reversals, and same-status changes are refused before any write, and denied by the rules', async () => {
    const service = incidentsAs(TECH)
    const current = await service.get(scopeOf(TECH), NEW_1)
    if (!current) throw new Error('missing')
    for (const to of ['new', 'in_progress', 'resolved'] as const) {
      await expect(service.changeStatus(scopeOf(TECH), current, to)).rejects.toMatchObject({ kind: 'transition' })
    }
    // A client that skips the check is stopped by the rules.
    const skip = updateDoc(doc(dbAs(TECH), 'incidents', NEW_1), {
      status: 'in_progress', lastStatusChange: { by: TECH, at: serverTimestamp(), from: 'new', to: 'in_progress' }, serverRevision: 2, updatedAt: serverTimestamp(),
    })
    await expect(skip).rejects.toMatchObject({ code: 'permission-denied' })
    expect((await serverDoc('incidents', NEW_1))?.status).toBe('new')
  })

  it('a stale view is refused: someone else changed the status first', async () => {
    const seen = await incidentsAs(TECH).get(scopeOf(TECH), NEW_1)
    if (!seen) throw new Error('missing')
    await incidentsAs(ADMIN).changeStatus(scopeOf(ADMIN), seen, 'triaged')
    await expect(incidentsAs(TECH).changeStatus(scopeOf(TECH), seen, 'triaged')).rejects.toMatchObject({ kind: 'stale' })
    expect((await serverDoc('incidents', NEW_1))?.serverRevision).toBe(2)
  })

  it('reporters cannot change status, even on their own incident', async () => {
    const seen = { id: NEW_1, status: 'new' as const, serverRevision: 1 }
    await expect(incidentsAs(REPORTER).changeStatus(scopeOf(REPORTER), seen, 'triaged')).rejects.toMatchObject({ kind: 'permission' })
    expect((await serverDoc('incidents', NEW_1))?.status).toBe('new')
  })

  it('another organization cannot change our incidents', async () => {
    const seen = { id: NEW_1, status: 'new' as const, serverRevision: 1 }
    await expect(incidentsAs(ADMIN_B).changeStatus(scopeOf(ADMIN_B), seen, 'triaged')).rejects.toMatchObject({ kind: 'permission' })
  })
})

describe('maintenance lifecycle (T7.3, AC10)', () => {
  it('administrator triages, creates a linked task assigned to a technician; the technician takes it to done', async () => {
    const admin = scopeOf(ADMIN)
    const incident = await incidentsAs(ADMIN).get(admin, NEW_1)
    if (!incident) throw new Error('missing')
    await incidentsAs(ADMIN).changeStatus(admin, incident, 'triaged')

    const id = await tasksAs(ADMIN).create(admin, { incidentId: NEW_1, waterPointId: WP_1 }, { title: 'Replace seal (fictional)', notes: '', assigneeId: TECH })
    expect(await serverDoc('maintenanceTasks', id)).toMatchObject({
      organizationId: ORG, incidentId: NEW_1, waterPointId: WP_1, status: 'open', assigneeId: TECH, createdBy: ADMIN, demo: false,
    })
    expect((await tasksAs(TECH).listForIncident(scopeOf(TECH), NEW_1)).map((t) => t.id)).toEqual([id])

    const tech = tasksAs(TECH)
    let task = await tech.get(scopeOf(TECH), id)
    if (!task) throw new Error('missing')
    await expect(tech.changeStatus(scopeOf(TECH), task, 'done')).rejects.toMatchObject({ kind: 'transition' })
    await tech.changeStatus(scopeOf(TECH), task, 'in_progress')
    await tech.update(scopeOf(TECH), id, { title: 'Replace seal (fictional)', notes: 'Seal replaced.', assigneeId: TECH })
    task = await tech.get(scopeOf(TECH), id)
    if (!task) throw new Error('missing')
    await tech.changeStatus(scopeOf(TECH), task, 'done')
    expect(await serverDoc('maintenanceTasks', id)).toMatchObject({ status: 'done', notes: 'Seal replaced.' })
    expect((await tech.list(scopeOf(TECH), { status: 'done' })).map((t) => t.id)).toEqual([id])
    expect(await tech.list(scopeOf(TECH), { status: 'open' })).toEqual([])
  })

  it('a technician creates a task assigned to themselves; assigning a reporter is denied', async () => {
    const tech = scopeOf(TECH)
    await expect(tasksAs(TECH).create(tech, { incidentId: NEW_2, waterPointId: WP_2 }, { title: 'Check kiosk tap', notes: '', assigneeId: TECH })).resolves.toEqual(expect.any(String))
    await expect(tasksAs(TECH).create(tech, { incidentId: NEW_2, waterPointId: WP_2 }, { title: 'Check kiosk tap', notes: '', assigneeId: REPORTER })).rejects.toMatchObject({ kind: 'permission' })
  })

  it('a task must be on the incident’s water point', async () => {
    await expect(tasksAs(ADMIN).create(scopeOf(ADMIN), { incidentId: NEW_1, waterPointId: WP_2 }, { title: 'x', notes: '', assigneeId: null })).rejects.toMatchObject({ kind: 'invalid' })
  })

  it('reporters and other organizations cannot create, list, or read tasks', async () => {
    await expect(tasksAs(REPORTER).create(scopeOf(REPORTER), { incidentId: NEW_1, waterPointId: WP_1 }, { title: 'x', notes: '', assigneeId: null })).rejects.toMatchObject({ kind: 'permission' })
    await expect(tasksAs(REPORTER).list(scopeOf(REPORTER), { status: null })).rejects.toMatchObject({ kind: 'permission' })
    const id = await tasksAs(ADMIN).create(scopeOf(ADMIN), { incidentId: NEW_1, waterPointId: WP_1 }, { title: 'x', notes: '', assigneeId: null })
    await expect(tasksAs(ADMIN_B).get(scopeOf(ADMIN_B), id)).rejects.toMatchObject({ kind: 'permission' })
    expect(await tasksAs(ADMIN_B).list(scopeOf(ADMIN_B), { status: null })).toEqual([])
    // Another organization cannot link a task to our incident.
    await expect(tasksAs(ADMIN_B).create(scopeOf(ADMIN_B), { incidentId: NEW_1, waterPointId: WP_1 }, { title: 'x', notes: '', assigneeId: null })).rejects.toMatchObject({ kind: 'permission' })
  })
})

describe('dashboard counts (T7.4)', () => {
  it('counts open incidents and tasks for the organization only', async () => {
    const admin = scopeOf(ADMIN)
    await tasksAs(ADMIN).create(admin, { incidentId: NEW_1, waterPointId: WP_1 }, { title: 'x', notes: '', assigneeId: null })
    const counts = await createFirebaseDashboardService(dbAs(TECH)).staffCounts(scopeOf(TECH))
    expect(counts).toEqual({ incidents: { new: 2, triaged: 1, in_progress: 1 }, tasks: { open: 1, in_progress: 0 } })
    expect(await createFirebaseDashboardService(dbAs(ADMIN_B)).staffCounts(scopeOf(ADMIN_B))).toEqual({
      incidents: { new: 1, triaged: 0, in_progress: 0 },
      tasks: { open: 0, in_progress: 0 },
    })
  })

  it('reporters cannot run organization counts', async () => {
    await expect(createFirebaseDashboardService(dbAs(REPORTER)).staffCounts(scopeOf(REPORTER))).rejects.toMatchObject({ kind: 'permission' })
  })
})
