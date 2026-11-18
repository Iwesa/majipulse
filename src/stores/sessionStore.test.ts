import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeAuthService, signedIn } from '../test/fakeServices'
import { createSessionStore } from './sessionStore'
import { registerStoreReset } from './storeRegistry'

describe('session store', () => {
  const cleanups: Array<() => void> = []
  afterEach(() => {
    cleanups.splice(0).forEach((fn) => fn())
  })

  function setup(initial = signedIn('reporter')) {
    const auth = new FakeAuthService(initial)
    const store = createSessionStore(auth)
    const reset = vi.fn()
    cleanups.push(registerStoreReset(reset), store.getState().start())
    return { auth, store, reset }
  }

  it('publishes the current session on start', () => {
    const { store, reset } = setup()
    expect(store.getState().session).toEqual(signedIn('reporter'))
    expect(reset).not.toHaveBeenCalled()
  })

  it('resets all stores on sign-out (R3.6)', async () => {
    const { store, reset } = setup()
    await store.getState().signOut()
    expect(store.getState().session).toEqual({ status: 'signedOut' })
    expect(reset).toHaveBeenCalledOnce()
  })

  it('resets all stores when a different user signs in', () => {
    const { auth, reset } = setup()
    auth.emit(signedIn('technician'))
    expect(reset).toHaveBeenCalledOnce()
  })

  it('does not reset when the same user’s claims refresh', () => {
    const { auth, reset } = setup()
    auth.emit(signedIn('reporter', { organizationName: 'Renamed (fictional)' }))
    expect(reset).not.toHaveBeenCalled()
  })

  it('resets before the new session is visible', () => {
    const { auth, store } = setup()
    let sessionAtReset: unknown
    cleanups.push(registerStoreReset(() => (sessionAtReset = store.getState().session)))
    auth.emit(signedIn('administrator'))
    expect(sessionAtReset).toEqual(signedIn('reporter'))
  })

  it('passes sign-in through to the auth service', async () => {
    const { auth, store } = setup({ status: 'signedOut' })
    await store.getState().signIn('reporter@example.org', 'secret-password')
    expect(auth.signIn).toHaveBeenCalledWith('reporter@example.org', 'secret-password')
  })

  it('stops listening after unsubscribe', () => {
    const auth = new FakeAuthService(signedIn('reporter'))
    const store = createSessionStore(auth)
    const stop = store.getState().start()
    stop()
    auth.emit({ status: 'signedOut' })
    expect(store.getState().session).toEqual(signedIn('reporter'))
  })
})
