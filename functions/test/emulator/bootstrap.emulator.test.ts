// Bootstrap and user admin through the real Admin SDK adapters, against the
// Auth and Firestore emulators (FICTIONAL data). Run with `npm run test:emulators`.
import { deleteApp, initializeApp, type App } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createAdminPorts } from '../../src/adminPorts.js'
import { BootstrapRefusal, runBootstrap, type BootstrapOptions } from '../../src/bootstrap.js'
import { createOrgUser, setUserRole } from '../../src/userAdmin.js'
import type { Ports } from '../../src/ports.js'

const PROJECT = 'demo-majipulse'
const ORG = 'kwale-demo'
let app: App
let ports: Ports

const options = (overrides: Partial<BootstrapOptions> = {}): BootstrapOptions => ({
  mode: 'run',
  project: PROJECT,
  confirmProject: PROJECT,
  orgId: ORG,
  orgName: 'Kwale Demo WUA (fictional)',
  county: 'Kwale',
  email: 'admin@example.org',
  adminName: 'Demo Admin',
  demo: true,
  deleteCreatedUser: false,
  ...overrides,
})

const silent = { info: () => undefined, secret: () => undefined }

async function clearEmulators() {
  const fs = process.env.FIRESTORE_EMULATOR_HOST
  const auth = process.env.FIREBASE_AUTH_EMULATOR_HOST
  if (!fs || !auth) throw new Error('Run through `npm run test:emulators` (emulator hosts not set).')
  await fetch(`http://${fs}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await fetch(`http://${auth}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })
}

beforeAll(() => {
  app = initializeApp({ projectId: PROJECT }, 'emulator-test')
  ports = createAdminPorts(app)
})
beforeEach(clearEmulators)
afterAll(async () => {
  await deleteApp(app)
})

describe('bootstrap against the emulators', () => {
  it('creates a complete organization with exactly the expected claims and member', async () => {
    const result = await runBootstrap(ports, options(), silent)
    if (result.outcome !== 'complete') throw new Error('expected complete')
    const user = await getAuth(app).getUser(result.adminUid)
    expect(user.customClaims).toEqual({ organizationId: ORG, role: 'administrator' })
    const member = (await getFirestore(app).doc(`members/${result.adminUid}`).get()).data()
    expect(member).toMatchObject({ organizationId: ORG, role: 'administrator', active: true })
    const org = (await getFirestore(app).doc(`organizations/${ORG}`).get()).data()
    expect(org?.bootstrap).toMatchObject({ status: 'complete', adminUid: result.adminUid })
    await expect(runBootstrap(ports, options(), silent)).rejects.toBeInstanceOf(BootstrapRefusal)
  })

  it('refuses an existing account with unrelated claims and leaves them unchanged', async () => {
    const existing = await getAuth(app).createUser({ email: 'admin@example.org' })
    await getAuth(app).setCustomUserClaims(existing.uid, { beta: true })
    await expect(runBootstrap(ports, options(), silent)).rejects.toThrow(/custom claims/)
    expect((await getAuth(app).getUser(existing.uid)).customClaims).toEqual({ beta: true })
    expect((await getFirestore(app).doc(`organizations/${ORG}`).get()).exists).toBe(false)
  })
})

describe('user admin against the emulators', () => {
  it('creates a user, refuses the same email again, and changes roles for others only', async () => {
    const result = await runBootstrap(ports, options(), silent)
    if (result.outcome !== 'complete') throw new Error('expected complete')
    const admin = { uid: result.adminUid, token: { organizationId: ORG, role: 'administrator' } }

    const created = await createOrgUser(ports, admin, { email: 'tech@example.org', displayName: 'Demo Tech', role: 'technician' })
    expect((await getAuth(app).getUser(created.uid)).customClaims).toEqual({ organizationId: ORG, role: 'technician' })
    await expect(
      createOrgUser(ports, admin, { email: 'tech@example.org', displayName: 'Again', role: 'reporter' }),
    ).rejects.toMatchObject({ code: 'already-exists' })

    await setUserRole(ports, admin, { targetUid: created.uid, role: 'reporter' })
    expect((await getAuth(app).getUser(created.uid)).customClaims).toEqual({ organizationId: ORG, role: 'reporter' })
    await expect(setUserRole(ports, admin, { targetUid: admin.uid, role: 'reporter' })).rejects.toMatchObject({
      code: 'failed-precondition',
    })
  })
})
