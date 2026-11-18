// createOrgUser and setUserRole through the Functions emulator over HTTP
// (callable protocol), with real Auth emulator ID tokens. FICTIONAL data.
//
// App Check in the emulator (verified): with enforceAppCheck: true, a request
// WITHOUT an X-Firebase-AppCheck header is rejected (401 UNAUTHENTICATED), but
// the emulator does not verify the token itself, so any non-empty value passes.
// Rejection of invalid tokens can only be checked in a deployed project (T9.1).
import { deleteApp, initializeApp, type App } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAdminPorts } from '../../src/adminPorts.js'
import { runBootstrap } from '../../src/bootstrap.js'

const PROJECT = 'demo-majipulse'
const REGION = 'africa-south1'
const PASSWORD = 'demo-password-123'
/** Any value passes the emulator's App Check presence check. */
const EMULATOR_APP_CHECK = { 'X-Firebase-AppCheck': 'emulator-placeholder-token' }

let app: App
let adminUid = ''
let adminToken = ''

const hosts = () => {
  const auth = process.env.FIREBASE_AUTH_EMULATOR_HOST
  const fs = process.env.FIRESTORE_EMULATOR_HOST
  if (!auth || !fs) throw new Error('Run through `npm run test:emulators`.')
  return { auth, fs, functions: '127.0.0.1:5001' }
}

async function signIn(email: string): Promise<string> {
  const res = await fetch(
    `http://${hosts().auth}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }) },
  )
  const body = (await res.json()) as { idToken?: string }
  if (!body.idToken) throw new Error(`sign-in failed for ${email}`)
  return body.idToken
}

type CallResult = { status: number; body: { result?: Record<string, unknown>; error?: { status: string; message: string } } }

async function call(name: string, data: unknown, headers: Record<string, string>): Promise<CallResult> {
  const res = await fetch(`http://${hosts().functions}/${PROJECT}/${REGION}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ data }),
  })
  return { status: res.status, body: (await res.json()) as CallResult['body'] }
}

const as = (token: string) => ({ Authorization: `Bearer ${token}`, ...EMULATOR_APP_CHECK })

beforeAll(async () => {
  const h = hosts()
  await fetch(`http://${h.fs}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await fetch(`http://${h.auth}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })
  app = initializeApp({ projectId: PROJECT }, 'callables-test')
  const result = await runBootstrap(
    createAdminPorts(app),
    {
      mode: 'run', project: PROJECT, confirmProject: PROJECT, orgId: 'kwale-demo', orgName: 'Kwale Demo (fictional)',
      county: 'Kwale', email: 'admin@example.org', adminName: 'Demo Admin', demo: true, deleteCreatedUser: false,
    },
    { info: () => undefined, secret: () => undefined },
  )
  if (result.outcome !== 'complete') throw new Error('bootstrap failed')
  adminUid = result.adminUid
  await getAuth(app).updateUser(adminUid, { password: PASSWORD })
  adminToken = await signIn('admin@example.org')
  // Warm up: each function's first request starts its worker, and loading
  // firebase-admin can take tens of seconds on a busy machine. Unauthenticated
  // calls are rejected without side effects.
  await Promise.all(['createOrgUser', 'setUserRole'].map((name) => call(name, {}, {})))
}, 300_000)

afterAll(async () => {
  await deleteApp(app)
})

describe('App Check enforcement in the emulator', () => {
  it.each(['createOrgUser', 'setUserRole'])('%s rejects a request without an App Check token', async (name) => {
    const res = await call(name, { email: 'x@example.org', displayName: 'X', role: 'reporter' }, { Authorization: `Bearer ${adminToken}` })
    expect(res.status).toBe(401)
    expect(res.body.error?.status).toBe('UNAUTHENTICATED')
  })

  it.each(['createOrgUser', 'setUserRole'])('%s rejects a request without an ID token', async (name) => {
    const res = await call(name, { targetUid: 'x', role: 'reporter' }, EMULATOR_APP_CHECK)
    expect(res.status).toBe(401)
    expect(res.body.error?.status).toBe('UNAUTHENTICATED')
  })
})

describe('callables end to end (AC22)', () => {
  it('administrator creates a technician; the email cannot be used again', async () => {
    const created = await call('createOrgUser', { email: 'tech@example.org', displayName: 'Demo Tech', role: 'technician' }, as(adminToken))
    expect(created.status).toBe(200)
    const uid = String(created.body.result?.uid)
    expect((await getAuth(app).getUser(uid)).customClaims).toEqual({ organizationId: 'kwale-demo', role: 'technician' })
    expect(String(created.body.result?.passwordResetLink)).toContain('resetPassword')

    const again = await call('createOrgUser', { email: 'tech@example.org', displayName: 'Again', role: 'reporter' }, as(adminToken))
    expect(again.body.error?.status).toBe('ALREADY_EXISTS')
  })

  it('a technician cannot manage users', async () => {
    const created = await call('createOrgUser', { email: 'tech2@example.org', displayName: 'Demo Tech 2', role: 'technician' }, as(adminToken))
    const uid = String(created.body.result?.uid)
    await getAuth(app).updateUser(uid, { password: PASSWORD })
    const techToken = await signIn('tech2@example.org')
    const res = await call('createOrgUser', { email: 'r@example.org', displayName: 'R', role: 'reporter' }, as(techToken))
    expect(res.body.error?.status).toBe('PERMISSION_DENIED')
    const role = await call('setUserRole', { targetUid: adminUid, role: 'reporter' }, as(techToken))
    expect(role.body.error?.status).toBe('PERMISSION_DENIED')
  })

  it('administrator changes another user’s role but not their own', async () => {
    const created = await call('createOrgUser', { email: 'rep@example.org', displayName: 'Demo Reporter', role: 'reporter' }, as(adminToken))
    const uid = String(created.body.result?.uid)
    const changed = await call('setUserRole', { targetUid: uid, role: 'technician' }, as(adminToken))
    expect(changed.status).toBe(200)
    expect((await getAuth(app).getUser(uid)).customClaims).toEqual({ organizationId: 'kwale-demo', role: 'technician' })

    const self = await call('setUserRole', { targetUid: adminUid, role: 'reporter' }, as(adminToken))
    expect(self.body.error?.status).toBe('FAILED_PRECONDITION')
    expect((await getAuth(app).getUser(adminUid)).customClaims).toEqual({ organizationId: 'kwale-demo', role: 'administrator' })
  })

  it('refuses a target with unrelated claims and leaves them unchanged', async () => {
    const created = await call('createOrgUser', { email: 'odd@example.org', displayName: 'Odd', role: 'reporter' }, as(adminToken))
    const uid = String(created.body.result?.uid)
    await getAuth(app).setCustomUserClaims(uid, { organizationId: 'kwale-demo', role: 'reporter', beta: true })
    const res = await call('setUserRole', { targetUid: uid, role: 'technician' }, as(adminToken))
    expect(res.body.error?.status).toBe('FAILED_PRECONDITION')
    expect((await getAuth(app).getUser(uid)).customClaims).toEqual({ organizationId: 'kwale-demo', role: 'reporter', beta: true })
  })

  it('rejects input with an organizationId (strict schema)', async () => {
    const res = await call('createOrgUser', { email: 'z@example.org', displayName: 'Z', role: 'reporter', organizationId: 'pwani-demo' }, as(adminToken))
    expect(res.body.error?.status).toBe('INVALID_ARGUMENT')
  })
})
