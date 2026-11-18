import { createStore, type StoreApi } from 'zustand/vanilla'
import type { LocalIncidentRecord } from '../schemas/localIncident'
import type { SessionScope } from '../schemas/roles'
import { applyLocalEdit, createLocalIncident, systemClock, type DraftClock } from '../services/incidentDrafts'
import { IncidentOutboxError, type IncidentContent, type IncidentOutbox } from '../services/incidents'
import { discardLocalEdit, retryOnLatest } from '../services/sync/transitions'

export type IncidentList =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; records: LocalIncidentRecord[] }
  | { status: 'error' }

export type ConflictAction = 'retryOnLatest' | 'discardMyEdit'

export interface IncidentState {
  list: IncidentList
  /**
   * Once per session. `resetInterrupted` recovers records left `syncing`;
   * when a sync engine runs, the engine does this under its lock instead.
   */
  openSession(scope: SessionScope, options?: { resetInterrupted?: boolean }): Promise<void>
  load(scope: SessionScope): Promise<void>
  /** Saves to IndexedDB only (R3.2). Throws IncidentOutboxError. */
  saveNew(scope: SessionScope, id: string, content: IncidentContent): Promise<LocalIncidentRecord>
  /** Atomic local edit. Throws IncidentOutboxError. */
  saveEdit(scope: SessionScope, id: string, content: IncidentContent): Promise<LocalIncidentRecord>
  /** Conflict review (T5.5). Local only; the caller then requests a sync. Throws IncidentOutboxError. */
  resolveConflict(scope: SessionScope, id: string, action: ConflictAction): Promise<LocalIncidentRecord>
  reset(): void
}

export type IncidentStore = StoreApi<IncidentState>

const asOutboxError = (error: unknown) => (error instanceof IncidentOutboxError ? error : new IncidentOutboxError('storage'))

export function createIncidentStore(outbox: IncidentOutbox, clock: DraftClock = systemClock): IncidentStore {
  // Responses from an older generation (for example the previous account) are discarded.
  let generation = 0

  return createStore<IncidentState>()((set, get) => ({
    list: { status: 'idle' },

    async openSession(scope, options = {}) {
      const mine = ++generation
      set({ list: { status: 'loading' } })
      if (options.resetInterrupted !== false) await outbox.forScope(scope).resetInterruptedSyncs().catch(() => 0)
      if (mine === generation) await get().load(scope)
    },

    async load(scope) {
      const mine = ++generation
      if (get().list.status !== 'ready') set({ list: { status: 'loading' } })
      try {
        const records = await outbox.forScope(scope).list()
        if (mine === generation) set({ list: { status: 'ready', records } })
      } catch {
        if (mine === generation) set({ list: { status: 'error' } })
      }
    },

    async saveNew(scope, id, content) {
      const record = createLocalIncident(id, scope, content, clock)
      try {
        await outbox.forScope(scope).create(record)
      } catch (error) {
        throw asOutboxError(error)
      }
      await get().load(scope)
      return record
    },

    async saveEdit(scope, id, content) {
      let next: LocalIncidentRecord | null
      try {
        // One IndexedDB transaction, so a sync result written at the same time is never lost.
        next = await outbox.forScope(scope).updateWith(id, (current) => applyLocalEdit(current, content, clock))
      } catch (error) {
        throw asOutboxError(error)
      }
      if (!next) throw new IncidentOutboxError('notFound')
      await get().load(scope)
      return next
    },

    async resolveConflict(scope, id, action) {
      let next: LocalIncidentRecord | null
      try {
        next = await outbox
          .forScope(scope)
          .updateWith(id, (current) =>
            action === 'retryOnLatest' ? retryOnLatest(current, clock) : discardLocalEdit(current, clock.now().toISOString()),
          )
      } catch (error) {
        throw asOutboxError(error)
      }
      if (!next) throw new IncidentOutboxError('notEditable')
      await get().load(scope)
      return next
    },

    reset() {
      generation += 1
      set({ list: { status: 'idle' } })
    },
  }))
}
