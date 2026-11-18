/**
 * Pure changes to local records made by sync and conflict review. Content
 * fields are never touched except by `discardLocalEdit`, which the reporter
 * confirms explicitly. Each function returns null when the record is no
 * longer in the expected state (for example, a different mutation is now in
 * flight), so a late result can never overwrite newer data.
 */
import type { FailureKind, LocalIncidentRecord } from '../../schemas/localIncident'
import type { DraftClock } from '../incidentDrafts'
import type { MutationSnapshot, ServerIncident } from './types'

type Record = LocalIncidentRecord

const withoutFailure = (r: Record): Record => {
  const { failureKind: _f, lastError: _e, ...rest } = r
  void _f
  void _e
  return rest
}

const withoutInFlight = (r: Record): Record => {
  const { inFlight: _i, ...rest } = r
  void _i
  return rest
}

const withoutConflict = (r: Record): Record => {
  const { conflictServerSnapshot: _c, ...rest } = r
  void _c
  return rest
}

/** Records the sync engine should send: new or edited reports, and network failures (auto-retried). */
export const isSendable = (r: Record): boolean =>
  r.syncStatus === 'pending' || (r.syncStatus === 'failed' && r.failureKind === 'network')

/** Takes the immutable snapshot and persists it as `inFlight` before any network call. */
export function markSyncing(r: Record, nowIso: string): Record | null {
  if (r.inFlight || !isSendable(r)) return null
  return {
    ...withoutFailure(r),
    syncStatus: 'syncing',
    inFlight: { mutationId: r.mutationId, baseRevision: r.baseRevision, startedAt: nowIso },
    lastAttemptAt: nowIso,
  }
}

export const toSnapshot = (r: Record): MutationSnapshot => {
  if (!r.inFlight) throw new Error('A snapshot needs inFlight')
  return Object.freeze({ ...r, inFlight: r.inFlight })
}

/**
 * The in-flight mutation is confirmed on the server. If the record still
 * holds that mutation it is synced; if the reporter edited meanwhile, the
 * newer edit stays pending and now builds on the committed revision (R5.12).
 */
export function applyCommitted(r: Record, inFlightMutationId: string, revision: number, server: ServerIncident | null, nowIso: string): Record | null {
  if (r.inFlight?.mutationId !== inFlightMutationId) return null
  const base = { ...withoutFailure(withoutInFlight(r)), baseRevision: revision, serverRevision: revision }
  if (r.mutationId !== inFlightMutationId) return { ...base, syncStatus: 'pending' }
  const synced: Record = { ...base, syncStatus: 'synced', syncedAt: nowIso }
  // Show staff progress (for example triage) that happened after the commit.
  if (server && server.status !== r.status && server.lastStatusChange) {
    return { ...synced, status: server.status, lastStatusChange: server.lastStatusChange }
  }
  return synced
}

/** The earlier mutation did not commit: clear it so the current content is sent from the same base. */
export function applyNotCommitted(r: Record, inFlightMutationId: string): Record | null {
  if (r.inFlight?.mutationId !== inFlightMutationId) return null
  return { ...withoutFailure(withoutInFlight(r)), syncStatus: 'pending' }
}

/** The server moved on. The local edit is kept unchanged for review (R5.6). */
export function applyConflict(r: Record, inFlightMutationId: string, server: ServerIncident): Record | null {
  if (r.inFlight && r.inFlight.mutationId !== inFlightMutationId) return null
  return { ...withoutFailure(withoutInFlight(r)), syncStatus: 'conflict', conflictServerSnapshot: server }
}

/** Sending failed. `inFlight` is kept: the outcome may be unknown, so it is reconciled first next time. */
export function applyFailed(r: Record, inFlightMutationId: string, kind: FailureKind, code: string, nowIso: string): Record | null {
  if (r.inFlight?.mutationId !== inFlightMutationId) return null
  return { ...r, syncStatus: 'failed', failureKind: kind, lastError: code.slice(0, 100), lastAttemptAt: nowIso }
}

/** Manual retry of a failed report (any failure kind). */
export function markForRetry(r: Record): Record | null {
  if (r.syncStatus !== 'failed') return null
  return { ...withoutFailure(r), syncStatus: 'pending' }
}

/** Retry on latest: only while the server copy is still `new` (design "Conflict handling"). */
export const canRetryOnLatest = (r: Record): boolean =>
  r.syncStatus === 'conflict' && r.conflictServerSnapshot?.status === 'new'

export function retryOnLatest(r: Record, clock: DraftClock): Record | null {
  if (!canRetryOnLatest(r) || !r.conflictServerSnapshot) return null
  const server = r.conflictServerSnapshot
  return {
    ...withoutConflict(withoutInFlight(withoutFailure(r))),
    baseRevision: server.serverRevision,
    serverRevision: server.serverRevision,
    clientRevision: r.clientRevision + 1,
    mutationId: clock.uuid(),
    syncStatus: 'pending',
  }
}

/** Discard my edit (confirmed by the reporter): the local record becomes the server version. */
export function discardLocalEdit(r: Record, nowIso: string): Record | null {
  if (r.syncStatus !== 'conflict' || !r.conflictServerSnapshot) return null
  const s = r.conflictServerSnapshot
  const record: Record = {
    id: r.id,
    ownerUid: r.ownerUid,
    organizationId: s.organizationId,
    waterPointId: s.waterPointId,
    reporterId: s.reporterId,
    demo: s.demo,
    description: s.description,
    incidentType: s.incidentType,
    severity: s.severity,
    status: s.status,
    baseRevision: s.serverRevision,
    serverRevision: s.serverRevision,
    clientRevision: s.clientRevision,
    mutationId: s.mutationId,
    clientCreatedAt: s.clientCreatedAt,
    confirmedFields: s.confirmedFields,
    syncStatus: 'synced',
    syncedAt: nowIso,
  }
  if (s.occurredAt !== undefined) record.occurredAt = s.occurredAt
  if (s.locationNote !== undefined) record.locationNote = s.locationNote
  if (s.lastStatusChange !== undefined) record.lastStatusChange = s.lastStatusChange
  if (s.ai !== undefined) record.ai = s.ai
  return record
}
