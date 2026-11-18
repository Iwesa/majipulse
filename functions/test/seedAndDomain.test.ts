// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { incidentSchema } from '../../src/schemas/incident'
import { memberSchema, organizationIdSchema as clientOrgId } from '../../src/schemas'
import { roleSchema as clientRoles } from '../../src/schemas/roles'
import { waterPointSchema } from '../../src/schemas/waterPoint'
import { ORGANIZATION_ID_PATTERN, ROLES, claimsEqual, hasOnlyOrgClaimKeys, organizationIdSchema } from '../src/domain.js'
import { buildDemoData } from '../src/seed/demoData.js'

/** Converts Dates to ISO strings, the client schema representation. */
const toIso = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(toIso)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toIso(v)]))
  return value
}

let n = 0
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const data = buildDemoData(new Date('2026-03-15T08:00:00Z'), uuid)

describe('server domain rules match the client schemas', () => {
  it('uses the same roles', () => {
    expect([...ROLES]).toEqual(clientRoles.options)
  })
  it.each(['kwale-demo', 'abc', 'ab', 'Kwale', '-x-', 'a'.repeat(64), 'a'.repeat(65)])(
    'agrees on organization ID %j',
    (id) => {
      expect(organizationIdSchema.safeParse(id).success).toBe(clientOrgId.safeParse(id).success)
      expect(ORGANIZATION_ID_PATTERN.test(id)).toBe(clientOrgId.safeParse(id).success)
    },
  )
  it('compares claims exactly', () => {
    const expected = { organizationId: 'kwale-demo', role: 'administrator' as const }
    expect(claimsEqual(expected, expected)).toBe(true)
    expect(claimsEqual({ ...expected, beta: true }, expected)).toBe(false)
    expect(claimsEqual({ organizationId: 'kwale-demo', role: 'reporter' }, expected)).toBe(false)
    expect(hasOnlyOrgClaimKeys({ organizationId: 'x', role: 'reporter' })).toBe(true)
    expect(hasOnlyOrgClaimKeys({ organizationId: 'x', role: 'reporter', beta: 1 })).toBe(false)
    expect(hasOnlyOrgClaimKeys({})).toBe(false)
  })
})

describe('demo seed data (T2.13)', () => {
  it('has the specified counts', () => {
    expect(data.organizations).toHaveLength(2)
    expect(data.organizations.flatMap((o) => o.users)).toHaveLength(6)
    expect(data.waterPoints).toHaveLength(6)
    expect(data.incidents).toHaveLength(12)
  })

  it('has one administrator, technician, and reporter per organization', () => {
    for (const org of data.organizations) {
      expect(org.users.map((u) => u.role).sort()).toEqual(['administrator', 'reporter', 'technician'])
    }
  })

  it('marks every record as demo and labels names as fictional', () => {
    expect(data.waterPoints.every((w) => w.data.demo && w.data.name.includes('(fictional)'))).toBe(true)
    expect(data.incidents.every((i) => i.data.demo && i.data.description.includes('fictional'))).toBe(true)
    expect(data.organizations.every((o) => o.name.includes('(fictional)'))).toBe(true)
  })

  it('uses only reserved example.org emails', () => {
    expect(data.organizations.flatMap((o) => o.users).every((u) => u.email.endsWith('@example.org'))).toBe(true)
  })

  it('produces records that pass the client schemas', () => {
    for (const wp of data.waterPoints) expect(waterPointSchema.safeParse(toIso(wp.data)).error).toBeUndefined()
    for (const incident of data.incidents) expect(incidentSchema.safeParse(toIso(incident.data)).error).toBeUndefined()
    for (const org of data.organizations) {
      for (const u of org.users) {
        const member = { organizationId: org.id, role: u.role, email: u.email, displayName: u.displayName, active: true, createdAt: '2026-03-15T08:00:00Z', updatedAt: '2026-03-15T08:00:00Z' }
        expect(memberSchema.safeParse(member).error).toBeUndefined()
      }
    }
  })

  it('keeps every incident inside its water point’s organization, reported by that organization’s reporter', () => {
    const wpOrg = new Map(data.waterPoints.map((w) => [w.id, w.data.organizationId]))
    for (const { data: i } of data.incidents) {
      expect(wpOrg.get(i.waterPointId)).toBe(i.organizationId)
      const reporter = data.organizations.find((o) => o.id === i.organizationId)?.users.find((u) => u.role === 'reporter')
      expect(i.reporterId).toBe(reporter?.uid)
    }
  })

  it('covers both organizations so isolation can be demonstrated', () => {
    const orgs = new Set(data.incidents.map((i) => i.data.organizationId))
    expect(orgs).toEqual(new Set(['kwale-demo', 'pwani-demo']))
  })
})
