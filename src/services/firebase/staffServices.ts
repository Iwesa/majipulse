import {
  collection,
  doc,
  getCountFromServer,
  getDocFromServer,
  getDocsFromServer,
  runTransaction,
  serverTimestamp,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore'
import { incidentSchema, isAllowedIncidentTransition } from '../../schemas/incident'
import { isAllowedMaintenanceTransition, maintenanceTaskInputSchema, maintenanceTaskSchema, type MaintenanceTaskInput } from '../../schemas/maintenanceTask'
import { documentIdSchema, uuidSchema } from '../../schemas/common'
import { sessionScopeSchema, type SessionScope } from '../../schemas/roles'
import { incidentCountPlan, incidentQueuePlan, taskCountPlan, taskListPlan, tasksForIncidentPlan } from '../queryPlans'
import {
  OPEN_INCIDENT_STATUSES,
  OPEN_TASK_STATUSES,
  StaffDataError,
  type DashboardService,
  type MaintenanceService,
  type MaintenanceTaskRecord,
  type StaffCounts,
  type StaffIncident,
  type StaffIncidentService,
} from '../staff'
import { plannedQuery } from './queries'
import { timestampsToIso } from './timestamps'
import { firestoreErrorKind } from './waterPointService'

const INCIDENTS = 'incidents'
const TASKS = 'maintenanceTasks'

/** Maps Firestore errors to StaffDataError. Never includes error details, which can contain data. */
async function run<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task()
  } catch (error) {
    if (error instanceof StaffDataError) throw error
    throw new StaffDataError(firestoreErrorKind(error))
  }
}

function scopeOf(scope: SessionScope): SessionScope {
  const parsed = sessionScopeSchema.safeParse(scope)
  if (!parsed.success) throw new StaffDataError('invalid')
  return parsed.data
}

function validId(id: string, kind: 'uuid' | 'doc'): string {
  const parsed = (kind === 'uuid' ? uuidSchema : documentIdSchema).safeParse(id)
  if (!parsed.success) throw new StaffDataError('notFound')
  return parsed.data
}

/** Server document -> validated record of this organization, or null. Invalid documents are never shown. */
function parseIncident(id: string, data: DocumentData | undefined, organizationId: string): StaffIncident | null {
  const parsed = incidentSchema.safeParse(timestampsToIso(data))
  return parsed.success && parsed.data.organizationId === organizationId ? { id, ...parsed.data } : null
}

function parseTask(id: string, data: DocumentData | undefined, organizationId: string): MaintenanceTaskRecord | null {
  const parsed = maintenanceTaskSchema.safeParse(timestampsToIso(data))
  return parsed.success && parsed.data.organizationId === organizationId ? { id, ...parsed.data } : null
}

function parseInput(input: MaintenanceTaskInput): MaintenanceTaskInput {
  const parsed = maintenanceTaskInputSchema.safeParse(input)
  if (!parsed.success) throw new StaffDataError('invalid')
  return parsed.data
}

export function createFirebaseStaffIncidentService(db: Firestore): StaffIncidentService {
  return {
    async list(scope, filter) {
      const { organizationId } = scopeOf(scope)
      // Server only: offline, this fails instead of showing a partial memory cache.
      const snap = await run(() => getDocsFromServer(plannedQuery(db, organizationId, incidentQueuePlan(filter))))
      return snap.docs.flatMap((d) => parseIncident(d.id, d.data(), organizationId) ?? [])
    },

    async get(scope, id) {
      const { organizationId } = scopeOf(scope)
      const snap = await run(() => getDocFromServer(doc(db, INCIDENTS, validId(id, 'uuid'))))
      return snap.exists() ? parseIncident(snap.id, snap.data(), organizationId) : null
    },

    async changeStatus(scope, seen, to) {
      const { organizationId, ownerUid } = scopeOf(scope)
      if (!isAllowedIncidentTransition(seen.status, to)) throw new StaffDataError('transition')
      const ref = doc(db, INCIDENTS, validId(seen.id, 'uuid'))
      await run(() =>
        runTransaction(db, async (tx) => {
          const snap = await tx.get(ref)
          const current = snap.exists() ? parseIncident(snap.id, snap.data(), organizationId) : null
          if (!current) throw new StaffDataError('notFound')
          if (current.status !== seen.status || current.serverRevision !== seen.serverRevision) throw new StaffDataError('stale')
          // Only status metadata changes; the rules reject anything else (R7.3).
          tx.update(ref, {
            status: to,
            lastStatusChange: { by: ownerUid, at: serverTimestamp(), from: current.status, to },
            serverRevision: current.serverRevision + 1,
            updatedAt: serverTimestamp(),
          })
        }),
      )
    },
  }
}

export function createFirebaseMaintenanceService(db: Firestore): MaintenanceService {
  const listBy = async (scope: SessionScope, plan: ReturnType<typeof taskListPlan>) => {
    const { organizationId } = scopeOf(scope)
    const snap = await run(() => getDocsFromServer(plannedQuery(db, organizationId, plan)))
    return snap.docs.flatMap((d) => parseTask(d.id, d.data(), organizationId) ?? [])
  }

  return {
    list: (scope, filter) => listBy(scope, taskListPlan(filter)),
    listForIncident: (scope, incidentId) => listBy(scope, tasksForIncidentPlan(validId(incidentId, 'uuid'))),

    async get(scope, id) {
      const { organizationId } = scopeOf(scope)
      const snap = await run(() => getDocFromServer(doc(db, TASKS, validId(id, 'doc'))))
      return snap.exists() ? parseTask(snap.id, snap.data(), organizationId) : null
    },

    async create(scope, link, input) {
      const { organizationId, ownerUid } = scopeOf(scope)
      const fields = parseInput(input)
      const incidentRef = doc(db, INCIDENTS, validId(link.incidentId, 'uuid'))
      const ref = doc(collection(db, TASKS))
      await run(() =>
        runTransaction(db, async (tx) => {
          const snap = await tx.get(incidentRef)
          const incident = snap.exists() ? parseIncident(snap.id, snap.data(), organizationId) : null
          if (!incident) throw new StaffDataError('notFound')
          if (incident.waterPointId !== link.waterPointId) throw new StaffDataError('invalid')
          tx.set(ref, {
            organizationId,
            waterPointId: incident.waterPointId,
            incidentId: incident.id,
            ...fields,
            status: 'open',
            createdBy: ownerUid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            demo: false,
          })
        }),
      )
      return ref.id
    },

    async update(scope, id, input) {
      const { organizationId } = scopeOf(scope)
      const fields = parseInput(input)
      const ref = doc(db, TASKS, validId(id, 'doc'))
      await run(() =>
        runTransaction(db, async (tx) => {
          const snap = await tx.get(ref)
          if (!snap.exists() || !parseTask(snap.id, snap.data(), organizationId)) throw new StaffDataError('notFound')
          tx.update(ref, { ...fields, updatedAt: serverTimestamp() })
        }),
      )
    },

    async changeStatus(scope, seen, to) {
      const { organizationId } = scopeOf(scope)
      if (!isAllowedMaintenanceTransition(seen.status, to)) throw new StaffDataError('transition')
      const ref = doc(db, TASKS, validId(seen.id, 'doc'))
      await run(() =>
        runTransaction(db, async (tx) => {
          const snap = await tx.get(ref)
          const current = snap.exists() ? parseTask(snap.id, snap.data(), organizationId) : null
          if (!current) throw new StaffDataError('notFound')
          if (current.status !== seen.status) throw new StaffDataError('stale')
          tx.update(ref, { status: to, updatedAt: serverTimestamp() })
        }),
      )
    },
  }
}

export function createFirebaseDashboardService(db: Firestore): DashboardService {
  return {
    async staffCounts(scope) {
      const { organizationId } = scopeOf(scope)
      const count = (plan: ReturnType<typeof incidentCountPlan>) =>
        run(async () => (await getCountFromServer(plannedQuery(db, organizationId, plan))).data().count)
      const [incidents, tasks] = await Promise.all([
        Promise.all(OPEN_INCIDENT_STATUSES.map((s) => count(incidentCountPlan(s)))),
        Promise.all(OPEN_TASK_STATUSES.map((s) => count(taskCountPlan(s)))),
      ])
      const result: StaffCounts = {
        incidents: { new: incidents[0], triaged: incidents[1], in_progress: incidents[2] },
        tasks: { open: tasks[0], in_progress: tasks[1] },
      }
      return result
    },
  }
}
