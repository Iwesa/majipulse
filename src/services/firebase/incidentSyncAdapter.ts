import {
  deleteField,
  doc,
  getDocFromServer,
  runTransaction,
  serverTimestamp,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore'
import { incidentSchema } from '../../schemas/incident'
import { decideWrite } from '../sync/decisions'
import { SyncAdapterError, type IncidentSyncAdapter, type MutationSnapshot, type ServerIncident } from '../sync/types'
import { isoToTimestamp, timestampsToIso } from './timestamps'

const COLLECTION = 'incidents'

const codeOf = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : ''

/** Maps Firestore errors to sync error codes. `detail` is the Firestore code only. */
export function toSyncError(error: unknown): SyncAdapterError {
  if (error instanceof SyncAdapterError) return error
  const code = codeOf(error)
  switch (code) {
    case 'unavailable':
    case 'deadline-exceeded':
    case 'cancelled':
    case 'aborted':
    case 'resource-exhausted':
      return new SyncAdapterError('network', code)
    case 'permission-denied':
    case 'unauthenticated':
      return new SyncAdapterError('permission-denied', code)
    case 'invalid-argument':
    case 'failed-precondition':
      return new SyncAdapterError('invalid', code)
    default:
      return new SyncAdapterError('unknown', code || 'unexpected')
  }
}

/** Server document -> validated incident, or a SyncAdapterError if it is not a valid incident. */
export function parseServerIncident(data: DocumentData): ServerIncident {
  const parsed = incidentSchema.safeParse(timestampsToIso(data))
  if (!parsed.success) throw new SyncAdapterError('unknown', 'invalid-server-document')
  return parsed.data
}

/** Reporter-editable fields, as Firestore values. Cleared optional fields are deleted. */
function contentFields(s: MutationSnapshot, forUpdate: boolean): Record<string, unknown> {
  const optional = (value: unknown) => (value === undefined ? (forUpdate ? deleteField() : undefined) : value)
  const fields: Record<string, unknown> = {
    waterPointId: s.waterPointId,
    description: s.description,
    incidentType: s.incidentType,
    severity: s.severity,
    occurredAt: optional(s.occurredAt === undefined ? undefined : isoToTimestamp(s.occurredAt)),
    locationNote: optional(s.locationNote),
    ai: optional(s.ai === undefined ? undefined : { ...s.ai, generatedAt: isoToTimestamp(s.ai.generatedAt) }),
    confirmedFields: [...s.confirmedFields],
    clientRevision: s.clientRevision,
    mutationId: s.mutationId,
  }
  for (const key of Object.keys(fields)) if (fields[key] === undefined) delete fields[key]
  return fields
}

/**
 * Firestore implementation of the sync adapter (T5.1). Writes happen only in
 * a transaction, after reading the current document, so retries are
 * idempotent: the same mutationId is never written twice, and a stale edit is
 * detected before writing. The security rules enforce the same checks.
 */
export function createFirestoreIncidentSyncAdapter(db: Firestore): IncidentSyncAdapter {
  return {
    async readServer(id) {
      let snap
      try {
        snap = await getDocFromServer(doc(db, COLLECTION, id))
      } catch (error) {
        throw toSyncError(error)
      }
      return snap.exists() ? parseServerIncident(snap.data()) : null
    },

    async submit(snapshot) {
      const ref = doc(db, COLLECTION, snapshot.id)
      try {
        return await runTransaction(db, async (tx) => {
          const current = await tx.get(ref)
          const server = current.exists() ? parseServerIncident(current.data()) : null
          const decision = decideWrite(snapshot, server)
          switch (decision.kind) {
            case 'alreadyApplied':
              return { kind: 'alreadyApplied', server: server as ServerIncident }
            case 'stale':
              return { kind: 'stale', server: server as ServerIncident }
            case 'missing':
              return { kind: 'missing' }
            case 'create':
              tx.set(ref, {
                organizationId: snapshot.organizationId,
                reporterId: snapshot.reporterId,
                demo: false,
                status: 'new',
                ...contentFields(snapshot, false),
                baseRevision: 0,
                serverRevision: 1,
                clientCreatedAt: isoToTimestamp(snapshot.clientCreatedAt),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              })
              return { kind: 'committed' }
            case 'update':
              tx.update(ref, {
                ...contentFields(snapshot, true),
                baseRevision: snapshot.baseRevision,
                serverRevision: snapshot.baseRevision + 1,
                updatedAt: serverTimestamp(),
              })
              return { kind: 'committed' }
          }
        })
      } catch (error) {
        throw toSyncError(error)
      }
    },
  }
}
