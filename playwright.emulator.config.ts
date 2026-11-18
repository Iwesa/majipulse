import { defineConfig, devices } from '@playwright/test'

// E2E against the Firebase emulators (Auth, Firestore) with the real rules.
// Needs Java (Firestore emulator) and a built functions package (demo seed).
// Run with `npm run test:e2e:emulators`. Set PLAYWRIGHT_CHANNEL=msedge to use
// an installed browser instead of Playwright's Chromium.
const PORT = 4174
const BASE_URL = `http://localhost:${PORT}`
const channel = process.env.PLAYWRIGHT_CHANNEL

/** Fictional demo-project config. Not secrets: the emulators accept any values. */
const EMULATOR_APP_ENV = {
  VITE_FIREBASE_API_KEY: 'fake-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-majipulse.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-majipulse',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo-majipulse.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
  VITE_FIREBASE_APP_ID: '1:000000000000:web:0000000000000000',
  VITE_APPCHECK_SITE_KEY: 'emulator-site-key',
  VITE_USE_EMULATORS: 'true',
}

export default defineConfig({
  testDir: './e2e-emulator',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  retries: 0,
  reporter: 'list',
  use: { baseURL: BASE_URL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], ...(channel ? { channel } : {}) } }],
  webServer: [
    {
      command: 'node scripts/firebase-emulators.mjs emulators:start --only auth,firestore --project demo-majipulse',
      url: 'http://127.0.0.1:4400/emulators',
      reuseExistingServer: false,
      timeout: 240_000,
    },
    {
      // Separate output folder, so it never mixes with the production `dist`.
      command: `npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
      url: BASE_URL,
      reuseExistingServer: false,
      timeout: 240_000,
      env: EMULATOR_APP_ENV,
    },
  ],
})
