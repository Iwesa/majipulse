import { createStore, type StoreApi } from 'zustand/vanilla'
import type { MaintenanceStatus, MaintenanceTaskInput } from '../schemas/maintenanceTask'
import type { SessionScope } from '../schemas/roles'
import type { TaskListFilter } from '../services/queryPlans'
import type { MaintenanceService, MaintenanceTaskRecord, TaskLink } from '../services/staff'
import type { MemberSummary } from '../services/userAdmin'
import { createGeneration, defaultIsOnline, failedState, type RemoteData } from './remoteData'

/** Someone a task can be assigned to. */
export interface AssigneeOption {
  uid: string
  /** Null for the signed-in user when their name is unknown. */
  name: string | null
}

export interface MaintenanceState {
  filter: TaskListFilter
  list: RemoteData<MaintenanceTaskRecord[]>
  /** Tasks linked to the incident open on the incident detail page. */
  forIncident: { incidentId: string | null; data: RemoteData<MaintenanceTaskRecord[]> }
  detail: { id: string | null; data: RemoteData<MaintenanceTaskRecord | null> }
  assignees: RemoteData<AssigneeOption[]>
  loadList(scope: SessionScope, filter?: TaskListFilter): Promise<void>
  loadForIncident(scope: SessionScope, incidentId: string): Promise<void>
  loadDetail(scope: SessionScope, id: string): Promise<void>
  /**
   * Administrators choose from the organization's active staff. Technicians
   * cannot read member records (rules), so they can assign only themselves.
   */
  loadAssignees(scope: SessionScope, self: { canListMembers: boolean; name: string | null }): Promise<void>
  /** Throws StaffDataError. Returns the new task ID. */
  create(scope: SessionScope, link: TaskLink, input: MaintenanceTaskInput): Promise<string>
  /** Throws StaffDataError. */
  update(scope: SessionScope, id: string, input: MaintenanceTaskInput): Promise<void>
  /** Throws StaffDataError. Reloads the detail afterwards. */
  changeStatus(scope: SessionScope, task: MaintenanceTaskRecord, to: MaintenanceStatus): Promise<void>
  reset(): void
}

export type MaintenanceStore = StoreApi<MaintenanceState>

interface Dependencies {
  service: MaintenanceService
  listMembers(scope: SessionScope): Promise<MemberSummary[]>
  isOnline?: () => boolean
}

export function createMaintenanceStore({ service, listMembers, isOnline = defaultIsOnline }: Dependencies): MaintenanceStore {
  const gens = { list: createGeneration(), incident: createGeneration(), detail: createGeneration(), assignees: createGeneration() }

  return createStore<MaintenanceState>()((set, get) => ({
    filter: { status: null },
    list: { status: 'idle' },
    forIncident: { incidentId: null, data: { status: 'idle' } },
    detail: { id: null, data: { status: 'idle' } },
    assignees: { status: 'idle' },

    async loadList(scope, filter = get().filter) {
      const mine = gens.list.next()
      set({ filter, list: { status: 'loading' } })
      try {
        const data = await service.list(scope, filter)
        if (gens.list.isCurrent(mine)) set({ list: { status: 'ready', data } })
      } catch (error) {
        if (gens.list.isCurrent(mine)) set({ list: failedState(error, isOnline) })
      }
    },

    async loadForIncident(scope, incidentId) {
      const mine = gens.incident.next()
      set({ forIncident: { incidentId, data: { status: 'loading' } } })
      try {
        const data = await service.listForIncident(scope, incidentId)
        if (gens.incident.isCurrent(mine)) set({ forIncident: { incidentId, data: { status: 'ready', data } } })
      } catch (error) {
        if (gens.incident.isCurrent(mine)) set({ forIncident: { incidentId, data: failedState(error, isOnline) } })
      }
    },

    async loadDetail(scope, id) {
      const mine = gens.detail.next()
      if (get().detail.id !== id || get().detail.data.status !== 'ready') set({ detail: { id, data: { status: 'loading' } } })
      try {
        const data = await service.get(scope, id)
        if (gens.detail.isCurrent(mine)) set({ detail: { id, data: { status: 'ready', data } } })
      } catch (error) {
        if (gens.detail.isCurrent(mine)) set({ detail: { id, data: failedState(error, isOnline) } })
      }
    },

    async loadAssignees(scope, self) {
      const mine = gens.assignees.next()
      const me: AssigneeOption = { uid: scope.ownerUid, name: self.name }
      if (!self.canListMembers) {
        set({ assignees: { status: 'ready', data: [me] } })
        return
      }
      set({ assignees: { status: 'loading' } })
      try {
        const members = await listMembers(scope)
        const staff = members
          .filter((m) => m.active && (m.role === 'administrator' || m.role === 'technician'))
          .map((m) => ({ uid: m.uid, name: m.displayName }))
        if (gens.assignees.isCurrent(mine)) set({ assignees: { status: 'ready', data: staff } })
      } catch (error) {
        if (gens.assignees.isCurrent(mine)) set({ assignees: failedState(error, isOnline) })
      }
    },

    async create(scope, link, input) {
      return service.create(scope, link, input)
    },

    async update(scope, id, input) {
      await service.update(scope, id, input)
      await get().loadDetail(scope, id)
    },

    async changeStatus(scope, task, to) {
      try {
        await service.changeStatus(scope, task, to)
      } finally {
        await get().loadDetail(scope, task.id)
      }
    },

    reset() {
      for (const g of Object.values(gens)) g.bump()
      set({
        filter: { status: null },
        list: { status: 'idle' },
        forIncident: { incidentId: null, data: { status: 'idle' } },
        detail: { id: null, data: { status: 'idle' } },
        assignees: { status: 'idle' },
      })
    },
  }))
}
