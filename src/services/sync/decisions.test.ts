import { describe, expect, it } from 'vitest'
import { incident as serverFixture } from '../../test/fixtures'
import { classifyPermissionDenied, decideWrite, reconcileInFlight } from './decisions'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const server = (o: Partial<ReturnType<typeof serverFixture>> = {}) => ({ ...serverFixture(), mutationId: A, ...o })
const triaged = () =>
  server({ status: 'triaged', serverRevision: 2, lastStatusChange: { by: 'uid-tech', at: '2026-03-01T09:00:00Z', from: 'new', to: 'triaged' } })

describe('decideWrite', () => {
  it.each([
    ['create when missing and base 0', { mutationId: B, baseRevision: 0 }, null, 'create'],
    ['already applied (same mutation)', { mutationId: A, baseRevision: 0 }, server(), 'alreadyApplied'],
    ['stale create (another document exists)', { mutationId: B, baseRevision: 0 }, server(), 'stale'],
    ['update from the current revision', { mutationId: B, baseRevision: 1 }, server(), 'update'],
    ['stale update (server ahead)', { mutationId: B, baseRevision: 1 }, server({ serverRevision: 2, baseRevision: 1 }), 'stale'],
    ['stale update (triaged)', { mutationId: B, baseRevision: 2 }, triaged(), 'stale'],
    ['missing document for an update', { mutationId: B, baseRevision: 1 }, null, 'missing'],
  ] as const)('%s', (_label, snapshot, srv, kind) => {
    expect(decideWrite(snapshot, srv).kind).toBe(kind)
  })
})

describe('reconcileInFlight', () => {
  it('committed: server holds the in-flight mutation (even after triage)', () => {
    expect(reconcileInFlight({ mutationId: A, baseRevision: 0, startedAt: 'x' }, server())).toEqual({ kind: 'committed', revision: 1 })
    expect(reconcileInFlight({ mutationId: A, baseRevision: 0, startedAt: 'x' }, triaged())).toEqual({ kind: 'committed', revision: 1 })
  })
  it('not committed: missing new report, or server still at the base revision', () => {
    expect(reconcileInFlight({ mutationId: B, baseRevision: 0, startedAt: 'x' }, null).kind).toBe('notCommitted')
    expect(reconcileInFlight({ mutationId: B, baseRevision: 1, startedAt: 'x' }, server()).kind).toBe('notCommitted')
  })
  it('superseded: a different write is past the base', () => {
    expect(reconcileInFlight({ mutationId: B, baseRevision: 1, startedAt: 'x' }, triaged()).kind).toBe('superseded')
    expect(reconcileInFlight({ mutationId: B, baseRevision: 0, startedAt: 'x' }, server()).kind).toBe('superseded')
  })
})

describe('classifyPermissionDenied (AC18)', () => {
  it.each([
    ['server revision ahead', { mutationId: B, baseRevision: 1 }, server({ serverRevision: 2, baseRevision: 1 }), 'conflict'],
    ['status past new', { mutationId: B, baseRevision: 2 }, triaged(), 'conflict'],
    ['server equals the snapshot base (field validation)', { mutationId: B, baseRevision: 1 }, server(), 'permissionDenied'],
    ['document missing', { mutationId: B, baseRevision: 1 }, null, 'permissionDenied'],
    ['already applied', { mutationId: A, baseRevision: 0 }, server(), 'committed'],
  ] as const)('%s -> %s', (_label, snapshot, srv, kind) => {
    expect(classifyPermissionDenied(snapshot, srv).kind).toBe(kind)
  })
})
