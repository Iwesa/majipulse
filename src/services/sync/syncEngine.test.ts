import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalIncidentRecord } from '../../schemas/localIncident'
import { FakeSyncServer } from '../../test/fakeSyncServer'
import { applyLocalEdit, createLocalIncident, systemClock } from '../incidentDrafts'
import type { IncidentRepository } from '../incidents'
import { openMajiPulseDb } from '../offline/db'
import { createIdbIncidentOutbox } from '../offline/incidentOutbox'
import { SyncEngine, type SyncEngineOptions, type Timers } from './syncEngine'
import type { LockManagerLike } from './types'

const A = { organizationId: 'kwale-demo', ownerUid: 'uid-reporter-a' }
const B = { organizationId: 'kwale-demo', ownerUid: 'uid-reporter-b' }
const content = { waterPointId: 'wp-1', description: 'Version A (fictional).', incidentType: 'leak' as const, severity: 'medium' as const }

let server: FakeSyncServer
let outbox: ReturnType<typeof createIdbIncidentOutbox>
let repo: IncidentRepository

/** Manual timers: nothing fires until the test says so. */
class ManualTimers implements Timers {
  pending = new Map<number, { callback: () => void; ms: number }>()
  private next = 1
  set = (callback: () => void, ms: number) => {
    const id = this.next++
    this.pending.set(id, { callback, ms })
    return id
  }
  clear = (handle: unknown) => {
    this.pending.delete(handle as number)
  }
  /** Fires timers with the given delay (backoff timers; submit timeouts are longer). */
  fire(ms: number) {
    for (const [id, t] of [...this.pending]) {
      if (t.ms === ms) {
        this.pending.delete(id)
        t.callback()
      }
    }
  }
  delays() {
    return [...this.pending.values()].map((t) => t.ms).filter((ms) => ms !== 30_000)
  }
}

let timers: ManualTimers

const engine = (overrides: Partial<SyncEngineOptions> = {}) =>
  new SyncEngine({ scope: A, repository: repo, adapter: server, locks: null, timers, isOnline: () => true, ...overrides })

const local = async (id: string) => (await repo.get(id)) as LocalIncidentRecord
const save = async (c = content) => {
  const record = createLocalIncident(crypto.randomUUID(), A, c)
  await repo.create(record)
  return record
}
const edit = (id: string, description: string) =>
  repo.updateWith(id, (r) => applyLocalEdit(r, { ...content, description }, systemClock)) as Promise<LocalIncidentRecord>

/** Waits for in-flight promise chains (fake IndexedDB, engine awaits). */
const settle = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  outbox = createIdbIncidentOutbox(openMajiPulseDb())
  repo = outbox.forScope(A)
  server = new FakeSyncServer()
  timers = new ManualTimers()
})

describe('basic sync (T5.1, T5.2, AC4)', () => {
  it('creates the document once and marks the report synced only after commit', async () => {
    const r = await save()
    await engine().start()
    expect(server.writes).toEqual([[r.id, r.mutationId]])
    expect(server.docs.get(r.id)).toMatchObject({ serverRevision: 1, baseRevision: 0, mutationId: r.mutationId, status: 'new' })
    expect(await local(r.id)).toMatchObject({ syncStatus: 'synced', serverRevision: 1, baseRevision: 1 })
    expect((await local(r.id)).inFlight).toBeUndefined()
  })

  it('persists the snapshot as inFlight before submitting', async () => {
    const r = await save()
    let seen: LocalIncidentRecord | undefined
    server.beforeSubmit = () => undefined
    server.submit.mockImplementationOnce(async (snapshot) => {
      seen = await local(r.id)
      expect(snapshot.inFlight.mutationId).toBe(r.mutationId)
      return { kind: 'committed' }
    })
    await engine().start()
    expect(seen).toMatchObject({ syncStatus: 'syncing', inFlight: { mutationId: r.mutationId, baseRevision: 0 } })
  })

  it('a duplicated sync request makes one write (single flight)', async () => {
    await save()
    const e = engine()
    await Promise.all([e.start(), e.requestSync('manual'), e.requestSync('online')])
    expect(server.writes).toHaveLength(1)
  })

  it('an edit after sync updates from the committed revision', async () => {
    const r = await save()
    const e = engine()
    await e.start()
    const edited = await edit(r.id, 'Version B (fictional).')
    await e.requestSync('save')
    expect(server.docs.get(r.id)).toMatchObject({ serverRevision: 2, baseRevision: 1, mutationId: edited.mutationId, description: 'Version B (fictional).' })
    expect(await local(r.id)).toMatchObject({ syncStatus: 'synced', serverRevision: 2, baseRevision: 2 })
  })

  it('skips the run while offline and leaves reports pending', async () => {
    const r = await save()
    const e = engine({ isOnline: () => false })
    await e.start()
    expect(server.submit).not.toHaveBeenCalled()
    expect((await local(r.id)).syncStatus).toBe('pending')
    expect(e.getState().lastRun).toBe('offline')
  })

  it('only touches the signed-in user’s records', async () => {
    const other = createLocalIncident(crypto.randomUUID(), B, content)
    await outbox.forScope(B).create(other)
    await engine().start()
    expect(server.writes).toEqual([])
    expect((await outbox.forScope(B).get(other.id))?.syncStatus).toBe('pending')
  })

  it('records the last successful sync time', async () => {
    await save()
    const now = new Date('2026-03-05T12:00:00.000Z')
    const e = engine({ now: () => now })
    await e.start()
    expect(e.getState()).toMatchObject({ lastRun: 'ok', lastSyncAt: now.toISOString() })
    expect(await repo.getLastSyncAt()).toBe(now.toISOString())
  })
})

describe('failures (AC5)', () => {
  it('a network failure keeps the report, marks it failed, and retries with backoff', async () => {
    const r = await save()
    server.failNextSubmit('network')
    const e = engine()
    await e.start()
    expect(await local(r.id)).toMatchObject({ syncStatus: 'failed', failureKind: 'network', description: r.description })
    expect(timers.delays()).toEqual([5_000])
    timers.fire(5_000)
    await settle()
    expect(await local(r.id)).toMatchObject({ syncStatus: 'synced' })
    expect(server.writes).toHaveLength(1)
  })

  it('backoff doubles while the network stays down', async () => {
    await save()
    server.failNextSubmit('network').failNextRead('network')
    const e = engine()
    await e.start()
    timers.fire(5_000)
    await settle()
    expect(timers.delays()).toEqual([10_000])
  })

  it('validation and unknown failures are not retried automatically; manual retry works', async () => {
    const r = await save()
    server.failNextSubmit('invalid')
    const e = engine()
    await e.start()
    expect(await local(r.id)).toMatchObject({ syncStatus: 'failed', failureKind: 'validation' })
    expect(timers.delays()).toEqual([])
    await e.requestSync('manual')
    expect(server.writes).toEqual([])
    await e.retry(r.id)
    expect(await local(r.id)).toMatchObject({ syncStatus: 'synced' })
  })

  it('a submission that never answers times out as an uncertain network failure', async () => {
    const r = await save()
    server.submit.mockImplementationOnce(() => new Promise(() => undefined))
    const e = engine()
    const run = e.start()
    await settle()
    timers.fire(30_000)
    await run
    expect(await local(r.id)).toMatchObject({ syncStatus: 'failed', failureKind: 'network', inFlight: { mutationId: r.mutationId } })
  })

  it('never deletes a report', async () => {
    const r = await save()
    server.failNextSubmit('unknown')
    await engine().start()
    expect(await repo.list()).toHaveLength(1)
    expect((await local(r.id)).description).toBe(r.description)
  })
})

describe('edit during sync (AC17)', () => {
  it('an older acknowledgement does not mark a newer edit synced; the newer edit then syncs', async () => {
    const r = await save()
    const gate = server.hold()
    const e = engine()
    const run = e.start()
    await settle()
    expect((await local(r.id)).syncStatus).toBe('syncing')
    const b = await edit(r.id, 'Version B (fictional).')
    gate.release()
    await run
    expect(server.writes.map(([, m]) => m)).toEqual([r.mutationId, b.mutationId])
    expect(server.docs.get(r.id)).toMatchObject({ description: 'Version B (fictional).', mutationId: b.mutationId, serverRevision: 2 })
    expect(await local(r.id)).toMatchObject({ syncStatus: 'synced', mutationId: b.mutationId, description: 'Version B (fictional).', baseRevision: 2 })
    expect(server.docs.size).toBe(1)
  })

  it('same race with a failed submission: the newer content is kept, then sent once', async () => {
    const r = await save()
    const gate = server.hold()
    server.failNextSubmit('network') // A's held submission fails after release
    const e = engine()
    const run = e.start()
    await settle()
    const b = await edit(r.id, 'Version B (fictional).')
    gate.release()
    await run
    expect(await local(r.id)).toMatchObject({
      syncStatus: 'failed',
      description: 'Version B (fictional).',
      mutationId: b.mutationId,
      inFlight: { mutationId: r.mutationId },
    })
    timers.fire(5_000)
    await settle()
    expect(server.writes.map(([, m]) => m)).toEqual([b.mutationId])
    expect(await local(r.id)).toMatchObject({ syncStatus: 'synced', mutationId: b.mutationId })
  })
})

describe('uncertain commits (T5.2a, AC17b to AC17d)', () => {
  it('AC17b new report: A committed but the acknowledgement was lost, edit B, next sync commits B with no conflict', async () => {
    const a = await save()
    server.failNextSubmit('network', true)
    const e = engine()
    await e.start()
    expect(await local(a.id)).toMatchObject({ syncStatus: 'failed', inFlight: { mutationId: a.mutationId } })
    const b = await edit(a.id, 'Version B (fictional).')
    timers.fire(5_000)
    await settle()
    expect(server.docs.get(a.id)).toMatchObject({ mutationId: b.mutationId, serverRevision: 2, description: 'Version B (fictional).' })
    expect(await local(a.id)).toMatchObject({ syncStatus: 'synced', mutationId: b.mutationId })
    expect(server.writes.map(([, m]) => m)).toEqual([a.mutationId, b.mutationId])
    expect(server.docs.size).toBe(1)
  })

  it('AC17b update: the same for an edit whose acknowledgement was lost', async () => {
    const r = await save()
    const e = engine()
    await e.start()
    const a2 = await edit(r.id, 'Version A2 (fictional).')
    server.failNextSubmit('network', true)
    await e.requestSync('save')
    const b = await edit(r.id, 'Version B (fictional).')
    timers.fire(5_000)
    await settle()
    expect(server.docs.get(r.id)).toMatchObject({ mutationId: b.mutationId, serverRevision: 3 })
    expect(server.writes.map(([, m]) => m)).toEqual([r.mutationId, a2.mutationId, b.mutationId])
    expect((await local(r.id)).syncStatus).toBe('synced')
  })

  it('lost acknowledgement without a newer edit: reconciliation marks it synced without writing again', async () => {
    const a = await save()
    server.failNextSubmit('network', true)
    const e = engine()
    await e.start()
    timers.fire(5_000)
    await settle()
    expect(server.writes).toHaveLength(1)
    expect(await local(a.id)).toMatchObject({ syncStatus: 'synced', serverRevision: 1 })
  })

  it('AC17c: unreadable server during reconciliation submits nothing, survives a restart, then completes', async () => {
    const a = await save()
    server.failNextSubmit('network', true).failNextRead('network')
    const first = engine()
    await first.start()
    const b = await edit(a.id, 'Version B (fictional).')
    timers.fire(5_000)
    await settle()
    expect(server.writes).toHaveLength(1)
    expect(await local(a.id)).toMatchObject({ syncStatus: 'failed', failureKind: 'network', inFlight: { mutationId: a.mutationId } })
    first.stop()

    // App restart: a new engine over the same device storage.
    repo = createIdbIncidentOutbox(openMajiPulseDb()).forScope(A)
    await engine().start()
    expect(server.docs.get(a.id)).toMatchObject({ mutationId: b.mutationId, serverRevision: 2 })
    expect(await local(a.id)).toMatchObject({ syncStatus: 'synced' })
  })

  it('startup recovery: a report left syncing by a closed tab is reconciled, not duplicated', async () => {
    const a = await save()
    // The tab closed after the commit, before the acknowledgement was stored.
    await repo.updateWith(a.id, (r) => ({ ...r, syncStatus: 'syncing', inFlight: { mutationId: r.mutationId, baseRevision: 0, startedAt: r.clientCreatedAt } }))
    await server.submit({ ...(await local(a.id)), inFlight: { mutationId: a.mutationId, baseRevision: 0, startedAt: a.clientCreatedAt } })
    server.submit.mockClear()
    server.writes = []
    await engine().start()
    expect(server.submit).not.toHaveBeenCalled()
    expect(await local(a.id)).toMatchObject({ syncStatus: 'synced' })
  })

  it('AC17d: A committed, acknowledgement lost, then triage: edit B is a conflict and kept unchanged', async () => {
    const a = await save()
    server.failNextSubmit('network', true)
    const e = engine()
    await e.start()
    server.triage(a.id)
    const b = await edit(a.id, 'Version B (fictional).')
    timers.fire(5_000)
    await settle()
    const now = await local(a.id)
    expect(now).toMatchObject({ syncStatus: 'conflict', description: 'Version B (fictional).', mutationId: b.mutationId })
    expect(now.conflictServerSnapshot).toMatchObject({ status: 'triaged', mutationId: a.mutationId })
    expect(server.writes).toHaveLength(1)
  })

  it('A committed and triaged with no newer edit: synced, showing the server status', async () => {
    const a = await save()
    server.failNextSubmit('network', true)
    const e = engine()
    await e.start()
    server.triage(a.id)
    timers.fire(5_000)
    await settle()
    expect(await local(a.id)).toMatchObject({ syncStatus: 'synced', status: 'triaged' })
  })

  it('A did not commit: the current content is sent from the unchanged base', async () => {
    const a = await save()
    server.failNextSubmit('network')
    const e = engine()
    await e.start()
    const b = await edit(a.id, 'Version B (fictional).')
    timers.fire(5_000)
    await settle()
    expect(server.writes.map(([, m]) => m)).toEqual([b.mutationId])
    expect(server.docs.get(a.id)).toMatchObject({ serverRevision: 1, mutationId: b.mutationId })
  })
})

describe('conflicts and permission-denied classification (AC6, AC18)', () => {
  it('a stale edit detected in the transaction becomes a conflict, kept unchanged and not retried', async () => {
    const r = await save()
    const e = engine()
    await e.start()
    server.triage(r.id)
    const edited = await edit(r.id, 'Too late (fictional).')
    await e.requestSync('save')
    expect(await local(r.id)).toMatchObject({ syncStatus: 'conflict', description: 'Too late (fictional).', mutationId: edited.mutationId })
    await e.requestSync('manual')
    expect(server.writes).toHaveLength(1)
    expect(timers.delays()).toEqual([])
  })

  const deniedCase = async (setup: (id: string) => void, readFails = false) => {
    const r = await save()
    const e = engine()
    await e.start()
    const edited = await edit(r.id, 'Denied edit (fictional).')
    setup(r.id)
    server.failNextSubmit('permission-denied')
    if (readFails) server.failNextRead('permission-denied')
    await e.requestSync('save')
    const now = await local(r.id)
    expect(now.description).toBe('Denied edit (fictional).')
    expect(now.mutationId).toBe(edited.mutationId)
    return now
  }

  it('denied + server revision ahead of the base -> conflict', async () => {
    const now = await deniedCase((id) => {
      const doc = server.docs.get(id)
      if (doc) server.docs.set(id, { ...doc, serverRevision: doc.serverRevision + 1, mutationId: crypto.randomUUID() })
    })
    expect(now.syncStatus).toBe('conflict')
  })

  it('denied + status triaged -> conflict', async () => {
    const now = await deniedCase((id) => server.triage(id))
    expect(now.syncStatus).toBe('conflict')
    expect(now.conflictServerSnapshot?.status).toBe('triaged')
  })

  it('denied + follow-up read also denied (claims removed or organization changed) -> failed, permission denied', async () => {
    const now = await deniedCase(() => undefined, true)
    expect(now).toMatchObject({ syncStatus: 'failed', failureKind: 'permission_denied' })
    expect(timers.delays()).toEqual([])
  })

  it('denied + server equal to the snapshot base (field validation) -> failed, permission denied', async () => {
    const now = await deniedCase(() => undefined)
    expect(now).toMatchObject({ syncStatus: 'failed', failureKind: 'permission_denied' })
  })

  it('denied + document missing for an update -> failed, permission denied', async () => {
    const now = await deniedCase((id) => server.docs.delete(id))
    expect(now).toMatchObject({ syncStatus: 'failed', failureKind: 'permission_denied' })
  })

  it('refreshes claims before the follow-up read', async () => {
    const refreshClaims = vi.fn(async () => undefined)
    await save()
    server.failNextSubmit('permission-denied')
    await engine({ refreshClaims }).start()
    expect(refreshClaims).toHaveBeenCalledOnce()
  })
})

describe('locks and account switching (AC13)', () => {
  it('uses the Web Locks API with one lock name per account', async () => {
    const names: string[] = []
    const locks: LockManagerLike = {
      request: async (name, _options, callback) => {
        names.push(name)
        return callback({ name })
      },
    }
    await save()
    await engine({ locks }).start()
    expect(names).toEqual(['majipulse-sync:kwale-demo:uid-reporter-a'])
    expect(server.writes).toHaveLength(1)
  })

  it('skips the run when another tab holds the lock', async () => {
    const r = await save()
    const locks: LockManagerLike = { request: async (_n, _o, callback) => callback(null) }
    const e = engine({ locks })
    await e.start()
    expect(server.submit).not.toHaveBeenCalled()
    expect((await local(r.id)).syncStatus).toBe('pending')
    expect(e.getState().lastRun).toBe('busy')
  })

  it('stop() during a submission discards the late result: no write-back, no timers', async () => {
    const r = await save()
    const gate = server.hold()
    const onChange = vi.fn()
    const e = engine({ onChange })
    const run = e.start()
    await settle()
    e.stop()
    gate.release()
    await run
    // The server committed, but the stopped engine wrote nothing locally: the
    // next sign-in reconciles it from inFlight.
    expect(await local(r.id)).toMatchObject({ syncStatus: 'syncing', inFlight: { mutationId: r.mutationId } })
    expect(timers.delays()).toEqual([])
    await engine().start()
    expect(await local(r.id)).toMatchObject({ syncStatus: 'synced' })
    expect(server.writes).toHaveLength(1)
  })

  it('a stopped engine ignores new requests', async () => {
    await save()
    const e = engine()
    e.stop()
    await e.start()
    await e.requestSync('manual')
    expect(server.submit).not.toHaveBeenCalled()
  })
})
