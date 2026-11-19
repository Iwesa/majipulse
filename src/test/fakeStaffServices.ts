// In-memory staff services for UI and store tests (FICTIONAL data). They
// apply the same scoping and transition checks as the Firestore services.
import { vi } from 'vitest'
import { isAllowedIncidentTransition, type Incident } from '../schemas/incident'
import { isAllowedMaintenanceTransition, maintenanceTaskInputSchema } from '../schemas/maintenanceTask'
import type { PatternAnalysisRecord, PatternService, RunInput } from '../services/patterns'
import { QUEUE_LIMIT } from '../services/queryPlans'
import {
  OPEN_INCIDENT_STATUSES,
  OPEN_TASK_STATUSES,
  StaffDataError,
  type DashboardService,
  type MaintenanceService,
  type MaintenanceTaskRecord,
  type StaffIncident,
  type StaffIncidentService,
} from '../services/staff'

export const STAFF_ORG = 'kwale-demo'
export const T_STAFF = '2026-03-01T08:00:00.000Z'
let counter = 0
export const staffUuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`

export function staffIncident(overrides: Partial<StaffIncident> = {}): StaffIncident {
  const base: Incident = {
    organizationId: STAFF_ORG,
    waterPointId: 'wp-mwamanga',
    reporterId: 'uid-reporter',
    demo: true,
    description: 'Handpump gives very little water (fictional).',
    incidentType: 'low_flow',
    severity: 'medium',
    status: 'new',
    baseRevision: 0,
    clientRevision: 1,
    mutationId: staffUuid(),
    serverRevision: 1,
    clientCreatedAt: T_STAFF,
    createdAt: T_STAFF,
    updatedAt: T_STAFF,
    confirmedFields: ['incidentType'],
  }
  return { id: staffUuid(), ...base, ...overrides } as StaffIncident
}

export function taskRecord(overrides: Partial<MaintenanceTaskRecord> = {}): MaintenanceTaskRecord {
  return {
    id: `task-${++counter}`,
    organizationId: STAFF_ORG,
    waterPointId: 'wp-mwamanga',
    incidentId: null,
    title: 'Inspect handpump (fictional)',
    notes: '',
    status: 'open',
    assigneeId: null,
    createdBy: 'uid-administrator',
    createdAt: T_STAFF,
    updatedAt: T_STAFF,
    demo: false,
    ...overrides,
  }
}

export class FakeStaffIncidentService implements StaffIncidentService {
  incidents: StaffIncident[]
  fail: StaffDataError | null = null
  constructor(incidents: StaffIncident[] = []) {
    this.incidents = incidents
  }
  list = vi.fn<StaffIncidentService['list']>(async (scope, filter) => {
    if (this.fail) throw this.fail
    const shown = this.incidents.filter(
      (i) =>
        i.organizationId === scope.organizationId &&
        (!filter.status || i.status === filter.status) &&
        (!filter.waterPointId || i.waterPointId === filter.waterPointId),
    )
    shown.sort((a, b) => (filter.order === 'newest' ? -1 : 1) * a.createdAt.localeCompare(b.createdAt))
    return shown.slice(0, QUEUE_LIMIT)
  })
  get = vi.fn<StaffIncidentService['get']>(async (scope, id) => {
    if (this.fail) throw this.fail
    return this.incidents.find((i) => i.id === id && i.organizationId === scope.organizationId) ?? null
  })
  changeStatus = vi.fn<StaffIncidentService['changeStatus']>(async (scope, seen, to) => {
    if (this.fail) throw this.fail
    if (!isAllowedIncidentTransition(seen.status, to)) throw new StaffDataError('transition')
    const index = this.incidents.findIndex((i) => i.id === seen.id && i.organizationId === scope.organizationId)
    if (index < 0) throw new StaffDataError('notFound')
    const current = this.incidents[index]
    if (current.status !== seen.status || current.serverRevision !== seen.serverRevision) throw new StaffDataError('stale')
    this.incidents[index] = {
      ...current,
      status: to,
      lastStatusChange: { by: scope.ownerUid, at: T_STAFF, from: current.status, to },
      serverRevision: current.serverRevision + 1,
    }
  })
}

export class FakeMaintenanceService implements MaintenanceService {
  tasks: MaintenanceTaskRecord[]
  incidents: () => StaffIncident[]
  fail: StaffDataError | null = null
  constructor(tasks: MaintenanceTaskRecord[] = [], incidents: () => StaffIncident[] = () => []) {
    this.tasks = tasks
    this.incidents = incidents
  }
  private mine = (orgId: string) => this.tasks.filter((t) => t.organizationId === orgId)
  list = vi.fn<MaintenanceService['list']>(async (scope, filter) => {
    if (this.fail) throw this.fail
    return this.mine(scope.organizationId).filter((t) => !filter.status || t.status === filter.status)
  })
  listForIncident = vi.fn<MaintenanceService['listForIncident']>(async (scope, incidentId) => {
    if (this.fail) throw this.fail
    return this.mine(scope.organizationId).filter((t) => t.incidentId === incidentId)
  })
  get = vi.fn<MaintenanceService['get']>(async (scope, id) => {
    if (this.fail) throw this.fail
    return this.mine(scope.organizationId).find((t) => t.id === id) ?? null
  })
  create = vi.fn<MaintenanceService['create']>(async (scope, link, input) => {
    if (this.fail) throw this.fail
    const fields = maintenanceTaskInputSchema.safeParse(input)
    if (!fields.success) throw new StaffDataError('invalid')
    const incident = this.incidents().find((i) => i.id === link.incidentId && i.organizationId === scope.organizationId)
    if (!incident) throw new StaffDataError('notFound')
    if (incident.waterPointId !== link.waterPointId) throw new StaffDataError('invalid')
    const task = taskRecord({ ...fields.data, incidentId: incident.id, waterPointId: incident.waterPointId, createdBy: scope.ownerUid })
    this.tasks.push(task)
    return task.id
  })
  update = vi.fn<MaintenanceService['update']>(async (scope, id, input) => {
    if (this.fail) throw this.fail
    const fields = maintenanceTaskInputSchema.safeParse(input)
    if (!fields.success) throw new StaffDataError('invalid')
    const index = this.tasks.findIndex((t) => t.id === id && t.organizationId === scope.organizationId)
    if (index < 0) throw new StaffDataError('notFound')
    this.tasks[index] = { ...this.tasks[index], ...fields.data }
  })
  changeStatus = vi.fn<MaintenanceService['changeStatus']>(async (scope, seen, to) => {
    if (this.fail) throw this.fail
    if (!isAllowedMaintenanceTransition(seen.status, to)) throw new StaffDataError('transition')
    const index = this.tasks.findIndex((t) => t.id === seen.id && t.organizationId === scope.organizationId)
    if (index < 0) throw new StaffDataError('notFound')
    if (this.tasks[index].status !== seen.status) throw new StaffDataError('stale')
    this.tasks[index] = { ...this.tasks[index], status: to }
  })
}

/** Counts derived from the fakes above, like the server count queries. */
export function fakeDashboard(incidents: () => StaffIncident[], tasks: () => MaintenanceTaskRecord[]): DashboardService & { fail: StaffDataError | null } {
  const service = {
    fail: null as StaffDataError | null,
    staffCounts: vi.fn<DashboardService['staffCounts']>(async (scope) => {
      if (service.fail) throw service.fail
      const inOrg = incidents().filter((i) => i.organizationId === scope.organizationId)
      const tasksInOrg = tasks().filter((t) => t.organizationId === scope.organizationId)
      const count = <T extends string>(statuses: readonly T[], items: Array<{ status: string }>) =>
        Object.fromEntries(statuses.map((s) => [s, items.filter((i) => i.status === s).length])) as Record<T, number>
      return { incidents: count(OPEN_INCIDENT_STATUSES, inOrg), tasks: count(OPEN_TASK_STATUSES, tasksInOrg) }
    }),
  }
  return service
}

/** In-memory pattern analyses. `next` decides what a run returns; runs are recorded. */
export class FakePatternService implements PatternService {
  analyses: PatternAnalysisRecord[]
  fail: StaffDataError | null = null
  runFail: StaffDataError | null = null
  next: (input: RunInput) => PatternAnalysisRecord
  constructor(analyses: PatternAnalysisRecord[] = [], next?: (input: RunInput) => PatternAnalysisRecord) {
    this.analyses = analyses
    this.next = next ?? ((input) => patternAnalysis({ id: `analysis-${this.analyses.length + 1}`, period: { from: input.from, to: input.to } }))
  }
  list = vi.fn<PatternService['list']>(async (scope) => {
    if (this.fail) throw this.fail
    return this.analyses.filter((a) => a.organizationId === scope.organizationId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  })
  get = vi.fn<PatternService['get']>(async (scope, id) => {
    if (this.fail) throw this.fail
    return this.analyses.find((a) => a.id === id && a.organizationId === scope.organizationId) ?? null
  })
  run = vi.fn<PatternService['run']>(async (input) => {
    if (this.runFail) throw this.runFail
    const analysis = this.next(input)
    this.analyses.push(analysis)
    return { analysisId: analysis.id, insufficientData: analysis.insufficientData, analyzedIncidentCount: analysis.analyzedIncidentCount, insightCount: analysis.insights.length }
  })
}

export const ANALYZED = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003']

export function patternAnalysis(overrides: Partial<PatternAnalysisRecord> = {}): PatternAnalysisRecord {
  return {
    id: 'analysis-1',
    organizationId: STAFF_ORG,
    requestedBy: 'uid-technician',
    createdAt: '2026-03-31T12:00:00.000Z',
    demo: true,
    model: 'gemini-3.5-flash',
    period: { from: '2026-03-01T00:00:00.000Z', to: '2026-03-31T00:00:00.000Z' },
    scope: {},
    analyzedIncidentIds: ANALYZED,
    analyzedIncidentCount: 3,
    insufficientData: false,
    limitations: ['Based on 3 incident reports from 2026-03-01 to 2026-03-31.'],
    insights: [
      {
        kind: 'observation',
        title: 'Repeated low flow at Mwamanga (fictional)',
        statement: 'Two reports describe low morning flow at the same borehole.',
        supportingIncidentIds: [ANALYZED[0], ANALYZED[1]],
        affectedWaterPointIds: ['wp-mwamanga'],
        period: { from: '2026-03-02T00:00:00.000Z', to: '2026-03-06T00:00:00.000Z' },
        limitations: ['Only two reports.'],
        confidence: 'medium',
      },
      {
        kind: 'hypothesis',
        title: 'Possible pump wear',
        statement: 'The low flow may be linked to a worn pump part.',
        supportingIncidentIds: [ANALYZED[1]],
        affectedWaterPointIds: ['wp-mwamanga'],
        period: { from: '2026-03-02T00:00:00.000Z', to: '2026-03-06T00:00:00.000Z' },
        limitations: ['No inspection yet.'],
        confidence: 'low',
      },
    ],
    ...overrides,
  }
}