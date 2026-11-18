import type { User } from 'firebase/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// resolveSession reads members/{uid} and organizations/{org}; mock the reads.
const docs = new Map<string, Record<string, unknown> | Error>()
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => `${collection}/${id}`,
  getDoc: async (path: string) => {
    const value = docs.get(path)
    if (value instanceof Error) throw value
    return { exists: () => value !== undefined, data: () => value }
  },
}))

const { resolveSession } = await import('./authService')

const user = (claims: Record<string, unknown>) =>
  ({
    uid: 'uid-1',
    email: 'reporter@example.org',
    displayName: 'Demo Reporter',
    getIdTokenResult: async () => ({ claims: { iss: 'x', aud: 'y', ...claims } }),
  }) as unknown as User

const claims = { organizationId: 'kwale-demo', role: 'reporter' }
const member = { organizationId: 'kwale-demo', role: 'reporter', active: true }

beforeEach(() => {
  docs.clear()
  docs.set('members/uid-1', member)
  docs.set('organizations/kwale-demo', { name: 'Kwale Demo WUA (fictional)', demo: true })
})
afterEach(() => {
  docs.clear()
})

describe('resolveSession', () => {
  it('builds a session from claims, member, and organization', async () => {
    const session = await resolveSession(user(claims), {} as never)
    expect(session).toEqual({
      status: 'signedIn',
      user: {
        uid: 'uid-1',
        email: 'reporter@example.org',
        displayName: 'Demo Reporter',
        organizationId: 'kwale-demo',
        role: 'reporter',
        organizationName: 'Kwale Demo WUA (fictional)',
        organizationDemo: true,
        scope: { organizationId: 'kwale-demo', ownerUid: 'uid-1' },
      },
    })
  })

  it.each([
    [{}, 'noClaims'],
    [{ organizationId: 'kwale-demo' }, 'noClaims'],
    [{ organizationId: 'kwale-demo', role: 'owner' }, 'noClaims'],
    [{ organizationId: 'Not Valid', role: 'reporter' }, 'noClaims'],
  ])('claims %j -> %s', async (c, reason) => {
    expect(await resolveSession(user(c), {} as never)).toMatchObject({ status: 'noAccess', reason })
  })

  it('reports a missing member document', async () => {
    docs.delete('members/uid-1')
    expect(await resolveSession(user(claims), {} as never)).toMatchObject({ status: 'noAccess', reason: 'noMember' })
  })

  it('reports an inactive member', async () => {
    docs.set('members/uid-1', { ...member, active: false })
    expect(await resolveSession(user(claims), {} as never)).toMatchObject({ status: 'noAccess', reason: 'inactive' })
  })

  it('reports claims that do not match the member document', async () => {
    docs.set('members/uid-1', { ...member, role: 'technician' })
    expect(await resolveSession(user(claims), {} as never)).toMatchObject({ status: 'noAccess', reason: 'mismatch' })
  })

  it('keeps working from verified claims when offline (R1.3)', async () => {
    docs.set('members/uid-1', Object.assign(new Error('offline'), { code: 'unavailable' }))
    const session = await resolveSession(user(claims), {} as never)
    expect(session).toMatchObject({ status: 'signedIn', user: { role: 'reporter', organizationName: null } })
  })

  it('does not hide permission errors', async () => {
    docs.set('members/uid-1', Object.assign(new Error('denied'), { code: 'permission-denied' }))
    await expect(resolveSession(user(claims), {} as never)).rejects.toThrow('denied')
  })
})
