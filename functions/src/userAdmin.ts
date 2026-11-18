/**
 * Administrator-only user management (createOrgUser, setUserRole).
 * Pure logic over ports; index.ts wires it to callable functions.
 */
import {
  createOrgUserInputSchema,
  hasOnlyOrgClaimKeys,
  orgClaims,
  setUserRoleInputSchema,
  type Role,
} from './domain.js'
import type { Ports } from './ports.js'

export type UserAdminErrorCode =
  | 'unauthenticated'
  | 'permission-denied'
  | 'invalid-argument'
  | 'already-exists'
  | 'not-found'
  | 'failed-precondition'
  | 'internal'

/** Errors with plain-language messages that are safe to return to the caller. */
export class UserAdminError extends Error {
  readonly code: UserAdminErrorCode

  constructor(code: UserAdminErrorCode, message: string) {
    super(message)
    this.name = 'UserAdminError'
    this.code = code
  }
}

export interface Caller {
  uid: string
  /** Verified ID token claims. */
  token: Readonly<Record<string, unknown>>
}

/**
 * The caller must hold administrator claims AND an active member document
 * that matches them, the same check the security rules make.
 */
async function requireAdministrator(ports: Ports, caller: Caller | null): Promise<string> {
  if (!caller) throw new UserAdminError('unauthenticated', 'Sign in to manage users.')
  const { organizationId, role } = caller.token
  if (typeof organizationId !== 'string' || role !== 'administrator') {
    throw new UserAdminError('permission-denied', 'Only administrators can manage users.')
  }
  const member = await ports.store.getMember(caller.uid)
  if (!member || !member.active || member.organizationId !== organizationId || member.role !== 'administrator') {
    throw new UserAdminError('permission-denied', 'Only administrators can manage users.')
  }
  return organizationId
}

export interface CreateOrgUserResult {
  uid: string
  passwordResetLink: string
}

export async function createOrgUser(ports: Ports, caller: Caller | null, rawInput: unknown): Promise<CreateOrgUserResult> {
  const organizationId = await requireAdministrator(ports, caller)
  const parsed = createOrgUserInputSchema.safeParse(rawInput)
  if (!parsed.success) throw new UserAdminError('invalid-argument', 'Check the email, name, and role.')
  const input = parsed.data

  // Never take over an existing account: it may belong to another organization
  // or carry claims that setClaims would overwrite (R11.10).
  if (await ports.auth.findUserByEmail(input.email)) {
    throw new UserAdminError('already-exists', 'An account with this email already exists.')
  }

  const user = await ports.auth.createUser({ email: input.email, displayName: input.displayName })
  let memberCreated = false
  try {
    await ports.auth.setClaims(user.uid, orgClaims(organizationId, input.role))
    await ports.store.createMember(user.uid, {
      organizationId,
      role: input.role,
      email: input.email,
      displayName: input.displayName,
      active: true,
    })
    memberCreated = true
    const passwordResetLink = await ports.auth.passwordResetLink(input.email)
    return { uid: user.uid, passwordResetLink }
  } catch {
    // Roll back only what this call created.
    if (memberCreated) await ports.store.deleteMember(user.uid).catch(() => undefined)
    await ports.auth.deleteUser(user.uid).catch(() => undefined)
    throw new UserAdminError('internal', 'The account could not be created. Try again.')
  }
}

export interface SetUserRoleResult {
  uid: string
  role: Role
  changed: boolean
}

export async function setUserRole(ports: Ports, caller: Caller | null, rawInput: unknown): Promise<SetUserRoleResult> {
  const organizationId = await requireAdministrator(ports, caller)
  const parsed = setUserRoleInputSchema.safeParse(rawInput)
  if (!parsed.success) throw new UserAdminError('invalid-argument', 'Check the user and role.')
  const { targetUid, role } = parsed.data

  if (caller && targetUid === caller.uid) {
    throw new UserAdminError('failed-precondition', 'You cannot change your own role.')
  }

  // Same message for "missing" and "other organization" so membership elsewhere is not revealed.
  const member = await ports.store.getMember(targetUid)
  const user = member?.organizationId === organizationId ? await ports.auth.getUser(targetUid) : null
  if (!member || !user || member.organizationId !== organizationId) {
    throw new UserAdminError('not-found', 'This user is not a member of your organization.')
  }

  // Claims are replaced as a whole, so refuse if anything besides MajiPulse claims is present.
  if (!hasOnlyOrgClaimKeys(user.customClaims) || user.customClaims.organizationId !== organizationId) {
    throw new UserAdminError(
      'failed-precondition',
      'This account has other account settings. Ask the project owner to review it before changing the role.',
    )
  }

  if (member.role === role && user.customClaims.role === role) {
    return { uid: targetUid, role, changed: false }
  }

  await ports.store.setMemberRole(targetUid, role)
  try {
    await ports.auth.setClaims(targetUid, orgClaims(organizationId, role))
  } catch {
    await ports.store.setMemberRole(targetUid, member.role).catch(() => undefined)
    throw new UserAdminError('internal', 'The role could not be changed. Try again.')
  }
  return { uid: targetUid, role, changed: true }
}
