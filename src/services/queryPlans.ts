/**
 * Declarative shapes of every staff list and count query (T7.1). The
 * Firestore services build their queries from these plans, and a unit test
 * checks each plan against `firestore.indexes.json`, so a new filter cannot
 * ship without its composite index. The Firestore emulator does not enforce
 * indexes, so that test is the check.
 *
 * `organizationId ==` is not listed: `orgScopedQuery` always adds it first.
 */
import type { IncidentStatus } from '../schemas/incident'
import type { MaintenanceStatus } from '../schemas/maintenanceTask'

export type PlannedCollection = 'incidents' | 'maintenanceTasks' | 'patternAnalyses'
export type SortDirection = 'asc' | 'desc'

export interface QueryPlan {
  collection: PlannedCollection
  /** Equality filters after `organizationId`, in order. */
  equals: ReadonlyArray<readonly [field: string, value: string]>
  orderBy: readonly [field: string, direction: SortDirection] | null
  limit: number | null
}

export const QUEUE_LIMIT = 100

export type IncidentQueueOrder = 'newest' | 'oldest'

export interface IncidentQueueFilter {
  status: IncidentStatus | null
  waterPointId: string | null
  order: IncidentQueueOrder
}

export const DEFAULT_QUEUE_FILTER: IncidentQueueFilter = { status: null, waterPointId: null, order: 'newest' }

export function incidentQueuePlan(filter: IncidentQueueFilter): QueryPlan {
  const equals: Array<[string, string]> = []
  if (filter.status) equals.push(['status', filter.status])
  if (filter.waterPointId) equals.push(['waterPointId', filter.waterPointId])
  return { collection: 'incidents', equals, orderBy: ['createdAt', filter.order === 'newest' ? 'desc' : 'asc'], limit: QUEUE_LIMIT }
}

export interface TaskListFilter {
  status: MaintenanceStatus | null
}

export function taskListPlan(filter: TaskListFilter): QueryPlan {
  return {
    collection: 'maintenanceTasks',
    equals: filter.status ? [['status', filter.status]] : [],
    orderBy: ['updatedAt', 'desc'],
    limit: QUEUE_LIMIT,
  }
}

export function tasksForIncidentPlan(incidentId: string): QueryPlan {
  return { collection: 'maintenanceTasks', equals: [['incidentId', incidentId]], orderBy: ['createdAt', 'desc'], limit: QUEUE_LIMIT }
}

/** Dashboard counts (T7.4). */
export function incidentCountPlan(status: IncidentStatus): QueryPlan {
  return { collection: 'incidents', equals: [['status', status]], orderBy: null, limit: null }
}

export function taskCountPlan(status: MaintenanceStatus): QueryPlan {
  return { collection: 'maintenanceTasks', equals: [['status', status]], orderBy: null, limit: null }
}

export const ANALYSIS_LIST_LIMIT = 20

/** Saved pattern analyses, newest first (T8.4). */
export function analysisListPlan(): QueryPlan {
  return { collection: 'patternAnalyses', equals: [], orderBy: ['createdAt', 'desc'], limit: ANALYSIS_LIST_LIMIT }
}