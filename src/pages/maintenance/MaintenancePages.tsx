import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMaintenance, useStaffIncidents } from '../../app/servicesContext'
import { MaintenanceStatusBadge } from '../../components/incidents/StatusBadges'
import { TaskForm } from '../../components/maintenance/TaskForm'
import { Alert, AsyncBoundary, Button, EmptyState, SelectField, type SelectOption } from '../../components/ui'
import { formatDateTime } from '../../lib/formatDate'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { maintenanceStatusSchema, nextMaintenanceStatus, type MaintenanceStatus, type MaintenanceTaskInput } from '../../schemas/maintenanceTask'
import type { SessionScope } from '../../schemas/roles'
import { staffDataErrorKind, type MaintenanceTaskRecord, type StaffDataErrorKind } from '../../services/staff'
import type { AssigneeOption } from '../../stores/maintenanceStore'
import { en, format } from '../../strings/en'
import { useSignedInUser, useWaterPointNames } from '../incidents/staffPageHelpers'
import { remoteToAsync } from '../remoteState'

const m = en.maintenance
const f = en.reports.fields

const backToList = (
  <Link to="/maintenance" className="font-medium text-sky-900 underline">
    {m.backToList}
  </Link>
)

/** Loads who tasks can be assigned to, and turns them into select options. */
function useAssigneeOptions(scope: SessionScope | null, canListMembers: boolean, selfName: string | null) {
  const assignees = useMaintenance((s) => s.assignees)
  const loadAssignees = useMaintenance((s) => s.loadAssignees)
  useEffect(() => {
    if (scope) void loadAssignees(scope, { canListMembers, name: selfName })
  }, [scope, canListMembers, selfName, loadAssignees])
  const list: AssigneeOption[] = assignees.status === 'ready' ? assignees.data : []
  const options: SelectOption[] = list.map((a) => ({
    value: a.uid,
    label: a.uid === scope?.ownerUid ? (a.name ? `${a.name} ${en.common.you}` : m.meOption) : (a.name ?? m.assignedToOther),
  }))
  return { options, list, failed: assignees.status === 'error' || assignees.status === 'offline' }
}

/** Display name for a task's assignee. Technicians cannot read other members, so others show generically. */
function assigneeLabel(assigneeId: string | null, selfUid: string, known: readonly AssigneeOption[]): string {
  if (!assigneeId) return m.unassigned
  if (assigneeId === selfUid) return m.assignedToYou
  return known.find((a) => a.uid === assigneeId)?.name ?? m.assignedToOther
}

const statusFrom = (value: string | null): MaintenanceStatus | null => {
  const parsed = maintenanceStatusSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** Maintenance task list (T7.3). */
export function MaintenanceListPage() {
  const signedIn = useSignedInUser()
  const list = useMaintenance((s) => s.list)
  const loadList = useMaintenance((s) => s.loadList)
  const nameOf = useWaterPointNames()
  const [params, setParams] = useSearchParams()
  const status = statusFrom(params.get('status'))
  const scope = signedIn?.scope ?? null
  const { list: known } = useAssigneeOptions(scope, signedIn?.user.role === 'administrator', signedIn?.user.displayName ?? null)

  useEffect(() => {
    if (scope) void loadList(scope, { status })
  }, [scope, status, loadList])

  if (!signedIn || !scope) return null

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-slate-900">{m.title}</h1>
      <p className="text-slate-700">{m.intro}</p>
      <div className="max-w-xs">
        <SelectField
          label={m.statusFilter}
          placeholder={m.allStatuses}
          options={maintenanceStatusSchema.options.map((s) => ({ value: s, label: en.maintenanceStatuses[s] }))}
          value={status ?? ''}
          onChange={(e) => {
            const next = new URLSearchParams(params)
            if (e.target.value) next.set('status', e.target.value)
            else next.delete('status')
            setParams(next, { replace: true })
          }}
        />
      </div>
      <AsyncBoundary
        state={remoteToAsync(list)}
        isEmpty={(tasks) => tasks.length === 0}
        empty={<EmptyState title={m.emptyTitle} description={m.emptyDescription} />}
        onRetry={() => void loadList(scope, { status })}
      >
        {(tasks) => (
          <div className="flex flex-col gap-3">
            <p role="status" className="text-sm text-slate-700">
              {tasks.length === 1 ? m.countOne : format(m.count, { count: String(tasks.length) })}
            </p>
            <ul className="flex flex-col gap-3">
              {tasks.map((task) => (
                <li key={task.id} className="flex flex-col gap-2 rounded-md border border-slate-300 bg-white p-4">
                  <Link
                    to={`/maintenance/${encodeURIComponent(task.id)}`}
                    className="text-lg font-semibold text-sky-900 underline-offset-4 hover:underline focus-visible:outline-3 focus-visible:outline-sky-600"
                  >
                    {task.title}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
                    <MaintenanceStatusBadge status={task.status} />
                    <span>{nameOf(task.waterPointId)}</span>
                    <span>
                      {m.assigneeField}: {assigneeLabel(task.assigneeId, scope.ownerUid, known)}
                    </span>
                    <span>{format(m.updatedOn, { time: formatDateTime(task.updatedAt) })}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </AsyncBoundary>
    </div>
  )
}

/** New task from an incident (R8.1): linked by incidentId and the incident's water point. */
export function NewMaintenanceTaskPage() {
  const signedIn = useSignedInUser()
  const [params] = useSearchParams()
  const incidentId = params.get('incident') ?? ''
  const detail = useStaffIncidents((s) => s.detail)
  const loadDetail = useStaffIncidents((s) => s.loadDetail)
  const create = useMaintenance((s) => s.create)
  const nameOf = useWaterPointNames()
  const online = useOnlineStatus()
  const navigate = useNavigate()
  const [failure, setFailure] = useState<StaffDataErrorKind | null>(null)
  const scope = signedIn?.scope ?? null
  const isAdmin = signedIn?.user.role === 'administrator'
  const { options, failed } = useAssigneeOptions(scope, isAdmin, signedIn?.user.displayName ?? null)

  useEffect(() => {
    if (scope && incidentId) void loadDetail(scope, incidentId)
  }, [scope, incidentId, loadDetail])

  if (!scope) return null
  const heading = <h1 className="text-2xl font-bold text-slate-900">{m.newTitle}</h1>
  if (!incidentId) {
    return (
      <div className="flex max-w-xl flex-col gap-4">
        {backToList}
        {heading}
        <Alert tone="info">{m.needsIncident}</Alert>
      </div>
    )
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <Link to={`/incidents/${incidentId}`} className="font-medium text-sky-900 underline">
        {m.viewIncident}
      </Link>
      {heading}
      {!online && <Alert tone="info">{m.onlineOnly}</Alert>}
      {failure && <Alert tone="error">{en.staffErrors[failure]}</Alert>}
      <AsyncBoundary
        state={remoteToAsync(detail.id === incidentId ? detail.data : { status: 'loading' })}
        onRetry={() => void loadDetail(scope, incidentId)}
      >
        {(incident) => {
          if (!incident) return <EmptyState title={en.incidents.notFoundTitle} description={en.incidents.notFoundDescription} />
          const submit = async (input: MaintenanceTaskInput) => {
            setFailure(null)
            try {
              const id = await create(scope, { incidentId: incident.id, waterPointId: incident.waterPointId }, input)
              navigate(`/maintenance/${encodeURIComponent(id)}`, { replace: true, state: { created: true } })
            } catch (error) {
              setFailure(staffDataErrorKind(error))
            }
          }
          return (
            <div className="flex flex-col gap-4">
              <dl className="grid gap-2 sm:grid-cols-[12rem_1fr]">
                <dt className="font-medium">{m.linkedIncident}</dt>
                <dd>{en.incidentTypes[incident.incidentType]}</dd>
                <dt className="font-medium">{m.waterPoint}</dt>
                <dd>{nameOf(incident.waterPointId)}</dd>
              </dl>
              {failed && <Alert tone="warning">{m.assigneesError}</Alert>}
              <TaskForm
                assignees={options}
                assigneeHint={isAdmin ? m.assigneeHint : m.assigneeHintTechnician}
                submitLabel={m.create}
                disabled={!online}
                onSubmit={submit}
              />
            </div>
          )
        }}
      </AsyncBoundary>
    </div>
  )
}

type Outcome = { kind: 'status'; status: MaintenanceStatus } | { kind: 'saved' } | { kind: 'failed'; error: StaffDataErrorKind } | null

/** Task detail: status, assignment, and edits (T7.3, R8.2). */
export function MaintenanceTaskPage() {
  const { taskId = '' } = useParams()
  const location = useLocation()
  const signedIn = useSignedInUser()
  const detail = useMaintenance((s) => s.detail)
  const loadDetail = useMaintenance((s) => s.loadDetail)
  const update = useMaintenance((s) => s.update)
  const changeStatus = useMaintenance((s) => s.changeStatus)
  const nameOf = useWaterPointNames()
  const online = useOnlineStatus()
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>(null)
  const scope = signedIn?.scope ?? null
  const isAdmin = signedIn?.user.role === 'administrator'
  const { options, list: known, failed } = useAssigneeOptions(scope, isAdmin, signedIn?.user.displayName ?? null)
  const justCreated = useMemo(() => (location.state as { created?: boolean } | null)?.created === true, [location.state])

  useEffect(() => {
    if (scope) void loadDetail(scope, taskId)
  }, [scope, taskId, loadDetail])

  if (!scope) return null

  const run = async (action: () => Promise<void>, success: Outcome) => {
    setBusy(true)
    setOutcome(null)
    try {
      await action()
      setOutcome(success)
    } catch (error) {
      setOutcome({ kind: 'failed', error: staffDataErrorKind(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {backToList}
      <AsyncBoundary state={remoteToAsync(detail.id === taskId ? detail.data : { status: 'loading' })} onRetry={() => void loadDetail(scope, taskId)}>
        {(task: MaintenanceTaskRecord | null) => {
          if (!task) return <EmptyState title={m.notFoundTitle} description={m.notFoundDescription} />
          const next = nextMaintenanceStatus(task.status)
          return (
            <article className="flex flex-col gap-4">
              <h1 className="text-2xl font-bold text-slate-900">{task.title}</h1>
              <div role="status" aria-live="polite">
                {justCreated && !outcome && <p className="font-medium text-green-900">{m.created}</p>}
                {outcome?.kind === 'status' && (
                  <p className="font-medium text-green-900">{format(m.statusChanged, { status: en.maintenanceStatuses[outcome.status] })}</p>
                )}
                {outcome?.kind === 'saved' && <p className="font-medium text-green-900">{m.saved}</p>}
              </div>
              {outcome?.kind === 'failed' && <Alert tone="error">{en.staffErrors[outcome.error]}</Alert>}
              {!online && <Alert tone="info">{m.onlineOnly}</Alert>}

              <section aria-label={en.incidents.statusTitle} className="flex flex-col gap-3 rounded-md border border-slate-300 bg-white p-4">
                <MaintenanceStatusBadge status={task.status} />
                {next ? (
                  <>
                    <Button
                      className="self-start"
                      loading={busy}
                      disabled={!online}
                      onClick={() => void run(() => changeStatus(scope, task, next), { kind: 'status', status: next })}
                    >
                      {format(m.moveTo, { status: en.maintenanceStatuses[next] })}
                    </Button>
                    <p className="text-sm text-slate-700">{m.statusHelp}</p>
                  </>
                ) : (
                  <p className="text-slate-800">{m.doneNote}</p>
                )}
              </section>

              <dl className="grid gap-2 sm:grid-cols-[12rem_1fr]">
                <dt className="font-medium">{m.waterPoint}</dt>
                <dd>{nameOf(task.waterPointId)}</dd>
                <dt className="font-medium">{m.linkedIncident}</dt>
                <dd>
                  {task.incidentId ? (
                    <Link to={`/incidents/${task.incidentId}`} className="font-medium text-sky-900 underline">
                      {m.viewIncident}
                    </Link>
                  ) : (
                    m.noIncident
                  )}
                </dd>
                <dt className="font-medium">{m.assigneeField}</dt>
                <dd>{assigneeLabel(task.assigneeId, scope.ownerUid, known)}</dd>
                <dt className="font-medium">{m.notesField}</dt>
                <dd className="whitespace-pre-wrap">{task.notes || f.notRecorded}</dd>
                <dt className="font-medium">{en.reports.fields.createdAt}</dt>
                <dd>{formatDateTime(task.createdAt)}</dd>
              </dl>

              <section aria-labelledby="edit-task-title" className="flex flex-col gap-3 rounded-md border border-slate-300 bg-white p-4">
                <h2 id="edit-task-title" className="text-lg font-semibold text-slate-900">
                  {m.editTitle}
                </h2>
                {failed && <Alert tone="warning">{m.assigneesError}</Alert>}
                <TaskForm
                  key={`${task.id}:${task.updatedAt}`}
                  assignees={options}
                  assigneeHint={isAdmin ? m.assigneeHint : m.assigneeHintTechnician}
                  initial={{ title: task.title, notes: task.notes, assigneeId: task.assigneeId }}
                  submitLabel={m.save}
                  disabled={!online}
                  onSubmit={(input) => run(() => update(scope, task.id, input), { kind: 'saved' })}
                />
              </section>
            </article>
          )
        }}
      </AsyncBoundary>
    </div>
  )
}
