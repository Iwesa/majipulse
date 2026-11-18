import { Timestamp } from 'firebase/firestore'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isoToTimestamp, timestampsToIso, timestampToIso } from './timestamps'
import { signInErrorKind } from './authService'
import { userAdminErrorKind } from './userAdminService'

describe('Timestamp <-> ISO 8601', () => {
  it('round-trips with millisecond precision', () => {
    const iso = '2026-03-01T08:30:15.123Z'
    expect(timestampToIso(isoToTimestamp(iso))).toBe(iso)
  })
  it('normalizes offsets to UTC', () => {
    expect(timestampToIso(isoToTimestamp('2026-03-01T11:00:00+03:00'))).toBe('2026-03-01T08:00:00.000Z')
  })
  it.each(['2026-03-01', '2026-03-01T08:00:00', 'yesterday', ''])('rejects %j', (value) => {
    expect(() => isoToTimestamp(value)).toThrow(RangeError)
  })
  it('deep-converts Timestamps in document data and leaves other values alone', () => {
    const t = Timestamp.fromDate(new Date('2026-03-01T08:00:00Z'))
    expect(
      timestampsToIso({ createdAt: t, n: 1, s: 'x', nil: null, nested: { at: t }, list: [t, 'y'] }),
    ).toEqual({
      createdAt: '2026-03-01T08:00:00.000Z',
      n: 1,
      s: 'x',
      nil: null,
      nested: { at: '2026-03-01T08:00:00.000Z' },
      list: ['2026-03-01T08:00:00.000Z', 'y'],
    })
  })
})

describe('error mapping', () => {
  it.each([
    ['auth/invalid-credential', 'invalidCredentials'],
    ['auth/user-not-found', 'invalidCredentials'],
    ['auth/wrong-password', 'invalidCredentials'],
    ['auth/user-disabled', 'invalidCredentials'],
    ['auth/network-request-failed', 'network'],
    ['auth/too-many-requests', 'tooManyAttempts'],
    ['auth/something-else', 'unknown'],
  ])('sign-in %s -> %s (never reveals whether the account exists)', (code, kind) => {
    expect(signInErrorKind({ code })).toBe(kind)
  })
  it('maps unknown sign-in errors to unknown', () => {
    expect(signInErrorKind(new Error('x'))).toBe('unknown')
  })
  it.each([
    ['functions/already-exists', 'create', 'alreadyExists'],
    ['functions/invalid-argument', 'create', 'invalid'],
    ['functions/permission-denied', 'create', 'permission'],
    ['functions/unauthenticated', 'setRole', 'permission'],
    ['functions/failed-precondition', 'setRole', 'otherSettings'],
    ['functions/not-found', 'setRole', 'notFound'],
    ['functions/unavailable', 'create', 'network'],
    ['functions/internal', 'create', 'unknown'],
  ] as const)('callable %s (%s) -> %s', (code, operation, kind) => {
    expect(userAdminErrorKind({ code }, operation)).toBe(kind)
  })
})

describe('orgScopedQuery', () => {
  afterEach(() => {
    vi.doUnmock('firebase/firestore')
    vi.resetModules()
  })

  it('always adds the organizationId filter first', async () => {
    const where = vi.fn((...args: unknown[]) => ({ where: args }))
    const query = vi.fn((...args: unknown[]) => ({ query: args }))
    vi.resetModules()
    vi.doMock('firebase/firestore', () => ({ collection: (_db: unknown, path: string) => ({ path }), where, query }))
    const { orgScopedQuery } = await import('./queries')
    const extra = { extra: true } as never
    orgScopedQuery({} as never, 'members', 'kwale-demo', extra)
    expect(where).toHaveBeenCalledWith('organizationId', '==', 'kwale-demo')
    expect(query).toHaveBeenCalledWith({ path: 'members' }, { where: ['organizationId', '==', 'kwale-demo'] }, extra)
  })

  it('refuses an empty organizationId', async () => {
    const { orgScopedQuery } = await import('./queries')
    expect(() => orgScopedQuery({} as never, 'members', '')).toThrow()
  })
})

describe('initFirebase', () => {
  const sdk = {
    initializeApp: vi.fn(() => ({ name: 'app' })),
    initializeAppCheck: vi.fn(() => ({})),
    ReCaptchaEnterpriseProvider: vi.fn(function (this: { key: string }, key: string) {
      this.key = key
    }),
    getAuth: vi.fn(() => ({ auth: true })),
    getFirestore: vi.fn(() => ({ db: true })),
    getFunctions: vi.fn(() => ({ functions: true })),
    connectAuthEmulator: vi.fn(),
    connectFirestoreEmulator: vi.fn(),
    connectFunctionsEmulator: vi.fn(),
  }
  const config = {
    firebase: {
      apiKey: 'k',
      authDomain: 'demo-majipulse.firebaseapp.com',
      projectId: 'demo-majipulse',
      storageBucket: 'b',
      messagingSenderId: '1',
      appId: '1:1:web:a',
    },
    appCheckSiteKey: 'site-key',
    useEmulators: false,
  }

  beforeEach(() => {
    vi.resetModules()
    Object.values(sdk).forEach((fn) => fn.mockClear())
    vi.doMock('firebase/app', () => ({ initializeApp: sdk.initializeApp }))
    vi.doMock('firebase/app-check', () => ({
      initializeAppCheck: sdk.initializeAppCheck,
      ReCaptchaEnterpriseProvider: sdk.ReCaptchaEnterpriseProvider,
    }))
    vi.doMock('firebase/auth', () => ({ getAuth: sdk.getAuth, connectAuthEmulator: sdk.connectAuthEmulator }))
    vi.doMock('firebase/firestore', () => ({ getFirestore: sdk.getFirestore, connectFirestoreEmulator: sdk.connectFirestoreEmulator }))
    vi.doMock('firebase/functions', () => ({ getFunctions: sdk.getFunctions, connectFunctionsEmulator: sdk.connectFunctionsEmulator }))
    delete (globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: unknown }).FIREBASE_APPCHECK_DEBUG_TOKEN
  })
  afterEach(() => {
    for (const m of ['firebase/app', 'firebase/app-check', 'firebase/auth', 'firebase/firestore', 'firebase/functions']) vi.doUnmock(m)
    vi.resetModules()
  })

  it('initializes App Check with reCAPTCHA Enterprise before other services', async () => {
    const { initFirebase, FUNCTIONS_REGION } = await import('./app')
    initFirebase(config)
    expect(sdk.ReCaptchaEnterpriseProvider).toHaveBeenCalledWith('site-key')
    expect(sdk.initializeAppCheck).toHaveBeenCalledWith({ name: 'app' }, expect.objectContaining({ isTokenAutoRefreshEnabled: true }))
    expect(sdk.initializeAppCheck.mock.invocationCallOrder[0]).toBeLessThan(sdk.getAuth.mock.invocationCallOrder[0])
    expect(sdk.getFunctions).toHaveBeenCalledWith({ name: 'app' }, FUNCTIONS_REGION)
    expect(FUNCTIONS_REGION).toBe('africa-south1')
  })

  it('does not set a debug token or connect emulators by default', async () => {
    const { initFirebase } = await import('./app')
    initFirebase(config)
    expect(globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN).toBeUndefined()
    expect(sdk.connectAuthEmulator).not.toHaveBeenCalled()
    expect(sdk.connectFirestoreEmulator).not.toHaveBeenCalled()
  })

  it('sets the debug token in development when provided, before App Check starts', async () => {
    let tokenAtInit: unknown
    sdk.initializeAppCheck.mockImplementationOnce(() => {
      tokenAtInit = globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN
      return {}
    })
    const { initFirebase } = await import('./app')
    initFirebase(config, 'debug-token-value')
    expect(tokenAtInit).toBe('debug-token-value')
  })

  it('treats the debug token "true" as a request to generate one', async () => {
    const { initFirebase } = await import('./app')
    initFirebase(config, 'true')
    expect(globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN).toBe(true)
  })

  it('connects all three emulators when configured', async () => {
    const { initFirebase, EMULATOR } = await import('./app')
    initFirebase({ ...config, useEmulators: true })
    expect(sdk.connectAuthEmulator).toHaveBeenCalledWith({ auth: true }, EMULATOR.auth, { disableWarnings: true })
    expect(sdk.connectFirestoreEmulator).toHaveBeenCalledWith({ db: true }, '127.0.0.1', 8080)
    expect(sdk.connectFunctionsEmulator).toHaveBeenCalledWith({ functions: true }, '127.0.0.1', 5001)
  })
})
