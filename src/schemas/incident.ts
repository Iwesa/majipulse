import { z } from 'zod'
import {
  documentIdSchema,
  isoDateTimeSchema,
  organizationIdSchema,
  requiredText,
  revisionSchema,
  uidSchema,
  uniqueArray,
  uuidSchema,
} from './common'

export const incidentTypeSchema = z.enum([
  'no_water',
  'low_flow',
  'leak',
  'water_quality_concern',
  'pump_or_equipment_issue',
  'other',
])
export const severitySchema = z.enum(['low', 'medium', 'high'])
export const incidentStatusSchema = z.enum(['new', 'triaged', 'in_progress', 'resolved'])
export type IncidentStatus = z.infer<typeof incidentStatusSchema>

/** The only allowed status transitions (R7.2). Security rules enforce the same list. */
export const INCIDENT_STATUS_TRANSITIONS = {
  new: ['triaged'],
  triaged: ['in_progress'],
  in_progress: ['resolved'],
  resolved: [],
} as const satisfies Record<IncidentStatus, readonly IncidentStatus[]>

export const isAllowedIncidentTransition = (from: IncidentStatus, to: IncidentStatus): boolean =>
  (INCIDENT_STATUS_TRANSITIONS[from] as readonly IncidentStatus[]).includes(to)

export const DESCRIPTION_MAX = 2000
export const LOCATION_NOTE_MAX = 300

/** Fields AI may suggest and the reporter can confirm or edit. */
export const extractableFieldSchema = z.enum(['incidentType', 'severity', 'occurredAt', 'locationNote'])
export type ExtractableField = z.infer<typeof extractableFieldSchema>

/** Inference source exactly as reported by the Firebase AI Logic SDK (`InferenceSource.ON_DEVICE` is 'on_device'). */
export const inferenceSourceSchema = z.enum(['on_device', 'in_cloud'])

/** Suggested values. Every field is nullable: absent facts stay null (R4.6). */
export const suggestedFieldsSchema = z.strictObject({
  incidentType: incidentTypeSchema.nullable(),
  severity: severitySchema.nullable(),
  occurredAt: isoDateTimeSchema.nullable(),
  locationNote: requiredText(LOCATION_NOTE_MAX).nullable(),
})

/**
 * Raw extraction payload from the model. Unknown keys are stripped (not
 * rejected) as the AI safety rules require; values are still strictly typed.
 * Further checks (grounding, placeholder echo) run in the AI service.
 */
export const aiExtractionOutputSchema = z.object({
  incidentType: incidentTypeSchema.nullable(),
  severity: severitySchema.nullable(),
  occurredAt: isoDateTimeSchema.nullable(),
  locationNote: requiredText(LOCATION_NOTE_MAX).nullable(),
})
export type AiExtractionOutput = z.infer<typeof aiExtractionOutputSchema>

/** Validated AI suggestion stored with an incident, with provenance (R4.2). */
export const aiSuggestionSchema = z.strictObject({
  suggested: suggestedFieldsSchema,
  inferenceSource: inferenceSourceSchema,
  model: requiredText(100),
  generatedAt: isoDateTimeSchema,
})
export type AiSuggestion = z.infer<typeof aiSuggestionSchema>

export const statusChangeSchema = z
  .strictObject({
    by: uidSchema,
    at: isoDateTimeSchema,
    from: incidentStatusSchema,
    to: incidentStatusSchema,
  })
  .refine((c) => isAllowedIncidentTransition(c.from, c.to), {
    error: 'Status transition is not allowed',
    path: ['to'],
  })

/** Reporter-entered content shared by server documents and local records. */
const incidentContentShape = {
  organizationId: organizationIdSchema,
  waterPointId: documentIdSchema,
  reporterId: uidSchema,
  demo: z.boolean(),
  description: requiredText(DESCRIPTION_MAX),
  incidentType: incidentTypeSchema,
  severity: severitySchema.nullable(),
  occurredAt: isoDateTimeSchema.optional(),
  locationNote: requiredText(LOCATION_NOTE_MAX).optional(),
  status: incidentStatusSchema,
  lastStatusChange: statusChangeSchema.optional(),
  baseRevision: revisionSchema,
  clientRevision: z.int().min(1),
  mutationId: uuidSchema,
  clientCreatedAt: isoDateTimeSchema,
  ai: aiSuggestionSchema.optional(),
  confirmedFields: uniqueArray(extractableFieldSchema),
}

type IncidentContentCheck = {
  status: IncidentStatus
  lastStatusChange?: { to: IncidentStatus } | undefined
}

/** Shared cross-field checks: status history must match the current status. */
function checkStatusHistory(i: IncidentContentCheck, ctx: z.RefinementCtx): void {
  if (i.status === 'new' && i.lastStatusChange) {
    ctx.addIssue({ code: 'custom', message: 'A new incident has no status change', path: ['lastStatusChange'] })
  }
  if (i.status !== 'new' && !i.lastStatusChange) {
    ctx.addIssue({ code: 'custom', message: 'A triaged incident needs lastStatusChange', path: ['lastStatusChange'] })
  }
  if (i.lastStatusChange && i.lastStatusChange.to !== i.status) {
    ctx.addIssue({ code: 'custom', message: 'lastStatusChange.to must equal status', path: ['lastStatusChange', 'to'] })
  }
}

/** `incidents/{incidentId}` as stored in Firestore. */
export const incidentSchema = z
  .strictObject({
    ...incidentContentShape,
    serverRevision: z.int().min(1),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .superRefine((i, ctx) => {
    checkStatusHistory(i, ctx)
    // Content writes set baseRevision to the previous serverRevision; status
    // updates only increase serverRevision. So base is always below server.
    if (i.baseRevision >= i.serverRevision) {
      ctx.addIssue({ code: 'custom', message: 'baseRevision must be lower than serverRevision', path: ['baseRevision'] })
    }
  })
export type Incident = z.infer<typeof incidentSchema>

export { incidentContentShape, checkStatusHistory }
