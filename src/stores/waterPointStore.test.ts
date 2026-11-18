import { describe, expect, it } from 'vitest'
import { WaterPointServiceError } from '../services/waterPoints'
import { FakeWaterPointCache, FakeWaterPointService, WATER_POINTS, waterPointRecord } from '../test/fakeServices'
import { createWaterPointStore } from './waterPointStore'

const A = { organizationId: 'kwale-demo', ownerUid: 'uid-reporter' }
const OTHER = { organizationId: 'kwale-demo', ownerUid: 'uid-technician' }
const NOW = new Date('2026-03-05T10:00:00.000Z')

function setup(online = true) {
  const service = new FakeWaterPointService()
  const cache = new FakeWaterPointCache()
  const store = createWaterPointStore(service, cache, { now: () => NOW, isOnline: () => online })
  return { service, cache, store }
}

describe('water point store (T3.1, T3.4)', () => {
  it('loads from the server and saves a copy to the cache', async () => {
    const { store, cache } = setup()
    await store.getState().load(A)
    expect(store.getState().list).toEqual({ status: 'ready', points: WATER_POINTS, source: 'server' })
    expect(await cache.read(A)).toEqual({ points: WATER_POINTS, cachedAt: NOW.toISOString() })
  })

  it('shows loading while the first load is in flight', async () => {
    const { store } = setup()
    const pending = store.getState().load(A)
    expect(store.getState().list).toEqual({ status: 'loading' })
    await pending
  })

  it('keeps the list on screen during a background refresh of the same user', async () => {
    const { store } = setup()
    await store.getState().load(A)
    const pending = store.getState().load(A)
    expect(store.getState().list.status).toBe('ready')
    await pending
  })

  it('falls back to the saved copy when offline, saying so and when it was saved', async () => {
    const { store, service, cache } = setup()
    await cache.replace(A, [waterPointRecord()], '2026-03-01T08:00:00.000Z')
    service.fail = new WaterPointServiceError('network')
    await store.getState().load(A)
    expect(store.getState().list).toEqual({
      status: 'ready',
      points: [waterPointRecord()],
      source: 'cache',
      cachedAt: '2026-03-01T08:00:00.000Z',
      reason: 'offline',
    })
  })

  it('falls back to the saved copy on other errors with reason "error"', async () => {
    const { store, service, cache } = setup()
    await cache.replace(A, [], '2026-03-01T08:00:00.000Z')
    service.fail = new WaterPointServiceError('permission')
    await store.getState().load(A)
    expect(store.getState().list).toMatchObject({ status: 'ready', source: 'cache', reason: 'error' })
  })

  it('treats any failure as offline when the browser reports offline', async () => {
    const { store, service } = setup(false)
    service.fail = new WaterPointServiceError('unknown')
    await store.getState().load(A)
    expect(store.getState().list).toEqual({ status: 'offline' })
  })

  it('reports offline or error when nothing was saved', async () => {
    const offline = setup()
    offline.service.fail = new WaterPointServiceError('network')
    await offline.store.getState().load(A)
    expect(offline.store.getState().list).toEqual({ status: 'offline' })

    const failing = setup()
    failing.service.fail = new WaterPointServiceError('unknown')
    await failing.store.getState().load(A)
    expect(failing.store.getState().list).toEqual({ status: 'error' })
  })

  it('does not use another user’s saved copy', async () => {
    const { store, service, cache } = setup()
    await cache.replace(OTHER, [waterPointRecord()], '2026-03-01T08:00:00.000Z')
    service.fail = new WaterPointServiceError('network')
    await store.getState().load(A)
    expect(store.getState().list).toEqual({ status: 'offline' })
  })

  it('still shows server data if saving the copy fails', async () => {
    const { store, cache } = setup()
    cache.replace.mockRejectedValueOnce(new Error('quota'))
    await store.getState().load(A)
    expect(store.getState().list).toMatchObject({ status: 'ready', source: 'server' })
  })

  it('reset clears the list and discards a response from the previous user (account switching)', async () => {
    const { store, service } = setup()
    let release: () => void = () => undefined
    service.list.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve([waterPointRecord({ name: 'Previous user data' })]))),
    )
    const pending = store.getState().load(A)
    store.getState().reset()
    release()
    await pending
    expect(store.getState().list).toEqual({ status: 'idle' })
  })

  it('a newer load wins over an older, slower one', async () => {
    const { store, service } = setup()
    let release: () => void = () => undefined
    service.list.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve([waterPointRecord({ name: 'Stale' })]))))
    const slow = store.getState().load(A)
    await store.getState().load(A)
    release()
    await slow
    expect(store.getState().list).toMatchObject({ status: 'ready', points: WATER_POINTS })
  })

  it('create and update write through the service, then refresh the list and cache', async () => {
    const { store, service, cache } = setup()
    const input = { name: 'New Tap (fictional)', type: 'tap' as const, locationDescription: 'Market', status: 'working' as const }
    const id = await store.getState().create(A, input)
    expect(service.create).toHaveBeenCalledWith(A, input)
    const list = store.getState().list
    expect(list.status === 'ready' && list.points.some((p) => p.id === id)).toBe(true)
    expect((await cache.read(A))?.points.some((p) => p.id === id)).toBe(true)

    await store.getState().update(A, id, { ...input, status: 'not_working' })
    const after = store.getState().list
    expect(after.status === 'ready' && after.points.find((p) => p.id === id)?.status).toBe('not_working')
  })

  it('create errors reach the caller and leave the list unchanged', async () => {
    const { store, service } = setup()
    await store.getState().load(A)
    service.fail = new WaterPointServiceError('permission')
    await expect(
      store.getState().create(A, { name: 'X', type: 'tap', locationDescription: 'Y', status: 'working' }),
    ).rejects.toMatchObject({ kind: 'permission' })
    expect(store.getState().list).toMatchObject({ status: 'ready', points: WATER_POINTS })
  })
})
