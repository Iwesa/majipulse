import { createStore, type StoreApi } from 'zustand/vanilla'
import type { LocalIncidentRecord, SyncStatus } from '../schemas/localIncident'
import type { SessionScope } from '../schemas/roles'
import type { WaterPointRecord } from '../schemas/waterPoint'
import type { DashboardService, StaffCounts } from '../services/staff'
import { createGeneration, defaultIsOnline, failedState, type RemoteData } from './remoteData'

export interface DashboardState {
  staffCounts: RemoteData<StaffCounts>
  loadStaffCounts(scope: SessionScope): Promise<void>
  reset(): void
}

export type DashboardStore = StoreApi<DashboardState>

export function createDashboardStore(service: DashboardService, options: { isOnline?: () => boolean } = {}): DashboardStore {
  const isOnline = options.isOnline ?? defaultIsOnline
  const gen = createGeneration()
  return createStore<DashboardState>()((set, get) => ({
    staffCounts: { status: 'idle' },
    async loadStaffCounts(scope) {
      const mine = gen.next()
      // Keep the last counts on screen while refreshing.
      if (get().staffCounts.status !== 'ready') set({ staffCounts: { status: 'loading' } })
      try {
        const data = await service.staffCounts(scope)
        if (gen.isCurrent(mine)) set({ staffCounts: { status: 'ready', data } })
      } catch (error) {
        if (gen.isCurrent(mine)) set({ staffCounts: failedState(error, isOnline) })
      }
    },
    reset() {
      gen.bump()
      set({ staffCounts: { status: 'idle' } })
    },
  }))
}

/** Water points per status, from the list already on this device. */
export function countWaterPointStatuses(points: readonly WaterPointRecord[]): Record<WaterPointRecord['status'], number> {
  const counts: Record<WaterPointRecord['status'], number> = { working: 0, needs_repair: 0, not_working: 0, unknown: 0 }
  for (const p of points) counts[p.status] += 1
  return counts
}

/** The signed-in user's local reports per sync status. */
export function countSyncStatuses(records: readonly LocalIncidentRecord[]): Record<SyncStatus, number> {
  const counts: Record<SyncStatus, number> = { pending: 0, syncing: 0, synced: 0, failed: 0, conflict: 0 }
  for (const r of records) counts[r.syncStatus] += 1
  return counts
}
