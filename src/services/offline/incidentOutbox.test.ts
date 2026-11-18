import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { beforeEach, describe, expect, it } from 'vitest'
import type { LocalIncidentRecord } from '../../schemas/localIncident'
import { waterPointRecord } from '../../test/fakeServices'
import { createLocalIncident, type DraftClock } from '../incidentDrafts'
import { IncidentOutboxError } from '../incidents'
import { DB_NAME, DB_VERSION, openMajiPulseDb, type MajiPulseDatabase } from './db'
import { createIdbIncidentOutbox } from './incidentOutbox'
import { createIdbWaterPointCache } from './waterPointCache'

const A = { organizationId: 'kwale-demo', ownerUid: 'uid-reporter-a' }
const B = { organizationId: 'kwale-demo', ownerUid: 'uid-reporter-b' }
const OTHER_ORG = { organizationId: 'pwani-demo', ownerUid: 'uid-reporter-a' }
const content = { waterPointId: 'wp-mwamanga', description: 'No water since Monday (fictional).', incidentType: 'no_water' as const, severity: null }

let n = 0
const clock: DraftClock = {
  now: () => new Date(Date.UTC(2026, 2, 1, 8, n)),
  uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
}
const id = () => crypto.randomUUID()

let database: Promise<MajiPulseDatabase>
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  database = openMajiPulseDb()
})

describe('database upgrade v1 -> v2', () => {
  it('adds the incidents store and keeps the Phase 3 water point cache', async () => {
    // A device that ran Phase 3 has version 1 with a saved water point list.
    // (The shared beforeEach database is not used here: a fresh factory.)
    globalThis.indexedDB = new IDBFactory()
    const v1 = await openDB(DB_NAME, 1, {
      upgrade(db) {
        const cache = db.createObjectStore('waterPointsCache', { keyPath: ['organizationId', 'ownerUid', 'id'] })
        cache.createIndex('byScope', ['organizationId', 'ownerUid'])
        db.createObjectStore('meta', { keyPath: 'key' })
      },
    })
    const cachedAt = '2026-03-01T08:00:00.000Z'
    await v1.put('waterPointsCache', { ...waterPointRecord(), ownerUid: A.ownerUid, cachedAt })
    await v1.put('meta', { key: JSON.stringify(['waterPoints', A.organizationId, A.ownerUid]), value: cachedAt })
    v1.close()

    const upgraded = await openMajiPulseDb()
    expect(upgraded.version).toBe(DB_VERSION)
    expect([...upgraded.objectStoreNames].sort()).toEqual(['incidents', 'meta', 'waterPointsCache'])
    expect([...upgraded.transaction('incidents').store.indexNames]).toEqual(['byScope'])
    const saved = await createIdbWaterPointCache(Promise.resolve(upgraded)).read(A)
    expect(saved?.points.map((p) => p.id)).toEqual(['wp-mwamanga'])
  })

  it('creates every store on a fresh device', async () => {
    const db = await database
    expect(db.version).toBe(2)
    expect([...db.objectStoreNames].sort()).toEqual(['incidents', 'meta', 'waterPointsCache'])
  })
})

describe('incident repository (T4.1)', () => {
  it('creates, reads, lists newest first, and updates', async () => {
    const repo = createIdbIncidentOutbox(database).forScope(A)
    const first = createLocalIncident(id(), A, content, clock)
    const second = createLocalIncident(id(), A, { ...content, incidentType: 'leak' }, clock)
    await repo.create(first)
    await repo.create(second)
    expect(await repo.get(first.id)).toEqual(first)
    expect((await repo.list()).map((r) => r.id)).toEqual([second.id, first.id])
    await repo.update({ ...first, description: 'Updated (fictional).' })
    expect((await repo.get(first.id))?.description).toBe('Updated (fictional).')
  })

  it('refuses to create an ID twice, so a double tap cannot overwrite a report', async () => {
    const repo = createIdbIncidentOutbox(database).forScope(A)
    const record = createLocalIncident(id(), A, content, clock)
    await repo.create(record)
    await expect(repo.create({ ...record, description: 'Overwrite' })).rejects.toMatchObject({ kind: 'alreadyExists' })
    expect((await repo.get(record.id))?.description).toBe(record.description)
  })

  it('refuses to update a record that does not exist', async () => {
    const repo = createIdbIncidentOutbox(database).forScope(A)
    await expect(repo.update(createLocalIncident(id(), A, content, clock))).rejects.toMatchObject({ kind: 'notFound' })
  })

  it('validates records and refuses records of another scope', async () => {
    const repo = createIdbIncidentOutbox(database).forScope(A)
    const record = createLocalIncident(id(), A, content, clock)
    await expect(repo.create({ ...record, description: '' })).rejects.toBeInstanceOf(IncidentOutboxError)
    await expect(repo.create(createLocalIncident(id(), B, content, clock))).rejects.toMatchObject({ kind: 'invalid' })
    expect(await repo.list()).toEqual([])
  })

  it('user A’s reports are invisible to user B and to another organization (R3.5, AC13)', async () => {
    const outbox = createIdbIncidentOutbox(database)
    const record = createLocalIncident(id(), A, content, clock)
    await outbox.forScope(A).create(record)
    expect(await outbox.forScope(B).list()).toEqual([])
    expect(await outbox.forScope(B).get(record.id)).toBeNull()
    expect(await outbox.forScope(OTHER_ORG).list()).toEqual([])
  })

  it('reports survive sign-out and a new session on the same device (R3.6)', async () => {
    const record = createLocalIncident(id(), A, content, clock)
    await createIdbIncidentOutbox(database).forScope(A).create(record)
    await createIdbIncidentOutbox(database).forScope(B).list()
    expect(await createIdbIncidentOutbox(openMajiPulseDb()).forScope(A).get(record.id)).toEqual(record)
  })

  it('skips stored records that fail validation', async () => {
    const repo = createIdbIncidentOutbox(database).forScope(A)
    await repo.create(createLocalIncident(id(), A, content, clock))
    await (await database).put('incidents', { id: 'bad', organizationId: A.organizationId, ownerUid: A.ownerUid, description: '' })
    expect(await repo.list()).toHaveLength(1)
  })

  it('crash recovery: syncing records go back to pending and keep inFlight', async () => {
    const outbox = createIdbIncidentOutbox(database)
    const base = createLocalIncident(id(), A, content, clock)
    const syncing: LocalIncidentRecord = { ...base, syncStatus: 'syncing', inFlight: { mutationId: base.mutationId, baseRevision: 0, startedAt: base.clientCreatedAt } }
    const pending = createLocalIncident(id(), A, content, clock)
    const otherUser: LocalIncidentRecord = { ...createLocalIncident(id(), B, content, clock), syncStatus: 'syncing', inFlight: syncing.inFlight }
    await outbox.forScope(A).create(syncing)
    await outbox.forScope(A).create(pending)
    await outbox.forScope(B).create(otherUser)

    expect(await outbox.forScope(A).resetInterruptedSyncs()).toBe(1)
    const recovered = await outbox.forScope(A).get(syncing.id)
    expect(recovered?.syncStatus).toBe('pending')
    expect(recovered?.inFlight).toEqual(syncing.inFlight)
    expect((await outbox.forScope(A).get(pending.id))?.syncStatus).toBe('pending')
    // Only this user's records are touched.
    expect((await outbox.forScope(B).get(otherUser.id))?.syncStatus).toBe('syncing')
  })

  it('rejects an invalid scope', () => {
    expect(() => createIdbIncidentOutbox(database).forScope({ organizationId: 'Bad Org', ownerUid: 'u' })).toThrow()
  })
})
