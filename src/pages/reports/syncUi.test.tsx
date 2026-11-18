import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalIncidentRecord } from '../../schemas/localIncident'
import { applyLocalEdit, createLocalIncident, systemClock } from '../../services/incidentDrafts'
import type { IncidentOutbox } from '../../services/incidents'
import { openMajiPulseDb } from '../../services/offline/db'
import { createIdbIncidentOutbox } from '../../services/offline/incidentOutbox'
import { en } from '../../strings/en'
import { FakeAuthService, renderApp, signedIn } from '../../test/fakeServices'
import { FakeSyncServer } from '../../test/fakeSyncServer'

const REPORTER = { organizationId: 'kwale-demo', ownerUid: 'uid-reporter' }
const content = { waterPointId: 'wp-mwamanga', description: 'My edit (fictional).', incidentType: 'leak' as const, severity: 'high' as const }

let outbox: IncidentOutbox
let server: FakeSyncServer
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  outbox = createIdbIncidentOutbox(openMajiPulseDb())
  server = new FakeSyncServer()
})
afterEach(() => vi.restoreAllMocks())

const render = (path: string, auth = new FakeAuthService(signedIn('reporter'))) =>
  renderApp(path, { auth, incidentOutbox: outbox, incidentSync: server })

const repo = () => outbox.forScope(REPORTER)
const stored = (id: string) => repo().get(id) as Promise<LocalIncidentRecord>

/** A synced report that the server then triaged (or not), with a local edit that conflicts. */
async function conflictRecord(triage: boolean): Promise<LocalIncidentRecord> {
  const record = createLocalIncident(crypto.randomUUID(), REPORTER, { ...content, description: 'Original (fictional).' })
  await repo().create(record)
  const inFlight = { mutationId: record.mutationId, baseRevision: 0, startedAt: record.clientCreatedAt }
  await server.submit({ ...record, inFlight })
  const serverCopy = server.docs.get(record.id)
  if (!serverCopy) throw new Error('no server copy')
  if (triage) {
    server.triage(record.id)
  } else {
    // Another device's edit moved the server ahead (fictional).
    server.docs.set(record.id, { ...serverCopy, description: 'Server edit (fictional).', serverRevision: 2, baseRevision: 1, mutationId: crypto.randomUUID() })
  }
  const synced: LocalIncidentRecord = { ...record, syncStatus: 'synced', serverRevision: 1, baseRevision: 1, syncedAt: '2026-03-01T09:00:00.000Z' }
  const edited = applyLocalEdit(synced, content, systemClock)
  const snapshot = server.docs.get(record.id)
  if (!snapshot) throw new Error('no server copy')
  const conflict: LocalIncidentRecord = { ...edited, syncStatus: 'conflict', conflictServerSnapshot: snapshot }
  await repo().update(conflict)
  return conflict
}

describe('sync in the app (T5.3, T5.4)', () => {
  it('sends pending reports on sign-in and shows them as sent', async () => {
    const record = createLocalIncident(crypto.randomUUID(), REPORTER, content)
    await repo().create(record)
    render('/reports')
    expect(await screen.findByText(en.syncStatuses.synced)).toBeInTheDocument()
    expect(server.writes).toEqual([[record.id, record.mutationId]])
  })

  it('a failed report offers "Try sending again", which sends it', async () => {
    const record = createLocalIncident(crypto.randomUUID(), REPORTER, content)
    await repo().create(record)
    server.failNextSubmit('invalid')
    render(`/reports/${record.id}`)
    const retry = await screen.findByRole('button', { name: en.sync.retry })
    expect(screen.getByText(en.sync.retryHelp)).toBeInTheDocument()
    fireEvent.click(retry)
    expect(await screen.findByText(en.syncStatusHelp.synced)).toBeInTheDocument()
  })

  it('the header shows reports needing attention and links to the sync page', async () => {
    const record = createLocalIncident(crypto.randomUUID(), REPORTER, content)
    await repo().create(record)
    server.failNextSubmit('invalid')
    render('/')
    const link = await screen.findByRole('link', { name: en.sync.indicatorAttentionOne })
    expect(link).toHaveAttribute('href', '/sync')
  })

  it('sync page: counts, last send, send now, and attention list', async () => {
    const failing = createLocalIncident(crypto.randomUUID(), REPORTER, content)
    await repo().create(failing)
    server.failNextSubmit('invalid')
    render('/sync')
    expect(await screen.findByRole('heading', { level: 1, name: en.sync.title })).toBeInTheDocument()
    const attention = await screen.findByRole('region', { name: en.sync.attentionTitle })
    expect(await within(attention).findByRole('link', { name: /Leak/ })).toHaveAttribute('href', `/reports/${failing.id}`)
    expect(screen.getByText(en.sync.failedNote)).toBeInTheDocument()

    await repo().updateWith(failing.id, (r) => ({ ...r, syncStatus: 'pending', failureKind: undefined, lastError: undefined }))
    fireEvent.click(screen.getByRole('button', { name: en.sync.sendNow }))
    expect(await screen.findByText(en.sync.allSent)).toBeInTheDocument()
    expect(screen.getByText(/Last successful send:/)).toBeInTheDocument()
  })

  it('send now is disabled offline and explains why', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    render('/sync')
    expect(await screen.findByText(en.sync.offlineNote)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.sync.sendNow })).toBeDisabled()
  })

  it('account switching: B never sees A’s reports and A’s unsent report is sent when A returns (AC13)', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const record = createLocalIncident(crypto.randomUUID(), REPORTER, { ...content, description: 'A only (fictional).' })
    await repo().create(record)
    const auth = new FakeAuthService(signedIn('reporter'))
    render('/reports', auth)
    expect(await screen.findByText('A only (fictional).')).toBeInTheDocument()

    auth.emit(signedIn('technician'))
    expect(await screen.findByRole('heading', { name: en.reports.emptyTitle })).toBeInTheDocument()
    expect(screen.queryByText('A only (fictional).')).not.toBeInTheDocument()

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    auth.emit(signedIn('reporter'))
    expect(await screen.findByText(en.syncStatuses.synced)).toBeInTheDocument()
    expect(server.writes).toEqual([[record.id, record.mutationId]])
  })
})

describe('conflict review (T5.5, AC6)', () => {
  it('shows both versions side by side and does nothing until a choice is made', async () => {
    const record = await conflictRecord(false)
    render(`/reports/${record.id}`)
    const review = await screen.findByRole('region', { name: en.conflict.title })
    const table = within(review).getByRole('table')
    expect(within(table).getByRole('columnheader', { name: en.conflict.yours })).toBeInTheDocument()
    expect(within(table).getByText('My edit (fictional).')).toBeInTheDocument()
    expect(within(table).getByText('Server edit (fictional).')).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 50))
    expect(server.writes).toHaveLength(1)
    expect((await stored(record.id)).syncStatus).toBe('conflict')
  })

  it('the edit form points to the review instead of editing', async () => {
    const record = await conflictRecord(false)
    render(`/reports/${record.id}/edit`)
    expect(await screen.findByText(en.conflict.reviewFirst, { exact: false })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.reports.save })).not.toBeInTheDocument()
  })

  it('"Send my version" (server still new) sends the edit on top of the server version', async () => {
    const record = await conflictRecord(false)
    render(`/reports/${record.id}`)
    fireEvent.click(await screen.findByRole('button', { name: en.conflict.retryOnLatest }))
    expect(await screen.findByText(en.syncStatusHelp.synced)).toBeInTheDocument()
    expect(server.docs.get(record.id)).toMatchObject({ description: 'My edit (fictional).', serverRevision: 3 })
  })

  it('after triage only discard is offered, with an explanation', async () => {
    const record = await conflictRecord(true)
    render(`/reports/${record.id}`)
    await screen.findByRole('region', { name: en.conflict.title })
    expect(screen.queryByRole('button', { name: en.conflict.retryOnLatest })).not.toBeInTheDocument()
    expect(screen.getByText(en.conflict.triagedNote)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.conflict.discard })).toBeInTheDocument()
  })

  it('discard needs explicit confirmation; cancel keeps the edit', async () => {
    const record = await conflictRecord(true)
    render(`/reports/${record.id}`)
    fireEvent.click(await screen.findByRole('button', { name: en.conflict.discard }))
    const dialog = screen.getByRole('alertdialog', { name: en.conflict.confirmTitle })
    expect(within(dialog).getByText(en.conflict.confirmText)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: en.conflict.cancel }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(await stored(record.id)).toMatchObject({ syncStatus: 'conflict', description: 'My edit (fictional).' })
  })

  it('confirmed discard replaces the local edit with the server version', async () => {
    const record = await conflictRecord(true)
    render(`/reports/${record.id}`)
    fireEvent.click(await screen.findByRole('button', { name: en.conflict.discard }))
    fireEvent.click(screen.getByRole('button', { name: en.conflict.confirmDiscard }))
    expect(await screen.findByText(en.conflict.discarded)).toBeInTheDocument()
    await waitFor(async () =>
      expect(await stored(record.id)).toMatchObject({ syncStatus: 'synced', status: 'triaged', description: 'Original (fictional).' }),
    )
    expect(screen.queryByRole('link', { name: en.reports.edit })).not.toBeInTheDocument()
  })
})
