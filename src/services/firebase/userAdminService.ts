import { getDocs, type Firestore } from 'firebase/firestore'
import { httpsCallable, type Functions } from 'firebase/functions'
import { z } from 'zod'
import { memberSchema } from '../../schemas/organization'
import type { Role } from '../../schemas/roles'
import {
  UserAdminClientError,
  type CreateUserInput,
  type MemberSummary,
  type UserAdminErrorKind,
  type UserAdminService,
} from '../userAdmin'
import { orgScopedQuery } from './queries'
import { timestampsToIso } from './timestamps'

const createUserResultSchema = z.object({ uid: z.string().min(1), passwordResetLink: z.url() })

/** Maps callable error codes (functions/<code>) to UI error kinds. */
export function userAdminErrorKind(error: unknown, operation: 'create' | 'setRole'): UserAdminErrorKind {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : ''
  switch (code.replace(/^functions\//, '')) {
    case 'already-exists':
      return 'alreadyExists'
    case 'invalid-argument':
      return 'invalid'
    case 'unauthenticated':
    case 'permission-denied':
      return 'permission'
    case 'failed-precondition':
      return operation === 'setRole' ? 'otherSettings' : 'unknown'
    case 'not-found':
      return 'notFound'
    case 'unavailable':
    case 'deadline-exceeded':
      return 'network'
    default:
      return 'unknown'
  }
}

export function createFirebaseUserAdminService(db: Firestore, functions: Functions): UserAdminService {
  const createOrgUser = httpsCallable<CreateUserInput, unknown>(functions, 'createOrgUser')
  const setUserRole = httpsCallable<{ targetUid: string; role: Role }, unknown>(functions, 'setUserRole')

  return {
    async listMembers(scope) {
      const snap = await getDocs(orgScopedQuery(db, 'members', scope.organizationId))
      const members: MemberSummary[] = []
      for (const docSnap of snap.docs) {
        const parsed = memberSchema.safeParse(timestampsToIso(docSnap.data()))
        if (!parsed.success) continue
        const { displayName, email, role, active } = parsed.data
        members.push({ uid: docSnap.id, displayName, email, role, active })
      }
      return members.sort((a, b) => a.displayName.localeCompare(b.displayName))
    },
    async createUser(input) {
      try {
        const result = await createOrgUser(input)
        return createUserResultSchema.parse(result.data)
      } catch (error) {
        throw new UserAdminClientError(userAdminErrorKind(error, 'create'))
      }
    },
    async setRole(targetUid, role) {
      try {
        await setUserRole({ targetUid, role })
      } catch (error) {
        throw new UserAdminClientError(userAdminErrorKind(error, 'setRole'))
      }
    },
  }
}
