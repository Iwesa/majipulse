/**
 * Narrow interfaces over Firebase Auth and Firestore used by the provisioning
 * logic. The Admin SDK adapter (adminPorts.ts) implements them for real use;
 * tests use in-memory fakes. Timestamps are set by the adapter.
 */
import type { Role } from './domain.js'

export type Claims = Readonly<Record<string, unknown>>

export interface AuthUser {
  uid: string
  email: string | undefined
  /** Custom claims. Empty object when the user has none. */
  customClaims: Claims
}

export interface AuthPort {
  findUserByEmail(email: string): Promise<AuthUser | null>
  getUser(uid: string): Promise<AuthUser | null>
  /** Creates a user without a password. They set one through the reset link. */
  createUser(input: { email: string; displayName: string }): Promise<AuthUser>
  /** Replaces the whole custom-claims map. `null` removes all custom claims. */
  setClaims(uid: string, claims: Claims | null): Promise<void>
  deleteUser(uid: string): Promise<void>
  passwordResetLink(email: string): Promise<string>
}

export interface MemberRecord {
  organizationId: string
  role: Role
  email: string
  displayName: string
  active: boolean
}

export interface BootstrapState {
  status: 'in_progress' | 'complete'
  adminUid?: string
  userCreatedByBootstrap?: boolean
}

export interface OrganizationRecord {
  name: string
  county: string
  demo: boolean
  bootstrap: BootstrapState
}

export interface StorePort {
  getMember(uid: string): Promise<MemberRecord | null>
  /** Throws AlreadyExistsError if the document exists. */
  createMember(uid: string, member: MemberRecord): Promise<void>
  setMemberRole(uid: string, role: Role): Promise<void>
  deleteMember(uid: string): Promise<void>
  listMemberUids(organizationId: string): Promise<string[]>
  getOrganization(organizationId: string): Promise<OrganizationRecord | null>
  /** Throws AlreadyExistsError if the document exists. */
  createOrganization(organizationId: string, organization: OrganizationRecord): Promise<void>
  updateBootstrap(organizationId: string, patch: Partial<BootstrapState>): Promise<void>
  deleteOrganization(organizationId: string): Promise<void>
}

export interface Ports {
  auth: AuthPort
  store: StorePort
}

export class AlreadyExistsError extends Error {
  constructor(what: string) {
    super(`${what} already exists`)
    this.name = 'AlreadyExistsError'
  }
}
