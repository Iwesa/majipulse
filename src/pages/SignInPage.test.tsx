import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SignInError } from '../services/session'
import { en } from '../strings/en'
import { FakeAuthService, renderApp, signedIn } from '../test/fakeServices'

const fill = (email: string, password: string) => {
  fireEvent.change(screen.getByLabelText(new RegExp(`^${en.signIn.email}`)), { target: { value: email } })
  fireEvent.change(screen.getByLabelText(new RegExp(`^${en.signIn.password}`)), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: en.signIn.submit }))
}

describe('SignInPage', () => {
  it('has labeled email and password fields with autocomplete hints', async () => {
    renderApp('/sign-in')
    const email = await screen.findByRole('textbox', { name: new RegExp(en.signIn.email) })
    expect(email).toHaveAttribute('autocomplete', 'email')
    expect(screen.getByLabelText(new RegExp(`^${en.signIn.password}`))).toHaveAttribute('autocomplete', 'current-password')
  })

  it('validates input before calling the auth service', async () => {
    const auth = new FakeAuthService()
    renderApp('/sign-in', { auth })
    await screen.findByRole('heading', { name: en.signIn.title })
    fill('not-an-email', '')
    expect(await screen.findByText(en.signIn.emailInvalid)).toBeInTheDocument()
    expect(screen.getByText(en.signIn.passwordRequired)).toBeInTheDocument()
    expect(auth.signIn).not.toHaveBeenCalled()
  })

  it('signs in and returns to the page the user asked for', async () => {
    const auth = new FakeAuthService()
    auth.signIn.mockImplementation(async () => auth.emit(signedIn('technician')))
    renderApp('/incidents', { auth })
    await screen.findByRole('heading', { name: en.signIn.title })
    fill(' tech@example.org ', 'correct horse')
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith('tech@example.org', 'correct horse'))
    expect(await screen.findByRole('heading', { level: 1, name: en.nav.incidents })).toBeInTheDocument()
  })

  it.each([
    ['invalidCredentials', en.signIn.invalidCredentials],
    ['network', en.signIn.network],
    ['tooManyAttempts', en.signIn.tooManyAttempts],
    ['unknown', en.signIn.unknown],
  ] as const)('shows a plain-language %s error', async (kind, message) => {
    const auth = new FakeAuthService()
    auth.signIn.mockRejectedValue(new SignInError(kind))
    renderApp('/sign-in', { auth })
    await screen.findByRole('heading', { name: en.signIn.title })
    fill('reporter@example.org', 'wrong')
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  it('redirects a signed-in user away from sign-in', async () => {
    renderApp('/sign-in', { auth: new FakeAuthService(signedIn('reporter')) })
    expect(await screen.findByRole('heading', { name: en.home.title })).toBeInTheDocument()
  })
})
