import { fireEvent, render as renderPlain, screen, waitFor, within } from '@testing-library/react'
import { SyncStatusBadge } from '../../components/incidents/SyncStatusBadge'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalIncidentRecord, SyncStatus } from '../../schemas/localIncident'
import { createLocalIncident } from '../../services/incidentDrafts'
import type { IncidentOutbox } from '../../services/incidents'
import { openMajiPulseDb } from '../../services/offline/db'
import { createIdbIncidentOutbox } from '../../services/offline/incidentOutbox'
import { WaterPointServiceError } from '../../services/waterPoints'
import { en } from '../../strings/en'
import {
  FakeAuthService,
  FakeWaterPointCache,
  FakeWaterPointService,
  WATER_POINTS,
  renderApp,
  signedIn,
} from '../../test/fakeServices'

const REPORTER = { organizationId: 'kwale-demo', ownerUid: 'uid-reporter' }
const renderBadge = (status: SyncStatus) => renderPlain(<SyncStatusBadge status={status} />)
const field = (label: string) => screen.getByLabelText(new RegExp(`^${label.replace(/[?]/g, '\\?')}`))

let outbox: IncidentOutbox
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  outbox = createIdbIncidentOutbox(openMajiPulseDb())
})
afterEach(() => vi.restoreAllMocks())

function render(path: string, options: { waterPoints?: FakeWaterPointService; cache?: FakeWaterPointCache; auth?: FakeAuthService } = {}) {
  const waterPoints = options.waterPoints ?? new FakeWaterPointService()
  return renderApp(path, {
    auth: options.auth ?? new FakeAuthService(signedIn('reporter')),
    waterPoints,
    waterPointCache: options.cache ?? new FakeWaterPointCache(),
    incidentOutbox: outbox,
  })
}

async function fillAndSave(description = 'Handpump gives very little water (fictional).') {
  fireEvent.change(await screen.findByLabelText(new RegExp(`^${en.reports.fields.waterPoint}`)), { target: { value: 'wp-soko' } })
  fireEvent.change(field(en.reports.fields.description), { target: { value: description } })
  fireEvent.change(field(en.reports.fields.incidentType), { target: { value: 'low_flow' } })
  fireEvent.click(screen.getByRole('button', { name: en.reports.save }))
}

const seed = async (overrides: Partial<LocalIncidentRecord> = {}) => {
  const record = { ...createLocalIncident(crypto.randomUUID(), REPORTER, { waterPointId: 'wp-mwamanga', description: 'Seeded (fictional).', incidentType: 'leak', severity: 'high' }), ...overrides } as LocalIncidentRecord
  await outbox.forScope(REPORTER).create(record)
  return record
}

describe('new report (T4.3)', () => {
  it('saves to this device with the network off and shows it as waiting to send (R3.2, AC3)', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const waterPoints = new FakeWaterPointService()
    waterPoints.fail = new WaterPointServiceError('network')
    const cache = new FakeWaterPointCache()
    await cache.replace(REPORTER, WATER_POINTS, '2026-03-01T08:00:00.000Z')
    render('/reports/new', { waterPoints, cache })

    // The water point picker uses the copy saved on this device.
    expect(await screen.findByText(/Showing the water points saved on this device/)).toBeInTheDocument()
    await fillAndSave()

    expect(await screen.findByText(en.reports.savedNew)).toBeInTheDocument()
    expect(screen.getAllByText(en.syncStatuses.pending).length).toBeGreaterThan(0)
    const saved = await outbox.forScope(REPORTER).list()
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ waterPointId: 'wp-soko', incidentType: 'low_flow', syncStatus: 'pending', clientRevision: 1, baseRevision: 0 })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('requires a water point, a description, and a type (R3.3)', async () => {
    render('/reports/new')
    await screen.findByLabelText(new RegExp(`^${en.reports.fields.waterPoint}`))
    fireEvent.click(screen.getByRole('button', { name: en.reports.save }))
    expect(await screen.findByText(en.reports.validation.waterPointRequired)).toBeInTheDocument()
    expect(screen.getByText(en.reports.validation.descriptionRequired)).toBeInTheDocument()
    expect(screen.getByText(en.reports.validation.incidentTypeRequired)).toBeInTheDocument()
    expect(await outbox.forScope(REPORTER).list()).toEqual([])
  })

  it('severity is optional and defaults to "not sure"; a future start time is rejected', async () => {
    render('/reports/new')
    expect((await screen.findByLabelText(new RegExp(`^${en.reports.fields.severity.replace('?', '\\?')}`)) as HTMLSelectElement).value).toBe('')
    fireEvent.change(field(en.reports.fields.occurredAt), { target: { value: '2999-01-01T10:00' } })
    fireEvent.click(screen.getByRole('button', { name: en.reports.save }))
    expect(await screen.findByText(en.reports.validation.occurredAtFuture)).toBeInTheDocument()
  })

  it('shows the privacy hint on the description', async () => {
    render('/reports/new')
    expect(await screen.findByText(en.reports.fields.descriptionHint)).toBeInTheDocument()
  })

  it('explains when no water points are on the device yet', async () => {
    const waterPoints = new FakeWaterPointService()
    waterPoints.fail = new WaterPointServiceError('network')
    render('/reports/new', { waterPoints })
    expect(await screen.findByText(en.reports.waterPointsUnavailable)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.reports.save })).not.toBeInTheDocument()
  })
})

describe('my reports (T4.4)', () => {
  it('shows an empty state with a link to create a report', async () => {
    render('/reports')
    expect(await screen.findByRole('heading', { name: en.reports.emptyTitle })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: en.reports.newReportLink })).toHaveAttribute('href', '/reports/new')
  })

  it('every status has its own text and an icon', () => {
    const statuses: SyncStatus[] = ['pending', 'syncing', 'synced', 'failed', 'conflict']
    for (const status of statuses) {
      const { container } = renderBadge(status)
      expect(container).toHaveTextContent(en.syncStatuses[status])
      expect(container.querySelector('[aria-hidden="true"] svg')).not.toBeNull()
    }
    expect(new Set(statuses.map((s) => en.syncStatuses[s])).size).toBe(5)
  })

  it('a report left "sending" by a closed tab shows as waiting to send (crash recovery)', async () => {
    await seed({ syncStatus: 'syncing', inFlight: { mutationId: '00000000-0000-4000-8000-000000000001', baseRevision: 0, startedAt: '2026-03-01T08:00:00.000Z' } })
    render('/reports')
    expect(await screen.findByText(en.syncStatuses.pending)).toBeInTheDocument()
    expect(screen.queryByText(en.syncStatuses.syncing)).not.toBeInTheDocument()
  })

  it.each<[SyncStatus, Partial<LocalIncidentRecord>]>([
    ['pending', {}],
    ['synced', { syncStatus: 'synced', serverRevision: 1, baseRevision: 1, syncedAt: '2026-03-01T09:00:00.000Z' }],
    ['failed', { syncStatus: 'failed', failureKind: 'network' }],
    ['conflict', { syncStatus: 'conflict', serverRevision: 2, baseRevision: 1 }],
  ])('shows the %s status as text with an icon', async (status, overrides) => {
    const extra: Partial<LocalIncidentRecord> = { ...overrides }
    if (status === 'conflict') {
      const snapshot = { ...createLocalIncident(crypto.randomUUID(), REPORTER, { waterPointId: 'wp-mwamanga', description: 'Server (fictional).', incidentType: 'leak', severity: null }) }
      const { id: _i, ownerUid: _o, syncStatus: _s, ...server } = snapshot
      void _i
      void _o
      void _s
      extra.conflictServerSnapshot = { ...server, serverRevision: 2, baseRevision: 1, createdAt: '2026-03-01T08:00:00.000Z', updatedAt: '2026-03-01T08:00:00.000Z' }
    }
    await seed(extra)
    render('/reports')
    const badge = await screen.findByText(en.syncStatuses[status])
    expect(badge.closest('span')?.querySelector('[aria-hidden="true"] svg')).not.toBeNull()
  })

  it('lists newest first with the water point name', async () => {
    await seed({ clientCreatedAt: '2026-03-01T08:00:00.000Z', description: 'Older (fictional).' })
    await seed({ clientCreatedAt: '2026-03-02T08:00:00.000Z', description: 'Newer (fictional).', waterPointId: 'wp-soko' })
    render('/reports')
    await screen.findByText('Newer (fictional).')
    const items = within(screen.getByRole('main')).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Newer (fictional).')
    expect(items[0]).toHaveTextContent('Soko Kiosk (fictional)')
    expect(items[1]).toHaveTextContent('Mwamanga Borehole (fictional)')
  })

  it('shows only the signed-in user’s reports (account switching, AC13)', async () => {
    await seed({ description: 'Mine (fictional).' })
    const auth = new FakeAuthService(signedIn('reporter'))
    render('/reports', { auth })
    expect(await screen.findByText('Mine (fictional).')).toBeInTheDocument()
    auth.emit(signedIn('technician'))
    await waitFor(() => expect(screen.queryByText('Mine (fictional).')).not.toBeInTheDocument())
    expect(await screen.findByRole('heading', { name: en.reports.emptyTitle })).toBeInTheDocument()
    auth.emit(signedIn('reporter'))
    expect(await screen.findByText('Mine (fictional).')).toBeInTheDocument()
  })
})

describe('report detail and edit', () => {
  it('shows the status explanation and an edit link while editable', async () => {
    const record = await seed()
    render(`/reports/${record.id}`)
    expect(await screen.findByText(en.syncStatusHelp.pending)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: en.reports.edit })).toHaveAttribute('href', `/reports/${record.id}/edit`)
  })

  it('explains a failed send and its reason', async () => {
    const record = await seed({ syncStatus: 'failed', failureKind: 'permission_denied' })
    render(`/reports/${record.id}`)
    expect(await screen.findByText(en.syncStatusHelp.failed)).toBeInTheDocument()
    expect(screen.getByText(en.failureKinds.permission_denied)).toBeInTheDocument()
  })

  it('no edit link after triage', async () => {
    const record = await seed({ status: 'triaged', serverRevision: 2, baseRevision: 1, syncStatus: 'synced', syncedAt: '2026-03-01T09:00:00.000Z', lastStatusChange: { by: 'uid-tech', at: '2026-03-01T09:00:00.000Z', from: 'new', to: 'triaged' } })
    render(`/reports/${record.id}`)
    await screen.findByText(en.syncStatusHelp.synced)
    expect(screen.queryByRole('link', { name: en.reports.edit })).not.toBeInTheDocument()
  })

  it('an edit is saved locally with a higher clientRevision and a new mutationId (R3.4)', async () => {
    const record = await seed()
    render(`/reports/${record.id}/edit`)
    const description = await screen.findByDisplayValue('Seeded (fictional).')
    fireEvent.change(description, { target: { value: 'Edited description (fictional).' } })
    fireEvent.click(screen.getByRole('button', { name: en.reports.save }))
    expect(await screen.findByText(en.reports.savedEdit)).toBeInTheDocument()
    const saved = await outbox.forScope(REPORTER).get(record.id)
    expect(saved).toMatchObject({ description: 'Edited description (fictional).', clientRevision: 2, baseRevision: 0, syncStatus: 'pending' })
    expect(saved?.mutationId).not.toBe(record.mutationId)
  })

  it('the edit form is not offered after triage', async () => {
    const record = await seed({ status: 'triaged', serverRevision: 2, baseRevision: 1, syncStatus: 'synced', syncedAt: '2026-03-01T09:00:00.000Z', lastStatusChange: { by: 'uid-tech', at: '2026-03-01T09:00:00.000Z', from: 'new', to: 'triaged' } })
    render(`/reports/${record.id}/edit`)
    expect(await screen.findByText(en.reports.notEditable)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.reports.save })).not.toBeInTheDocument()
  })

  it('shows not found for another user’s or an unknown report', async () => {
    render(`/reports/${crypto.randomUUID()}`)
    expect(await screen.findByRole('heading', { name: en.reports.notFoundTitle })).toBeInTheDocument()
  })

  it('detail heading shows the type and water point', async () => {
    const record = await seed()
    render(`/reports/${record.id}`)
    const heading = await screen.findByRole('heading', { level: 1 })
    expect(within(heading).getByText(/Leak: Mwamanga Borehole \(fictional\)/)).toBeInTheDocument()
  })
})
