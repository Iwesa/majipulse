// AI output validation fixtures (T6.2; R4.3, R4.6, R4.10, AC9, AC21). Fictional text.
import { describe, expect, it } from 'vitest'
import { normalizeForGrounding, statedDates, validateExtraction } from './extraction'

const NOW = new Date('2026-03-20T12:00:00Z')
const DESCRIPTION = 'Tap 2 near the cattle trough is leaking since 12/03/2026. Water everywhere, very serious.'
const nulls = { incidentType: null, severity: null, occurredAt: null, locationNote: null }
const run = (output: unknown, description = DESCRIPTION) =>
  validateExtraction(typeof output === 'string' ? output : JSON.stringify(output), description, NOW)

describe('validateExtraction: rejected output (whole response discarded)', () => {
  it.each([
    ['malformed JSON', '{"incidentType": "leak",'],
    ['a JSON array', '[]'],
    ['plain text', 'The pump is broken.'],
    ['an unknown enum', { ...nulls, incidentType: 'burst_pipe' }],
    ['an unknown severity', { ...nulls, severity: 'critical' }],
    ['an overlong location', { ...nulls, locationNote: 'x'.repeat(301) }],
    ['an empty location string', { ...nulls, locationNote: '  ' }],
    ['a date without offset', { ...nulls, occurredAt: '2026-03-12T08:00:00' }],
    ['a missing field', { incidentType: 'leak', severity: null, occurredAt: null }],
    ['a wrong type', { ...nulls, severity: 3 }],
  ])('%s', (_label, output) => {
    expect(run(output)).toEqual({ ok: false })
  })
})

describe('validateExtraction: accepted output', () => {
  it('keeps grounded values and strips unknown keys', () => {
    const result = run({
      incidentType: 'leak',
      severity: 'high',
      occurredAt: '2026-03-12T00:00:00+03:00',
      locationNote: 'near the cattle trough',
      cause: 'worn washer',
      diagnosis: 'replace the tap',
    })
    expect(result).toEqual({
      ok: true,
      suggested: { incidentType: 'leak', severity: 'high', occurredAt: '2026-03-12T00:00:00+03:00', locationNote: 'near the cattle trough' },
      dropped: [],
    })
  })

  it('all nulls is valid: nothing stated, nothing suggested', () => {
    expect(run(nulls)).toEqual({ ok: true, suggested: nulls, dropped: [] })
  })
})

describe('validateExtraction: grounding (AC9)', () => {
  it('drops an invented location', () => {
    const result = run({ ...nulls, incidentType: 'leak', locationNote: 'behind the school' })
    expect(result).toEqual({ ok: true, suggested: { ...nulls, incidentType: 'leak' }, dropped: ['locationNote'] })
  })

  it('drops a location that is only part of a word in the description', () => {
    expect(run({ ...nulls, locationNote: 'ap 2' })).toMatchObject({ dropped: ['locationNote'] })
  })

  it('matches locations ignoring case, punctuation, and spacing', () => {
    expect(run({ ...nulls, locationNote: 'Near the  cattle-trough' })).toMatchObject({ suggested: { locationNote: 'Near the  cattle-trough' }, dropped: [] })
  })

  it('drops a date the description does not state', () => {
    expect(run({ ...nulls, occurredAt: '2026-03-11T00:00:00Z' })).toMatchObject({ dropped: ['occurredAt'] })
  })

  it('drops a date inferred from a relative phrase', () => {
    const description = 'No water since yesterday morning at the kiosk.'
    expect(run({ ...nulls, occurredAt: '2026-03-19T06:00:00Z' }, description)).toMatchObject({ dropped: ['occurredAt'] })
  })

  it('drops a future date even if stated', () => {
    const description = 'Repair planned on 2026-04-01.'
    expect(run({ ...nulls, occurredAt: '2026-04-01T00:00:00Z' }, description)).toMatchObject({ dropped: ['occurredAt'] })
  })

  it('accepts a written-out date; without a year only the current year', () => {
    const description = 'Borehole dry since 5 March.'
    expect(run({ ...nulls, occurredAt: '2026-03-05T00:00:00Z' }, description)).toMatchObject({ dropped: [] })
    expect(run({ ...nulls, occurredAt: '2025-03-05T00:00:00Z' }, description)).toMatchObject({ dropped: ['occurredAt'] })
  })

  it('grounds against the redacted text the model saw', () => {
    // "Mama Rehema" was redacted to "Mama [NAME]", so the original name is not a grounded location.
    const redacted = 'Leak at the tap next to Mama [NAME] house.'
    expect(run({ ...nulls, locationNote: 'next to Mama Rehema house' }, redacted)).toMatchObject({ dropped: ['locationNote'] })
  })
})

describe('validateExtraction: personal information echoes (R4.10, AC21)', () => {
  const description = 'Leak at the tap next to [NAME] house, call [PHONE].'
  it.each([
    ['a placeholder', 'next to [NAME] house'],
    ['a phone placeholder', 'call [PHONE]'],
  ])('drops a location containing %s', (_label, locationNote) => {
    expect(run({ ...nulls, locationNote }, description)).toMatchObject({ suggested: { locationNote: null }, dropped: ['locationNote'] })
  })

  it('drops a location echoing a phone number or email, even if the text contains it', () => {
    const raw = 'Leak by tap 0712 345 678 and amina@example.org'
    expect(run({ ...nulls, locationNote: 'by tap 0712 345 678' }, raw)).toMatchObject({ dropped: ['locationNote'] })
    expect(run({ ...nulls, locationNote: 'amina@example.org' }, raw)).toMatchObject({ dropped: ['locationNote'] })
  })

  it('a placeholder in a stripped extra key does not reach the result', () => {
    const result = run({ ...nulls, incidentType: 'leak', reporter: '[PHONE]' }, description)
    expect(result).toEqual({ ok: true, suggested: { ...nulls, incidentType: 'leak' }, dropped: [] })
  })
})

describe('helpers', () => {
  it('normalizeForGrounding', () => {
    expect(normalizeForGrounding('  Near the CATTLE-trough!! ')).toBe('near the cattle trough')
  })

  it('statedDates finds written dates and ignores counts and times', () => {
    expect(statedDates('since 12/03/2026, 2026-03-14, 5 March, March 7th 2025')).toEqual([
      { year: 2026, month: 3, day: 14 },
      { year: 2026, month: 3, day: 12 },
      { year: null, month: 3, day: 5 },
      { year: 2025, month: 3, day: 7 },
    ])
    expect(statedDates('pump broken since 3 days, tap 2 leaking, 7am to 9am, borehole 14, 200 litres')).toEqual([])
  })
})
