import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Role } from '../../schemas/roles'
import { WaterPointServiceError } from '../../services/waterPoints'
import { en } from '../../strings/en'
import { FakeAuthService, FakeWaterPointCache, FakeWaterPointService, renderApp, signedIn, waterPointRecord } from '../../test/fakeServices'

const render = (path: string, role: Role = 'administrator', waterPoints = new FakeWaterPointService(), cache = new FakeWaterPointCache()) => {
  renderApp(path, { auth: new FakeAuthService(signedIn(role)), waterPoints, waterPointCache: cache })
  return { waterPoints, cache }
}

const setOnline = (online: boolean) => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online)
const field = (label: string) => screen.getByLabelText(new RegExp(`^${label}`))

afterEach(() => vi.restoreAllMocks())

describe('water point list (T3.2)', () => {
  it('lists water points with type, ward, status text, and demo labels', async () => {
    render('/water-points', 'reporter')
    const item = (await screen.findByRole('link', { name: 'Mwamanga Borehole (fictional)' })).closest('li')
    if (!item) throw new Error('no list item')
    expect(item).toHaveTextContent(en.waterPointTypes.borehole)
    expect(item).toHaveTextContent('Demo Ward')
    expect(item).toHaveTextContent(en.waterPointStatuses.working)
    expect(item).toHaveTextContent(en.waterPoints.demoBadge)
    expect(screen.getByText('2 water points')).toBeInTheDocument()
  })

  it('searches by name, ward, and location', async () => {
    render('/water-points')
    await screen.findByText('Soko Kiosk (fictional)')
    const search = screen.getByRole('searchbox', { name: new RegExp(en.waterPoints.search) })
    fireEvent.change(search, { target: { value: 'market' } })
    expect(screen.queryByText('Mwamanga Borehole (fictional)')).not.toBeInTheDocument()
    expect(screen.getByText('Soko Kiosk (fictional)')).toBeInTheDocument()
    expect(screen.getByText(en.waterPoints.countOne)).toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'nothing like this' } })
    expect(screen.getByText(en.waterPoints.noMatches)).toBeInTheDocument()
  })

  it('shows the register link to staff only', async () => {
    render('/water-points', 'technician')
    expect(await screen.findByRole('link', { name: en.waterPoints.register })).toHaveAttribute('href', '/water-points/new')
  })

  it('does not show the register link to reporters', async () => {
    render('/water-points', 'reporter')
    await screen.findByText('Soko Kiosk (fictional)')
    expect(screen.queryByRole('link', { name: en.waterPoints.register })).not.toBeInTheDocument()
  })

  it('empty: explains differently for staff and reporters', async () => {
    render('/water-points', 'administrator', new FakeWaterPointService([]))
    expect(await screen.findByText(en.waterPoints.emptyStaff)).toBeInTheDocument()
  })

  it('error with no saved copy: shows retry, which reloads', async () => {
    const service = new FakeWaterPointService()
    service.fail = new WaterPointServiceError('unknown')
    render('/water-points', 'reporter', service)
    const retry = await screen.findByRole('button', { name: en.common.retry })
    service.fail = null
    fireEvent.click(retry)
    expect(await screen.findByText('Soko Kiosk (fictional)')).toBeInTheDocument()
  })

  it('offline with no saved copy: shows the offline state', async () => {
    const service = new FakeWaterPointService()
    service.fail = new WaterPointServiceError('network')
    render('/water-points', 'reporter', service)
    expect(await screen.findByRole('heading', { name: en.states.offlineTitle })).toBeInTheDocument()
  })

  it('offline with a saved copy: shows it with a clear notice (R2.2)', async () => {
    const service = new FakeWaterPointService()
    service.fail = new WaterPointServiceError('network')
    const cache = new FakeWaterPointCache()
    await cache.replace({ organizationId: 'kwale-demo', ownerUid: 'uid-reporter' }, [waterPointRecord()], '2026-03-01T08:00:00.000Z')
    render('/water-points', 'reporter', service, cache)
    expect(await screen.findByText('Mwamanga Borehole (fictional)')).toBeInTheDocument()
    expect(screen.getByText(/You are offline\. Showing the water points saved on this device/)).toBeInTheDocument()
  })

  it('staff offline: no register link and an explanation', async () => {
    setOnline(false)
    render('/water-points', 'administrator')
    expect(await screen.findByText(en.waterPoints.onlineOnly)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: en.waterPoints.register })).not.toBeInTheDocument()
  })
})

describe('water point detail (T3.2)', () => {
  it('shows the fields and an edit link for staff', async () => {
    render('/water-points/wp-mwamanga', 'technician')
    expect(await screen.findByRole('heading', { level: 1, name: 'Mwamanga Borehole (fictional)' })).toBeInTheDocument()
    expect(screen.getByText('Beside the fictional primary school')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: en.waterPoints.edit })).toHaveAttribute('href', '/water-points/wp-mwamanga/edit')
  })

  it('reporters can view but not edit', async () => {
    render('/water-points/wp-mwamanga', 'reporter')
    await screen.findByRole('heading', { level: 1, name: 'Mwamanga Borehole (fictional)' })
    expect(screen.queryByRole('link', { name: en.waterPoints.edit })).not.toBeInTheDocument()
  })

  it('shows "not recorded" for a missing ward', async () => {
    render('/water-points/wp-x', 'reporter', new FakeWaterPointService([waterPointRecord({ id: 'wp-x', ward: undefined })]))
    expect(await screen.findByText(en.waterPoints.fields.noWard)).toBeInTheDocument()
  })

  it('shows not found for an unknown ID', async () => {
    render('/water-points/wp-nope', 'reporter')
    expect(await screen.findByRole('heading', { name: en.waterPoints.notFoundTitle })).toBeInTheDocument()
  })
})

describe('water point form (T3.3)', () => {
  it('reporters cannot open the form', async () => {
    render('/water-points/new', 'reporter')
    expect(await screen.findByText(en.access.deniedTitle)).toBeInTheDocument()
  })

  it('shows field-level errors and does not save an invalid form (R2.3)', async () => {
    const { waterPoints } = render('/water-points/new')
    await screen.findByRole('heading', { name: en.waterPoints.createTitle })
    fireEvent.change(field(en.waterPoints.fields.ward), { target: { value: 'w'.repeat(81) } })
    fireEvent.click(screen.getByRole('button', { name: en.waterPoints.save }))
    expect(await screen.findByText(en.waterPoints.validation.nameRequired)).toBeInTheDocument()
    expect(screen.getByText(en.waterPoints.validation.typeRequired)).toBeInTheDocument()
    expect(screen.getByText(en.waterPoints.validation.locationRequired)).toBeInTheDocument()
    expect(screen.getByText(en.waterPoints.validation.statusRequired)).toBeInTheDocument()
    expect(screen.getByText(en.waterPoints.validation.wardTooLong)).toBeInTheDocument()
    expect(field(en.waterPoints.fields.name)).toHaveAttribute('aria-invalid', 'true')
    expect(waterPoints.create).not.toHaveBeenCalled()
  })

  it('registers a water point in the user’s organization and opens it (R2.1)', async () => {
    const { waterPoints } = render('/water-points/new')
    await screen.findByRole('heading', { name: en.waterPoints.createTitle })
    fireEvent.change(field(en.waterPoints.fields.name), { target: { value: ' New Tap (fictional) ' } })
    fireEvent.change(field(en.waterPoints.fields.type), { target: { value: 'tap' } })
    fireEvent.change(field(en.waterPoints.fields.locationDescription), { target: { value: 'By the market' } })
    fireEvent.change(field(en.waterPoints.fields.status), { target: { value: 'working' } })
    fireEvent.click(screen.getByRole('button', { name: en.waterPoints.save }))
    await waitFor(() =>
      expect(waterPoints.create).toHaveBeenCalledWith(
        { organizationId: 'kwale-demo', ownerUid: 'uid-administrator' },
        { name: 'New Tap (fictional)', type: 'tap', locationDescription: 'By the market', status: 'working' },
      ),
    )
    expect(await screen.findByRole('heading', { level: 1, name: 'New Tap (fictional)' })).toBeInTheDocument()
    expect(screen.getByText(en.waterPoints.saved)).toBeInTheDocument()
  })

  it('edits an existing water point with its values filled in', async () => {
    const { waterPoints } = render('/water-points/wp-mwamanga/edit', 'technician')
    expect(await screen.findByDisplayValue('Mwamanga Borehole (fictional)')).toBeInTheDocument()
    fireEvent.change(field(en.waterPoints.fields.status), { target: { value: 'needs_repair' } })
    fireEvent.change(field(en.waterPoints.fields.ward), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: en.waterPoints.save }))
    await waitFor(() =>
      expect(waterPoints.update).toHaveBeenCalledWith(
        { organizationId: 'kwale-demo', ownerUid: 'uid-technician' },
        'wp-mwamanga',
        { name: 'Mwamanga Borehole (fictional)', type: 'borehole', locationDescription: 'Beside the fictional primary school', status: 'needs_repair' },
      ),
    )
    const heading = await screen.findByRole('heading', { level: 1, name: 'Mwamanga Borehole (fictional)' })
    expect(within(heading.closest('article') as HTMLElement).getByText(en.waterPointStatuses.needs_repair)).toBeInTheDocument()
  })

  it('shows a plain-language error when saving fails', async () => {
    const service = new FakeWaterPointService()
    render('/water-points/wp-mwamanga/edit', 'technician', service)
    await screen.findByDisplayValue('Mwamanga Borehole (fictional)')
    service.fail = new WaterPointServiceError('permission')
    fireEvent.click(screen.getByRole('button', { name: en.waterPoints.save }))
    expect(await screen.findByText(en.waterPoints.errors.permission)).toBeInTheDocument()
  })

  it('is online only: offline disables saving and explains why', async () => {
    setOnline(false)
    render('/water-points/new')
    expect(await screen.findByText(en.waterPoints.onlineOnly)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.waterPoints.save })).toBeDisabled()
  })
})
