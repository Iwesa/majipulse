// In-memory server for sync engine tests (FICTIONAL data). It applies the
// same write decision as the Firestore adapter and can inject failures.
import { vi } from 'vitest'
import type { IncidentStatus } from '../schemas/incident'
import { decideWrite } from '../services/sync/decisions'
import { SyncAdapterError, type IncidentSyncAdapter, type MutationSnapshot, type ServerIncident, type SyncErrorCode } from '../services/sync/types'

const SERVER_TIME = '2026-03-01T10:00:00.000Z'

export class FakeSyncServer implements IncidentSyncAdapter {
  docs = new Map<string, ServerIncident>()
  /** Every committed write, in order: [id, mutationId]. */
  writes: Array<[string, string]> = []
  private submitFailures: Array<{ code: SyncErrorCode; afterCommit: boolean }> = []
  private readFailures: SyncErrorCode[] = []
  private gate: { release: () => void; promise: Promise<void> } | null = null
  /** Called right before a submission decides, to simulate concurrent server changes. */
  beforeSubmit: (() => void) | null = null

  /** The next submit fails. `afterCommit` writes first, then fails: a lost acknowledgement. */
  failNextSubmit(code: SyncErrorCode, afterCommit = false): this {
    this.submitFailures.push({ code, afterCommit })
    return this
  }

  failNextRead(code: SyncErrorCode): this {
    this.readFailures.push(code)
    return this
  }

  /** Pauses the next submit until release() is called. */
  hold(): { release: () => void } {
    let release = () => undefined as void
    const promise = new Promise<void>((resolve) => (release = resolve))
    this.gate = { release, promise }
    return { release: () => release() }
  }

  /** A staff status change: keeps mutationId, advances serverRevision. */
  triage(id: string, to: IncidentStatus = 'triaged', by = 'uid-tech'): void {
    const doc = this.docs.get(id)
    if (!doc) throw new Error('no doc')
    this.docs.set(id, {
      ...doc,
      status: to,
      serverRevision: doc.serverRevision + 1,
      lastStatusChange: { by, at: SERVER_TIME, from: doc.status, to },
      updatedAt: SERVER_TIME,
    })
  }

  readServer = vi.fn<IncidentSyncAdapter['readServer']>(async (id) => {
    const failure = this.readFailures.shift()
    if (failure) throw new SyncAdapterError(failure, `injected-${failure}`)
    return this.docs.get(id) ?? null
  })

  submit = vi.fn<IncidentSyncAdapter['submit']>(async (snapshot: MutationSnapshot) => {
    if (this.gate) {
      const { promise } = this.gate
      this.gate = null
      await promise
    }
    this.beforeSubmit?.()
    const failure = this.submitFailures.shift()
    if (failure && !failure.afterCommit) throw new SyncAdapterError(failure.code, `injected-${failure.code}`)

    const server = this.docs.get(snapshot.id) ?? null
    const decision = decideWrite(snapshot, server)
    let result: Awaited<ReturnType<IncidentSyncAdapter['submit']>>
    switch (decision.kind) {
      case 'alreadyApplied':
        result = { kind: 'alreadyApplied', server: server as ServerIncident }
        break
      case 'stale':
        result = { kind: 'stale', server: server as ServerIncident }
        break
      case 'missing':
        result = { kind: 'missing' }
        break
      case 'create':
      case 'update':
        this.write(snapshot, server)
        result = { kind: 'committed' }
        break
    }
    if (failure?.afterCommit) throw new SyncAdapterError(failure.code, `injected-${failure.code}-after-commit`)
    return result
  })

  private write(s: MutationSnapshot, server: ServerIncident | null): void {
    const doc: ServerIncident = {
      organizationId: s.organizationId,
      waterPointId: s.waterPointId,
      reporterId: s.reporterId,
      demo: s.demo,
      description: s.description,
      incidentType: s.incidentType,
      severity: s.severity,
      status: server?.status ?? 'new',
      baseRevision: s.baseRevision,
      clientRevision: s.clientRevision,
      mutationId: s.mutationId,
      serverRevision: s.baseRevision + 1,
      clientCreatedAt: s.clientCreatedAt,
      createdAt: server?.createdAt ?? SERVER_TIME,
      updatedAt: SERVER_TIME,
      confirmedFields: [...s.confirmedFields],
    }
    if (s.occurredAt !== undefined) doc.occurredAt = s.occurredAt
    if (s.locationNote !== undefined) doc.locationNote = s.locationNote
    if (s.ai !== undefined) doc.ai = s.ai
    if (server?.lastStatusChange) doc.lastStatusChange = server.lastStatusChange
    this.docs.set(s.id, doc)
    this.writes.push([s.id, s.mutationId])
  }
}
