// Staff screens (T7.1 to T7.4): incident queue, detail and triage, maintenance,
// and the role-based dashboard. Fake services, real stores and routes. FICTIONAL data.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Role } from '../../schemas/roles'
import { StaffDataError } from '../../services/staff'
import { en, format } from '../../strings/en'
import { FakeAuthService, renderApp, signedIn } from '../../test/fakeServices'
import { FakeMaintenanceService, FakeStaffIncidentService, fakeDashboard, staffIncident, taskRecord } from '../../test/fakeStaffServices'

afterEach(() => vi.restoreAllMocks())

const t = en.incidents
const m = en.maintenance
const label = (text: string) => screen.getByLabelText(new RegExp(`^${text}`))

function setup(role: Role, path: string, data: { incidents?: ReturnType<typeof staffIncident>[]; tasks?: ReturnType<typeof taskRecord>[] } = {}) {
  const staffIncidents = new FakeStaffIncidentService(data.incidents ?? [])
  const maintenance = new FakeMaintenanceService(data.tasks ?? [], () => staffIncidents.incidents)
  const view = renderApp(path, { auth: new FakeAuthService(signedIn(role)), staffIncidents, maintenance })
  return { ...view, staffIncidents, maintenance }
}

describe('incident queue (T7.1, R7.1)', () => {
  it('lists the organization’s incidents with status, severity, and water point', async () => {
    setup('technician', '/incidents', {
      incidents: [staffIncident({ incidentType: 'leak', status: 'triaged', severity: 'high' }), staffIncident({ organizationId: 'pwani-demo', incidentType: 'no_water' })],
    })
    const link = await screen.findByRole('link', { name: 'Leak: Mwamanga Borehole (fictional)' })
    const item = link.closest('li') as HTMLElement
    expect(within(item).getByText(en.incidentStatuses.triaged)).toBeInTheDocument()
    expect(within(item).getByText(/High/)).toBeInTheDocument()
    expect(screen.queryByText(/No water/)).not.toBeInTheDocument()
    expect(screen.getByText(t.countOne)).toBeInTheDocument()
  })

  it('reads the filter from the URL and passes it to the service', async () => {
    const { staffIncidents } = setup('administrator', '/incidents?status=in_progress&waterPoint=wp-soko&order=oldest')
    await screen.findByText(t.emptyTitle)
    expect(staffIncidents.list).toHaveBeenLastCalledWith(
      { organizationId: 'kwale-demo', ownerUid: 'uid-administrator' },
      { status: 'in_progress', waterPointId: 'wp-soko', order: 'oldest' },
    )
    expect(label(t.statusFilter)).toHaveValue('in_progress')
  })

  it('changing a filter reloads with the new filter; unknown URL values are ignored', async () => {
    const { staffIncidents } = setup('administrator', '/incidents?status=burst', { incidents: [staffIncident({ status: 'new' }), staffIncident({ status: 'resolved' })] })
    await waitFor(() => expect(screen.getByText(format(t.count, { count: '2' }))).toBeInTheDocument())
    expect(staffIncidents.list).toHaveBeenLastCalledWith(expect.anything(), { status: null, waterPointId: null, order: 'newest' })
    fireEvent.change(label(t.statusFilter), { target: { value: 'resolved' } })
    await waitFor(() => expect(screen.getByText(t.countOne)).toBeInTheDocument())
    expect(staffIncidents.list).toHaveBeenLastCalledWith(expect.anything(), { status: 'resolved', waterPointId: null, order: 'newest' })
  })

  it('shows the offline state when the server cannot be reached', async () => {
    const service = new FakeStaffIncidentService()
    service.fail = new StaffDataError('network')
    renderApp('/incidents', { auth: new FakeAuthService(signedIn('technician')), staffIncidents: service })
    expect(await screen.findByText(en.states.offlineTitle)).toBeInTheDocument()
  })

  it('shows a plain-language permission error', async () => {
    const service = new FakeStaffIncidentService()
    service.fail = new StaffDataError('permission')
    renderApp('/incidents', { auth: new FakeAuthService(signedIn('administrator')), staffIncidents: service })
    expect(await screen.findByText(en.staffErrors.permission)).toBeInTheDocument()
  })

  it('reporters cannot open staff screens', async () => {
    const { staffIncidents } = setup('reporter', '/incidents')
    expect(await screen.findByRole('heading', { name: en.access.deniedTitle })).toBeInTheDocument()
    expect(staffIncidents.list).not.toHaveBeenCalled()
  })
})

describe('incident detail and triage (T7.2, R7.2, AC19)', () => {
  const ai = {
    suggested: { incidentType: 'leak' as const, severity: 'high' as const, occurredAt: null, locationNote: 'near the trough' },
    inferenceSource: 'in_cloud' as const,
    model: 'gemini-3.5-flash-lite',
    generatedAt: '2026-03-01T07:59:00.000Z',
  }

  it('shows reporter-confirmed values apart from the labeled AI suggestion and its provenance', async () => {
    const incident = staffIncident({ incidentType: 'low_flow', severity: null, confirmedFields: ['incidentType'], ai })
    setup('technician', `/incidents/${incident.id}`, { incidents: [incident] })
    const report = await screen.findByRole('region', { name: t.reportTitle })
    expect(within(report).getByText(en.incidentTypes.low_flow)).toBeInTheDocument()
    expect(within(report).getAllByText(`(${t.confirmedLabel})`)).toHaveLength(1)
    const aiBox = screen.getByRole('region', { name: t.aiTitle })
    expect(within(aiBox).getByText(t.aiDisclaimer)).toBeInTheDocument()
    expect(within(aiBox).getByText(en.ai.source.in_cloud)).toBeInTheDocument()
    expect(within(aiBox).getByText('gemini-3.5-flash-lite')).toBeInTheDocument()
    expect(within(aiBox).getByText(en.incidentTypes.leak)).toBeInTheDocument()
    expect(within(aiBox).getByText('near the trough')).toBeInTheDocument()
  })

  it('says when AI was not used', async () => {
    const incident = staffIncident()
    setup('administrator', `/incidents/${incident.id}`, { incidents: [incident] })
    expect(await screen.findByText(t.aiNone)).toBeInTheDocument()
  })

  it('moves new -> triaged -> in_progress -> resolved, one step at a time, recording who', async () => {
    const incident = staffIncident()
    const { staffIncidents } = setup('administrator', `/incidents/${incident.id}`, { incidents: [incident] })
    for (const [from, to] of [
      ['new', 'triaged'],
      ['triaged', 'in_progress'],
      ['in_progress', 'resolved'],
    ] as const) {
      fireEvent.click(await screen.findByRole('button', { name: format(t.moveTo, { status: en.incidentStatuses[to] }) }))
      expect(await screen.findByText(format(t.statusChanged, { status: en.incidentStatuses[to] }))).toBeInTheDocument()
      expect(staffIncidents.changeStatus).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ status: from }), to)
    }
    expect(screen.getByText(t.resolvedNote)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mark as/ })).not.toBeInTheDocument()
    expect(staffIncidents.incidents[0]).toMatchObject({ status: 'resolved', serverRevision: 4, lastStatusChange: { by: 'uid-administrator', from: 'in_progress', to: 'resolved' } })
  })

  it('a stale change shows a message and the latest version', async () => {
    const incident = staffIncident()
    const { staffIncidents } = setup('technician', `/incidents/${incident.id}`, { incidents: [incident] })
    await screen.findByRole('button', { name: format(t.moveTo, { status: en.incidentStatuses.triaged }) })
    // Someone else triaged it meanwhile.
    staffIncidents.incidents[0] = { ...incident, status: 'triaged', serverRevision: 2, lastStatusChange: { by: 'uid-other', at: incident.createdAt, from: 'new', to: 'triaged' } }
    fireEvent.click(screen.getByRole('button', { name: format(t.moveTo, { status: en.incidentStatuses.triaged }) }))
    expect(await screen.findByText(en.staffErrors.stale)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: format(t.moveTo, { status: en.incidentStatuses.in_progress }) })).toBeInTheDocument()
  })

  it('status changes need a connection', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const incident = staffIncident()
    setup('technician', `/incidents/${incident.id}`, { incidents: [incident] })
    expect(await screen.findByRole('button', { name: format(t.moveTo, { status: en.incidentStatuses.triaged }) })).toBeDisabled()
    expect(screen.getByText(t.onlineOnly)).toBeInTheDocument()
  })

  it('an incident of another organization is not found', async () => {
    const incident = staffIncident({ organizationId: 'pwani-demo' })
    setup('administrator', `/incidents/${incident.id}`, { incidents: [incident] })
    expect(await screen.findByRole('heading', { name: t.notFoundTitle })).toBeInTheDocument()
  })
})

describe('maintenance tasks (T7.3, R8, AC10)', () => {
  it('administrator: triage, create a linked task assigned to a technician, move it to done', async () => {
    const incident = staffIncident()
    const { maintenance, staffIncidents } = setup('administrator', `/incidents/${incident.id}`, { incidents: [incident] })
    fireEvent.click(await screen.findByRole('button', { name: format(t.moveTo, { status: en.incidentStatuses.triaged }) }))
    await screen.findByText(format(t.statusChanged, { status: en.incidentStatuses.triaged }))
    expect(screen.getByText(t.noTasks)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: t.createTask }))

    await screen.findByRole('heading', { name: m.newTitle })
    fireEvent.change(label(m.titleField), { target: { value: 'Replace handpump seal (fictional)' } })
    // Administrators pick from the active staff list (fake members: the administrator only).
    const assignee = label(m.assigneeField)
    expect(within(assignee).getByRole('option', { name: `Demo administrator ${en.common.you}` })).toBeInTheDocument()
    expect(within(assignee).queryByRole('option', { name: /reporter/ })).not.toBeInTheDocument()
    fireEvent.change(assignee, { target: { value: 'uid-administrator' } })
    fireEvent.click(screen.getByRole('button', { name: m.create }))

    expect(await screen.findByText(m.created)).toBeInTheDocument()
    expect(maintenance.tasks[0]).toMatchObject({ incidentId: incident.id, waterPointId: incident.waterPointId, status: 'open', assigneeId: 'uid-administrator' })
    fireEvent.click(screen.getByRole('button', { name: format(m.moveTo, { status: en.maintenanceStatuses.in_progress }) }))
    await screen.findByText(format(m.statusChanged, { status: en.maintenanceStatuses.in_progress }))
    fireEvent.click(screen.getByRole('button', { name: format(m.moveTo, { status: en.maintenanceStatuses.done }) }))
    await screen.findByText(format(m.statusChanged, { status: en.maintenanceStatuses.done }))
    expect(screen.getByText(m.doneNote)).toBeInTheDocument()
    expect(maintenance.tasks[0].status).toBe('done')
    expect(staffIncidents.incidents[0].status).toBe('triaged')
  })

  it('technician: can assign only themselves; title is required', async () => {
    const incident = staffIncident()
    const { maintenance } = setup('technician', `/maintenance/new?incident=${incident.id}`, { incidents: [incident] })
    await screen.findByRole('button', { name: m.create })
    expect(screen.getByText(m.assigneeHintTechnician)).toBeInTheDocument()
    const options = within(label(m.assigneeField)).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual([m.unassigned, `Demo technician ${en.common.you}`])
    fireEvent.click(screen.getByRole('button', { name: m.create }))
    expect(await screen.findByText(m.validation.titleRequired)).toBeInTheDocument()
    expect(maintenance.create).not.toHaveBeenCalled()
  })

  it('a new task needs an incident', async () => {
    setup('administrator', '/maintenance/new')
    expect(await screen.findByText(m.needsIncident)).toBeInTheDocument()
  })

  it('list shows tasks with status and assignee, filtered by the URL', async () => {
    const { maintenance } = setup('technician', '/maintenance?status=open', {
      tasks: [taskRecord({ title: 'Mine (fictional)', assigneeId: 'uid-technician' }), taskRecord({ title: 'Theirs (fictional)', assigneeId: 'uid-someone' }), taskRecord({ title: 'Done (fictional)', status: 'done' })],
    })
    const mine = (await screen.findByRole('link', { name: 'Mine (fictional)' })).closest('li') as HTMLElement
    expect(within(mine).getByText(`${m.assigneeField}: ${m.assignedToYou}`)).toBeInTheDocument()
    const theirs = screen.getByRole('link', { name: 'Theirs (fictional)' }).closest('li') as HTMLElement
    expect(within(theirs).getByText(`${m.assigneeField}: ${m.assignedToOther}`)).toBeInTheDocument()
    expect(screen.queryByText('Done (fictional)')).not.toBeInTheDocument()
    expect(maintenance.list).toHaveBeenLastCalledWith(expect.anything(), { status: 'open' })
  })

  it('editing a task saves title, notes, and assignee', async () => {
    const task = taskRecord({ title: 'Old title (fictional)' })
    const { maintenance } = setup('technician', `/maintenance/${task.id}`, { tasks: [task] })
    await screen.findByRole('heading', { level: 1, name: 'Old title (fictional)' })
    fireEvent.change(label(m.titleField), { target: { value: 'New title (fictional)' } })
    fireEvent.change(label(m.assigneeField), { target: { value: 'uid-technician' } })
    fireEvent.click(screen.getByRole('button', { name: m.save }))
    expect(await screen.findByText(m.saved)).toBeInTheDocument()
    expect(maintenance.tasks[0]).toMatchObject({ title: 'New title (fictional)', assigneeId: 'uid-technician', status: 'open' })
  })

  it('reporters cannot open maintenance screens', async () => {
    setup('reporter', '/maintenance/new?incident=x')
    expect(await screen.findByRole('heading', { name: en.access.deniedTitle })).toBeInTheDocument()
  })
})

describe('dashboard (T7.4)', () => {
  it('staff see open incident and task counts with links, water points, and sync summary', async () => {
    setup('technician', '/', {
      incidents: [staffIncident({ status: 'new' }), staffIncident({ status: 'new' }), staffIncident({ status: 'triaged' }), staffIncident({ status: 'resolved' })],
      tasks: [taskRecord({ status: 'in_progress' })],
    })
    const incidents = await screen.findByRole('region', { name: en.home.incidentsTitle })
    const newLink = await within(incidents).findByRole('link', { name: `${format(en.home.viewIncidents, { status: en.incidentStatuses.new })}: 2` })
    expect(newLink).toHaveAttribute('href', '/incidents?status=new')
    expect(within(incidents).getByRole('link', { name: `${format(en.home.viewIncidents, { status: en.incidentStatuses.triaged })}: 1` })).toBeInTheDocument()
    const tasks = screen.getByRole('region', { name: en.home.tasksTitle })
    expect(within(tasks).getByRole('link', { name: `${format(en.home.viewTasks, { status: en.maintenanceStatuses.in_progress })}: 1` })).toHaveAttribute('href', '/maintenance?status=in_progress')
    const points = screen.getByRole('region', { name: en.home.waterPointsTitle })
    await waitFor(() => expect(within(points).getByText(en.waterPointStatuses.needs_repair).closest('li')).toHaveTextContent('1'))
    expect(screen.getByRole('region', { name: en.home.syncTitle })).toBeInTheDocument()
  })

  it('staff counts offline show a plain message', async () => {
    const dashboard = fakeDashboard(() => [], () => [])
    dashboard.fail = new StaffDataError('network')
    renderApp('/', { auth: new FakeAuthService(signedIn('administrator')), dashboard })
    expect(await screen.findAllByText(en.home.countsOffline)).toHaveLength(2)
  })

  it('reporters see their own report counts and no organization counts', async () => {
    const dashboard = fakeDashboard(() => [], () => [])
    renderApp('/', { auth: new FakeAuthService(signedIn('reporter')), dashboard })
    expect(await screen.findByRole('region', { name: en.home.syncTitle })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: en.home.newReport })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: en.home.incidentsTitle })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: en.home.tasksTitle })).not.toBeInTheDocument()
    expect(dashboard.staffCounts).not.toHaveBeenCalled()
  })
})
