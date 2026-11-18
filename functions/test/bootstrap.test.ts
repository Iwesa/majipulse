// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { BootstrapRefusal, runBootstrap, type BootstrapOptions } from '../src/bootstrap.js'
import { FakeBackend, type Operation } from './fakes.js'

const ORG = 'kwale-demo'
const EMAIL = 'admin@example.org'
const ADMIN_CLAIMS = { organizationId: ORG, role: 'administrator' }

const options = (overrides: Partial<BootstrapOptions> = {}): BootstrapOptions => ({
  mode: 'run',
  project: 'demo-majipulse',
  confirmProject: 'demo-majipulse',
  orgId: ORG,
  orgName: 'Kwale Demo WUA (fictional)',
  county: 'Kwale',
  email: EMAIL,
  adminName: 'Demo Admin',
  demo: true,
  deleteCreatedUser: false,
  ...overrides,
})

class Out {
  lines: string[] = []
  secrets: string[] = []
  info = (m: string) => {
    this.lines.push(m)
  }
  secret = (_label: string, value: string) => {
    this.secrets.push(value)
  }
}

let backend: FakeBackend
let out: Out
const run = (o: Partial<BootstrapOptions> = {}) => runBootstrap(backend.ports(), options(o), out)

/** Asserts a refusal that leaves the backend exactly as it was. */
async function expectRefusalWithoutChanges(o: Partial<BootstrapOptions>, message: RegExp) {
  const before = backend.snapshot()
  await expect(run(o)).rejects.toThrow(BootstrapRefusal)
  await expect(run(o)).rejects.toThrow(message)
  expect(backend.snapshot()).toBe(before)
}

const adminCount = () => [...backend.members.values()].filter((m) => m.organizationId === ORG && m.role === 'administrator').length

beforeEach(() => {
  backend = new FakeBackend()
  out = new Out()
})

describe('fresh run', () => {
  it('creates the organization, user, claims, and member, then completes', async () => {
    const result = await run()
    expect(result.outcome).toBe('complete')
    const uid = result.outcome === 'complete' ? result.adminUid : ''
    expect(backend.users.get(uid)?.claims).toEqual(ADMIN_CLAIMS)
    expect(backend.members.get(uid)).toMatchObject({ organizationId: ORG, role: 'administrator', active: true })
    expect(backend.organizations.get(ORG)?.bootstrap).toEqual({ status: 'complete', adminUid: uid, userCreatedByBootstrap: true })
  })

  it('prints the reset link exactly once and no other secrets or claim values', async () => {
    await run()
    expect(out.secrets).toEqual([backend.resetLink])
    const printed = out.lines.join('\n')
    expect(printed).not.toContain('oobCode')
    expect(printed).not.toContain('administrator"')
  })

  it('refuses a second run for the same organization', async () => {
    await run()
    await expectRefusalWithoutChanges({}, /already bootstrapped/)
  })

  it('refuses mismatched --confirm-project before reading anything', async () => {
    await expectRefusalWithoutChanges({ confirmProject: 'other-project' }, /do not match/)
  })

  it('reuses a clean existing account and records that it was not created by the bootstrap', async () => {
    const existing = backend.addUser(EMAIL)
    await run()
    expect(backend.users.get(existing.uid)?.claims).toEqual(ADMIN_CLAIMS)
    expect(backend.organizations.get(ORG)?.bootstrap.userCreatedByBootstrap).toBe(false)
  })
})

describe('existing-user guard (AC22)', () => {
  it('(a) refuses a user who is a member of another organization, and does not create the org', async () => {
    const other = backend.addUser(EMAIL, { organizationId: 'pwani-demo', role: 'reporter' })
    backend.addMember(other.uid, 'pwani-demo', 'reporter')
    await expectRefusalWithoutChanges({}, /already a member/)
    expect(backend.organizations.has(ORG)).toBe(false)
  })

  it('(b) refuses a user with another organization’s claims but no member document', async () => {
    const other = backend.addUser(EMAIL, { organizationId: 'pwani-demo', role: 'technician' })
    await expectRefusalWithoutChanges({}, /custom claims \(keys: organizationId, role\)/)
    expect(backend.users.get(other.uid)?.claims).toEqual({ organizationId: 'pwani-demo', role: 'technician' })
  })

  it('(c) refuses a user with unrelated claims only', async () => {
    const other = backend.addUser(EMAIL, { beta: true })
    await expectRefusalWithoutChanges({}, /keys: beta/)
    expect(backend.users.get(other.uid)?.claims).toEqual({ beta: true })
  })

  it('(d) stops at step 4 without writing when claims appear after preflight', async () => {
    const existing = backend.addUser(EMAIL)
    backend.before('getUser', () => {
      existing.claims = { beta: true }
    })
    await expect(run()).rejects.toThrow(/gained custom claims/)
    expect(backend.users.get(existing.uid)?.claims).toEqual({ beta: true })
    expect(backend.writes.some((w) => w.startsWith('setClaims'))).toBe(false)
    expect(backend.members.has(existing.uid)).toBe(false)
  })

  it('refuses admin claims for an organization that does not exist, with instructions', async () => {
    backend.addUser(EMAIL, ADMIN_CLAIMS)
    await expectRefusalWithoutChanges({}, /Remove the custom claims .* run again/)
  })
})

describe('partial failure and resume (AC20)', () => {
  // A failure right after step N, injected into the first write of step N + 1.
  const cases: Array<[step: number, failingOp: Operation | 'markComplete']> = [
    [3, 'setClaims'], // account created and recorded, claims not set
    [4, 'createMember'], // claims set, no member document
    [5, 'passwordResetLink'], // member created, no link yet
    [6, 'markComplete'], // link printed, not marked complete
  ]

  it.each(cases)('resumes after a failure following step %i to exactly one administrator', async (_step, op) => {
    if (op === 'markComplete') {
      // updateBootstrap also runs in step 3; fail its second call (step 7).
      let calls = 0
      const ports = backend.ports()
      const original = ports.store.updateBootstrap
      ports.store.updateBootstrap = async (id, patch) => {
        calls += 1
        if (calls === 2) throw new Error('Injected failure: step 7')
        return original(id, patch)
      }
      await expect(runBootstrap(ports, options(), out)).rejects.toThrow('Injected failure')
    } else {
      backend.failOnce(op)
      await expect(run()).rejects.toThrow('Injected failure')
    }
    expect(backend.organizations.get(ORG)?.bootstrap.status).toBe('in_progress')

    out = new Out()
    const result = await run({ mode: 'resume' })
    expect(result.outcome).toBe('complete')
    expect(backend.organizations.get(ORG)?.bootstrap.status).toBe('complete')
    expect(adminCount()).toBe(1)
    expect(backend.users.size).toBe(1)
    expect(out.secrets).toEqual([backend.resetLink])
  })

  it('resumes when the account was never created (failure at step 3)', async () => {
    backend.failOnce('createUser')
    await expect(run()).rejects.toThrow('Injected failure')
    expect(backend.users.size).toBe(0)
    await run({ mode: 'resume' })
    expect(adminCount()).toBe(1)
    expect(backend.organizations.get(ORG)?.bootstrap.userCreatedByBootstrap).toBe(true)
  })

  it('a fresh run refuses an in-progress bootstrap and points to --resume', async () => {
    backend.failOnce('setClaims')
    await expect(run()).rejects.toThrow('Injected failure')
    await expectRefusalWithoutChanges({}, /--resume/)
  })

  it('refuses when the email now belongs to a different account than the recorded adminUid', async () => {
    backend.failOnce('setClaims')
    await expect(run()).rejects.toThrow('Injected failure')
    const recorded = backend.organizations.get(ORG)?.bootstrap.adminUid ?? ''
    backend.users.delete(recorded)
    backend.addUser(EMAIL)
    await expectRefusalWithoutChanges({ mode: 'resume' }, /different account/)
  })

  it.each([
    ['another organization', { organizationId: 'pwani-demo', role: 'administrator' }],
    ['extra keys', { ...ADMIN_CLAIMS, beta: true }],
  ])('refuses resume when the recorded admin’s claims changed to %s', async (_label, claims) => {
    backend.failOnce('createMember')
    await expect(run()).rejects.toThrow('Injected failure')
    const uid = backend.organizations.get(ORG)?.bootstrap.adminUid ?? ''
    const user = backend.users.get(uid)
    if (user) user.claims = claims
    await expectRefusalWithoutChanges({ mode: 'resume' }, /changed outside this script/)
  })

  it('refuses resume when nothing was started or it is already complete', async () => {
    await expectRefusalWithoutChanges({ mode: 'resume' }, /nothing to resume/)
    await run()
    await expectRefusalWithoutChanges({ mode: 'resume' }, /already bootstrapped/)
  })
})

describe('cleanup', () => {
  const failAfterClaims = async () => {
    backend.failOnce('createMember')
    await expect(run()).rejects.toThrow('Injected failure')
    return backend.organizations.get(ORG)?.bootstrap.adminUid ?? ''
  }

  it('requires --confirm-org to match', async () => {
    await failAfterClaims()
    await expectRefusalWithoutChanges({ mode: 'cleanup' }, /--confirm-org/)
    await expectRefusalWithoutChanges({ mode: 'cleanup', confirmOrg: 'other-org' }, /--confirm-org/)
  })

  it('removes only bootstrap-created data and keeps the account by default', async () => {
    const uid = await failAfterClaims()
    await run({ mode: 'cleanup', confirmOrg: ORG })
    expect(backend.organizations.has(ORG)).toBe(false)
    expect(backend.users.get(uid)?.claims).toEqual({})
    expect(backend.users.has(uid)).toBe(true)
  })

  it('deletes the account only if the bootstrap created it and --delete-created-user is set', async () => {
    const uid = await failAfterClaims()
    await run({ mode: 'cleanup', confirmOrg: ORG, deleteCreatedUser: true })
    expect(backend.users.has(uid)).toBe(false)
  })

  it('never deletes a pre-existing account', async () => {
    const existing = backend.addUser(EMAIL)
    backend.failOnce('createMember')
    await expect(run()).rejects.toThrow('Injected failure')
    await run({ mode: 'cleanup', confirmOrg: ORG, deleteCreatedUser: true })
    expect(backend.users.has(existing.uid)).toBe(true)
    expect(out.lines.join('\n')).toMatch(/existed before/)
  })

  it('leaves claims that are not exactly the bootstrap claims', async () => {
    const uid = await failAfterClaims()
    const user = backend.users.get(uid)
    if (user) user.claims = { ...ADMIN_CLAIMS, beta: true }
    await run({ mode: 'cleanup', confirmOrg: ORG })
    expect(backend.users.get(uid)?.claims).toEqual({ ...ADMIN_CLAIMS, beta: true })
  })

  it('refuses when other members exist', async () => {
    await failAfterClaims()
    const other = backend.addUser('tech@example.org', { organizationId: ORG, role: 'technician' })
    backend.addMember(other.uid, ORG, 'technician')
    await expectRefusalWithoutChanges({ mode: 'cleanup', confirmOrg: ORG }, /other members/)
  })

  it('refuses to clean up a completed organization', async () => {
    await run()
    await expectRefusalWithoutChanges({ mode: 'cleanup', confirmOrg: ORG }, /unfinished/)
  })
})
