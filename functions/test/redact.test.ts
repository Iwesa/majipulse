// @vitest-environment node
// Shared redactor fixtures, run against the functions package's import of the
// redactor (functions/src/privacy.ts), in a Node environment. The same
// fixtures run in the app suite (src/services/ai/redact.test.ts).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { containsPersonalData, redact } from '../src/privacy.js'

interface Fixtures {
  redacts: Array<{ input: string; expected: string; kinds: string[] }>
  unchanged: string[]
}
const fixtures = JSON.parse(readFileSync(new URL('../../shared/privacy/fixtures.json', import.meta.url), 'utf8')) as Fixtures

describe('shared redactor in functions (T6.1b, AC21)', () => {
  it.each(fixtures.redacts.map((c) => [c.input, c] as const))('redacts %j', (_input, c) => {
    const result = redact(c.input)
    expect(result.text).toBe(c.expected)
    expect(result.findings.map((f) => f.kind)).toEqual(c.kinds)
  })

  it.each(fixtures.unchanged)('leaves %j unchanged', (input) => {
    expect(redact(input).text).toBe(input)
    expect(containsPersonalData(input)).toBe(false)
  })
})
