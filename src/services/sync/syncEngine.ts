/**
 * Incident sync engine (T5.2, design section 6). One engine per signed-in
 * scope; it only ever reads and writes that scope's records.
 *
 * Guarantees:
 * - Single flight: one run per scope at a time, across tabs (Web Locks) or
 *   within the tab when Web Locks are unavailable.
 * - Every submission is an immutable snapshot persisted as `inFlight` before
 *   the network call. A record with `inFlight` is reconciled against the
 *   server before anything newer is sent, so a lost acknowledgement never
 *   becomes a false conflict or a duplicate write (R5.13 to R5.15).
 * - Nothing is deleted, and content is never changed by sync.
 * - After stop() (sign-out or account switch) no result is written back.
 */
import { reconcileInFlight, classifyPermissionDenied } from './decisions'
import {
  applyCommitted,
  applyConflict,
  applyFailed,
  applyNotCommitted,
  isSendable,
  markForRetry,
  markSyncing,
  toSnapshot,
} from './transitions'
import { SyncAdapterError, syncErrorOf, type IncidentSyncAdapter, type LockManagerLike, type MutationSnapshot } from './types'
import type { FailureKind, LocalIncidentRecord } from '../../schemas/localIncident'
import type { SessionScope } from '../../schemas/roles'
import type { IncidentRepository } from '../incidents'

export type SyncTrigger = 'start' | 'online' | 'save' | 'manual' | 'retry' | 'backoff'

export interface SyncEngineState {
  /** True while a run is in progress in this tab. */
  running: boolean
  /** Last run that finished without errors, or null. */
  lastSyncAt: string | null
  /** Result of the last run. `busy`: another tab is syncing this account. */
  lastRun: 'ok' | 'offline' | 'failed' | 'busy' | null
}

export interface Timers {
  set(callback: () => void, ms: number): unknown
  clear(handle: unknown): void
}

export interface SyncEngineOptions {
  scope: SessionScope
  repository: IncidentRepository
  adapter: IncidentSyncAdapter
  /** Forces a fresh ID token before the permission-denied follow-up read. */
  refreshClaims?: () => Promise<void>
  /** Hint only: false skips the run, true still has to be proven by the request. */
  isOnline?: () => boolean
  now?: () => Date
  /** Defaults to navigator.locks; null forces the in-tab fallback. */
  locks?: LockManagerLike | null
  timers?: Timers
  /** A submission that takes longer counts as an uncertain network failure. */
  timeoutMs?: number
  onChange?: () => void
  onState?: (state: SyncEngineState) => void
}

type Outcome = 'synced' | 'pending' | 'conflict' | 'failed' | 'network' | 'stopped' | 'skipped'

const BACKOFF_BASE_MS = 5_000
const BACKOFF_MAX_MS = 5 * 60_000
const MAX_PASSES = 5

const failureKindOf = (code: SyncAdapterError['code']): FailureKind =>
  code === 'network' ? 'network' : code === 'permission-denied' ? 'permission_denied' : code === 'invalid' ? 'validation' : 'unknown'

const defaultLocks = (): LockManagerLike | null => {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManagerLike }).locks : undefined
  return locks && typeof locks.request === 'function' ? locks : null
}

const defaultTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export class SyncEngine {
  private readonly o: Required<Omit<SyncEngineOptions, 'refreshClaims' | 'locks' | 'onChange' | 'onState'>> &
    Pick<SyncEngineOptions, 'refreshClaims' | 'onChange' | 'onState'> & { locks: LockManagerLike | null }
  private stopped = false
  private running = false
  private rerun = false
  private started = false
  private networkFailures = 0
  private backoffHandle: unknown = null
  private state: SyncEngineState = { running: false, lastSyncAt: null, lastRun: null }

  constructor(options: SyncEngineOptions) {
    this.o = {
      isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
      now: () => new Date(),
      timers: defaultTimers,
      timeoutMs: 30_000,
      ...options,
      locks: options.locks === undefined ? defaultLocks() : options.locks,
    }
  }

  get lockName(): string {
    return `majipulse-sync:${this.o.scope.organizationId}:${this.o.scope.ownerUid}`
  }

  getState(): SyncEngineState {
    return this.state
  }

  /** Recovers interrupted submissions, then runs once. Call once per session. */
  async start(): Promise<void> {
    if (this.started || this.stopped) return
    this.started = true
    this.setState({ lastSyncAt: await this.o.repository.getLastSyncAt().catch(() => null) })
    await this.run('start', true)
  }

  /** Stops for good: no new runs, no timers, and in-flight results are discarded. */
  stop(): void {
    this.stopped = true
    if (this.backoffHandle !== null) this.o.timers.clear(this.backoffHandle)
    this.backoffHandle = null
  }

  /** Asks for a run (save, reconnect, manual). Coalesces with a run in progress. */
  requestSync(trigger: SyncTrigger = 'manual'): Promise<void> {
    return this.run(trigger, false)
  }

  /** Manual retry of one failed report, including failures that are not retried automatically. */
  async retry(id: string): Promise<void> {
    if (this.stopped) return
    await this.o.repository.updateWith(id, markForRetry)
    this.o.onChange?.()
    await this.run('retry', false)
  }

  private setState(patch: Partial<SyncEngineState>): void {
    if (this.stopped) return
    this.state = { ...this.state, ...patch }
    this.o.onState?.(this.state)
  }

  private async run(trigger: SyncTrigger, recover: boolean): Promise<void> {
    if (this.stopped) return
    if (this.running) {
      this.rerun = true
      return
    }
    this.running = true
    this.setState({ running: true })
    try {
      await this.withLock(async () => {
        if (recover) {
          await this.o.repository.resetInterruptedSyncs()
          this.o.onChange?.()
        }
        do {
          this.rerun = false
          await this.processAll(trigger)
        } while (this.rerun && !this.stopped)
      })
    } finally {
      this.running = false
      this.setState({ running: false })
    }
  }

  private async withLock(task: () => Promise<void>): Promise<void> {
    const locks = this.o.locks
    if (!locks) return task()
    await locks.request(this.lockName, { ifAvailable: true }, async (lock) => {
      if (!lock) {
        // Another tab is syncing this account; it will finish the work.
        this.setState({ lastRun: 'busy' })
        return
      }
      await task()
    })
  }

  private async processAll(trigger: SyncTrigger): Promise<void> {
    if (!this.o.isOnline()) {
      this.setState({ lastRun: 'offline' })
      return
    }
    let failed = false
    let networkDown = false
    for (let pass = 0; pass < MAX_PASSES && !this.stopped; pass += 1) {
      const records = (await this.o.repository.list())
        .filter((r) => isSendable(r) || (r.inFlight !== undefined && r.syncStatus !== 'conflict' && r.syncStatus !== 'failed'))
        .sort((a, b) => Date.parse(a.clientCreatedAt) - Date.parse(b.clientCreatedAt))
      if (records.length === 0) break
      let morePending = false
      for (const record of records) {
        if (this.stopped) return
        const outcome = await this.syncOne(record.id)
        if (outcome === 'stopped') return
        this.o.onChange?.()
        if (outcome === 'pending') morePending = true
        if (outcome === 'failed') failed = true
        if (outcome === 'network') {
          networkDown = true
          break
        }
      }
      if (networkDown || !morePending) break
    }
    if (this.stopped) return

    if (networkDown) {
      this.networkFailures += 1
      this.scheduleBackoff()
      this.setState({ lastRun: 'failed' })
      return
    }
    this.networkFailures = 0
    if (failed) {
      this.setState({ lastRun: 'failed' })
      return
    }
    const now = this.o.now().toISOString()
    await this.o.repository.setLastSyncAt(now).catch(() => undefined)
    this.setState({ lastRun: 'ok', lastSyncAt: now })
    void trigger
  }

  private scheduleBackoff(): void {
    if (this.stopped || this.backoffHandle !== null) return
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** (this.networkFailures - 1), BACKOFF_MAX_MS)
    this.backoffHandle = this.o.timers.set(() => {
      this.backoffHandle = null
      void this.run('backoff', false)
    }, delay)
  }

  private nowIso(): string {
    return this.o.now().toISOString()
  }

  /** Writes a sync result only if the engine is still running for this scope. */
  private async write(id: string, change: (r: LocalIncidentRecord) => LocalIncidentRecord | null): Promise<LocalIncidentRecord | null | 'stopped'> {
    if (this.stopped) return 'stopped'
    return this.o.repository.updateWith(id, change)
  }

  private async syncOne(id: string): Promise<Outcome> {
    const repo = this.o.repository
    let record = await repo.get(id)
    if (!record || this.stopped) return this.stopped ? 'stopped' : 'skipped'

    // 1. Reconcile an earlier uncertain submission before sending anything newer.
    if (record.inFlight) {
      const inFlight = record.inFlight
      let server
      try {
        server = await this.o.adapter.readServer(id)
      } catch (error) {
        const e = syncErrorOf(error)
        const kind = failureKindOf(e.code)
        const result = await this.write(id, (r) => applyFailed(r, inFlight.mutationId, kind, e.detail, this.nowIso()))
        if (result === 'stopped') return 'stopped'
        return kind === 'network' ? 'network' : 'failed'
      }
      const decision = reconcileInFlight(inFlight, server)
      const result = await this.write(id, (r) => {
        switch (decision.kind) {
          case 'committed':
            return applyCommitted(r, inFlight.mutationId, decision.revision, server, this.nowIso())
          case 'notCommitted':
            return applyNotCommitted(r, inFlight.mutationId)
          case 'superseded':
            return applyConflict(r, inFlight.mutationId, decision.server)
        }
      })
      if (result === 'stopped') return 'stopped'
      record = await repo.get(id)
      if (!record) return 'skipped'
      if (record.syncStatus === 'synced') return 'synced'
      if (record.syncStatus === 'conflict') return 'conflict'
      if (record.inFlight) return 'skipped'
    }

    // 2. Persist the snapshot as inFlight, then submit only that snapshot.
    const marked = await this.write(id, (r) => markSyncing(r, this.nowIso()))
    if (marked === 'stopped') return 'stopped'
    if (!marked) return 'skipped'
    const snapshot = toSnapshot(marked)
    this.o.onChange?.()

    try {
      const result = await this.withTimeout(this.o.adapter.submit(snapshot))
      if (this.stopped) return 'stopped'
      return await this.applySubmitResult(snapshot, result)
    } catch (error) {
      if (this.stopped) return 'stopped'
      const e = syncErrorOf(error)
      if (e.code === 'permission-denied') return this.handlePermissionDenied(snapshot)
      const kind = failureKindOf(e.code)
      const written = await this.write(id, (r) => applyFailed(r, snapshot.inFlight.mutationId, kind, e.detail, this.nowIso()))
      if (written === 'stopped') return 'stopped'
      return kind === 'network' ? 'network' : 'failed'
    }
  }

  private async applySubmitResult(snapshot: MutationSnapshot, result: Awaited<ReturnType<IncidentSyncAdapter['submit']>>): Promise<Outcome> {
    const id = snapshot.id
    const mutationId = snapshot.inFlight.mutationId
    const revision = snapshot.baseRevision + 1
    let written: LocalIncidentRecord | null | 'stopped'
    switch (result.kind) {
      case 'committed':
        written = await this.write(id, (r) => applyCommitted(r, mutationId, revision, null, this.nowIso()))
        break
      case 'alreadyApplied':
        written = await this.write(id, (r) => applyCommitted(r, mutationId, revision, result.server, this.nowIso()))
        break
      case 'stale':
        written = await this.write(id, (r) => applyConflict(r, mutationId, result.server))
        break
      case 'missing':
        written = await this.write(id, (r) => applyFailed(r, mutationId, 'unknown', 'missing-document', this.nowIso()))
        break
    }
    if (written === 'stopped') return 'stopped'
    if (!written) return 'skipped'
    if (written.syncStatus === 'synced') return 'synced'
    if (written.syncStatus === 'conflict') return 'conflict'
    if (written.syncStatus === 'failed') return 'failed'
    return 'pending'
  }

  /** AC18: read the server copy to tell a genuine conflict from a permission failure. */
  private async handlePermissionDenied(snapshot: MutationSnapshot): Promise<Outcome> {
    const id = snapshot.id
    const mutationId = snapshot.inFlight.mutationId
    await this.o.refreshClaims?.().catch(() => undefined)
    if (this.stopped) return 'stopped'
    let server
    try {
      server = await this.o.adapter.readServer(id)
    } catch {
      server = undefined
    }
    if (this.stopped) return 'stopped'
    const decision = server === undefined ? { kind: 'permissionDenied' as const } : classifyPermissionDenied(snapshot, server)
    if (decision.kind === 'committed' && server) {
      return this.applySubmitResult(snapshot, { kind: 'alreadyApplied', server })
    }
    if (decision.kind === 'conflict') {
      const written = await this.write(id, (r) => applyConflict(r, mutationId, decision.server))
      return written === 'stopped' ? 'stopped' : 'conflict'
    }
    const written = await this.write(id, (r) => applyFailed(r, mutationId, 'permission_denied', 'permission-denied', this.nowIso()))
    return written === 'stopped' ? 'stopped' : 'failed'
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    let handle: unknown
    const timeout = new Promise<never>((_, reject) => {
      handle = this.o.timers.set(() => reject(new SyncAdapterError('network', 'timeout')), this.o.timeoutMs)
    })
    return Promise.race([promise, timeout]).finally(() => this.o.timers.clear(handle))
  }
}
