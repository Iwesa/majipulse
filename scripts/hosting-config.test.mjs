// @vitest-environment node
// firebase.json hosting headers and rewrites (T9.3), checked against Firebase
// Hosting's matching rules: `source` globs and `regex` patterns are matched
// against the original request path, regardless of rewrites.
//
// Why this exists: the Hosting emulator applies no custom headers on Windows
// (superstatic normalizes paths with path.join, turning "/patterns" into
// "\patterns"), so tests/hosting checks headers only on other platforms.
// Firebase does not document which rule wins when two set the same header,
// so this test also requires that no path gets two Cache-Control rules.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const hosting = JSON.parse(readFileSync('firebase.json', 'utf8')).hosting

/** Supports the patterns this config uses. Fails loudly for anything new. */
function matches(rule, path) {
  if (rule.regex !== undefined) return new RegExp(rule.regex, 'u').test(path)
  if (rule.source === '**') return true
  throw new Error(`Extend this test for the glob ${rule.source}`)
}

function headersFor(path) {
  const found = []
  for (const rule of hosting.headers) if (matches(rule, path)) for (const h of rule.headers) found.push([h.key.toLowerCase(), h.value])
  return found
}

const APP_ROUTES = ['/', '/sign-in', '/reports/new', '/incidents/3f1c2a9e-5b7d-4e2a-9c1f-0a1b2c3d4e5f', '/maintenance/AbC123xyz', '/patterns/kQ9z', '/water-points/wp-mwamanga-borehole/edit']
const ASSETS = ['/assets/index-ZFzMgDPK.js', '/assets/index-Bm2g00b7.css']
const SECURITY = ['x-content-type-options', 'referrer-policy', 'x-frame-options', 'strict-transport-security', 'content-security-policy', 'permissions-policy']

describe('hosting config (T9.3)', () => {
  it('serves dist with an SPA rewrite to index.html', () => {
    expect(hosting.public).toBe('dist')
    expect(hosting.rewrites).toEqual([{ source: '**', destination: '/index.html' }])
    expect(hosting.predeploy).toEqual(['npm run build', 'npm run check:build'])
  })

  it.each([...APP_ROUTES, '/index.html'])('%s: no-cache, exactly one Cache-Control rule', (path) => {
    expect(headersFor(path).filter(([k]) => k === 'cache-control')).toEqual([['cache-control', 'no-cache']])
  })

  it.each(ASSETS)('%s: immutable for a year, exactly one Cache-Control rule', (path) => {
    expect(headersFor(path).filter(([k]) => k === 'cache-control')).toEqual([['cache-control', 'public, max-age=31536000, immutable']])
  })

  it('other static files (favicon) keep the Hosting default cache', () => {
    expect(headersFor('/favicon.svg').filter(([k]) => k === 'cache-control')).toEqual([])
  })

  it.each([...APP_ROUTES, ...ASSETS, '/favicon.svg'])('%s: security headers, each set once', (path) => {
    const found = headersFor(path)
    for (const key of SECURITY) expect(found.filter(([k]) => k === key), key).toHaveLength(1)
  })

  it('the enforced CSP never blocks the app: no script, style, or connect restrictions', () => {
    const csp = headersFor('/').find(([k]) => k === 'content-security-policy')[1]
    expect(csp).toBe("frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'")
  })

  it('the report-only CSP allows Firebase, App Check (reCAPTCHA Enterprise), and AI Logic', () => {
    const csp = headersFor('/').find(([k]) => k === 'content-security-policy-report-only')[1]
    const directive = (name) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `))
    expect(directive('script-src')).toContain('https://www.google.com/recaptcha/')
    expect(directive('script-src')).toContain('https://www.gstatic.com/recaptcha/')
    expect(directive('frame-src')).toContain('https://www.google.com/recaptcha/')
    // Auth, Firestore, App Check exchange, AI Logic (firebasevertexai.googleapis.com), and callables.
    expect(directive('connect-src')).toContain('https://*.googleapis.com')
    expect(directive('connect-src')).toContain('https://*.cloudfunctions.net')
    expect(csp).not.toContain("'unsafe-eval'")
  })

  it('the hosting emulator is configured', () => {
    const emulators = JSON.parse(readFileSync('firebase.json', 'utf8')).emulators
    expect(emulators.hosting).toEqual({ host: '127.0.0.1', port: 5050 })
  })
})
