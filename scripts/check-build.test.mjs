// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findForbidden, readLocalTokenValues } from './check-build.mjs'

let root

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'majipulse-check-build-'))
  mkdirSync(join(root, 'dist', 'assets'), { recursive: true })
  writeFileSync(join(root, 'dist', 'index.html'), '<html><body>ok</body></html>')
  writeFileSync(join(root, 'dist', 'assets', 'index.js'), 'console.log("clean")')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('check-build', () => {
  it('passes on a clean build', () => {
    expect(findForbidden(join(root, 'dist'))).toEqual([])
  })

  it.each(['self.FIREBASE_APPCHECK_DEBUG_TOKEN=true', 'self.FIREBASE_APPCHECK_DEBUG_TOKEN = "abc"'])(
    'fails when the debug token is assigned: %s',
    (code) => {
      writeFileSync(join(root, 'dist', 'assets', 'leak.js'), code)
      const findings = findForbidden(join(root, 'dist'))
      expect(findings).toHaveLength(1)
      expect(findings[0].kind).toBe('marker FIREBASE_APPCHECK_DEBUG_TOKEN assignment')
    },
  )

  it('passes when the App Check SDK only reads the global', () => {
    // Shape of the minified SDK code in a real build.
    writeFileSync(
      join(root, 'dist', 'assets', 'sdk.js'),
      'if(typeof t.FIREBASE_APPCHECK_DEBUG_TOKEN!=`string`&&t.FIREBASE_APPCHECK_DEBUG_TOKEN!==!0)return;' +
        'typeof t.FIREBASE_APPCHECK_DEBUG_TOKEN==`string`?r.resolve(t.FIREBASE_APPCHECK_DEBUG_TOKEN):0',
    )
    expect(findForbidden(join(root, 'dist'))).toEqual([])
  })

  it('fails when the token env variable name appears', () => {
    writeFileSync(join(root, 'dist', 'assets', 'leak.js'), 'const k="VITE_APPCHECK_DEBUG_TOKEN"')
    expect(findForbidden(join(root, 'dist'))[0].kind).toBe('marker VITE_APPCHECK_DEBUG_TOKEN')
  })

  it('fails when a local debug-token value is planted, without reporting the value', () => {
    const token = 'test-token-0000-1111-2222'
    writeFileSync(join(root, '.env.development.local'), `VITE_APPCHECK_DEBUG_TOKEN="${token}"\n`)
    writeFileSync(join(root, 'dist', 'assets', 'leak.js'), `const t="${token}"`)
    const findings = findForbidden(join(root, 'dist'), { tokenValues: readLocalTokenValues(root) })
    expect(findings).toHaveLength(1)
    expect(JSON.stringify(findings)).not.toContain(token)
  })

  it('ignores missing or too-short token values', () => {
    writeFileSync(join(root, '.env.development.local'), 'VITE_APPCHECK_DEBUG_TOKEN=\n')
    expect(readLocalTokenValues(root)).toEqual([])
  })
})
