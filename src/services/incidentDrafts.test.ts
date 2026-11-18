import { describe, expect, it } from 'vitest'
import { localIncidentRecordSchema, type LocalIncidentRecord } from '../schemas/localIncident'
import {
  applyLocalEdit,
  applySuggestedFields,
  confirmedFieldsFor,
  contentOf,
  createLocalIncident,
  mergeConfirmedFields,
  newIncidentId,
  type DraftClock,
} from './incidentDrafts'
import { IncidentOutboxError } from './incidents'

const scope = { organizationId: 'kwale-demo', ownerUid: 'uid-reporter' }
const ID = '3f1c2a9e-5b7d-4e2a-9c1f-0a1b2c3d4e5f'
const content = { waterPointId: 'wp-1', description: 'Low flow since Monday (fictional).', incidentType: 'low_flow' as const, severity: null }

function makeClock(): DraftClock & { ids: string[] } {
  let n = 0
  const ids: string[] = []
  return {
    ids,
    now: () => new Date('2026-03-01T08:00:00.000Z'),
    uuid: () => {
      const value = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
      ids.push(value)
      return value
    },
  }
}

describe('new report (R3.1)', () => {
  it('generates the incident ID up front, from the UUID source', () => {
    const clock = makeClock()
    expect(newIncidentId(clock)).toBe(clock.ids[0])
    expect(newIncidentId()).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('first save: revision metadata for a never-synced report', () => {
    const clock = makeClock()
    const record = createLocalIncident(ID, scope, content, clock)
    expect(record).toMatchObject({
      id: ID,
      ownerUid: 'uid-reporter',
      reporterId: 'uid-reporter',
      organizationId: 'kwale-demo',
      status: 'new',
      baseRevision: 0,
      clientRevision: 1,
      mutationId: clock.ids[0],
      syncStatus: 'pending',
      demo: false,
      clientCreatedAt: '2026-03-01T08:00:00.000Z',
    })
    expect(record.serverRevision).toBeUndefined()
    expect(record.inFlight).toBeUndefined()
    expect(localIncidentRecordSchema.safeParse(record).success).toBe(true)
  })

  it('the incident ID and mutation ID are different values', () => {
    const record = createLocalIncident(ID, scope, content, makeClock())
    expect(record.mutationId).not.toBe(record.id)
  })

  it('rejects invalid content', () => {
    expect(() => createLocalIncident(ID, scope, { ...content, description: ' ' }, makeClock())).toThrow(IncidentOutboxError)
    expect(() => createLocalIncident('not-a-uuid', scope, content, makeClock())).toThrow(IncidentOutboxError)
  })
})

describe('local edits (R3.4)', () => {
  it('increment clientRevision and generate a new mutationId each time, keeping the ID and baseRevision', () => {
    const clock = makeClock()
    const v1 = createLocalIncident(ID, scope, content, clock)
    const v2 = applyLocalEdit(v1, { ...content, description: 'Edit one (fictional).' }, clock)
    const v3 = applyLocalEdit(v2, { ...content, description: 'Edit two (fictional).' }, clock)
    expect([v1.clientRevision, v2.clientRevision, v3.clientRevision]).toEqual([1, 2, 3])
    expect(new Set([v1.mutationId, v2.mutationId, v3.mutationId]).size).toBe(3)
    expect(v3).toMatchObject({ id: ID, baseRevision: 0, clientCreatedAt: v1.clientCreatedAt, description: 'Edit two (fictional).' })
  })

  it('keeps baseRevision and inFlight while a submission is in flight', () => {
    const clock = makeClock()
    const base = createLocalIncident(ID, scope, content, clock)
    const inFlight = { mutationId: base.mutationId, baseRevision: 0, startedAt: base.clientCreatedAt }
    const edited = applyLocalEdit({ ...base, syncStatus: 'syncing', inFlight }, { ...content, description: 'During sync' }, clock)
    expect(edited).toMatchObject({ syncStatus: 'syncing', inFlight, baseRevision: 0 })
    expect(edited.mutationId).not.toBe(inFlight.mutationId)
  })

  it('a synced report goes back to pending and keeps its server revision', () => {
    const clock = makeClock()
    const synced: LocalIncidentRecord = { ...createLocalIncident(ID, scope, content, clock), syncStatus: 'synced', serverRevision: 1, baseRevision: 1, syncedAt: '2026-03-01T09:00:00.000Z' }
    const edited = applyLocalEdit(synced, { ...content, description: 'Changed (fictional).' }, clock)
    expect(edited).toMatchObject({ syncStatus: 'pending', serverRevision: 1, baseRevision: 1, clientRevision: 2 })
  })

  it('a failed report goes back to pending and its failure details are cleared', () => {
    const clock = makeClock()
    const failed: LocalIncidentRecord = { ...createLocalIncident(ID, scope, content, clock), syncStatus: 'failed', failureKind: 'network', lastError: 'Offline' }
    const edited = applyLocalEdit(failed, content, clock)
    expect(edited.syncStatus).toBe('pending')
    expect(edited.failureKind).toBeUndefined()
    expect(edited.lastError).toBeUndefined()
  })

  it('removes optional fields the reporter cleared', () => {
    const clock = makeClock()
    const v1 = createLocalIncident(ID, scope, { ...content, locationNote: 'By the gate', occurredAt: '2026-03-01T06:00:00.000Z' }, clock)
    const v2 = applyLocalEdit(v1, content, clock)
    expect(v2.locationNote).toBeUndefined()
    expect(v2.occurredAt).toBeUndefined()
  })

  it.each([
    ['in conflict', { syncStatus: 'conflict' as const }],
    ['after triage', { status: 'triaged' as const }],
  ])('refuses edits %s', (_label, change) => {
    const record = createLocalIncident(ID, scope, content, makeClock())
    expect(() => applyLocalEdit({ ...record, ...change } as LocalIncidentRecord, content, makeClock())).toThrow(
      expect.objectContaining({ kind: 'notEditable' }),
    )
  })

  it('contentOf round-trips the editable fields', () => {
    const full = { ...content, severity: 'high' as const, locationNote: 'Gate', occurredAt: '2026-03-01T06:00:00.000Z' }
    expect(contentOf(createLocalIncident(ID, scope, full, makeClock()))).toEqual(full)
  })
})

describe('confirmed fields (R4.5)', () => {
  it('the reporter’s own entries count as confirmed', () => {
    expect(confirmedFieldsFor(content)).toEqual(['incidentType'])
    expect(confirmedFieldsFor({ ...content, severity: 'low', locationNote: 'x', occurredAt: '2026-03-01T06:00:00.000Z' })).toEqual([
      'incidentType',
      'severity',
      'occurredAt',
      'locationNote',
    ])
  })

  it('edits never lose a confirmation', () => {
    expect(mergeConfirmedFields(['severity', 'incidentType'], ['locationNote'])).toEqual(['incidentType', 'severity', 'locationNote'])
    const clock = makeClock()
    const v1 = createLocalIncident(ID, scope, { ...content, severity: 'low' }, clock)
    const v2 = applyLocalEdit(v1, { ...content, severity: null }, clock)
    expect(v2.confirmedFields).toEqual(['incidentType', 'severity'])
  })

  it('suggestions fill only unconfirmed fields and never overwrite confirmed ones', () => {
    const merged = applySuggestedFields({ ...content, severity: 'low' }, ['incidentType', 'severity'], {
      incidentType: 'leak',
      severity: 'high',
      locationNote: 'Near the trough',
      occurredAt: null,
    })
    expect(merged).toEqual({ ...content, severity: 'low', locationNote: 'Near the trough' })
  })
})
