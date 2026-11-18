import { describe, expect, it } from 'vitest'
import {
  ADMIN_UID,
  T0,
  T1,
  maintenanceTask,
  member,
  organization,
  waterPoint,
} from '../test/fixtures'
import { isAllowedMaintenanceTransition, maintenanceTaskSchema } from './maintenanceTask'
import { bootstrapStateSchema, memberSchema, organizationSchema } from './organization'
import { waterPointSchema } from './waterPoint'

describe('organizationSchema', () => {
  it('accepts a complete fictional organization', () => {
    expect(organizationSchema.safeParse(organization()).success).toBe(true)
  })
  it('rejects unknown keys', () => {
    expect(organizationSchema.safeParse({ ...organization(), billing: 'x' }).success).toBe(false)
  })
  it('rejects an empty name and an overlong county', () => {
    expect(organizationSchema.safeParse({ ...organization(), name: ' ' }).success).toBe(false)
    expect(organizationSchema.safeParse({ ...organization(), county: 'k'.repeat(81) }).success).toBe(false)
  })
})

describe('bootstrapStateSchema', () => {
  it('accepts an in-progress bootstrap without adminUid', () => {
    expect(bootstrapStateSchema.safeParse({ status: 'in_progress', startedAt: T0 }).success).toBe(true)
  })
  it('requires adminUid and completedAt when complete', () => {
    const result = bootstrapStateSchema.safeParse({ status: 'complete', startedAt: T0 })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual(['adminUid', 'completedAt'])
  })
  it('rejects completedAt while in progress', () => {
    expect(bootstrapStateSchema.safeParse({ status: 'in_progress', startedAt: T0, completedAt: T1 }).success).toBe(false)
  })
  it('rejects completedAt before startedAt', () => {
    expect(
      bootstrapStateSchema.safeParse({ status: 'complete', adminUid: ADMIN_UID, startedAt: T1, completedAt: T0 }).success,
    ).toBe(false)
  })
  it('rejects an unknown status', () => {
    expect(bootstrapStateSchema.safeParse({ status: 'failed', startedAt: T0 }).success).toBe(false)
  })
})

describe('memberSchema', () => {
  it('accepts a valid member', () => {
    expect(memberSchema.safeParse(member()).success).toBe(true)
  })
  it.each([
    ['role', 'owner'],
    ['email', 'not-an-email'],
    ['email', `${'a'.repeat(250)}@x.org`],
    ['organizationId', 'Kwale Demo'],
    ['displayName', ''],
    ['active', 'yes'],
    ['createdAt', '2026-03-01'],
  ])('rejects invalid %s', (key, value) => {
    expect(memberSchema.safeParse({ ...member(), [key]: value }).success).toBe(false)
  })
  it('rejects client-added keys', () => {
    expect(memberSchema.safeParse({ ...member(), isSuperAdmin: true }).success).toBe(false)
  })
})

describe('waterPointSchema', () => {
  it('accepts a valid water point, with or without ward', () => {
    expect(waterPointSchema.safeParse(waterPoint()).success).toBe(true)
    const { ward: _ward, ...noWard } = waterPoint()
    void _ward
    expect(waterPointSchema.safeParse(noWard).success).toBe(true)
  })
  it('rejects coordinates (not in the MVP)', () => {
    expect(waterPointSchema.safeParse({ ...waterPoint(), lat: -4.17, lng: 39.45 }).success).toBe(false)
  })
  it.each([
    ['type', 'dam'],
    ['status', 'broken'],
    ['name', 'n'.repeat(121)],
    ['locationDescription', ''],
    ['ward', ''],
    ['demo', undefined],
  ])('rejects invalid %s', (key, value) => {
    expect(waterPointSchema.safeParse({ ...waterPoint(), [key]: value }).success).toBe(false)
  })
  it('requires organizationId', () => {
    const { organizationId: _org, ...rest } = waterPoint()
    void _org
    expect(waterPointSchema.safeParse(rest).success).toBe(false)
  })
})

describe('maintenanceTaskSchema', () => {
  it('accepts a valid task, including one without an incident or assignee', () => {
    expect(maintenanceTaskSchema.safeParse(maintenanceTask()).success).toBe(true)
    expect(maintenanceTaskSchema.safeParse({ ...maintenanceTask(), incidentId: null, assigneeId: null }).success).toBe(true)
  })
  it('allows empty notes but bounds their length', () => {
    expect(maintenanceTaskSchema.safeParse({ ...maintenanceTask(), notes: '' }).success).toBe(true)
    expect(maintenanceTaskSchema.safeParse({ ...maintenanceTask(), notes: 'n'.repeat(2001) }).success).toBe(false)
  })
  it.each([
    ['status', 'closed'],
    ['incidentId', 'not-a-uuid'],
    ['assigneeId', ''],
    ['title', ''],
  ])('rejects invalid %s', (key, value) => {
    expect(maintenanceTaskSchema.safeParse({ ...maintenanceTask(), [key]: value }).success).toBe(false)
  })
  it('allows only open -> in_progress -> done', () => {
    expect(isAllowedMaintenanceTransition('open', 'in_progress')).toBe(true)
    expect(isAllowedMaintenanceTransition('in_progress', 'done')).toBe(true)
    expect(isAllowedMaintenanceTransition('open', 'done')).toBe(false)
    expect(isAllowedMaintenanceTransition('done', 'open')).toBe(false)
    expect(isAllowedMaintenanceTransition('open', 'open')).toBe(false)
  })
})
