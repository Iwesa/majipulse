/** In-memory fakes of the provisioning ports, with failure injection. */
import type { Role } from '../src/domain.js'
import {
  AlreadyExistsError,
  type AuthUser,
  type BootstrapState,
  type Claims,
  type MemberRecord,
  type OrganizationRecord,
  type Ports,
} from '../src/ports.js'

export type Operation =
  | 'createUser'
  | 'setClaims'
  | 'deleteUser'
  | 'passwordResetLink'
  | 'createMember'
  | 'setMemberRole'
  | 'deleteMember'
  | 'createOrganization'
  | 'updateBootstrap'
  | 'deleteOrganization'
  | 'getUser'

interface FakeUser {
  uid: string
  email: string
  displayName: string
  claims: Claims
}

export class FakeBackend {
  users = new Map<string, FakeUser>()
  members = new Map<string, MemberRecord>()
  organizations = new Map<string, OrganizationRecord>()
  /** Every write, in order, for assertions. */
  writes: string[] = []
  /** Operations that throw the next time they run. */
  private failNext = new Set<Operation>()
  /** Called before an operation runs, to simulate concurrent changes. */
  private hooks = new Map<Operation, () => void>()
  private nextUid = 1
  readonly resetLink = 'https://example.org/reset?oobCode=FAKE-RESET-CODE'

  failOnce(op: Operation): this {
    this.failNext.add(op)
    return this
  }

  before(op: Operation, hook: () => void): this {
    this.hooks.set(op, hook)
    return this
  }

  addUser(email: string, claims: Claims = {}, uid = `uid-${this.nextUid++}`): FakeUser {
    const user = { uid, email, displayName: email, claims }
    this.users.set(uid, user)
    return user
  }

  addMember(uid: string, organizationId: string, role: Role, active = true): void {
    const user = this.users.get(uid)
    this.members.set(uid, { organizationId, role, email: user?.email ?? `${uid}@example.org`, displayName: uid, active })
  }

  private run(op: Operation): void {
    const hook = this.hooks.get(op)
    if (hook) {
      this.hooks.delete(op)
      hook()
    }
    if (this.failNext.delete(op)) throw new Error(`Injected failure: ${op}`)
  }

  private write(op: Operation, detail: string): void {
    this.run(op)
    this.writes.push(`${op} ${detail}`)
  }

  private toAuthUser(u: FakeUser): AuthUser {
    return { uid: u.uid, email: u.email, customClaims: { ...u.claims } }
  }

  ports(): Ports {
    return {
      auth: {
        findUserByEmail: async (email) => {
          const u = [...this.users.values()].find((x) => x.email === email)
          return u ? this.toAuthUser(u) : null
        },
        getUser: async (uid) => {
          this.run('getUser')
          const u = this.users.get(uid)
          return u ? this.toAuthUser(u) : null
        },
        createUser: async ({ email, displayName }) => {
          this.write('createUser', email)
          const u = { uid: `uid-${this.nextUid++}`, email, displayName, claims: {} }
          this.users.set(u.uid, u)
          return this.toAuthUser(u)
        },
        setClaims: async (uid, claims) => {
          this.write('setClaims', uid)
          const u = this.users.get(uid)
          if (!u) throw new Error('no user')
          u.claims = claims === null ? {} : { ...claims }
        },
        deleteUser: async (uid) => {
          this.write('deleteUser', uid)
          this.users.delete(uid)
        },
        passwordResetLink: async () => {
          this.run('passwordResetLink')
          return this.resetLink
        },
      },
      store: {
        getMember: async (uid) => {
          const m = this.members.get(uid)
          return m ? { ...m } : null
        },
        createMember: async (uid, member) => {
          this.write('createMember', uid)
          if (this.members.has(uid)) throw new AlreadyExistsError(`members/${uid}`)
          this.members.set(uid, { ...member })
        },
        setMemberRole: async (uid, role) => {
          this.write('setMemberRole', `${uid} ${role}`)
          const m = this.members.get(uid)
          if (!m) throw new Error('no member')
          m.role = role
        },
        deleteMember: async (uid) => {
          this.write('deleteMember', uid)
          this.members.delete(uid)
        },
        listMemberUids: async (organizationId) =>
          [...this.members.entries()].filter(([, m]) => m.organizationId === organizationId).map(([uid]) => uid),
        getOrganization: async (id) => {
          const o = this.organizations.get(id)
          return o ? { ...o, bootstrap: { ...o.bootstrap } } : null
        },
        createOrganization: async (id, org) => {
          this.write('createOrganization', id)
          if (this.organizations.has(id)) throw new AlreadyExistsError(`organizations/${id}`)
          this.organizations.set(id, { ...org, bootstrap: { ...org.bootstrap } })
        },
        updateBootstrap: async (id, patch: Partial<BootstrapState>) => {
          this.write('updateBootstrap', `${id} ${JSON.stringify(patch)}`)
          const o = this.organizations.get(id)
          if (!o) throw new Error('no org')
          o.bootstrap = { ...o.bootstrap, ...patch }
        },
        deleteOrganization: async (id) => {
          this.write('deleteOrganization', id)
          this.organizations.delete(id)
        },
      },
    }
  }

  /** Snapshot for "nothing changed" assertions. */
  snapshot(): string {
    return JSON.stringify({
      users: [...this.users.entries()],
      members: [...this.members.entries()],
      organizations: [...this.organizations.entries()],
    })
  }
}
