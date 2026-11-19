/**
 * Staff (administrator and technician) services for triage, maintenance, and
 * the dashboard (Phase 7). All are online only and organization-scoped: every
 * query is built with `orgScopedQuery` from a plan in `queryPlans.ts`, and the
 * security rules enforce the same limits. All methods throw StaffDataError.
 */
import type { Incident, IncidentStatus } from '../schemas/incident'
import type { MaintenanceStatus, MaintenanceTask, MaintenanceTaskInput } from '../schemas/maintenanceTask'
import type { SessionScope } from '../schemas/roles'
import type { IncidentQueueFilter, TaskListFilter } from './queryPlans'

export type StaffDataErrorKind =
  /** Rules denied the request (role or organization). */
  | 'permission'
  | 'network'
  | 'notFound'
  /** Input failed validation, or a linked record does not match. */
  | 'invalid'
  /** Someone else changed the record since it was loaded. */
  | 'stale'
  /** The requested status change is not allowed (R7.2, R8.2). */
  | 'transition'
  | 'unknown'

export class StaffDataError extends Error {
  readonly kind: StaffDataErrorKind
  constructor(kind: StaffDataErrorKind) {
    super(kind)
    this.name = 'StaffDataError'
    this.kind = kind
  }
}

export const staffDataErrorKind = (error: unknown): StaffDataErrorKind =>
  error instanceof StaffDataError ? error.kind : 'unknown'

export type StaffIncident = Incident & { id: string }

export interface StaffIncidentService {
  /** The organization's incidents for the filter, at most QUEUE_LIMIT. Invalid documents are skipped. */
  list(scope: SessionScope, filter: IncidentQueueFilter): Promise<StaffIncident[]>
  /** Null if missing or in another organization. */
  get(scope: SessionScope, id: string): Promise<StaffIncident | null>
  /**
   * Moves the incident one step along new -> triaged -> in_progress -> resolved,
   * in a transaction. Throws 'stale' if its status or revision changed since
   * `seen` was loaded, 'transition' for any other change.
   */
  changeStatus(scope: SessionScope, seen: Pick<StaffIncident, 'id' | 'status' | 'serverRevision'>, to: IncidentStatus): Promise<void>
}

export type MaintenanceTaskRecord = MaintenanceTask & { id: string }

/** The incident a new task is created from (R8.1). */
export interface TaskLink {
  incidentId: string
  waterPointId: string
}

export interface MaintenanceService {
  list(scope: SessionScope, filter: TaskListFilter): Promise<MaintenanceTaskRecord[]>
  listForIncident(scope: SessionScope, incidentId: string): Promise<MaintenanceTaskRecord[]>
  get(scope: SessionScope, id: string): Promise<MaintenanceTaskRecord | null>
  /** Status `open`. Checks the incident is in the organization and on the same water point. Returns the new ID. */
  create(scope: SessionScope, link: TaskLink, input: MaintenanceTaskInput): Promise<string>
  /** Title, notes, and assignee. The status is unchanged. */
  update(scope: SessionScope, id: string, input: MaintenanceTaskInput): Promise<void>
  /** open -> in_progress -> done only (R8.2). Same 'stale' and 'transition' rules as incidents. */
  changeStatus(scope: SessionScope, seen: Pick<MaintenanceTaskRecord, 'id' | 'status'>, to: MaintenanceStatus): Promise<void>
}

/** Statuses counted as open work on the dashboard. */
export const OPEN_INCIDENT_STATUSES = ['new', 'triaged', 'in_progress'] as const satisfies readonly IncidentStatus[]
export const OPEN_TASK_STATUSES = ['open', 'in_progress'] as const satisfies readonly MaintenanceStatus[]

export interface StaffCounts {
  incidents: Record<(typeof OPEN_INCIDENT_STATUSES)[number], number>
  tasks: Record<(typeof OPEN_TASK_STATUSES)[number], number>
}

export interface DashboardService {
  /** Server-side counts for the organization (T7.4). */
  staffCounts(scope: SessionScope): Promise<StaffCounts>
}
