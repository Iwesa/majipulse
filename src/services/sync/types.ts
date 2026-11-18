/** Types shared by the sync engine, the Firestore adapter, and test fakes. */
import type { Incident } from '../../schemas/incident'
import type { LocalIncidentRecord } from '../../schemas/localIncident'

/** A validated incident document as stored on the server. */
export type ServerIncident = Incident

/**
 * An immutable copy of a local record taken when it is submitted. Only this
 * copy is written; edits made while it is in flight never change it (R5.11).
 */
export type MutationSnapshot = Readonly<LocalIncidentRecord> & {
  readonly inFlight: NonNullable<LocalIncidentRecord['inFlight']>
}

export type SubmitResult =
  /** The transaction wrote this mutation. Its revision is baseRevision + 1. */
  | { kind: 'committed' }
  /** The server already holds this exact mutation (lost acknowledgement). */
  | { kind: 'alreadyApplied'; server: ServerIncident }
  /** The server moved on: this edit is based on an old revision or the report was triaged. */
  | { kind: 'stale'; server: ServerIncident }
  /** An update targets a document that does not exist. */
  | { kind: 'missing' }

export type SyncErrorCode = 'network' | 'permission-denied' | 'invalid' | 'unknown'

/** Errors thrown by an adapter. `detail` is a short code, never user data. */
export class SyncAdapterError extends Error {
  readonly code: SyncErrorCode
  readonly detail: string

  constructor(code: SyncErrorCode, detail: string = code) {
    super(`${code}: ${detail}`)
    this.name = 'SyncAdapterError'
    this.code = code
    this.detail = detail
  }
}

export const syncErrorOf = (error: unknown): SyncAdapterError =>
  error instanceof SyncAdapterError ? error : new SyncAdapterError('unknown', 'unexpected')

/** Server access used by the sync engine. Both methods throw SyncAdapterError. */
export interface IncidentSyncAdapter {
  /** Reads from the server only (never a local cache). Null if the document does not exist. */
  readServer(id: string): Promise<ServerIncident | null>
  /** Writes the snapshot in one transaction, using `decideWrite` on the server state it reads. */
  submit(snapshot: MutationSnapshot): Promise<SubmitResult>
}

/** Minimal Web Locks API surface (navigator.locks), injectable for tests. */
export interface LockManagerLike {
  request<T>(name: string, options: { ifAvailable: boolean }, callback: (lock: unknown) => Promise<T>): Promise<T>
}
