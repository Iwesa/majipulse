import { createStore, type StoreApi } from 'zustand/vanilla'
import { sessionUid, type AuthService, type Session } from '../services/session'
import { resetAllStores } from './storeRegistry'

export interface SessionState {
  session: Session
  /** Subscribes to auth changes. Returns the unsubscribe function. */
  start(): () => void
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>
  refreshClaims(): Promise<void>
}

export type SessionStore = StoreApi<SessionState>

/**
 * Session store over an AuthService (injected so tests can use a fake).
 * Whenever the signed-in user changes, including sign-out, every registered
 * store is reset before the new session is published.
 */
export function createSessionStore(auth: AuthService): SessionStore {
  return createStore<SessionState>()((set, get) => ({
    session: { status: 'loading' },
    start() {
      return auth.subscribe((next) => {
        const previous = get().session
        const userChanged = sessionUid(previous) !== sessionUid(next) && previous.status !== 'loading'
        if (userChanged) resetAllStores()
        set({ session: next })
      })
    },
    signIn: (email, password) => auth.signIn(email, password),
    async signOut() {
      await auth.signOut()
    },
    refreshClaims: () => auth.refreshClaims(),
  }))
}
