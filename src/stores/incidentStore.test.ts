import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalIncidentRecord } from '../schemas/localIncident'
import { openMajiPulseDb } from '../services/offline/db'
import { createIdbIncidentOutbox } from '../services/offline/incidentOutbox'
import type { IncidentOutbox } from '../services/incidents'
import { createIncidentStore } from './incidentStore'
import { registerStoreReset, resetAllStores } from './storeRegistry'

const A = { organizationId: 'kwale-demo', ownerUid: 'uid-reporter-a' }
const B = { organizationId: 'kwale-demo', ownerUid: 'uid-reporter-b' }
const content = { waterPointId: 'wp-1', description: 'Leaking pipe (fictional).', incidentType: 'leak' as const, severity: 'medium' as const }

let outbox: IncidentOutbox
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  outbox = createIdbIncidentOutbox(openMajiPulseDb())
})

const records = (store: ReturnType<typeof createIncidentStore>): LocalIncidentRecord[] => {
  const list = store.getState().list
  return list.status === 'ready' ? list.records : []
}

describe('incident store', () => {
  it('saveNew writes to IndexedDB, with no network involved, and lists it as pending (R3.2)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const store = createIncidentStore(outbox)
    await store.getState().openSession(A)
    const id = crypto.randomUUID()
    await store.getState().saveNew(A, id, content)
    expect(records(store)).toHaveLength(1)
    expect(records(store)[0]).toMatchObject({ id, syncStatus: 'pending', clientRevision: 1, baseRevision: 0 })
    expect(await outbox.forScope(A).get(id)).toMatchObject({ id })
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('saveEdit increments clientRevision and rotates mutationId (R3.4)', async () => {
    const store = createIncidentStore(outbox)
    const id = crypto.randomUUID()
    const first = await store.getState().saveNew(A, id, content)
    const second = await store.getState().saveEdit(A, id, { ...content, description: 'More detail (fictional).' })
    expect(second.clientRevision).toBe(2)
    expect(second.mutationId).not.toBe(first.mutationId)
    expect(records(store)[0].description).toBe('More detail (fictional).')
  })

  it('saveEdit of an unknown report fails with notFound', async () => {
    const store = createIncidentStore(outbox)
    await expect(store.getState().saveEdit(A, crypto.randomUUID(), content)).rejects.toMatchObject({ kind: 'notFound' })
  })

  it('saving the same new report twice fails instead of overwriting', async () => {
    const store = createIncidentStore(outbox)
    const id = crypto.randomUUID()
    await store.getState().saveNew(A, id, content)
    await expect(store.getState().saveNew(A, id, { ...content, description: 'Other' })).rejects.toMatchObject({ kind: 'alreadyExists' })
  })

  it('openSession recovers interrupted syncs before listing', async () => {
    const store = createIncidentStore(outbox)
    const id = crypto.randomUUID()
    const record = await store.getState().saveNew(A, id, content)
    await outbox.forScope(A).update({ ...record, syncStatus: 'syncing', inFlight: { mutationId: record.mutationId, baseRevision: 0, startedAt: record.clientCreatedAt } })
    const fresh = createIncidentStore(outbox)
    await fresh.getState().openSession(A)
    expect(records(fresh)[0].syncStatus).toBe('pending')
  })

  it('account switching: reset clears memory, B sees none of A’s reports, A’s stay on the device (AC13)', async () => {
    const store = createIncidentStore(outbox)
    const unregister = registerStoreReset(() => store.getState().reset())
    await store.getState().saveNew(A, crypto.randomUUID(), content)
    expect(records(store)).toHaveLength(1)

    resetAllStores()
    expect(store.getState().list).toEqual({ status: 'idle' })
    await store.getState().openSession(B)
    expect(records(store)).toEqual([])

    resetAllStores()
    await store.getState().openSession(A)
    expect(records(store)).toHaveLength(1)
    unregister()
  })

  it('a slow load for the previous account is discarded after reset', async () => {
    const store = createIncidentStore(outbox)
    await store.getState().saveNew(A, crypto.randomUUID(), content)
    const pending = store.getState().load(A)
    store.getState().reset()
    await pending
    expect(store.getState().list).toEqual({ status: 'idle' })
  })

  it('reports a storage error state', async () => {
    const broken: IncidentOutbox = {
      forScope: (scope) => ({ ...outbox.forScope(scope), list: () => Promise.reject(new Error('quota')) }),
    }
    const store = createIncidentStore(broken)
    await store.getState().load(A)
    expect(store.getState().list).toEqual({ status: 'error' })
  })
})
