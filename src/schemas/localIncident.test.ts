import { describe, expect, it } from 'vitest'
import { MUTATION_ID, MUTATION_ID_2, T0, T1, incident, localRecord } from '../test/fixtures'
import { localIncidentRecordSchema } from './localIncident'

const inFlight = { mutationId: MUTATION_ID, baseRevision: 0, startedAt: T1 }

const synced = () => ({ ...localRecord(), syncStatus: 'synced' as const, serverRevision: 1, baseRevision: 1, syncedAt: T1 })

function issuePaths(value: unknown): string[] {
  const result = localIncidentRecordSchema.safeParse(value)
  return result.success ? [] : result.error.issues.map((i) => i.path.join('.'))
}

describe('localIncidentRecordSchema: valid states', () => {
  it('accepts a pending never-synced record', () => {
    expect(issuePaths(localRecord())).toEqual([])
  })
  it('accepts a syncing record with inFlight', () => {
    expect(issuePaths({ ...localRecord(), syncStatus: 'syncing', inFlight })).toEqual([])
  })
  it('accepts a synced record', () => {
    expect(issuePaths(synced())).toEqual([])
  })
  it('accepts a failed record with failureKind and a kept inFlight (uncertain commit)', () => {
    const value = { ...localRecord(), syncStatus: 'failed', failureKind: 'network', lastError: 'Offline', lastAttemptAt: T1, inFlight }
    expect(issuePaths(value)).toEqual([])
  })
  it('accepts a pending edit made during sync: new mutationId, same base, inFlight kept', () => {
    const value = { ...localRecord(), mutationId: MUTATION_ID_2, clientRevision: 2, inFlight }
    expect(issuePaths(value)).toEqual([])
  })
  it('accepts a conflict record with a server snapshot', () => {
    const value = { ...synced(), syncStatus: 'conflict', syncedAt: undefined, conflictServerSnapshot: incident() }
    delete (value as Record<string, unknown>).syncedAt
    expect(issuePaths(value)).toEqual([])
  })
})

describe('localIncidentRecordSchema: invariants', () => {
  it('rejects unknown sync statuses and failure kinds', () => {
    expect(issuePaths({ ...localRecord(), syncStatus: 'queued' })).not.toEqual([])
    expect(issuePaths({ ...localRecord(), syncStatus: 'failed', failureKind: 'timeout' })).not.toEqual([])
  })
  it('requires ownerUid to equal reporterId', () => {
    expect(issuePaths({ ...localRecord(), ownerUid: 'uid-someone-else' })).toContain('ownerUid')
  })
  it('requires failureKind exactly when failed', () => {
    expect(issuePaths({ ...localRecord(), syncStatus: 'failed' })).toContain('failureKind')
    expect(issuePaths({ ...localRecord(), failureKind: 'network' })).toContain('failureKind')
  })
  it('requires a server snapshot exactly when in conflict', () => {
    expect(issuePaths({ ...localRecord(), syncStatus: 'conflict' })).toContain('conflictServerSnapshot')
    expect(issuePaths({ ...localRecord(), conflictServerSnapshot: incident() })).toContain('conflictServerSnapshot')
  })
  it('rejects a conflict snapshot from another organization', () => {
    const snapshot = { ...incident(), organizationId: 'other-demo-org' }
    const value = { ...synced(), syncStatus: 'conflict', conflictServerSnapshot: snapshot }
    delete (value as Record<string, unknown>).syncedAt
    expect(issuePaths(value)).toContain('conflictServerSnapshot')
  })
  it('requires inFlight while syncing', () => {
    expect(issuePaths({ ...localRecord(), syncStatus: 'syncing' })).toContain('inFlight')
  })
  it('rejects synced records without syncedAt or serverRevision, or with inFlight', () => {
    const { syncedAt: _s, ...noSyncedAt } = synced()
    void _s
    expect(issuePaths(noSyncedAt)).toContain('syncedAt')
    expect(issuePaths({ ...synced(), serverRevision: undefined, baseRevision: 0 })).toContain('serverRevision')
    expect(issuePaths({ ...synced(), inFlight: { ...inFlight, baseRevision: 1 } })).toContain('inFlight')
  })
  it('requires inFlight.baseRevision to equal baseRevision', () => {
    expect(issuePaths({ ...localRecord(), inFlight: { ...inFlight, baseRevision: 3 } })).toContain('inFlight')
  })
  it('requires baseRevision 0 before the first sync', () => {
    expect(issuePaths({ ...localRecord(), baseRevision: 1 })).toContain('baseRevision')
  })
  it('rejects baseRevision ahead of the known serverRevision', () => {
    expect(issuePaths({ ...localRecord(), serverRevision: 1, baseRevision: 2 })).toContain('baseRevision')
  })
  it('rejects server-only timestamps and unknown keys', () => {
    expect(issuePaths({ ...localRecord(), createdAt: T0 })).not.toEqual([])
    expect(issuePaths({ ...localRecord(), deleted: true })).not.toEqual([])
  })
  it('rejects a non-UUID id and an invalid inFlight', () => {
    expect(issuePaths({ ...localRecord(), id: 'incident-1' })).not.toEqual([])
    expect(issuePaths({ ...localRecord(), inFlight: { mutationId: 'x', baseRevision: 0, startedAt: T1 } })).not.toEqual([])
  })
  it('bounds lastError length', () => {
    const base = { ...localRecord(), syncStatus: 'failed', failureKind: 'unknown' }
    expect(issuePaths({ ...base, lastError: 'e'.repeat(500) })).toEqual([])
    expect(issuePaths({ ...base, lastError: 'e'.repeat(501) })).not.toEqual([])
  })
})
