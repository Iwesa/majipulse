import { describe, expect, it } from 'vitest'
import { ConfigError, parseAppConfig } from './config'

// Fictional placeholder values for tests only.
const valid = {
  VITE_FIREBASE_API_KEY: 'test-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'majipulse-demo.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'majipulse-demo',
  VITE_FIREBASE_STORAGE_BUCKET: 'majipulse-demo.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789012',
  VITE_FIREBASE_APP_ID: '1:123456789012:web:abc123def456',
  VITE_APPCHECK_SITE_KEY: 'test-site-key',
  VITE_USE_EMULATORS: 'true',
}

function issuesFor(env: Record<string, unknown>): readonly string[] {
  try {
    parseAppConfig(env)
  } catch (error) {
    if (error instanceof ConfigError) return error.issues
    throw error
  }
  throw new Error('expected ConfigError')
}

describe('parseAppConfig', () => {
  it('maps valid values to the app config', () => {
    expect(parseAppConfig(valid)).toEqual({
      firebase: {
        apiKey: 'test-api-key',
        authDomain: 'majipulse-demo.firebaseapp.com',
        projectId: 'majipulse-demo',
        storageBucket: 'majipulse-demo.firebasestorage.app',
        messagingSenderId: '123456789012',
        appId: '1:123456789012:web:abc123def456',
      },
      appCheckSiteKey: 'test-site-key',
      useEmulators: true,
    })
  })

  it('defaults useEmulators to false when unset', () => {
    const env: Record<string, unknown> = { ...valid }
    delete env.VITE_USE_EMULATORS
    expect(parseAppConfig(env).useEmulators).toBe(false)
  })

  it.each(Object.keys(valid).filter((k) => k !== 'VITE_USE_EMULATORS'))(
    'reports %s when missing',
    (key) => {
      const env: Record<string, unknown> = { ...valid }
      delete env[key]
      expect(issuesFor(env)).toContain(`${key} is missing`)
    },
  )

  it('treats blank values as missing', () => {
    expect(issuesFor({ ...valid, VITE_FIREBASE_API_KEY: '   ' })).toContain(
      'VITE_FIREBASE_API_KEY is missing',
    )
  })

  it('reports every missing value at once', () => {
    expect(issuesFor({})).toHaveLength(7)
  })

  it.each([
    ['VITE_FIREBASE_PROJECT_ID', 'Not A Project', 'VITE_FIREBASE_PROJECT_ID must be'],
    ['VITE_FIREBASE_MESSAGING_SENDER_ID', '12ab', 'VITE_FIREBASE_MESSAGING_SENDER_ID must contain'],
    ['VITE_FIREBASE_APP_ID', 'not-an-app-id', 'VITE_FIREBASE_APP_ID must look like'],
    ['VITE_USE_EMULATORS', 'yes', 'VITE_USE_EMULATORS must be'],
  ])('rejects invalid %s', (key, value, message) => {
    const issues = issuesFor({ ...valid, [key]: value })
    expect(issues.some((issue) => issue.startsWith(message))).toBe(true)
  })

  it('rejects non-string values', () => {
    expect(issuesFor({ ...valid, VITE_FIREBASE_API_KEY: 42 })).toContain(
      'VITE_FIREBASE_API_KEY is missing',
    )
  })

  it('does not include values in error messages', () => {
    const issues = issuesFor({ ...valid, VITE_FIREBASE_APP_ID: 'secret-looking-value' })
    expect(issues.join(' ')).not.toContain('secret-looking-value')
  })
})
