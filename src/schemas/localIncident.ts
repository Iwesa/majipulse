import { z } from 'zod'
import { isoDateTimeSchema, optionalText, revisionSchema, uidSchema, uuidSchema } from './common'
import { checkStatusHistory, incidentContentShape, incidentSchema } from './incident'

export const syncStatusSchema = z.enum(['pending', 'syncing', 'synced', 'failed', 'conflict'])
export type SyncStatus = z.infer<typeof syncStatusSchema>

export const failureKindSchema = z.enum(['network', 'permission_denied', 'validation', 'unknown'])
export type FailureKind = z.infer<typeof failureKindSchema>

/** A submitted mutation whose outcome is not yet confirmed (design section 6). */
export const inFlightSchema = z.strictObject({
  mutationId: uuidSchema,
  baseRevision: revisionSchema,
  startedAt: isoDateTimeSchema,
})
export type InFlight = z.infer<typeof inFlightSchema>

/**
 * Incident record in the local IndexedDB outbox. Holds the reporter's content
 * plus sync metadata. Server timestamps are absent until the first sync.
 */
export const localIncidentRecordSchema = z
  .strictObject({
    ...incidentContentShape,
    id: uuidSchema,
    ownerUid: uidSchema,
    serverRevision: z.int().min(1).optional(),
    syncStatus: syncStatusSchema,
    failureKind: failureKindSchema.optional(),
    lastError: optionalText(500).optional(),
    lastAttemptAt: isoDateTimeSchema.optional(),
    syncedAt: isoDateTimeSchema.optional(),
    inFlight: inFlightSchema.optional(),
    conflictServerSnapshot: incidentSchema.optional(),
  })
  .superRefine((r, ctx) => {
    checkStatusHistory(r, ctx)
    const issue = (message: string, path: string) => ctx.addIssue({ code: 'custom', message, path: [path] })

    // Local records are always the owner's own reports.
    if (r.ownerUid !== r.reporterId) issue('ownerUid must equal reporterId', 'ownerUid')

    // failureKind is present exactly when the status is failed.
    if (r.syncStatus === 'failed' && !r.failureKind) issue('A failed record needs failureKind', 'failureKind')
    if (r.syncStatus !== 'failed' && r.failureKind) issue('Only failed records have failureKind', 'failureKind')

    // conflictServerSnapshot is present exactly when the status is conflict.
    if (r.syncStatus === 'conflict' && !r.conflictServerSnapshot) {
      issue('A conflict record needs conflictServerSnapshot', 'conflictServerSnapshot')
    }
    if (r.syncStatus !== 'conflict' && r.conflictServerSnapshot) {
      issue('Only conflict records have conflictServerSnapshot', 'conflictServerSnapshot')
    }
    if (r.conflictServerSnapshot && r.conflictServerSnapshot.organizationId !== r.organizationId) {
      issue('conflictServerSnapshot must belong to the same organization', 'conflictServerSnapshot')
    }

    // A record being submitted always has its in-flight mutation recorded.
    if (r.syncStatus === 'syncing' && !r.inFlight) issue('A syncing record needs inFlight', 'inFlight')

    // A synced record has a confirmed server revision and nothing in flight.
    if (r.syncStatus === 'synced') {
      if (!r.syncedAt) issue('A synced record needs syncedAt', 'syncedAt')
      if (r.serverRevision === undefined) issue('A synced record needs serverRevision', 'serverRevision')
      if (r.inFlight) issue('A synced record cannot have inFlight', 'inFlight')
    }

    // Edits never change baseRevision while a mutation is in flight.
    if (r.inFlight && r.inFlight.baseRevision !== r.baseRevision) {
      issue('inFlight.baseRevision must equal baseRevision', 'inFlight')
    }

    // A never-synced report starts from revision 0.
    if (r.serverRevision === undefined && r.baseRevision !== 0) {
      issue('An unsynced record must have baseRevision 0', 'baseRevision')
    }
    if (r.serverRevision !== undefined && r.baseRevision > r.serverRevision) {
      issue('baseRevision cannot be ahead of the known serverRevision', 'baseRevision')
    }
  })
export type LocalIncidentRecord = z.infer<typeof localIncidentRecordSchema>
