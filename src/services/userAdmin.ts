/** User management types shared by the service, the Users screen, and tests. */
import type { Role, SessionScope } from '../schemas/roles'

export interface MemberSummary {
  uid: string
  displayName: string
  email: string
  role: Role
  active: boolean
}

export interface CreateUserInput {
  email: string
  displayName: string
  role: 'technician' | 'reporter'
}

export type UserAdminErrorKind =
  | 'alreadyExists'
  | 'invalid'
  | 'permission'
  | 'otherSettings'
  | 'notFound'
  | 'network'
  | 'unknown'

export class UserAdminClientError extends Error {
  readonly kind: UserAdminErrorKind

  constructor(kind: UserAdminErrorKind) {
    super(kind)
    this.name = 'UserAdminClientError'
    this.kind = kind
  }
}

export interface UserAdminService {
  listMembers(scope: SessionScope): Promise<MemberSummary[]>
  /** Returns a one-time password reset link for the new user. Throws UserAdminClientError. */
  createUser(input: CreateUserInput): Promise<{ uid: string; passwordResetLink: string }>
  /** Throws UserAdminClientError. */
  setRole(targetUid: string, role: Role): Promise<void>
}
