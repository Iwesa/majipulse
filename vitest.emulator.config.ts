import { defineConfig } from 'vitest/config'

// Tests that need the Firebase emulators. Run through `npm run test:emulators`,
// which starts the emulators (Java required) and sets the *_EMULATOR_HOST variables.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/emulator/**/*.test.ts', 'functions/test/emulator/**/*.test.ts'],
    // Tests share one emulator, so files run one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
