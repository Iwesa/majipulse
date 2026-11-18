import {
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type Auth,
  type User,
} from 'firebase/auth'
import { doc, getDoc, type Firestore } from 'firebase/firestore'
import { sessionClaimsSchema } from '../../schemas/roles'
import { SignInError, type AuthService, type Session, type SignInErrorKind } from '../session'

const errorCode = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : ''

/** Maps Firebase Auth errors to kinds without revealing whether an account exists. */
export function signInErrorKind(error: unknown): SignInErrorKind {
  switch (errorCode(error)) {
    case 'auth/invalid-credential':
    case 'auth/invalid-email':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/user-disabled':
      return 'invalidCredentials'
    case 'auth/network-request-failed':
      return 'network'
    case 'auth/too-many-requests':
      return 'tooManyAttempts'
    default:
      return 'unknown'
  }
}

/** True when a read failed for lack of connectivity rather than permission. */
const isOfflineError = (error: unknown) => errorCode(error) === 'unavailable'

/**
 * Builds the session from verified ID token claims plus the member document.
 * Rules enforce access either way; this only decides what the UI shows.
 */
export async function resolveSession(user: User, db: Firestore): Promise<Session> {
  const token = await user.getIdTokenResult()
  const parsed = sessionClaimsSchema.safeParse({
    organizationId: token.claims.organizationId,
    role: token.claims.role,
  })
  if (!parsed.success) return { status: 'noAccess', reason: 'noClaims', email: user.email }
  const { organizationId, role } = parsed.data

  let organizationName: string | null = null
  let organizationDemo = false
  try {
    const member = await getDoc(doc(db, 'members', user.uid))
    if (!member.exists()) return { status: 'noAccess', reason: 'noMember', email: user.email }
    const m = member.data()
    if (m.active !== true) return { status: 'noAccess', reason: 'inactive', email: user.email }
    if (m.organizationId !== organizationId || m.role !== role) {
      return { status: 'noAccess', reason: 'mismatch', email: user.email }
    }
    const org = await getDoc(doc(db, 'organizations', organizationId))
    if (org.exists()) {
      organizationName = typeof org.data().name === 'string' ? org.data().name : null
      organizationDemo = org.data().demo === true
    }
  } catch (error) {
    // Offline after load (R1.3): keep working from the verified claims.
    if (!isOfflineError(error)) throw error
  }

  return {
    status: 'signedIn',
    user: {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      organizationId,
      role,
      organizationName,
      organizationDemo,
      scope: { organizationId, ownerUid: user.uid },
    },
  }
}

export function createFirebaseAuthService(auth: Auth, db: Firestore): AuthService {
  return {
    subscribe(listener) {
      listener({ status: 'loading' })
      // onIdTokenChanged also fires when claims refresh, unlike onAuthStateChanged.
      return onIdTokenChanged(auth, (user) => {
        if (!user) {
          listener({ status: 'signedOut' })
          return
        }
        resolveSession(user, db).then(listener, () =>
          listener({ status: 'noAccess', reason: 'noMember', email: user.email }),
        )
      })
    },
    async signIn(email, password) {
      try {
        await signInWithEmailAndPassword(auth, email, password)
      } catch (error) {
        throw new SignInError(signInErrorKind(error))
      }
    },
    async signOut() {
      await firebaseSignOut(auth)
    },
    async refreshClaims() {
      await auth.currentUser?.getIdToken(true)
    },
  }
}
