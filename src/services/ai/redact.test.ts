// Shared redactor fixtures, run in the app's test environment (jsdom). The
// same fixtures run in the functions suite (functions/test/redact.test.ts).
import { describe, expect, it, vi } from 'vitest'
import fixtures from '../../../shared/privacy/fixtures.json'
import { PLACEHOLDERS, containsPersonalData, countByKind, redact } from '../../../shared/privacy/redact'

describe('shared redactor in the app (T6.1b, AC21)', () => {
  it.each(fixtures.redacts.map((c) => [c.input, c] as const))('redacts %j', (_input, c) => {
    const result = redact(c.input)
    expect(result.text).toBe(c.expected)
    expect(result.findings.map((f) => f.kind)).toEqual(c.kinds)
  })

  it.each(fixtures.unchanged)('leaves %j unchanged', (input) => {
    expect(redact(input)).toEqual({ text: input, findings: [] })
    expect(containsPersonalData(input)).toBe(false)
  })

  it('never returns the removed values in the redacted text', () => {
    const input = 'My name is Amina, call 0712 345 678 or amina@example.org.'
    const { text } = redact(input)
    for (const secret of ['Amina,', '0712', '345 678', 'amina@example.org']) expect(text).not.toContain(secret)
  })

  it('findings point at the original text', () => {
    const input = 'Call 0712345678 now.'
    const [finding] = redact(input).findings
    expect(input.slice(finding.start, finding.end)).toBe('0712345678')
  })

  it('detects placeholders and personal data in AI output', () => {
    expect(containsPersonalData(`Reported by ${PLACEHOLDERS.name}`)).toBe(true)
    expect(containsPersonalData('Call 0712345678')).toBe(true)
    expect(containsPersonalData('Near the tank')).toBe(false)
  })

  it('counts by kind (safe to log) and never logs anything itself', () => {
    const log = vi.spyOn(console, 'log')
    const warn = vi.spyOn(console, 'warn')
    const { findings } = redact('Call 0712345678 or 0722345678, my name is Amina.')
    expect(countByKind(findings)).toEqual({ phone: 2, email: 0, id: 0, name: 1, number: 0 })
    expect(log).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('is stable on repeated calls (global regex state is reset)', () => {
    const input = 'Call 0712345678 now.'
    expect(redact(input).text).toBe(redact(input).text)
    expect(containsPersonalData('Call 0712345678')).toBe(true)
    expect(containsPersonalData('Call 0712345678')).toBe(true)
  })
})
