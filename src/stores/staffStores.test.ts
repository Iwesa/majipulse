// Staff stores (T7.1 to T7.4) over the in-memory fakes. FICTIONAL data.
import { describe, expect, it, vi } from 'vitest'
import { StaffDataError } from '../services/staff'
import {
  FakeMaintenanceService,
  FakeStaffIncidentService,
  fakeDashboard,
  staffIncident,
  taskRecord,
} from '../test/fakeStaffServices'
import { countSyncStatuses, countWaterPointStatuses, createDashboardStore } from './dashboardStore'
import { createMaintenanceStore } from './maintenanceStore'
import { createStaffIncidentStore } from './staffIncidentStore'

const ADMIN = { organizationId: 'kwale-demo', ownerUid: 'uid-administrator' }
const TECH = { organizationId: 'kwale-demo', ownerUid: 'uid-technician' }
const OTHER_ORG = { organizationId: 'pwani-demo', ownerUid: 'uid-admin-b' }
const online = () => true

describe('staff incident store (T7.1, T7.2)', () => {
  it('loads the queue for the filter and keeps the filter', async () => {
    const service = new FakeStaffIncidentService([
      staffIncident({ status: 'new', createdAt: '2026-03-01T08:00:00.000Z' }),
      staffIncident({ status: 'triaged', createdAt: '2026-03-02T08:00:00.000Z' }),
      staffIncident({ organizationId: 'pwani-demo' }),
    ])
    const store = createStaffIncidentStore(service, { isOnline: online })
    await store.getState().loadQueue(ADMIN, { status: 'triaged', waterPointId: null, order: 'newest' })
    const { queue, filter } = store.getState()
    expect(filter.status).toBe('triaged')
    expect(queue.status === 'ready' && queue.data.map((i) => i.status)).toEqual(['triaged'])
    expect(service.list).toHaveBeenCalledWith(ADMIN, filter)
  })

  it('never shows another organization’s incidents', async () => {
    const service = new FakeStaffIncidentService([staffIncident()])
    const store = createStaffIncidentStore(service, { isOnline: online })
    await store.getState().loadQueue(OTHER_ORG)
    const { queue } = store.getState()
    expect(queue.status === 'ready' && queue.data).toEqual([])
  })

  it('maps network errors to offline and other errors to error kinds', async () => {
    const service = new FakeStaffIncidentService()
    const store = createStaffIncidentStore(service, { isOnline: online })
    service.fail = new StaffDataError('network')
    await store.getState().loadQueue(ADMIN)
    expect(store.getState().queue).toEqual({ status: 'offline' })
    service.fail = new StaffDataError('permission')
    await store.getState().loadQueue(ADMIN)
    expect(store.getState().queue).toEqual({ status: 'error', kind: 'permission' })
  })

  it('changes status one step and reloads the incident', async () => {
    const incident = staffIncident()
    const service = new FakeStaffIncidentService([incident])
    const store = createStaffIncidentStore(service, { isOnline: online })
    await store.getState().loadDetail(TECH, incident.id)
    await store.getState().changeStatus(TECH, incident, 'triaged')
    const { detail } = store.getState()
    expect(detail.data.status === 'ready' && detail.data.data).toMatchObject({
      status: 'triaged',
      serverRevision: 2,
      lastStatusChange: { by: TECH.ownerUid, from: 'new', to: 'triaged' },
    })
  })

  it('a stale change throws and shows the latest server version', async () => {
    const incident = staffIncident()
    const service = new FakeStaffIncidentService([{ ...incident, status: 'triaged', serverRevision: 2 }])
    const store = createStaffIncidentStore(service, { isOnline: online })
    await expect(store.getState().changeStatus(TECH, incident, 'triaged')).rejects.toMatchObject({ kind: 'stale' })
    const { detail } = store.getState()
    expect(detail.data.status === 'ready' && detail.data.data?.status).toBe('triaged')
  })

  it('reset discards a response that arrives afterwards (account switch)', async () => {
    let release: () => void = () => undefined
    const service = new FakeStaffIncidentService([staffIncident()])
    service.list.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve([staffIncident()]))))
    const store = createStaffIncidentStore(service, { isOnline: online })
    const pending = store.getState().loadQueue(ADMIN)
    store.getState().reset()
    release()
    await pending
    expect(store.getState().queue).toEqual({ status: 'idle' })
  })
})

describe('maintenance store (T7.3, AC10)', () => {
  const members = vi.fn(async () => [
    { uid: 'uid-administrator', displayName: 'Demo administrator', email: 'a@example.org', role: 'administrator' as const, active: true },
    { uid: 'uid-technician', displayName: 'Demo technician', email: 't@example.org', role: 'technician' as const, active: true },
    { uid: 'uid-tech-off', displayName: 'Former technician', email: 'x@example.org', role: 'technician' as const, active: false },
    { uid: 'uid-reporter', displayName: 'Demo reporter', email: 'r@example.org', role: 'reporter' as const, active: true },
  ])

  it('administrators choose from active staff only', async () => {
    const store = createMaintenanceStore({ service: new FakeMaintenanceService(), listMembers: members, isOnline: online })
    await store.getState().loadAssignees(ADMIN, { canListMembers: true, name: 'Demo administrator' })
    const { assignees } = store.getState()
    expect(assignees.status === 'ready' && assignees.data.map((a) => a.uid)).toEqual(['uid-administrator', 'uid-technician'])
  })

  it('technicians can only assign themselves (no member reads)', async () => {
    const listMembers = vi.fn(members)
    const store = createMaintenanceStore({ service: new FakeMaintenanceService(), listMembers, isOnline: online })
    await store.getState().loadAssignees(TECH, { canListMembers: false, name: null })
    expect(store.getState().assignees).toEqual({ status: 'ready', data: [{ uid: TECH.ownerUid, name: null }] })
    expect(listMembers).not.toHaveBeenCalled()
  })

  it('create from an incident, assign, then open -> in_progress -> done', async () => {
    const incident = staffIncident({ status: 'triaged' })
    const service = new FakeMaintenanceService([], () => [incident])
    const store = createMaintenanceStore({ service, listMembers: members, isOnline: online })
    const id = await store.getState().create(ADMIN, { incidentId: incident.id, waterPointId: incident.waterPointId }, { title: 'Replace seal', notes: '', assigneeId: null })
    await store.getState().update(ADMIN, id, { title: 'Replace seal', notes: 'Bring spares', assigneeId: 'uid-technician' })
    let task = service.tasks[0]
    expect(task).toMatchObject({ incidentId: incident.id, waterPointId: incident.waterPointId, status: 'open', assigneeId: 'uid-technician', createdBy: ADMIN.ownerUid })
    await store.getState().changeStatus(TECH, task, 'in_progress')
    task = service.tasks[0]
    await store.getState().changeStatus(TECH, task, 'done')
    const { detail } = store.getState()
    expect(detail.data.status === 'ready' && detail.data.data?.status).toBe('done')
  })

  it('rejects skipped transitions and invalid input', async () => {
    const task = taskRecord()
    const service = new FakeMaintenanceService([task])
    const store = createMaintenanceStore({ service, listMembers: members, isOnline: online })
    await expect(store.getState().changeStatus(TECH, task, 'done')).rejects.toMatchObject({ kind: 'transition' })
    await expect(store.getState().update(TECH, task.id, { title: ' ', notes: '', assigneeId: null })).rejects.toMatchObject({ kind: 'invalid' })
  })

  it('a task cannot be linked to an incident on another water point', async () => {
    const incident = staffIncident()
    const service = new FakeMaintenanceService([], () => [incident])
    const store = createMaintenanceStore({ service, listMembers: members, isOnline: online })
    await expect(
      store.getState().create(ADMIN, { incidentId: incident.id, waterPointId: 'wp-other' }, { title: 'x', notes: '', assigneeId: null }),
    ).rejects.toMatchObject({ kind: 'invalid' })
  })
})

describe('dashboard (T7.4)', () => {
  it('counts open incidents and tasks for the organization only', async () => {
    const incidents = [
      staffIncident({ status: 'new' }),
      staffIncident({ status: 'new' }),
      staffIncident({ status: 'in_progress' }),
      staffIncident({ status: 'resolved' }),
      staffIncident({ status: 'new', organizationId: 'pwani-demo' }),
    ]
    const tasks = [taskRecord({ status: 'open' }), taskRecord({ status: 'done' }), taskRecord({ status: 'in_progress', organizationId: 'pwani-demo' })]
    const store = createDashboardStore(fakeDashboard(() => incidents, () => tasks), { isOnline: online })
    await store.getState().loadStaffCounts(ADMIN)
    expect(store.getState().staffCounts).toEqual({
      status: 'ready',
      data: { incidents: { new: 2, triaged: 0, in_progress: 1 }, tasks: { open: 1, in_progress: 0 } },
    })
  })

  it('offline counts show as offline', async () => {
    const service = fakeDashboard(() => [], () => [])
    service.fail = new StaffDataError('network')
    const store = createDashboardStore(service, { isOnline: online })
    await store.getState().loadStaffCounts(ADMIN)
    expect(store.getState().staffCounts).toEqual({ status: 'offline' })
  })

  it('water point and sync status counts', () => {
    const point = { id: 'wp', organizationId: 'kwale-demo', name: 'x', type: 'tap' as const, locationDescription: 'x', demo: true, createdBy: 'u', createdAt: 'x', updatedAt: 'x' }
    expect(countWaterPointStatuses([{ ...point, status: 'working' }, { ...point, status: 'not_working' }, { ...point, status: 'working' }])).toEqual({
      working: 2,
      needs_repair: 0,
      not_working: 1,
      unknown: 0,
    })
    expect(countSyncStatuses([])).toEqual({ pending: 0, syncing: 0, synced: 0, failed: 0, conflict: 0 })
  })
})
