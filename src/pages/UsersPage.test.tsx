import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UserAdminClientError } from '../services/userAdmin'
import { en, format } from '../strings/en'
import { FakeAuthService, MEMBERS, fakeUserAdmin, renderApp, signedIn } from '../test/fakeServices'

const asAdmin = (userAdmin = fakeUserAdmin()) => {
  renderApp('/users', { auth: new FakeAuthService(signedIn('administrator')), userAdmin })
  return userAdmin
}

const createForm = () => screen.getByRole('region', { name: en.users.createTitle })

describe('UsersPage (T2.9)', () => {
  it('lists the organization’s members using the session scope', async () => {
    const userAdmin = asAdmin()
    expect(await screen.findByText('Demo reporter one')).toBeInTheDocument()
    expect(userAdmin.listMembers).toHaveBeenCalledWith({ organizationId: 'kwale-demo', ownerUid: 'uid-administrator' })
  })

  it('does not show a role control for the administrator’s own account', async () => {
    asAdmin()
    await screen.findByText('Demo reporter one')
    expect(screen.queryByRole('combobox', { name: format(en.users.changeRoleFor, { name: MEMBERS[0].displayName }) })).not.toBeInTheDocument()
    expect(screen.getByText(en.common.you)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: format(en.users.changeRoleFor, { name: MEMBERS[1].displayName }) })).toBeInTheDocument()
  })

  it('changes another user’s role through the service and confirms it', async () => {
    const userAdmin = asAdmin()
    const select = await screen.findByRole('combobox', { name: format(en.users.changeRoleFor, { name: 'Demo reporter one' }) })
    const save = screen.getByRole('button', { name: en.users.saveRole })
    expect(save).toBeDisabled()
    fireEvent.change(select, { target: { value: 'technician' } })
    fireEvent.click(save)
    await waitFor(() => expect(userAdmin.setRole).toHaveBeenCalledWith('uid-reporter-1', 'technician'))
    expect(await screen.findByText(format(en.users.roleSaved, { name: 'Demo reporter one' }))).toBeInTheDocument()
  })

  it('shows a plain-language error when a role change is refused', async () => {
    asAdmin(fakeUserAdmin({ setRole: vi.fn(async () => Promise.reject(new UserAdminClientError('otherSettings'))) }))
    const select = await screen.findByRole('combobox', { name: format(en.users.changeRoleFor, { name: 'Demo reporter one' }) })
    fireEvent.change(select, { target: { value: 'technician' } })
    fireEvent.click(screen.getByRole('button', { name: en.users.saveRole }))
    expect(await screen.findByRole('alert')).toHaveTextContent(en.users.errors.otherSettings)
  })

  it('creates a technician and shows the one-time setup link', async () => {
    const userAdmin = asAdmin()
    await screen.findByText('Demo reporter one')
    const form = within(createForm())
    fireEvent.change(form.getByLabelText(new RegExp(`^${en.users.name}`)), { target: { value: 'New Tech' } })
    fireEvent.change(form.getByLabelText(new RegExp(`^${en.users.email}`)), { target: { value: 'newtech@example.org' } })
    fireEvent.change(form.getByLabelText(new RegExp(`^${en.users.role}`)), { target: { value: 'technician' } })
    fireEvent.click(form.getByRole('button', { name: en.users.createSubmit }))
    await waitFor(() =>
      expect(userAdmin.createUser).toHaveBeenCalledWith({ displayName: 'New Tech', email: 'newtech@example.org', role: 'technician' }),
    )
    expect(await form.findByDisplayValue('https://example.org/reset?oobCode=FAKE')).toHaveAttribute('readonly')
    expect(form.getByText(en.users.resetLinkHelp)).toBeInTheDocument()
  })

  it('offers only technician and reporter for new accounts', async () => {
    asAdmin()
    await screen.findByText('Demo reporter one')
    const options = within(within(createForm()).getByLabelText(new RegExp(`^${en.users.role}`)))
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(options).toEqual([en.common.selectPlaceholder, en.roles.technician, en.roles.reporter])
  })

  it('validates the create form before calling the service', async () => {
    const userAdmin = asAdmin()
    await screen.findByText('Demo reporter one')
    fireEvent.click(within(createForm()).getByRole('button', { name: en.users.createSubmit }))
    expect(await screen.findByText(en.users.nameRequired)).toBeInTheDocument()
    expect(screen.getByText(en.users.roleRequired)).toBeInTheDocument()
    expect(userAdmin.createUser).not.toHaveBeenCalled()
  })

  it('shows an error when the email already has an account', async () => {
    asAdmin(fakeUserAdmin({ createUser: vi.fn(async () => Promise.reject(new UserAdminClientError('alreadyExists'))) }))
    await screen.findByText('Demo reporter one')
    const form = within(createForm())
    fireEvent.change(form.getByLabelText(new RegExp(`^${en.users.name}`)), { target: { value: 'Dup' } })
    fireEvent.change(form.getByLabelText(new RegExp(`^${en.users.email}`)), { target: { value: 'r1@example.org' } })
    fireEvent.change(form.getByLabelText(new RegExp(`^${en.users.role}`)), { target: { value: 'reporter' } })
    fireEvent.click(form.getByRole('button', { name: en.users.createSubmit }))
    expect(await form.findByRole('alert')).toHaveTextContent(en.users.errors.alreadyExists)
  })

  it('shows an error state with retry when members cannot be loaded', async () => {
    const listMembers = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(MEMBERS)
    asAdmin(fakeUserAdmin({ listMembers }))
    fireEvent.click(await screen.findByRole('button', { name: en.common.retry }))
    expect(await screen.findByText('Demo reporter one')).toBeInTheDocument()
  })

  it('shows an empty state when there are no members', async () => {
    asAdmin(fakeUserAdmin({ listMembers: vi.fn(async () => []) }))
    expect(await screen.findByRole('heading', { name: en.states.emptyTitle })).toBeInTheDocument()
  })
})
