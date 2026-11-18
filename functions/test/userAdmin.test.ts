// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { createOrgUser, setUserRole, UserAdminError, type Caller } from '../src/userAdmin.js'
import { FakeBackend } from './fakes.js'

const ORG = 'kwale-demo'
let backend: FakeBackend
let admin: Caller

const callerFor = (uid: string): Caller => {
  const user = backend.users.get(uid)
  return { uid, token: { ...(user?.claims ?? {}) } }
}

async function expectCode(promise: Promise<unknown>, code: UserAdminError['code']) {
  await expect(promise).rejects.toBeInstanceOf(UserAdminError)
  await promise.catch((error: UserAdminError) => expect(error.code).toBe(code))
}

beforeEach(() => {
  backend = new FakeBackend()
  const a = backend.addUser('admin@example.org', { organizationId: ORG, role: 'administrator' }, 'uid-admin')
  backend.addMember(a.uid, ORG, 'administrator')
  admin = callerFor(a.uid)
})

const newUser = { email: 'tech@example.org', displayName: 'Demo Technician', role: 'technician' }

describe('caller checks (both functions)', () => {
  const calls = [
    ['createOrgUser', (c: Caller | null) => createOrgUser(backend.ports(), c, newUser)],
    ['setUserRole', (c: Caller | null) => setUserRole(backend.ports(), c, { targetUid: 'uid-x', role: 'reporter' })],
  ] as const

  it.each(calls)('%s rejects unauthenticated callers', async (_n, call) => {
    await expectCode(call(null), 'unauthenticated')
  })

  it.each(calls)('%s rejects technicians and reporters', async (_n, call) => {
    for (const role of ['technician', 'reporter'] as const) {
      const u = backend.addUser(`${role}@example.org`, { organizationId: ORG, role })
      backend.addMember(u.uid, ORG, role)
      await expectCode(call(callerFor(u.uid)), 'permission-denied')
    }
  })

  it.each(calls)('%s rejects admin claims without a matching active member document', async (_n, call) => {
    const noMember = backend.addUser('ghost@example.org', { organizationId: ORG, role: 'administrator' })
    await expectCode(call(callerFor(noMember.uid)), 'permission-denied')
    const inactive = backend.addUser('inactive@example.org', { organizationId: ORG, role: 'administrator' })
    backend.addMember(inactive.uid, ORG, 'administrator', false)
    await expectCode(call(callerFor(inactive.uid)), 'permission-denied')
    const mismatch = backend.addUser('mismatch@example.org', { organizationId: ORG, role: 'administrator' })
    backend.addMember(mismatch.uid, 'pwani-demo', 'administrator')
    await expectCode(call(callerFor(mismatch.uid)), 'permission-denied')
  })
})

describe('createOrgUser', () => {
  it('creates a user in the caller’s organization with claims, member, and a reset link', async () => {
    const result = await createOrgUser(backend.ports(), admin, newUser)
    expect(result.passwordResetLink).toBe(backend.resetLink)
    expect(backend.users.get(result.uid)?.claims).toEqual({ organizationId: ORG, role: 'technician' })
    expect(backend.members.get(result.uid)).toMatchObject({ organizationId: ORG, role: 'technician', active: true })
  })

  it('ignores any organization in the input: strict input rejects extra keys', async () => {
    await expectCode(createOrgUser(backend.ports(), admin, { ...newUser, organizationId: 'pwani-demo' }), 'invalid-argument')
  })

  it.each([
    [{ ...newUser, role: 'administrator' }],
    [{ ...newUser, email: 'not-an-email' }],
    [{ ...newUser, displayName: ' ' }],
    ['not an object'],
  ])('rejects invalid input %j', async (input) => {
    await expectCode(createOrgUser(backend.ports(), admin, input), 'invalid-argument')
  })

  it('refuses an email that already has an account and leaves it unchanged', async () => {
    const existing = backend.addUser(newUser.email, { organizationId: 'pwani-demo', role: 'reporter' })
    const before = backend.snapshot()
    await expectCode(createOrgUser(backend.ports(), admin, newUser), 'already-exists')
    expect(backend.snapshot()).toBe(before)
    expect(backend.users.get(existing.uid)?.claims).toEqual({ organizationId: 'pwani-demo', role: 'reporter' })
  })

  it('rolls back the new account if a later step fails', async () => {
    backend.failOnce('createMember')
    const before = backend.snapshot()
    await expectCode(createOrgUser(backend.ports(), admin, newUser), 'internal')
    expect(backend.snapshot()).toBe(before)
  })
})

describe('setUserRole', () => {
  let targetUid: string

  beforeEach(() => {
    const t = backend.addUser('reporter@example.org', { organizationId: ORG, role: 'reporter' })
    backend.addMember(t.uid, ORG, 'reporter')
    targetUid = t.uid
  })

  it('changes the role in claims and the member document', async () => {
    const result = await setUserRole(backend.ports(), admin, { targetUid, role: 'technician' })
    expect(result).toEqual({ uid: targetUid, role: 'technician', changed: true })
    expect(backend.users.get(targetUid)?.claims).toEqual({ organizationId: ORG, role: 'technician' })
    expect(backend.members.get(targetUid)?.role).toBe('technician')
  })

  it('reports no change when the role is already set', async () => {
    expect((await setUserRole(backend.ports(), admin, { targetUid, role: 'reporter' })).changed).toBe(false)
  })

  it('rejects changing the caller’s own role', async () => {
    await expectCode(setUserRole(backend.ports(), admin, { targetUid: admin.uid, role: 'reporter' }), 'failed-precondition')
    expect(backend.users.get(admin.uid)?.claims).toEqual({ organizationId: ORG, role: 'administrator' })
  })

  it('rejects a member of another organization as not found', async () => {
    const other = backend.addUser('other@example.org', { organizationId: 'pwani-demo', role: 'reporter' })
    backend.addMember(other.uid, 'pwani-demo', 'reporter')
    const before = backend.snapshot()
    await expectCode(setUserRole(backend.ports(), admin, { targetUid: other.uid, role: 'technician' }), 'not-found')
    expect(backend.snapshot()).toBe(before)
  })

  it('rejects an unknown user as not found', async () => {
    await expectCode(setUserRole(backend.ports(), admin, { targetUid: 'uid-nobody', role: 'technician' }), 'not-found')
  })

  it('refuses a target with unrelated claims and leaves them unchanged', async () => {
    const user = backend.users.get(targetUid)
    if (user) user.claims = { organizationId: ORG, role: 'reporter', beta: true }
    const before = backend.snapshot()
    await expectCode(setUserRole(backend.ports(), admin, { targetUid, role: 'technician' }), 'failed-precondition')
    expect(backend.snapshot()).toBe(before)
  })

  it('refuses a target whose claims point to another organization', async () => {
    const user = backend.users.get(targetUid)
    if (user) user.claims = { organizationId: 'pwani-demo', role: 'reporter' }
    await expectCode(setUserRole(backend.ports(), admin, { targetUid, role: 'technician' }), 'failed-precondition')
  })

  it('reverts the member role if setting claims fails', async () => {
    backend.failOnce('setClaims')
    await expectCode(setUserRole(backend.ports(), admin, { targetUid, role: 'technician' }), 'internal')
    expect(backend.members.get(targetUid)?.role).toBe('reporter')
    expect(backend.users.get(targetUid)?.claims).toEqual({ organizationId: ORG, role: 'reporter' })
  })

  it('rejects invalid input', async () => {
    await expectCode(setUserRole(backend.ports(), admin, { targetUid: 'a/b', role: 'technician' }), 'invalid-argument')
    await expectCode(setUserRole(backend.ports(), admin, { targetUid, role: 'owner' }), 'invalid-argument')
  })
})
