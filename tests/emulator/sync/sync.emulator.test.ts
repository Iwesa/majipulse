// Sync engine + Firestore adapter against the Firestore emulator and the real
// security rules (T5.1, T5.2, T5.2a, T5.2b). FICTIONAL data.
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { IDBFactory } from 'fake-indexeddb'
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc, type Firestore } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { LocalIncidentRecord } from '../../../src/schemas/localIncident'
import { createFirestoreIncidentSyncAdapter, toSyncError } from '../../../src/services/firebase/incidentSyncAdapter'
import { applyLocalEdit, createLocalIncident, systemClock } from '../../../src/services/incidentDrafts'
import type { IncidentRepository } from '../../../src/services/incidents'
import { openMajiPulseDb } from '../../../src/services/offline/db'
import { createIdbIncidentOutbox } from '../../../src/services/offline/incidentOutbox'
import { SyncEngine } from '../../../src/services/sync/syncEngine'
import { retryOnLatest } from '../../../src/services/sync/transitions'
import { SyncAdapterError, type IncidentSyncAdapter } from '../../../src/services/sync/types'

const PROJECT_ID = 'demo-majipulse'
const ORG = 'kwale-demo'
const WP = 'wp-mwamanga'
const T = Timestamp.fromDate(new Date('2026-03-01T08:00:00Z'))
const REPORTER = 'uid-reporter'
const TECH = 'uid-tech'
const SCOPE = { organizationId: ORG, ownerUid: REPORTER }
const content = { waterPointId: WP, description: 'Version A (fictional).', incidentType: 'low_flow' as const, severity: null }

let env: RulesTestEnvironment
let repo: IncidentRepository

const dbAs = (uid: string, role: string): Firestore =>
  env.authenticatedContext(uid, { organizationId: ORG, role }).firestore() as unknown as Firestore
const reporterDb = () => dbAs(REPORTER, 'reporter')

/** Real adapter, optionally wrapped to lose the acknowledgement or fail reads. */
function adapterFor(db: Firestore, faults: { loseAckOnce?: boolean; failReadsOnce?: boolean } = {}): IncidentSyncAdapter {
  const real = createFirestoreIncidentSyncAdapter(db)
  let loseAck = faults.loseAckOnce ?? false
  let failRead = faults.failReadsOnce ?? false
  return {
    async readServer(id) {
      if (failRead) {
        failRead = false
        throw new SyncAdapterError('network', 'injected-read-failure')
      }
      return real.readServer(id)
    },
    async submit(snapshot) {
      const result = await real.submit(snapshot)
      if (loseAck) {
        loseAck = false
        throw new SyncAdapterError('network', 'injected-lost-ack')
      }
      return result
    },
  }
}

const engineWith = (adapter: IncidentSyncAdapter) =>
  new SyncEngine({ scope: SCOPE, repository: repo, adapter, locks: null, isOnline: () => true })

const local = async (id: string) => (await repo.get(id)) as LocalIncidentRecord
const save = async (description = 'Version A (fictional).') => {
  const r = createLocalIncident(crypto.randomUUID(), SCOPE, { ...content, description })
  await repo.create(r)
  return r
}
const edit = (id: string, description: string) =>
  repo.updateWith(id, (r) => applyLocalEdit(r, { ...content, description }, systemClock)) as Promise<LocalIncidentRecord>

async function serverDoc(id: string) {
  let data: Record<string, unknown> | undefined
  await env.withSecurityRulesDisabled(async (ctx) => {
    data = (await getDoc(doc(ctx.firestore() as unknown as Firestore, 'incidents', id))).data()
  })
  return data
}

async function incidentCount() {
  let n = 0
  await env.withSecurityRulesDisabled(async (ctx) => {
    n = (await getDocs(collection(ctx.firestore() as unknown as Firestore, 'incidents'))).size
  })
  return n
}

/** A technician triages through the real rules (status transition only). */
async function triage(id: string, serverRevision: number) {
  await updateDoc(doc(dbAs(TECH, 'technician'), 'incidents', id), {
    status: 'triaged',
    lastStatusChange: { by: TECH, at: serverTimestamp(), from: 'new', to: 'triaged' },
    serverRevision: serverRevision + 1,
    updatedAt: serverTimestamp(),
  })
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: readFileSync('firestore.rules', 'utf8') } })
})
beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  repo = createIdbIncidentOutbox(openMajiPulseDb()).forScope(SCOPE)
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore
    for (const [uid, role] of [[REPORTER, 'reporter'], [TECH, 'technician']]) {
      await setDoc(doc(db, 'members', uid), { organizationId: ORG, role, email: `${uid}@example.org`, displayName: uid, active: true, createdAt: T, updatedAt: T })
    }
    await setDoc(doc(db, 'waterPoints', WP), {
      organizationId: ORG, name: 'Mwamanga Borehole (fictional)', type: 'borehole', locationDescription: 'Fictional', status: 'working',
      demo: true, createdBy: 'seed', createdAt: T, updatedAt: T,
    })
  })
})
afterAll(async () => {
  await env.cleanup()
})

describe('adapter and engine against real rules (T5.1, AC4)', () => {
  it('creates exactly one document with server timestamps, then marks synced', async () => {
    const a = await save()
    await engineWith(adapterFor(reporterDb())).start()
    const data = await serverDoc(a.id)
    expect(data).toMatchObject({ organizationId: ORG, reporterId: REPORTER, status: 'new', serverRevision: 1, baseRevision: 0, mutationId: a.mutationId })
    expect(data?.createdAt).toBeInstanceOf(Timestamp)
    expect(await local(a.id)).toMatchObject({ syncStatus: 'synced', serverRevision: 1 })
    expect(await incidentCount()).toBe(1)
  })

  it('a repeated run and a direct resubmission of the same mutation write nothing more', async () => {
    const a = await save()
    const adapter = adapterFor(reporterDb())
    await engineWith(adapter).start()
    await engineWith(adapter).requestSync('manual')
    const again = await adapter.submit({ ...a, inFlight: { mutationId: a.mutationId, baseRevision: 0, startedAt: a.clientCreatedAt } })
    expect(again.kind).toBe('alreadyApplied')
    expect((await serverDoc(a.id))?.serverRevision).toBe(1)
  })

  it('an edit updates from the current revision and clears removed fields', async () => {
    const a = createLocalIncident(crypto.randomUUID(), SCOPE, { ...content, locationNote: 'By the gate' })
    await repo.create(a)
    const engine = engineWith(adapterFor(reporterDb()))
    await engine.start()
    const b = await edit(a.id, 'Version B (fictional).')
    await engine.requestSync('save')
    const data = await serverDoc(a.id)
    expect(data).toMatchObject({ serverRevision: 2, baseRevision: 1, mutationId: b.mutationId, description: 'Version B (fictional).' })
    expect(data?.locationNote).toBeUndefined()
  })

  it('a stale edit is detected in the transaction and becomes a conflict, not retried (AC6)', async () => {
    const a = await save()
    const engine = engineWith(adapterFor(reporterDb()))
    await engine.start()
    await triage(a.id, 1)
    const b = await edit(a.id, 'Too late (fictional).')
    await engine.requestSync('save')
    expect(await local(a.id)).toMatchObject({ syncStatus: 'conflict', description: 'Too late (fictional).', mutationId: b.mutationId })
    expect((await serverDoc(a.id))?.description).toBe('Version A (fictional).')
  })

  it('the rules themselves reject a stale write (permission-denied)', async () => {
    const a = await save()
    await engineWith(adapterFor(reporterDb())).start()
    await triage(a.id, 1)
    const error = await updateDoc(doc(reporterDb(), 'incidents', a.id), {
      description: 'Stale', baseRevision: 1, serverRevision: 2, mutationId: crypto.randomUUID(), updatedAt: serverTimestamp(),
    }).catch((e: unknown) => e)
    expect(toSyncError(error).code).toBe('permission-denied')
  })
})

describe('uncertain commits against the emulator (T5.2a)', () => {
  it('AC17b new report: lost acknowledgement, edit B, next sync commits B with no conflict', async () => {
    const a = await save()
    const engine = engineWith(adapterFor(reporterDb(), { loseAckOnce: true }))
    await engine.start()
    expect(await local(a.id)).toMatchObject({ syncStatus: 'failed', inFlight: { mutationId: a.mutationId } })
    const b = await edit(a.id, 'Version B (fictional).')
    await engine.requestSync('online')
    expect(await serverDoc(a.id)).toMatchObject({ mutationId: b.mutationId, serverRevision: 2, description: 'Version B (fictional).' })
    expect(await local(a.id)).toMatchObject({ syncStatus: 'synced', mutationId: b.mutationId })
    expect(await incidentCount()).toBe(1)
  })

  it('AC17b update: lost acknowledgement of an edit, edit again, next sync commits the newest', async () => {
    const a = await save()
    const adapter = adapterFor(reporterDb())
    await engineWith(adapter).start()
    await edit(a.id, 'Version A2 (fictional).')
    const lossy = engineWith(adapterFor(reporterDb(), { loseAckOnce: true }))
    await lossy.requestSync('save')
    expect((await serverDoc(a.id))?.serverRevision).toBe(2)
    const b = await edit(a.id, 'Version B (fictional).')
    await lossy.requestSync('online')
    expect(await serverDoc(a.id)).toMatchObject({ mutationId: b.mutationId, serverRevision: 3 })
    expect((await local(a.id)).syncStatus).toBe('synced')
  })

  it('AC17c: reconciliation read fails, app restarts, then the same outcome as AC17b', async () => {
    const a = await save()
    const first = engineWith(adapterFor(reporterDb(), { loseAckOnce: true }))
    await first.start()
    const b = await edit(a.id, 'Version B (fictional).')
    const failingRead = engineWith(adapterFor(reporterDb(), { failReadsOnce: true }))
    await failingRead.requestSync('online')
    expect((await serverDoc(a.id))?.mutationId).toBe(a.mutationId)
    expect(await local(a.id)).toMatchObject({ syncStatus: 'failed', inFlight: { mutationId: a.mutationId } })
    first.stop()
    failingRead.stop()

    repo = createIdbIncidentOutbox(openMajiPulseDb()).forScope(SCOPE)
    await engineWith(adapterFor(reporterDb())).start()
    expect(await serverDoc(a.id)).toMatchObject({ mutationId: b.mutationId, serverRevision: 2 })
    expect(await local(a.id)).toMatchObject({ syncStatus: 'synced' })
  })

  it('AC17d: lost acknowledgement, administrator triages, edit B -> conflict, local B unchanged', async () => {
    const a = await save()
    const engine = engineWith(adapterFor(reporterDb(), { loseAckOnce: true }))
    await engine.start()
    await triage(a.id, 1)
    const b = await edit(a.id, 'Version B (fictional).')
    await engine.requestSync('online')
    const now = await local(a.id)
    expect(now).toMatchObject({ syncStatus: 'conflict', mutationId: b.mutationId, description: 'Version B (fictional).' })
    expect(now.conflictServerSnapshot).toMatchObject({ status: 'triaged', mutationId: a.mutationId })
  })
})

describe('permission-denied classification against the emulator (AC18)', () => {
  it('stale revision: denied by the rules, follow-up read shows a conflict', async () => {
    const a = await save()
    const real = createFirestoreIncidentSyncAdapter(reporterDb())
    await engineWith(real).start()
    await triage(a.id, 1)
    const b = await edit(a.id, 'Denied edit (fictional).')
    // A client that skips the pre-check: the write reaches the rules and is denied.
    const unchecked: IncidentSyncAdapter = {
      readServer: (id) => real.readServer(id),
      submit: async (s) => {
        try {
          await updateDoc(doc(reporterDb(), 'incidents', s.id), {
            description: s.description, baseRevision: s.baseRevision, serverRevision: s.baseRevision + 1, mutationId: s.mutationId, updatedAt: serverTimestamp(),
          })
        } catch (error) {
          throw toSyncError(error)
        }
        return { kind: 'committed' }
      },
    }
    await engineWith(unchecked).requestSync('save')
    expect(await local(a.id)).toMatchObject({ syncStatus: 'conflict', description: 'Denied edit (fictional).', mutationId: b.mutationId })
  })

  it('claims removed (member deactivated): denied, follow-up read denied -> failed, permission denied', async () => {
    const a = await save()
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore() as unknown as Firestore, 'members', REPORTER), { active: false })
    })
    await engineWith(adapterFor(reporterDb())).start()
    const now = await local(a.id)
    expect(now).toMatchObject({ syncStatus: 'failed', failureKind: 'permission_denied', description: a.description, mutationId: a.mutationId })
    expect(await incidentCount()).toBe(0)
  })
})

describe('conflict review against the emulator', () => {
  it('retry on latest after another write sends the local version on top of it', async () => {
    const a = await save()
    const engine = engineWith(adapterFor(reporterDb()))
    await engine.start()
    // Another of the reporter's devices edits first (fictional).
    await updateDoc(doc(reporterDb(), 'incidents', a.id), {
      description: 'Other device (fictional).', baseRevision: 1, serverRevision: 2, mutationId: crypto.randomUUID(), clientRevision: 5, updatedAt: serverTimestamp(),
    })
    await edit(a.id, 'This device (fictional).')
    await engine.requestSync('save')
    expect((await local(a.id)).syncStatus).toBe('conflict')
    await repo.updateWith(a.id, (r) => retryOnLatest(r, systemClock))
    await engine.requestSync('manual')
    expect(await serverDoc(a.id)).toMatchObject({ description: 'This device (fictional).', serverRevision: 3 })
    expect((await local(a.id)).syncStatus).toBe('synced')
  })
})
