import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts on purpose: Vitest 3 runs on its own Vite 7,
// while @vitejs/plugin-react 6 and @tailwindcss/vite target Vite 8. JSX is
// compiled with esbuild's automatic runtime instead of the React plugin.
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
    restoreMocks: true,
  },
})
