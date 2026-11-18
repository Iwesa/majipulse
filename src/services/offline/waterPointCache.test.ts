import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { waterPointRecord } from '../../test/fakeServices'
import { DB_NAME, openMajiPulseDb, type MajiPulseDatabase } from './db'
import { createIdbWaterPointCache } from './waterPointCache'

const A = { organizationId: 'kwale-demo', ownerUid: 'uid-reporter' }
const A2 = { organizationId: 'kwale-demo', ownerUid: 'uid-technician' }
const B = { organizationId: 'pwani-demo', ownerUid: 'uid-reporter' }
const T1 = '2026-03-01T08:00:00.000Z'
const T2 = '2026-03-02T09:00:00.000Z'

let database: Promise<MajiPulseDatabase>

beforeEach(() => {
  // A fresh, empty IndexedDB per test.
  globalThis.indexedDB = new IDBFactory()
  database = openMajiPulseDb()
})

describe('IndexedDB water point cache (T3.4, R2.2)', () => {
  it('returns null before anything is saved', async () => {
    expect(await createIdbWaterPointCache(database).read(A)).toBeNull()
  })

  it('saves and reads back the organization’s water points, sorted by name', async () => {
    const cache = createIdbWaterPointCache(database)
    const points = [waterPointRecord({ id: 'wp-b', name: 'B point' }), waterPointRecord({ id: 'wp-a', name: 'A point' })]
    await cache.replace(A, points, T1)
    const saved = await cache.read(A)
    expect(saved?.cachedAt).toBe(T1)
    expect(saved?.points.map((p) => p.id)).toEqual(['wp-a', 'wp-b'])
    expect(saved?.points[0]).toEqual(points[1])
  })

  it('an empty list is a valid saved state (not "never loaded")', async () => {
    const cache = createIdbWaterPointCache(database)
    await cache.replace(A, [], T1)
    expect(await cache.read(A)).toEqual({ points: [], cachedAt: T1 })
  })

  it('replace removes records that are no longer on the server', async () => {
    const cache = createIdbWaterPointCache(database)
    await cache.replace(A, [waterPointRecord({ id: 'wp-old' }), waterPointRecord({ id: 'wp-keep' })], T1)
    await cache.replace(A, [waterPointRecord({ id: 'wp-keep' })], T2)
    const saved = await cache.read(A)
    expect(saved?.points.map((p) => p.id)).toEqual(['wp-keep'])
    expect(saved?.cachedAt).toBe(T2)
  })

  it('another organization’s cache is not readable', async () => {
    const cache = createIdbWaterPointCache(database)
    await cache.replace(A, [waterPointRecord()], T1)
    expect(await cache.read(B)).toBeNull()
  })

  it('another user in the same organization cannot read this user’s copy (account switching)', async () => {
    const cache = createIdbWaterPointCache(database)
    await cache.replace(A, [waterPointRecord()], T1)
    expect(await cache.read(A2)).toBeNull()
    await cache.replace(A2, [], T2)
    expect((await cache.read(A))?.points).toHaveLength(1)
    expect((await cache.read(A2))?.points).toHaveLength(0)
  })

  it('a user’s copy survives sign-out and is there when they sign in again', async () => {
    await createIdbWaterPointCache(database).replace(A, [waterPointRecord()], T1)
    // Same device, new app session.
    const reopened = createIdbWaterPointCache(openMajiPulseDb())
    expect((await reopened.read(A))?.points).toHaveLength(1)
  })

  it('never writes records of another organization into a scope', async () => {
    const cache = createIdbWaterPointCache(database)
    await cache.replace(A, [waterPointRecord(), waterPointRecord({ id: 'wp-foreign', organizationId: 'pwani-demo' })], T1)
    expect((await cache.read(A))?.points.map((p) => p.id)).toEqual(['wp-mwamanga'])
    expect(await cache.read(B)).toBeNull()
  })

  it('skips records that fail validation instead of showing them', async () => {
    const cache = createIdbWaterPointCache(database)
    await cache.replace(A, [waterPointRecord()], T1)
    const db = await database
    await db.put('waterPointsCache', { id: 'wp-bad', organizationId: A.organizationId, ownerUid: A.ownerUid, cachedAt: T1, name: '' })
    expect((await cache.read(A))?.points.map((p) => p.id)).toEqual(['wp-mwamanga'])
  })

  it('rejects an invalid scope', async () => {
    const cache = createIdbWaterPointCache(database)
    await expect(cache.read({ organizationId: 'Bad Org', ownerUid: 'u' })).rejects.toThrow()
    await expect(cache.replace({ organizationId: 'kwale-demo', ownerUid: 'a/b' }, [], T1)).rejects.toThrow()
  })

  it('uses the shared majipulse database', async () => {
    expect((await database).name).toBe(DB_NAME)
  })
})
