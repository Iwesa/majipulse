import { describe, expect, it } from 'vitest'
import {
  documentIdSchema,
  isoDateTimeSchema,
  organizationIdSchema,
  periodSchema,
  requiredText,
  uniqueArray,
  uuidSchema,
} from './common'
import { isStaffRole, roleSchema, sessionClaimsSchema, sessionScopeSchema } from './roles'
import { z } from 'zod'

describe('documentIdSchema', () => {
  it.each(['wp-1', 'a', 'x'.repeat(128), 'UPPER_and_lower.123'])('accepts %s', (id) => {
    expect(documentIdSchema.safeParse(id).success).toBe(true)
  })
  it.each(['', 'a/b', '.', '..', '__reserved__', 'x'.repeat(129)])('rejects %j', (id) => {
    expect(documentIdSchema.safeParse(id).success).toBe(false)
  })
})

describe('organizationIdSchema', () => {
  it.each(['kwale-demo', 'abc', 'org-2026', 'a'.repeat(64)])('accepts %s', (id) => {
    expect(organizationIdSchema.safeParse(id).success).toBe(true)
  })
  it.each(['ab', 'Kwale', '-kwale', 'kwale-', 'kwale demo', 'kwale_demo', 'a'.repeat(65), ''])(
    'rejects %j',
    (id) => {
      expect(organizationIdSchema.safeParse(id).success).toBe(false)
    },
  )
})

describe('uuidSchema', () => {
  it('accepts crypto.randomUUID output', () => {
    expect(uuidSchema.safeParse(crypto.randomUUID()).success).toBe(true)
  })
  it.each(['not-a-uuid', '3f1c2a9e5b7d4e2a9c1f0a1b2c3d4e5f', ''])('rejects %j', (v) => {
    expect(uuidSchema.safeParse(v).success).toBe(false)
  })
})

describe('isoDateTimeSchema', () => {
  it.each(['2026-03-01T08:00:00Z', '2026-03-01T08:00:00.123Z', '2026-03-01T11:00:00+03:00'])('accepts %s', (v) => {
    expect(isoDateTimeSchema.safeParse(v).success).toBe(true)
  })
  it.each(['2026-03-01', '2026-03-01 08:00:00', 'yesterday', '2026-13-01T08:00:00Z', ''])('rejects %j', (v) => {
    expect(isoDateTimeSchema.safeParse(v).success).toBe(false)
  })
})

describe('periodSchema', () => {
  it('accepts from == to', () => {
    expect(periodSchema.safeParse({ from: '2026-03-01T08:00:00Z', to: '2026-03-01T08:00:00Z' }).success).toBe(true)
  })
  it('compares instants, not strings, across offsets', () => {
    // 10:00+03:00 is 07:00Z, which is before 08:00Z.
    expect(periodSchema.safeParse({ from: '2026-03-01T10:00:00+03:00', to: '2026-03-01T08:00:00Z' }).success).toBe(true)
  })
  it('rejects from after to', () => {
    expect(periodSchema.safeParse({ from: '2026-03-02T00:00:00Z', to: '2026-03-01T00:00:00Z' }).success).toBe(false)
  })
  it('rejects extra keys', () => {
    expect(periodSchema.safeParse({ from: '2026-03-01T00:00:00Z', to: '2026-03-02T00:00:00Z', extra: 1 }).success).toBe(false)
  })
})

describe('text helpers', () => {
  it('requiredText trims and enforces bounds', () => {
    const s = requiredText(5)
    expect(s.parse('  abc  ')).toBe('abc')
    expect(s.safeParse('   ').success).toBe(false)
    expect(s.safeParse('abcde').success).toBe(true)
    expect(s.safeParse('abcdef').success).toBe(false)
  })
  it('uniqueArray rejects duplicates', () => {
    const s = uniqueArray(z.string())
    expect(s.safeParse(['a', 'b']).success).toBe(true)
    expect(s.safeParse(['a', 'a']).success).toBe(false)
  })
})

describe('roles and session claims', () => {
  it('accepts exactly the three roles', () => {
    expect(roleSchema.options).toEqual(['administrator', 'technician', 'reporter'])
    expect(roleSchema.safeParse('owner').success).toBe(false)
  })
  it('accepts claims with exactly organizationId and role', () => {
    expect(sessionClaimsSchema.safeParse({ organizationId: 'kwale-demo', role: 'reporter' }).success).toBe(true)
  })
  it('rejects claims with unrelated keys', () => {
    expect(sessionClaimsSchema.safeParse({ organizationId: 'kwale-demo', role: 'reporter', beta: true }).success).toBe(false)
  })
  it('rejects claims missing a key', () => {
    expect(sessionClaimsSchema.safeParse({ role: 'administrator' }).success).toBe(false)
  })
  it('validates session scope', () => {
    expect(sessionScopeSchema.safeParse({ organizationId: 'kwale-demo', ownerUid: 'uid-1' }).success).toBe(true)
    expect(sessionScopeSchema.safeParse({ organizationId: 'kwale-demo', ownerUid: 'a/b' }).success).toBe(false)
  })
  it('identifies staff roles', () => {
    expect(isStaffRole('administrator')).toBe(true)
    expect(isStaffRole('technician')).toBe(true)
    expect(isStaffRole('reporter')).toBe(false)
  })
})
