// Firebase Hosting config against the Hosting emulator (T9.3): the real
// `dist` build is served with the SPA rewrite for every app route.
//
// Header checks run only off Windows: on Windows the emulator (superstatic)
// normalizes request paths with backslashes and applies no custom headers.
// scripts/hosting-config.test.mjs checks the header rules on every platform.
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const BASE = 'http://127.0.0.1:5050'
const get = (path: string) => fetch(`${BASE}${path}`, { redirect: 'manual' })
const onWindows = process.platform === 'win32'

const asset = readdirSync('dist/assets').find((name) => name.endsWith('.js')) ?? ''
const shell = readFileSync('dist/index.html', 'utf8')
const ROUTES = ['/', '/sign-in', '/reports/new', '/incidents/3f1c2a9e-5b7d-4e2a-9c1f-0a1b2c3d4e5f', '/maintenance/abc123', '/patterns', '/water-points/wp-1/edit']

describe('Hosting emulator smoke test (T9.3)', () => {
  it.each(ROUTES)('serves the app shell for %s (SPA rewrite)', async (path) => {
    const res = await get(path)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
    expect(await res.text()).toBe(shell)
  })

  it('the shell loads the built bundle, and the bundle is served as JavaScript', async () => {
    expect(shell).toContain(`/assets/${asset}`)
    const res = await get(`/assets/${asset}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/javascript/)
  })

  it('the build contains no App Check debug token', () => {
    expect(shell).not.toContain('FIREBASE_APPCHECK_DEBUG_TOKEN')
  })

  it.skipIf(onWindows)('app routes are not cached; hashed assets are immutable', async () => {
    expect((await get('/patterns')).headers.get('cache-control')).toBe('no-cache')
    expect((await get(`/assets/${asset}`)).headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  })

  it.skipIf(onWindows)('security headers are sent', async () => {
    const res = await get('/')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
  })
})
