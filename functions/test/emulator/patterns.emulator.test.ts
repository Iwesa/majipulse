// Pattern analysis against the emulators (T8.3; R9.1 to R9.3, S4, S7, AC21).
// Part 1 runs the analysis logic with the real Admin SDK data port on the
// Firestore emulator and a capturing fake model. Part 2 calls the deployed
// `analyzeIncidentPatterns` callable through the Functions emulator, where the
// demo project never reaches a model. FICTIONAL data.
import { deleteApp, initializeApp, type App } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { patternAnalysisSchema } from '../../../src/schemas/patternAnalysis'
import { createAdminAnalysisPort } from '../../src/patterns/adminAnalysisPort.js'
import { analyzeIncidentPatterns, type ModelRequest, type PatternModel } from '../../src/patterns/analysis.js'

const PROJECT = 'demo-majipulse'
const REGION = 'africa-south1'
const ORG = 'patterns-org'
const OTHER_ORG = 'patterns-other'
const PASSWORD = 'demo-password-123'
const EMULATOR_APP_CHECK = { 'X-Firebase-AppCheck': 'emulator-placeholder-token' }
const NOW = new Date('2026-03-31T12:00:00Z')
const PERIOD = { from: '2026-03-01T00:00:00Z', to: '2026-03-31T00:00:00Z' }
const id = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`

let app: App
const hosts = () => {
  const auth = process.env.FIREBASE_AUTH_EMULATOR_HOST
  const fs = process.env.FIRESTORE_EMULATOR_HOST
  if (!auth || !fs) throw new Error('Run through `npm run test:emulators`.')
  return { auth, fs, functions: '127.0.0.1:5001' }
}

const USERS = [
  ['uid-pat-admin', 'admin.patterns@example.org', 'administrator', ORG],
  ['uid-pat-tech', 'tech.patterns@example.org', 'technician', ORG],
  ['uid-pat-reporter', 'reporter.patterns@example.org', 'reporter', ORG],
  ['uid-pat-other', 'admin.other@example.org', 'administrator', OTHER_ORG],
] as const

/** [n, org, water point, day, description] */
const INCIDENTS: Array<[number, string, string, number, string]> = [
  [1, ORG, 'wp-pat-1', 2, 'Low flow in the morning. My name is Amina Otieno, call 0712 345 678.'],
  [2, ORG, 'wp-pat-1', 5, 'Low flow again, email amina.otieno@example.org.'],
  [3, ORG, 'wp-pat-2', 8, 'Tap leaking near Mama Rehema kiosk, ID number 12345678.'],
  [4, ORG, 'wp-pat-2', 9, 'Leak continues at the kiosk.'],
  [5, ORG, 'wp-pat-1', 40, 'Outside the analysis period.'],
  [6, OTHER_ORG, 'wp-other', 3, 'Other organization: Mr Kahindi reports no water.'],
  [7, OTHER_ORG, 'wp-other', 4, 'Other organization report.'],
  [8, OTHER_ORG, 'wp-other', 6, 'Other organization report.'],
]

async function seed() {
  const h = hosts()
  await fetch(`http://${h.fs}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await fetch(`http://${h.auth}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })
  const db = getFirestore(app)
  const auth = getAuth(app)
  const ts = (day: number) => Timestamp.fromDate(new Date(Date.UTC(2026, 2, day, 8)))
  for (const org of [ORG, OTHER_ORG]) {
    await db.doc(`organizations/${org}`).set({ name: `${org} (fictional)`, county: 'Kwale', demo: true, createdAt: ts(1), createdBy: 'seed', bootstrap: { status: 'complete' } })
  }
  for (const [uid, email, role, org] of USERS) {
    await auth.createUser({ uid, email, password: PASSWORD })
    await auth.setCustomUserClaims(uid, { organizationId: org, role })
    await db.doc(`members/${uid}`).set({ organizationId: org, role, email, displayName: uid, active: true, createdAt: ts(1), updatedAt: ts(1) })
  }
  for (const [wp, org, name] of [['wp-pat-1', ORG, 'Mwamanga Borehole (fictional)'], ['wp-pat-2', ORG, 'Kiosk of Mama Rehema Said (fictional)'], ['wp-other', OTHER_ORG, 'Other Borehole (fictional)']]) {
    await db.doc(`waterPoints/${wp}`).set({ organizationId: org, name, type: 'borehole', locationDescription: 'Fictional', status: 'working', demo: true, createdBy: 'seed', createdAt: ts(1), updatedAt: ts(1) })
  }
  for (const [n, org, wp, day, description] of INCIDENTS) {
    await db.doc(`incidents/${id(n)}`).set({
      organizationId: org, waterPointId: wp, reporterId: 'uid-pat-reporter', demo: true, description, incidentType: 'low_flow', severity: 'medium',
      status: 'new', baseRevision: 0, clientRevision: 1, mutationId: id(100 + n), serverRevision: 1, clientCreatedAt: ts(day), createdAt: ts(day), updatedAt: ts(day),
      confirmedFields: ['incidentType'], locationNote: 'Behind the house of Mr Kahindi', ai: { suggested: { incidentType: 'leak', severity: null, occurredAt: null, locationNote: 'by Mzee Juma' }, inferenceSource: 'in_cloud', model: 'm', generatedAt: ts(day) },
    })
  }
}

beforeAll(async () => {
  hosts()
  app = initializeApp({ projectId: PROJECT }, 'patterns-test')
})
afterAll(async () => {
  await deleteApp(app)
})

describe('analysis logic with the Admin SDK data port (Firestore emulator)', () => {
  beforeEach(seed)

  class CapturingModel implements PatternModel {
    readonly name = 'fake-model'
    requests: ModelRequest[] = []
    async generate(request: ModelRequest) {
      this.requests.push(request)
      return JSON.stringify({
        insights: [
          {
            kind: 'observation', title: 'Repeated low flow', statement: 'Two reports describe low morning flow at one borehole.',
            supportingIncidentIds: [id(1), id(2)], affectedWaterPointIds: ['wp-pat-1'],
            period: { from: '2026-03-02T00:00:00Z', to: '2026-03-06T00:00:00Z' }, limitations: ['Two reports only.'], confidence: 'medium',
          },
          {
            kind: 'hypothesis', title: 'Cross-organization claim', statement: 'Low flow may be linked to the other borehole.',
            supportingIncidentIds: [id(1), id(6)], affectedWaterPointIds: ['wp-pat-1', 'wp-other'],
            period: { from: '2026-03-02T00:00:00Z', to: '2026-03-06T00:00:00Z' }, limitations: ['Speculative.'], confidence: 'low',
          },
        ],
        limitations: ['Small sample.'],
      })
    }
  }

  const run = (model: PatternModel, uid: string, role: string, org: string, input: unknown = PERIOD) =>
    analyzeIncidentPatterns({ data: createAdminAnalysisPort(app), model, now: () => NOW, log: { info: () => undefined } }, { uid, token: { organizationId: org, role } }, input)

  it('reads only this organization’s incidents in the period and sends only minimized, redacted text (AC21)', async () => {
    const model = new CapturingModel()
    const result = await run(model, 'uid-pat-tech', 'technician', ORG)
    expect(result).toMatchObject({ insufficientData: false, analyzedIncidentCount: 4, insightCount: 1 })

    const sent = JSON.stringify(model.requests)
    expect(model.requests).toHaveLength(1)
    for (const secret of ['Amina', 'Otieno', '0712', 'amina.otieno@example.org', '12345678', 'Rehema', 'Said', 'Kahindi', 'Juma', 'uid-pat-reporter', 'reporterId', 'createdBy', 'locationNote', 'confirmedFields', 'inferenceSource']) {
      expect(sent).not.toContain(secret)
    }
    for (const placeholder of ['[NAME]', '[PHONE]', '[EMAIL]', '[ID]']) expect(sent).toContain(placeholder)
    // Cross-organization isolation: no other-org or out-of-period incident is sent.
    for (const n of [5, 6, 7, 8]) expect(sent).not.toContain(id(n))
    expect(sent).not.toContain('wp-other')
  })

  it('stores a validated analysis that the client schema accepts; the cross-org insight is dropped', async () => {
    const { analysisId } = await run(new CapturingModel(), 'uid-pat-admin', 'administrator', ORG)
    const snap = await getFirestore(app).doc(`patternAnalyses/${analysisId}`).get()
    const data = snap.data() ?? {}
    expect(data).toMatchObject({ organizationId: ORG, requestedBy: 'uid-pat-admin', insufficientData: false, analyzedIncidentCount: 4, model: 'fake-model', demo: true })
    expect(data.createdAt).toBeInstanceOf(Timestamp)
    expect(data.insights).toHaveLength(1)
    const toIso = (v: unknown): unknown =>
      v instanceof Timestamp ? v.toDate().toISOString() : Array.isArray(v) ? v.map(toIso) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toIso(x)])) : v
    const parsed = patternAnalysisSchema.safeParse(toIso(data))
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
  })

  it('fewer than 3 incidents for a water point: insufficient data, no model call', async () => {
    const model = new CapturingModel()
    const result = await run(model, 'uid-pat-tech', 'technician', ORG, { ...PERIOD, waterPointId: 'wp-pat-2' })
    expect(result).toMatchObject({ insufficientData: true, analyzedIncidentCount: 2 })
    expect(model.requests).toHaveLength(0)
  })

  it('another organization analyzes only its own data and cannot target our water points', async () => {
    const model = new CapturingModel()
    await run(model, 'uid-pat-other', 'administrator', OTHER_ORG)
    const sent = JSON.stringify(model.requests)
    for (const n of [1, 2, 3, 4]) expect(sent).not.toContain(id(n))
    await expect(run(model, 'uid-pat-other', 'administrator', OTHER_ORG, { ...PERIOD, waterPointId: 'wp-pat-1' })).rejects.toMatchObject({ code: 'not-found' })
  })

  it('a reporter is denied before any read', async () => {
    const model = new CapturingModel()
    await expect(run(model, 'uid-pat-reporter', 'reporter', ORG)).rejects.toMatchObject({ code: 'permission-denied' })
    expect(model.requests).toHaveLength(0)
  })
})

describe('analyzeIncidentPatterns callable (Functions emulator)', () => {
  const tokens: Record<string, string> = {}
  beforeAll(async () => {
    await seed()
    for (const [uid, email] of USERS) {
      const res = await fetch(`http://${hosts().auth}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
      })
      const body = (await res.json()) as { idToken?: string }
      if (!body.idToken) throw new Error('sign-in failed')
      tokens[uid] = body.idToken
    }
  })

  const call = async (data: unknown, headers: Record<string, string>) => {
    const res = await fetch(`http://${hosts().functions}/${PROJECT}/${REGION}/analyzeIncidentPatterns`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ data }),
    })
    return { status: res.status, body: (await res.json()) as { result?: Record<string, unknown>; error?: { status: string; message: string } } }
  }
  const as = (uid: string) => ({ Authorization: `Bearer ${tokens[uid]}`, ...EMULATOR_APP_CHECK })
  it('requires App Check and authentication', async () => {
    expect((await call(PERIOD, { Authorization: `Bearer ${tokens['uid-pat-admin']}` })).status).toBe(401)
    expect((await call(PERIOD, EMULATOR_APP_CHECK)).body.error?.status).toBe('UNAUTHENTICATED')
  })

  it('denies reporters', async () => {
    expect((await call(PERIOD, as('uid-pat-reporter'))).body.error?.status).toBe('PERMISSION_DENIED')
  })

  it('rejects invalid input', async () => {
    expect((await call({ from: 'yesterday', to: 'today' }, as('uid-pat-tech'))).body.error?.status).toBe('INVALID_ARGUMENT')
  })

  it('stores and returns insufficient data when fewer than 3 incidents match', async () => {
    // A window with no seeded incidents (the seed uses fixed dates in March 2026).
    const to = new Date()
    const from = new Date(to.getTime() - 86_400_000)
    const { body } = await call({ from: from.toISOString(), to: to.toISOString() }, as('uid-pat-tech'))
    expect(body.result).toMatchObject({ insufficientData: true, analyzedIncidentCount: 0, insightCount: 0 })
    const snap = await getFirestore(app).doc(`patternAnalyses/${String(body.result?.analysisId)}`).get()
    expect(snap.get('organizationId')).toBe(ORG)
    expect(snap.get('model')).toBe('none')
  })

  it('with enough incidents in a demo project the model is never called: unavailable, nothing stored', async () => {
    const before = (await getFirestore(app).collection('patternAnalyses').get()).size
    const { body } = await call(PERIOD, as('uid-pat-admin'))
    expect(body.error?.status).toBe('UNAVAILABLE')
    expect((await getFirestore(app).collection('patternAnalyses').get()).size).toBe(before)
  })
})
