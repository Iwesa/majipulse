import { defineConfig, devices } from '@playwright/test'

const PORT = 4173
const BASE_URL = `http://localhost:${PORT}`

// By default Playwright uses its own Chromium build (`npx playwright install chromium`).
// Set PLAYWRIGHT_CHANNEL=msedge (or chrome) to use a browser already installed on the machine.
const channel = process.env.PLAYWRIGHT_CHANNEL

const UNCONFIGURED = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_APPCHECK_SITE_KEY',
  'VITE_USE_EMULATORS',
  'VITE_APPCHECK_DEBUG_TOKEN',
]

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...(channel ? { channel } : {}) },
    },
  ],
  webServer: {
    // Own output folder, so it never replaces the `dist` that Hosting deploys.
    command: `npx vite build --outDir dist-smoke --emptyOutDir && npx vite preview --outDir dist-smoke --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    // These tests check the "not configured" screen. Empty values win over any
    // .env.local, so the result does not depend on the developer's machine.
    env: Object.fromEntries(UNCONFIGURED.map((key) => [key, ''])),
  },
})
