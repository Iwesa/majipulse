// Pattern analysis screen and store (T8.4, AC11). Fake service, real stores and routes. FICTIONAL data.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Role } from '../../schemas/roles'
import { StaffDataError } from '../../services/staff'
import { createPatternStore } from '../../stores/patternStore'
import { en, format } from '../../strings/en'
import { FakeAuthService, renderApp, signedIn } from '../../test/fakeServices'
import { ANALYZED, FakePatternService, patternAnalysis } from '../../test/fakeStaffServices'
import { periodFromInputs } from './period'

afterEach(() => vi.restoreAllMocks())

const p = en.patterns
const setup = (role: Role, path: string, service = new FakePatternService()) => {
  renderApp(path, { auth: new FakeAuthService(signedIn(role)), patterns: service })
  return service
}

describe('analysis detail (AC11)', () => {
  it('labels each insight as an observation or an unverified hypothesis, with incidents, water points, period, and limitations', async () => {
    setup('technician', '/patterns/analysis-1', new FakePatternService([patternAnalysis()]))
    const observation = await screen.findByRole('article', { name: 'Repeated low flow at Mwamanga (fictional)' })
    expect(within(observation).getByText(p.observation)).toBeInTheDocument()
    expect(within(observation).getByText(p.observationHelp)).toBeInTheDocument()
    const links = within(observation).getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual(['Incident 1', 'Incident 2'])
    expect(links[0]).toHaveAttribute('href', `/incidents/${ANALYZED[0]}`)
    expect(within(observation).getByText('Mwamanga Borehole (fictional)')).toBeInTheDocument()
    expect(within(observation).getByText('Only two reports.')).toBeInTheDocument()
    expect(within(observation).getByText(format(p.confidence, { level: 'medium' }))).toBeInTheDocument()

    const hypothesis = screen.getByRole('article', { name: 'Possible pump wear' })
    expect(within(hypothesis).getByText(p.hypothesis)).toBeInTheDocument()
    expect(within(hypothesis).getByText(p.hypothesisHelp)).toBeInTheDocument()

    expect(screen.getByText(incidentCount(3))).toBeInTheDocument()
    expect(screen.getByText('Based on 3 incident reports from 2026-03-01 to 2026-03-31.')).toBeInTheDocument()
    expect(screen.getByText('gemini-3.5-flash')).toBeInTheDocument()
    expect(screen.getByText(en.waterPoints.demoBadge)).toBeInTheDocument()
  })

  it('insufficient data shows the reason and no insights', async () => {
    setup('administrator', '/patterns/a-2', new FakePatternService([
      patternAnalysis({ id: 'a-2', insufficientData: true, insights: [], analyzedIncidentIds: [ANALYZED[0]], analyzedIncidentCount: 1, model: 'none' }),
    ]))
    expect(await screen.findByText(p.insufficient)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: p.insightsTitle })).not.toBeInTheDocument()
    expect(screen.queryByText('none')).not.toBeInTheDocument()
  })

  it('no insights that passed the checks', async () => {
    setup('administrator', '/patterns/a-3', new FakePatternService([patternAnalysis({ id: 'a-3', insights: [] })]))
    expect(await screen.findByText(p.noInsights)).toBeInTheDocument()
  })

  it('an analysis of another organization is not found', async () => {
    setup('administrator', '/patterns/a-4', new FakePatternService([patternAnalysis({ id: 'a-4', organizationId: 'pwani-demo' })]))
    expect(await screen.findByRole('heading', { name: p.notFoundTitle })).toBeInTheDocument()
  })
})

const incidentCount = (n: number) => (n === 1 ? p.incidentsOne : format(p.incidentsMany, { count: String(n) }))

describe('pattern analysis page (T8.4)', () => {
  it('lists saved analyses newest first', async () => {
    setup('technician', '/patterns', new FakePatternService([
      patternAnalysis({ id: 'old', createdAt: '2026-02-01T00:00:00.000Z', period: { from: '2026-01-01T00:00:00.000Z', to: '2026-01-31T00:00:00.000Z' } }),
      patternAnalysis({ id: 'new', createdAt: '2026-03-31T12:00:00.000Z' }),
    ]))
    const saved = await screen.findByRole('region', { name: p.savedTitle })
    await waitFor(() => expect(within(saved).getAllByRole('link')).toHaveLength(2))
    expect(within(saved).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual(['/patterns/new', '/patterns/old'])
  })

  it('empty, offline, and error states', async () => {
    setup('technician', '/patterns')
    expect(await screen.findByText(p.emptyTitle)).toBeInTheDocument()
  })

  it('shows offline when saved analyses cannot be loaded', async () => {
    const service = new FakePatternService()
    service.fail = new StaffDataError('network')
    setup('technician', '/patterns', service)
    expect(await screen.findByText(en.states.offlineTitle)).toBeInTheDocument()
  })

  it('runs an analysis for the chosen period and water point, then opens the result', async () => {
    const service = setup('administrator', '/patterns')
    await screen.findByText(p.emptyTitle)
    expect(screen.getByText(p.privacyNote)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(new RegExp(`^${p.from}`)), { target: { value: '2026-03-01' } })
    fireEvent.change(screen.getByLabelText(new RegExp(`^${p.to}`)), { target: { value: '2026-03-31' } })
    fireEvent.change(screen.getByLabelText(new RegExp(`^${p.waterPoint}`)), { target: { value: 'wp-mwamanga' } })
    fireEvent.click(screen.getByRole('button', { name: p.run }))
    expect(await screen.findByText(p.runDone)).toBeInTheDocument()
    expect(service.run).toHaveBeenCalledWith({
      from: new Date('2026-03-01T00:00:00').toISOString(),
      to: new Date('2026-03-31T23:59:59.999').toISOString(),
      waterPointId: 'wp-mwamanga',
    })
    expect(await screen.findByRole('article', { name: 'Repeated low flow at Mwamanga (fictional)' })).toBeInTheDocument()
  })

  it('an insufficient-data run says so', async () => {
    const service = new FakePatternService([], (input) =>
      patternAnalysis({ id: 'tiny', period: { from: input.from, to: input.to }, insufficientData: true, insights: [], analyzedIncidentIds: [], analyzedIncidentCount: 0, model: 'none' }),
    )
    setup('technician', '/patterns', service)
    await screen.findByText(p.emptyTitle)
    fireEvent.click(screen.getByRole('button', { name: p.run }))
    expect(await screen.findByText(p.runInsufficient)).toBeInTheDocument()
    expect(screen.getByText(p.insufficient)).toBeInTheDocument()
  })

  it('a failed run shows a plain-language error and stays on the page', async () => {
    const service = new FakePatternService()
    service.runFail = new StaffDataError('unavailable')
    setup('technician', '/patterns', service)
    await screen.findByText(p.emptyTitle)
    fireEvent.click(screen.getByRole('button', { name: p.run }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(p.runFailed)
    expect(alert).toHaveTextContent(en.staffErrors.unavailable)
  })

  it('an invalid period is refused without a call', async () => {
    const service = setup('technician', '/patterns')
    await screen.findByText(p.emptyTitle)
    fireEvent.change(screen.getByLabelText(new RegExp(`^${p.from}`)), { target: { value: '2026-03-31' } })
    fireEvent.change(screen.getByLabelText(new RegExp(`^${p.to}`)), { target: { value: '2026-03-01' } })
    fireEvent.click(screen.getByRole('button', { name: p.run }))
    expect(await screen.findByText(p.invalidPeriod)).toBeInTheDocument()
    expect(service.run).not.toHaveBeenCalled()
  })

  it('running is disabled offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    setup('technician', '/patterns')
    expect(await screen.findByRole('button', { name: p.run })).toBeDisabled()
    expect(screen.getByText(p.onlineOnly)).toBeInTheDocument()
  })

  it('reporters cannot open pattern analysis', async () => {
    const service = setup('reporter', '/patterns')
    expect(await screen.findByRole('heading', { name: en.access.deniedTitle })).toBeInTheDocument()
    expect(service.list).not.toHaveBeenCalled()
  })
})

describe('period from date inputs', () => {
  const now = new Date('2026-03-31T12:00:00')
  it('uses whole local days and ends no later than now', () => {
    expect(periodFromInputs('2026-03-01', '2026-03-31', now)).toEqual({ from: new Date('2026-03-01T00:00:00').toISOString(), to: now.toISOString() })
  })
  it.each([
    ['reversed', '2026-03-10', '2026-03-01'],
    ['in the future', '2026-04-02', '2026-04-03'],
    ['over 366 days', '2025-01-01', '2026-03-01'],
    ['not a date', 'x', '2026-03-01'],
  ])('rejects %s', (_label, from, to) => {
    expect(periodFromInputs(from, to, now)).toBeNull()
  })
})

describe('pattern store', () => {
  it('run refreshes the list; reset discards late responses', async () => {
    const service = new FakePatternService()
    const store = createPatternStore(service, { isOnline: () => true })
    const scope = { organizationId: 'kwale-demo', ownerUid: 'uid-technician' }
    const result = await store.getState().run(scope, { from: '2026-03-01T00:00:00Z', to: '2026-03-31T00:00:00Z' })
    expect(result.analysisId).toBe('analysis-1')
    const { list } = store.getState()
    expect(list.status === 'ready' && list.data.map((a) => a.id)).toEqual(['analysis-1'])
    let release: () => void = () => undefined
    service.list.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve([]))))
    store.getState().reset()
    const pending = store.getState().loadList(scope)
    store.getState().reset()
    release()
    await pending
    expect(store.getState().list).toEqual({ status: 'idle' })
  })
})
