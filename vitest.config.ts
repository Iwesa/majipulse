import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Vitest 5 runs on the same Vite 8 as the app, so it uses the same React plugin.
// The Tailwind plugin is left out: jsdom does not render CSS, and component
// tests assert class names instead.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
    restoreMocks: true,
  },
})
