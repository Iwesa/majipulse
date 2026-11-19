import { defineConfig } from 'vitest/config'

// Hosting smoke test (T9.3). Run through `npm run test:hosting`, which builds
// `dist` and starts the Hosting emulator with firebase.json's hosting config.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/hosting/**/*.test.ts'],
    testTimeout: 30_000,
  },
})
