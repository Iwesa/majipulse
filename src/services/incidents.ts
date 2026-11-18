/** Local incident outbox types shared by the IndexedDB repository, store, UI, and tests. */
import type { IncidentStatus } from '../schemas/incident'
import type { LocalIncidentRecord } from '../schemas/localIncident'
import type { SessionScope } from '../schemas/roles'

/** What the reporter enters. Everything else is set by the draft logic. */
export interface IncidentContent {
  waterPointId: string
  description: string
  incidentType: LocalIncidentRecord['incidentType']
  severity: LocalIncidentRecord['severity']
  /** ISO 8601 with offset. */
  occurredAt?: string
  locationNote?: string
}

export type IncidentOutboxErrorKind = 'alreadyExists' | 'notFound' | 'notEditable' | 'invalid' | 'storage'

export class IncidentOutboxError extends Error {
  readonly kind: IncidentOutboxErrorKind

  constructor(kind: IncidentOutboxErrorKind) {
    super(kind)
    this.name = 'IncidentOutboxError'
    this.kind = kind
  }
}

export const incidentOutboxErrorKind = (error: unknown): IncidentOutboxErrorKind =>
  error instanceof IncidentOutboxError ? error.kind : 'storage'

/**
 * The signed-in user's local reports. Every method only sees records of the
 * scope the repository was opened for; there is no unscoped API (design 4).
 * Records are never deleted here (R5.4).
 */
export interface IncidentRepository {
  readonly scope: SessionScope
  /** Newest first. Invalid stored records are skipped. */
  list(): Promise<LocalIncidentRecord[]>
  get(id: string): Promise<LocalIncidentRecord | null>
  /** Throws IncidentOutboxError('alreadyExists') if the ID is taken. */
  create(record: LocalIncidentRecord): Promise<void>
  /** Throws IncidentOutboxError('notFound') if the record does not exist. */
  update(record: LocalIncidentRecord): Promise<void>
  /**
   * Startup recovery: records left `syncing` by a closed tab or crash go
   * back to `pending`. `inFlight` is kept so the sync engine reconciles it
   * before submitting (design 6). Returns how many were reset.
   */
  resetInterruptedSyncs(): Promise<number>
}

export interface IncidentOutbox {
  forScope(scope: SessionScope): IncidentRepository
}

/** Reporters may edit their report only while the server status is `new` and it is not in conflict. */
export function isEditable(record: Pick<LocalIncidentRecord, 'status' | 'syncStatus'>): boolean {
  const status: IncidentStatus = record.status
  return status === 'new' && record.syncStatus !== 'conflict'
}
