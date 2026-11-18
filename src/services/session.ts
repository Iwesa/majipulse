/** Session types shared by the auth service, stores, and UI. */
import type { Role, SessionScope } from '../schemas/roles'

export interface SessionUser {
  uid: string
  email: string | null
  displayName: string | null
  organizationId: string
  role: Role
  /** Null when it could not be read (for example offline). */
  organizationName: string | null
  /** True when the organization is fictional demo data (R10.1). */
  organizationDemo: boolean
  scope: SessionScope
}

/** Why a signed-in account cannot use the app yet. */
export type NoAccessReason = 'noClaims' | 'noMember' | 'inactive' | 'mismatch'

export type Session =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'noAccess'; reason: NoAccessReason; email: string | null }
  | { status: 'signedIn'; user: SessionUser }

export type SignInErrorKind = 'invalidCredentials' | 'network' | 'tooManyAttempts' | 'unknown'

export class SignInError extends Error {
  readonly kind: SignInErrorKind

  constructor(kind: SignInErrorKind) {
    super(kind)
    this.name = 'SignInError'
    this.kind = kind
  }
}

export interface AuthService {
  /** Calls the listener with the current session now and on every change. */
  subscribe(listener: (session: Session) => void): () => void
  /** Throws SignInError. */
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>
  /** Forces a fresh ID token, for example after a permission-denied error. */
  refreshClaims(): Promise<void>
}

export const sessionUid = (session: Session): string | null =>
  session.status === 'signedIn' ? session.user.uid : null
