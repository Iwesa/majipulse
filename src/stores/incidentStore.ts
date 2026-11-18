import { createStore, type StoreApi } from 'zustand/vanilla'
import type { LocalIncidentRecord } from '../schemas/localIncident'
import type { SessionScope } from '../schemas/roles'
import { applyLocalEdit, createLocalIncident, systemClock, type DraftClock } from '../services/incidentDrafts'
import { IncidentOutboxError, type IncidentContent, type IncidentOutbox } from '../services/incidents'

export type IncidentList =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; records: LocalIncidentRecord[] }
  | { status: 'error' }

export interface IncidentState {
  list: IncidentList
  /** Once per session: resets interrupted syncs, then loads. */
  openSession(scope: SessionScope): Promise<void>
  load(scope: SessionScope): Promise<void>
  /** Saves to IndexedDB only (R3.2). Throws IncidentOutboxError. */
  saveNew(scope: SessionScope, id: string, content: IncidentContent): Promise<LocalIncidentRecord>
  /** Throws IncidentOutboxError. */
  saveEdit(scope: SessionScope, id: string, content: IncidentContent): Promise<LocalIncidentRecord>
  reset(): void
}

export type IncidentStore = StoreApi<IncidentState>

export function createIncidentStore(outbox: IncidentOutbox, clock: DraftClock = systemClock): IncidentStore {
  // Responses from an older generation (for example the previous account) are discarded.
  let generation = 0

  return createStore<IncidentState>()((set, get) => ({
    list: { status: 'idle' },

    async openSession(scope) {
      const mine = ++generation
      set({ list: { status: 'loading' } })
      await outbox.forScope(scope).resetInterruptedSyncs().catch(() => 0)
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
        throw error instanceof IncidentOutboxError ? error : new IncidentOutboxError('storage')
      }
      await get().load(scope)
      return record
    },

    async saveEdit(scope, id, content) {
      const repository = outbox.forScope(scope)
      let next: LocalIncidentRecord
      try {
        const current = await repository.get(id)
        if (!current) throw new IncidentOutboxError('notFound')
        next = applyLocalEdit(current, content, clock)
        await repository.update(next)
      } catch (error) {
        throw error instanceof IncidentOutboxError ? error : new IncidentOutboxError('storage')
      }
      await get().load(scope)
      return next
    },

    reset() {
      generation += 1
      set({ list: { status: 'idle' } })
    },
  }))
}
