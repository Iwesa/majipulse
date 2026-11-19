import { createStore, type StoreApi } from 'zustand/vanilla'
import type { IncidentStatus } from '../schemas/incident'
import type { SessionScope } from '../schemas/roles'
import { DEFAULT_QUEUE_FILTER, type IncidentQueueFilter } from '../services/queryPlans'
import type { StaffIncident, StaffIncidentService } from '../services/staff'
import { createGeneration, defaultIsOnline, failedState, type RemoteData } from './remoteData'

export interface StaffIncidentState {
  filter: IncidentQueueFilter
  queue: RemoteData<StaffIncident[]>
  /** The incident open on the detail page. Ready with null when not found. */
  detail: { id: string | null; data: RemoteData<StaffIncident | null> }
  loadQueue(scope: SessionScope, filter?: IncidentQueueFilter): Promise<void>
  loadDetail(scope: SessionScope, id: string): Promise<void>
  /** Throws StaffDataError. Reloads the detail afterwards, also after a stale error. */
  changeStatus(scope: SessionScope, incident: StaffIncident, to: IncidentStatus): Promise<void>
  reset(): void
}

export type StaffIncidentStore = StoreApi<StaffIncidentState>

export function createStaffIncidentStore(service: StaffIncidentService, options: { isOnline?: () => boolean } = {}): StaffIncidentStore {
  const isOnline = options.isOnline ?? defaultIsOnline
  const queueGen = createGeneration()
  const detailGen = createGeneration()

  return createStore<StaffIncidentState>()((set, get) => ({
    filter: DEFAULT_QUEUE_FILTER,
    queue: { status: 'idle' },
    detail: { id: null, data: { status: 'idle' } },

    async loadQueue(scope, filter = get().filter) {
      const mine = queueGen.next()
      set({ filter, queue: { status: 'loading' } })
      try {
        const data = await service.list(scope, filter)
        if (queueGen.isCurrent(mine)) set({ queue: { status: 'ready', data } })
      } catch (error) {
        if (queueGen.isCurrent(mine)) set({ queue: failedState(error, isOnline) })
      }
    },

    async loadDetail(scope, id) {
      const mine = detailGen.next()
      // Keep the current incident visible while refreshing the same one.
      if (get().detail.id !== id || get().detail.data.status !== 'ready') set({ detail: { id, data: { status: 'loading' } } })
      try {
        const data = await service.get(scope, id)
        if (detailGen.isCurrent(mine)) set({ detail: { id, data: { status: 'ready', data } } })
      } catch (error) {
        if (detailGen.isCurrent(mine)) set({ detail: { id, data: failedState(error, isOnline) } })
      }
    },

    async changeStatus(scope, incident, to) {
      try {
        await service.changeStatus(scope, incident, to)
      } finally {
        await get().loadDetail(scope, incident.id)
      }
    },

    reset() {
      queueGen.bump()
      detailGen.bump()
      set({ filter: DEFAULT_QUEUE_FILTER, queue: { status: 'idle' }, detail: { id: null, data: { status: 'idle' } } })
    },
  }))
}
