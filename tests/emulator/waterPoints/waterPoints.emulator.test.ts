// Water point service, store, and IndexedDB cache against the Firestore
// emulator with the real security rules (T3.1, T3.4, AC2). FICTIONAL data.
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { IDBFactory } from 'fake-indexeddb'
import { disableNetwork, doc, getDoc, setDoc, Timestamp, type Firestore } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createFirebaseWaterPointService } from '../../../src/services/firebase/waterPointService'
import { openMajiPulseDb } from '../../../src/services/offline/db'
import { createIdbWaterPointCache } from '../../../src/services/offline/waterPointCache'
import { createWaterPointStore } from '../../../src/stores/waterPointStore'

const PROJECT_ID = 'demo-majipulse'
const ORG_A = 'kwale-demo'
const ORG_B = 'pwani-demo'
const T = Timestamp.fromDate(new Date('2026-03-01T08:00:00Z'))
const PEOPLE = {
  adminA: [ORG_A, 'administrator'],
  techA: [ORG_A, 'technician'],
  reporterA: [ORG_A, 'reporter'],
  adminB: [ORG_B, 'administrator'],
} as const

let env: RulesTestEnvironment

const dbFor = (uid: keyof typeof PEOPLE): Firestore => {
  const [organizationId, role] = PEOPLE[uid]
  return env.authenticatedContext(uid, { organizationId, role }).firestore() as unknown as Firestore
}
const scopeOf = (uid: keyof typeof PEOPLE) => ({ organizationId: PEOPLE[uid][0], ownerUid: uid })
const stored = (organizationId: string, name: string) => ({
  organizationId,
  name,
  type: 'borehole',
  locationDescription: 'Fictional place',
  status: 'working',
  demo: true,
  createdBy: 'seed',
  createdAt: T,
  updatedAt: T,
})
const input = { name: 'New Tap (fictional)', type: 'tap' as const, locationDescription: 'Fictional market', status: 'working' as const }

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: readFileSync('firestore.rules', 'utf8') } })
})
beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore
    for (const [uid, [organizationId, role]] of Object.entries(PEOPLE)) {
      await setDoc(doc(db, 'members', uid), { organizationId, role, email: `${uid}@example.org`, displayName: uid, active: true, createdAt: T, updatedAt: T })
    }
    await setDoc(doc(db, 'waterPoints', 'wp-a1'), stored(ORG_A, 'Alpha Borehole (fictional)'))
    await setDoc(doc(db, 'waterPoints', 'wp-a2'), { ...stored(ORG_A, 'Beta Kiosk (fictional)'), ward: 'Demo Ward' })
    await setDoc(doc(db, 'waterPoints', 'wp-b1'), stored(ORG_B, 'Pwani Borehole (fictional)'))
  })
})
afterAll(async () => {
  await env.cleanup()
})

describe('Firestore water point service (AC2)', () => {
  it('every role lists only its own organization’s water points', async () => {
    for (const uid of ['adminA', 'techA', 'reporterA'] as const) {
      const points = await createFirebaseWaterPointService(dbFor(uid)).list(scopeOf(uid))
      expect(points.map((p) => p.id)).toEqual(['wp-a1', 'wp-a2'])
      expect(points[1].createdAt).toBe('2026-03-01T08:00:00.000Z')
    }
    const b = await createFirebaseWaterPointService(dbFor('adminB')).list(scopeOf('adminB'))
    expect(b.map((p) => p.id)).toEqual(['wp-b1'])
  })

  it('a forged scope for another organization is denied by the rules', async () => {
    const service = createFirebaseWaterPointService(dbFor('adminA'))
    await expect(service.list({ organizationId: ORG_B, ownerUid: 'adminA' })).rejects.toMatchObject({ kind: 'permission' })
  })

  it('administrators and technicians create water points with server timestamps (R2.1)', async () => {
    for (const uid of ['adminA', 'techA'] as const) {
      const service = createFirebaseWaterPointService(dbFor(uid))
      const id = await service.create(scopeOf(uid), { ...input, ward: 'Market Ward' })
      const created = (await service.list(scopeOf(uid))).find((p) => p.id === id)
      expect(created).toMatchObject({ ...input, ward: 'Market Ward', organizationId: ORG_A, createdBy: uid, demo: false })
    }
  })

  it('reporters cannot create water points', async () => {
    const service = createFirebaseWaterPointService(dbFor('reporterA'))
    await expect(service.create(scopeOf('reporterA'), input)).rejects.toMatchObject({ kind: 'permission' })
  })

  it('staff update fields, clear the ward, and keep immutable fields', async () => {
    const service = createFirebaseWaterPointService(dbFor('techA'))
    await service.update(scopeOf('techA'), 'wp-a2', { ...input, status: 'needs_repair' })
    const updated = (await service.list(scopeOf('techA'))).find((p) => p.id === 'wp-a2')
    expect(updated).toMatchObject({ status: 'needs_repair', organizationId: ORG_A, createdBy: 'seed', demo: true })
    expect(updated?.ward).toBeUndefined()
    expect(updated && Date.parse(updated.updatedAt)).toBeGreaterThan(T.toMillis())
  })

  it('another organization cannot update, and the record is unchanged', async () => {
    const service = createFirebaseWaterPointService(dbFor('adminB'))
    await expect(service.update(scopeOf('adminB'), 'wp-a1', input)).rejects.toMatchObject({ kind: 'permission' })
    await env.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore() as unknown as Firestore, 'waterPoints', 'wp-a1'))
      expect(snap.data()?.name).toBe('Alpha Borehole (fictional)')
    })
  })

  it('reporters cannot update', async () => {
    const service = createFirebaseWaterPointService(dbFor('reporterA'))
    await expect(service.update(scopeOf('reporterA'), 'wp-a1', input)).rejects.toMatchObject({ kind: 'permission' })
  })
})

describe('offline cache fallback and account isolation (R2.2)', () => {
  it('after an online load, the list is still readable offline from IndexedDB', async () => {
    const db = dbFor('reporterA')
    const cache = createIdbWaterPointCache(openMajiPulseDb())
    const online = createWaterPointStore(createFirebaseWaterPointService(db), cache)
    await online.getState().load(scopeOf('reporterA'))
    expect(online.getState().list).toMatchObject({ status: 'ready', source: 'server' })

    // A new app session with the network off.
    await disableNetwork(db)
    const offline = createWaterPointStore(createFirebaseWaterPointService(db), createIdbWaterPointCache(openMajiPulseDb()), {
      isOnline: () => false,
    })
    await offline.getState().load(scopeOf('reporterA'))
    const list = offline.getState().list
    expect(list).toMatchObject({ status: 'ready', source: 'cache', reason: 'offline' })
    expect(list.status === 'ready' ? list.points.map((p) => p.id) : []).toEqual(['wp-a1', 'wp-a2'])
  })

  it('a different account on the same device cannot read the first account’s copy', async () => {
    const cache = createIdbWaterPointCache(openMajiPulseDb())
    await createWaterPointStore(createFirebaseWaterPointService(dbFor('reporterA')), cache).getState().load(scopeOf('reporterA'))

    const other = dbFor('adminB')
    await disableNetwork(other)
    const store = createWaterPointStore(createFirebaseWaterPointService(other), cache, { isOnline: () => false })
    await store.getState().load(scopeOf('adminB'))
    expect(store.getState().list).toEqual({ status: 'offline' })
    expect(await cache.read(scopeOf('techA'))).toBeNull()
  })
})
