/**
 * Pure draft and revision logic for local reports (T4.2). No storage or
 * network here. Every function returns a record that passes
 * localIncidentRecordSchema, or throws.
 */
import type { ExtractableField } from '../schemas/incident'
import { localIncidentRecordSchema, type LocalIncidentRecord } from '../schemas/localIncident'
import type { SessionScope } from '../schemas/roles'
import { IncidentOutboxError, isEditable, type IncidentContent } from './incidents'

export interface DraftClock {
  now(): Date
  uuid(): string
}

export const systemClock: DraftClock = {
  now: () => new Date(),
  uuid: () => crypto.randomUUID(),
}

/** Called once when the reporter opens a new report, before any save (R3.1). */
export const newIncidentId = (clock: DraftClock = systemClock): string => clock.uuid()

/**
 * Fields the reporter set themselves count as confirmed: a later AI run must
 * not overwrite them (R4.5). The incident type is always reporter-confirmed.
 */
export function confirmedFieldsFor(content: IncidentContent): ExtractableField[] {
  const fields: ExtractableField[] = ['incidentType']
  if (content.severity !== null) fields.push('severity')
  if (content.occurredAt !== undefined) fields.push('occurredAt')
  if (content.locationNote !== undefined) fields.push('locationNote')
  return fields
}

/** Union in a stable order, so confirmations are never lost. */
export function mergeConfirmedFields(previous: readonly ExtractableField[], next: readonly ExtractableField[]): ExtractableField[] {
  const order: ExtractableField[] = ['incidentType', 'severity', 'occurredAt', 'locationNote']
  const all = new Set([...previous, ...next])
  return order.filter((field) => all.has(field))
}

/** Suggested values (for example from AI, Phase 6). Null means "not stated". */
export type SuggestedFields = { [K in ExtractableField]: IncidentContent[K] | null }

/**
 * Fills only fields the reporter has not confirmed and that the suggestion
 * actually provides. Confirmed fields are never changed (R4.5).
 */
export function applySuggestedFields(
  content: IncidentContent,
  confirmed: readonly ExtractableField[],
  suggested: Partial<SuggestedFields>,
): IncidentContent {
  const next: IncidentContent = { ...content }
  const open = (field: ExtractableField) => !confirmed.includes(field)
  if (open('incidentType') && suggested.incidentType) next.incidentType = suggested.incidentType
  if (open('severity') && suggested.severity) next.severity = suggested.severity
  if (open('occurredAt') && suggested.occurredAt) next.occurredAt = suggested.occurredAt
  if (open('locationNote') && suggested.locationNote) next.locationNote = suggested.locationNote
  return next
}

/**
 * Suggested fields the reporter can still review: the suggestion has a value
 * and the reporter has not confirmed the field. Same rule as
 * applySuggestedFields, used when suggestions are applied one by one.
 */
export function reviewableSuggestions(
  suggested: Partial<SuggestedFields>,
  confirmed: readonly ExtractableField[],
): ExtractableField[] {
  const order: ExtractableField[] = ['incidentType', 'severity', 'occurredAt', 'locationNote']
  return order.filter((field) => !confirmed.includes(field) && suggested[field] !== null && suggested[field] !== undefined)
}

const contentFields = (content: IncidentContent) => ({
  waterPointId: content.waterPointId,
  description: content.description,
  incidentType: content.incidentType,
  severity: content.severity,
  ...(content.occurredAt !== undefined ? { occurredAt: content.occurredAt } : {}),
  ...(content.locationNote !== undefined ? { locationNote: content.locationNote } : {}),
  ...(content.ai !== undefined ? { ai: content.ai } : {}),
})

function validated(record: LocalIncidentRecord): LocalIncidentRecord {
  const parsed = localIncidentRecordSchema.safeParse(record)
  if (!parsed.success) throw new IncidentOutboxError('invalid')
  return parsed.data
}

/**
 * First local save of a new report. Never synced, so baseRevision is 0 and
 * serverRevision is not set yet (it is assigned when the server accepts it).
 */
export function createLocalIncident(
  id: string,
  scope: SessionScope,
  content: IncidentContent,
  clock: DraftClock = systemClock,
): LocalIncidentRecord {
  return validated({
    id,
    ownerUid: scope.ownerUid,
    organizationId: scope.organizationId,
    reporterId: scope.ownerUid,
    demo: false,
    ...contentFields(content),
    status: 'new',
    baseRevision: 0,
    clientRevision: 1,
    mutationId: clock.uuid(),
    clientCreatedAt: clock.now().toISOString(),
    confirmedFields: confirmedFieldsFor(content),
    syncStatus: 'pending',
  })
}

/**
 * A later local save (R3.4): increments clientRevision and generates a new
 * mutationId. baseRevision and inFlight are kept, because the edit is still
 * based on the same server revision (design 6). A synced or failed record
 * goes back to pending.
 */
export function applyLocalEdit(
  record: LocalIncidentRecord,
  content: IncidentContent,
  clock: DraftClock = systemClock,
): LocalIncidentRecord {
  if (!isEditable(record)) throw new IncidentOutboxError('notEditable')
  const {
    occurredAt: _o,
    locationNote: _l,
    ai: _a,
    failureKind: _f,
    lastError: _e,
    ...rest
  } = record
  void _o
  void _l
  void _a
  void _f
  void _e
  return validated({
    ...rest,
    ...contentFields(content),
    clientRevision: record.clientRevision + 1,
    mutationId: clock.uuid(),
    confirmedFields: mergeConfirmedFields(record.confirmedFields, confirmedFieldsFor(content)),
    // A submission in progress keeps its status; the engine reconciles it.
    syncStatus: record.syncStatus === 'syncing' ? 'syncing' : 'pending',
  })
}

/** Content of a record, for filling the edit form. */
export function contentOf(record: LocalIncidentRecord): IncidentContent {
  return {
    waterPointId: record.waterPointId,
    description: record.description,
    incidentType: record.incidentType,
    severity: record.severity,
    ...(record.occurredAt !== undefined ? { occurredAt: record.occurredAt } : {}),
    ...(record.locationNote !== undefined ? { locationNote: record.locationNote } : {}),
    ...(record.ai !== undefined ? { ai: record.ai } : {}),
  }
}
