/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string
  readonly VITE_FIREBASE_APP_ID?: string
  readonly VITE_APPCHECK_SITE_KEY?: string
  readonly VITE_USE_EMULATORS?: string
  /** Development only. Set in .env.development.local. Never read outside import.meta.env.DEV. */
  readonly VITE_APPCHECK_DEBUG_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Read by the Firebase App Check SDK. Set only in development builds.
// eslint-disable-next-line no-var
declare var FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean | undefined
