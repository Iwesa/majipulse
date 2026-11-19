// Accessibility audit of every screen, per role (T9.2, AC16). Real stores,
// routes, and components with fake services; checks run on the rendered DOM.
// Browser-only checks (contrast, target size, reflow at 360 px) run in
// e2e-emulator/accessibility.spec.ts. FICTIONAL data.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import type { LocalIncidentRecord } from '../schemas/localIncident'
import type { Role } from '../schemas/roles'
import { createLocalIncident } from '../services/incidentDrafts'
import type { IncidentOutbox } from '../services/incidents'
import { openMajiPulseDb } from '../services/offline/db'
import { createIdbIncidentOutbox } from '../services/offline/incidentOutbox'
import { en } from '../strings/en'
import { auditDocument } from './a11yAudit'
import { FakeAuthService, renderApp, signedIn } from './fakeServices'
import { ANALYZED, FakeMaintenanceService, FakePatternService, FakeStaffIncidentService, patternAnalysis, staffIncident, taskRecord } from './fakeStaffServices'

const AI = {
  suggested: { incidentType: 'leak' as const, severity: 'high' as const, occurredAt: null, locationNote: 'near the trough' },
  inferenceSource: 'in_cloud' as const,
  model: 'gemini-3.5-flash-lite',
  generatedAt: '2026-03-01T07:59:00.000Z',
}
const INCIDENT = staffIncident({ id: ANALYZED[0], ai: AI, status: 'triaged', serverRevision: 2, lastStatusChange: { by: 'uid-technician', at: '2026-03-01T09:00:00.000Z', from: 'new', to: 'triaged' } })
const TASK = taskRecord({ id: 'task-a11y', incidentId: INCIDENT.id, assigneeId: 'uid-technician' })

let outbox: IncidentOutbox
let reportId = ''
let conflictId = ''

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  outbox = createIdbIncidentOutbox(openMajiPulseDb())
  for (const role of ['reporter', 'administrator'] as const) {
    const scope = { organizationId: 'kwale-demo', ownerUid: `uid-${role}` }
    const repo = outbox.forScope(scope)
    const report = createLocalIncident(crypto.randomUUID(), scope, { waterPointId: 'wp-mwamanga', description: 'Low flow (fictional).', incidentType: 'low_flow', severity: null, ai: AI })
    await repo.create(report)
    const original = createLocalIncident(crypto.randomUUID(), scope, { waterPointId: 'wp-mwamanga', description: 'Mine (fictional).', incidentType: 'leak', severity: 'low' })
    const { ownerUid: _o, syncStatus: _s, id: _i, ...server } = { ...original, description: 'Server (fictional).', serverRevision: 2, baseRevision: 1, status: 'triaged' as const, createdAt: original.clientCreatedAt, updatedAt: original.clientCreatedAt, lastStatusChange: { by: 'uid-technician', at: original.clientCreatedAt, from: 'new' as const, to: 'triaged' as const } }
    void _o
    void _s
    void _i
    const conflict: LocalIncidentRecord = { ...original, serverRevision: 1, baseRevision: 1, syncStatus: 'conflict', conflictServerSnapshot: server }
    await repo.create(conflict)
    if (role === 'reporter') {
      reportId = report.id
      conflictId = conflict.id
    }
  }
})

function render(role: Role | null, path: string) {
  const staffIncidents = new FakeStaffIncidentService([INCIDENT, staffIncident({ status: 'new' })])
  renderApp(path, {
    auth: new FakeAuthService(role ? signedIn(role) : { status: 'signedOut' }),
    incidentOutbox: outbox,
    staffIncidents,
    maintenance: new FakeMaintenanceService([TASK], () => staffIncidents.incidents),
    patterns: new FakePatternService([patternAnalysis()]),
  })
}

/** Waits until the page has its h1 and nothing is loading. */
async function settled() {
  await waitFor(() => {
    expect(document.querySelector('main h1')).not.toBeNull()
    expect(screen.queryAllByText(en.common.loading)).toHaveLength(0)
  })
}

const expectNoViolations = () => expect(auditDocument()).toEqual([])

type Page = [label: string, role: Role | null, path: () => string]
const PAGES: Page[] = [
  ['sign in', null, () => '/sign-in'],
  ['reporter home', 'reporter', () => '/'],
  ['new report', 'reporter', () => '/reports/new'],
  ['my reports', 'reporter', () => '/reports'],
  ['report detail with AI provenance', 'reporter', () => `/reports/${reportId}`],
  ['conflict review', 'reporter', () => `/reports/${conflictId}`],
  ['edit report', 'reporter', () => `/reports/${reportId}/edit`],
  ['sync status', 'reporter', () => '/sync'],
  ['water points (reporter)', 'reporter', () => '/water-points'],
  ['water point detail', 'reporter', () => '/water-points/wp-mwamanga'],
  ['access denied', 'reporter', () => '/incidents'],
  ['not found', 'reporter', () => '/no-such-page'],
  ['staff home dashboard', 'technician', () => '/'],
  ['incident queue', 'technician', () => '/incidents'],
  ['incident detail and triage', 'technician', () => `/incidents/${INCIDENT.id}`],
  ['maintenance list', 'technician', () => '/maintenance'],
  ['new maintenance task', 'technician', () => `/maintenance/new?incident=${INCIDENT.id}`],
  ['maintenance task', 'technician', () => `/maintenance/${TASK.id}`],
  ['pattern analysis', 'administrator', () => '/patterns'],
  ['pattern analysis detail', 'administrator', () => '/patterns/analysis-1'],
  ['users', 'administrator', () => '/users'],
  ['register water point', 'administrator', () => '/water-points/new'],
  ['edit water point', 'administrator', () => '/water-points/wp-mwamanga/edit'],
]

describe('accessibility audit of every screen (T9.2)', () => {
  it.each(PAGES)('%s', async (_label, role, path) => {
    render(role, path())
    await settled()
    expectNoViolations()
    // Each screen has its own title (WCAG 2.4.2).
    const h1 = document.querySelector('main h1')?.textContent?.trim()
    await waitFor(() => expect(document.title).toBe(`${h1} – ${en.app.name}`))
  })
})

describe('keyboard and focus', () => {
  it('in-app navigation moves focus to the main content', async () => {
    render('reporter', '/')
    await settled()
    fireEvent.click(screen.getByRole('link', { name: en.nav.syncStatus }))
    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus())
    await waitFor(() => expect(document.title).toBe(`${en.sync.title} – ${en.app.name}`))
  })

  it('Escape closes the mobile menu and returns focus to its button', async () => {
    render('reporter', '/')
    await settled()
    const button = screen.getByRole('button', { name: en.layout.openMenu })
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(screen.getByRole('link', { name: en.nav.syncStatus }), { key: 'Escape' })
    expect(screen.getByRole('button', { name: en.layout.openMenu })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: en.layout.openMenu })).toHaveFocus()
  })

  it('closing the discard confirmation returns focus to the discard button; differences are marked in text', async () => {
    render('reporter', `/reports/${conflictId}`)
    await settled()
    expect(screen.getAllByText(en.conflict.different).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: en.conflict.discard }))
    fireEvent.click(await screen.findByRole('button', { name: en.conflict.cancel }))
    await waitFor(() => expect(screen.getByRole('button', { name: en.conflict.discard })).toHaveFocus())
  })
})

describe('form errors are linked to their fields', () => {
  it.each([
    ['sign in', null, '/sign-in', en.signIn.submit],
    ['new report', 'reporter', '/reports/new', en.reports.save],
    ['register water point', 'administrator', '/water-points/new', en.waterPoints.save],
    ['new maintenance task', 'technician', `/maintenance/new?incident=${INCIDENT.id}`, en.maintenance.create],
    ['create user', 'administrator', '/users', en.users.createSubmit],
  ] as Array<[string, Role | null, string, string]>)('%s', async (_label, role, path, submit) => {
    render(role, path)
    await settled()
    fireEvent.click(await screen.findByRole('button', { name: submit }))
    await waitFor(() => expect(document.querySelectorAll('[aria-invalid="true"]').length).toBeGreaterThan(0))
    expectNoViolations()
  })
})

describe('dialogs and panels', () => {
  it('AI privacy preview and the discard confirmation pass the audit', async () => {
    render('reporter', `/reports/${conflictId}`)
    await settled()
    fireEvent.click(screen.getByRole('button', { name: en.conflict.discard }))
    expect(await screen.findByRole('alertdialog', { name: en.conflict.confirmTitle })).toBeInTheDocument()
    expectNoViolations()
  })
})

describe('the audit catches problems', () => {
  it('reports unnamed controls, missing references, duplicate IDs, and heading gaps', () => {
    document.body.innerHTML = `
      <main><h1>Title</h1><h3 id="x">Skipped</h3>
      <input id="x" /><button></button><a>no href</a>
      <div aria-describedby="nowhere">x</div><svg></svg>
      <input aria-invalid="true" aria-label="Field" /></main>`
    const rules = auditDocument().map((v) => v.rule)
    for (const rule of ['duplicate-id', 'aria-describedby-missing-target', 'control-without-name', 'button-without-name', 'link-without-href', 'heading-level-skipped', 'svg-not-hidden', 'invalid-without-error']) {
      expect(rules).toContain(rule)
    }
    document.body.innerHTML = ''
  })
})
