import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { ORG_A, ORG_B, UID, WP_A, WP_B, as, createEnv, seed } from './setup'

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

const newWaterPoint = (createdBy: string, overrides: Record<string, unknown> = {}) => ({
  organizationId: ORG_A,
  name: 'New Demo Tap (fictional)',
  type: 'tap',
  locationDescription: 'Fictional market',
  status: 'working',
  demo: false,
  createdBy,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...overrides,
})

describe('read', () => {
  it('every role reads its own organization’s water points', async () => {
    for (const uid of [UID.adminA, UID.techA, UID.reporterA]) {
      await assertSucceeds(getDoc(doc(as(env, uid), 'waterPoints', WP_A)))
    }
  })
  it('scoped list queries succeed for each role (AC2)', async () => {
    for (const uid of [UID.adminA, UID.techA, UID.reporterA]) {
      await assertSucceeds(getDocs(query(collection(as(env, uid), 'waterPoints'), where('organizationId', '==', ORG_A))))
    }
  })
  it('unscoped list queries are denied for each role (AC2)', async () => {
    for (const uid of [UID.adminA, UID.techA, UID.reporterA]) {
      await assertFails(getDocs(collection(as(env, uid), 'waterPoints')))
    }
  })
  it('another organization’s water points are denied, by get and by query', async () => {
    await assertFails(getDoc(doc(as(env, UID.adminA), 'waterPoints', WP_B)))
    await assertFails(getDocs(query(collection(as(env, UID.adminA), 'waterPoints'), where('organizationId', '==', ORG_B))))
  })
})

describe('create', () => {
  it('administrators and technicians create water points in their organization', async () => {
    await assertSucceeds(setDoc(doc(as(env, UID.adminA), 'waterPoints', 'wp-new-1'), newWaterPoint(UID.adminA)))
    await assertSucceeds(setDoc(doc(as(env, UID.techA), 'waterPoints', 'wp-new-2'), newWaterPoint(UID.techA)))
  })
  it('reporters cannot create water points', async () => {
    await assertFails(setDoc(doc(as(env, UID.reporterA), 'waterPoints', 'wp-new'), newWaterPoint(UID.reporterA)))
  })
  it('denies another organization, a forged creator, demo records, and client timestamps', async () => {
    const db = as(env, UID.adminA)
    await assertFails(setDoc(doc(db, 'waterPoints', 'wp-x1'), newWaterPoint(UID.adminA, { organizationId: ORG_B })))
    await assertFails(setDoc(doc(db, 'waterPoints', 'wp-x2'), newWaterPoint(UID.techA)))
    await assertFails(setDoc(doc(db, 'waterPoints', 'wp-x3'), newWaterPoint(UID.adminA, { demo: true })))
    await assertFails(setDoc(doc(db, 'waterPoints', 'wp-x4'), newWaterPoint(UID.adminA, { createdAt: new Date() })))
  })
  it.each([
    ['unknown type', { type: 'dam' }],
    ['unknown status', { status: 'broken' }],
    ['empty name', { name: '' }],
    ['overlong name', { name: 'n'.repeat(121) }],
    ['coordinates (not in the MVP)', { lat: -4.17 }],
    ['empty ward', { ward: '' }],
  ])('denies invalid fields: %s', async (_label, overrides) => {
    await assertFails(setDoc(doc(as(env, UID.adminA), 'waterPoints', 'wp-bad'), newWaterPoint(UID.adminA, overrides)))
  })
})

describe('update and delete', () => {
  it('staff update fields with a server updatedAt', async () => {
    await assertSucceeds(updateDoc(doc(as(env, UID.techA), 'waterPoints', WP_A), { status: 'needs_repair', updatedAt: serverTimestamp() }))
  })
  it('organizationId, createdBy, createdAt, and demo are immutable', async () => {
    const db = as(env, UID.adminA)
    for (const change of [{ organizationId: ORG_B }, { createdBy: UID.techA }, { createdAt: serverTimestamp() }, { demo: true }]) {
      await assertFails(updateDoc(doc(db, 'waterPoints', WP_A), { ...change, updatedAt: serverTimestamp() }))
    }
  })
  it('reporters and other organizations cannot update', async () => {
    await assertFails(updateDoc(doc(as(env, UID.reporterA), 'waterPoints', WP_A), { status: 'unknown', updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(as(env, UID.adminB), 'waterPoints', WP_A), { status: 'unknown', updatedAt: serverTimestamp() }))
  })
  it('nobody deletes water points from the client', async () => {
    await assertFails(deleteDoc(doc(as(env, UID.adminA), 'waterPoints', WP_A)))
  })
})
