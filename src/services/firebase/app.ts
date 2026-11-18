import { initializeApp, type FirebaseApp } from 'firebase/app'
import { CustomProvider, initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check'
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions'
import type { AppConfig } from './config'

/** Region of the callable functions; same as the Firestore database. */
export const FUNCTIONS_REGION = 'africa-south1'

export const EMULATOR = {
  auth: 'http://127.0.0.1:9099',
  firestore: { host: '127.0.0.1', port: 8080 },
  functions: { host: '127.0.0.1', port: 5001 },
} as const

export interface FirebaseServices {
  app: FirebaseApp
  appCheck: AppCheck
  auth: Auth
  db: Firestore
  functions: Functions
}

/**
 * Initializes Firebase. App Check starts first so every later request carries
 * a token. The default Firestore cache is memory-only: the app's own
 * IndexedDB outbox is the source of truth for unsynced reports (design 6).
 *
 * @param debugToken App Check debug token. Callers pass it only in
 *   development; it is applied only when `import.meta.env.DEV` is true, so the
 *   assignment is removed from production builds (checked by check:build).
 */
export function initFirebase(config: AppConfig, debugToken?: string): FirebaseServices {
  const app = initializeApp(config.firebase)

  if (import.meta.env.DEV && debugToken) {
    // "true" asks the SDK to generate a token and print it for registration.
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken === 'true' ? true : debugToken
  }
  const appCheck = initializeAppCheck(app, {
    // The emulators do not verify App Check tokens (the Functions emulator
    // only checks one is present), so emulator builds send a placeholder
    // instead of loading reCAPTCHA. Production builds never set useEmulators.
    provider: config.useEmulators
      ? new CustomProvider({ getToken: async () => ({ token: 'emulator-placeholder', expireTimeMillis: Date.now() + 3_600_000 }) })
      : new ReCaptchaEnterpriseProvider(config.appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  })

  const auth = getAuth(app)
  const db = getFirestore(app)
  const functions = getFunctions(app, FUNCTIONS_REGION)

  if (config.useEmulators) {
    connectAuthEmulator(auth, EMULATOR.auth, { disableWarnings: true })
    connectFirestoreEmulator(db, EMULATOR.firestore.host, EMULATOR.firestore.port)
    connectFunctionsEmulator(functions, EMULATOR.functions.host, EMULATOR.functions.port)
  }

  return { app, appCheck, auth, db, functions }
}
