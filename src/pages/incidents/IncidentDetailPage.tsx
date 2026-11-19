import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMaintenance, useStaffIncidents } from '../../app/servicesContext'
import { AiProvenance } from '../../components/incidents/AiProvenance'
import { IncidentStatusBadge, MaintenanceStatusBadge } from '../../components/incidents/StatusBadges'
import { Alert, AsyncBoundary, Button, EmptyState } from '../../components/ui'
import { DemoBadge } from '../../components/waterPoints/WaterPointBits'
import { formatDateTime } from '../../lib/formatDate'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { nextIncidentStatus, type ExtractableField, type IncidentStatus } from '../../schemas/incident'
import { staffDataErrorKind, type StaffDataErrorKind, type StaffIncident } from '../../services/staff'
import { en, format } from '../../strings/en'
import { linkButtonClasses } from '../waterPoints/linkStyles'
import { remoteToAsync } from '../remoteState'
import { useSignedInUser, useWaterPointNames } from './staffPageHelpers'

const t = en.incidents
const f = en.reports.fields

type Outcome = ({ kind: 'changed'; status: IncidentStatus } | { kind: 'failed'; error: StaffDataErrorKind }) & { incidentId: string }

function ConfirmedValue({ incident, field, value }: { incident: StaffIncident; field: ExtractableField; value: string | null }) {
  const confirmed = incident.confirmedFields.includes(field)
  return (
    <dd className="flex flex-wrap items-center gap-2">
      <span>{value ?? f.notRecorded}</span>
      <span className="text-sm text-slate-700">({confirmed ? t.confirmedLabel : t.notConfirmed})</span>
    </dd>
  )
}

/** Incident detail and triage (T7.2, R7.2). */
export function IncidentDetailPage() {
  const { incidentId = '' } = useParams()
  const signedIn = useSignedInUser()
  const detail = useStaffIncidents((s) => s.detail)
  const loadDetail = useStaffIncidents((s) => s.loadDetail)
  const changeStatus = useStaffIncidents((s) => s.changeStatus)
  const tasks = useMaintenance((s) => s.forIncident)
  const loadTasks = useMaintenance((s) => s.loadForIncident)
  const nameOf = useWaterPointNames()
  const online = useOnlineStatus()
  const [busy, setBusy] = useState(false)
  const [lastOutcome, setOutcome] = useState<Outcome | null>(null)
  // A result belongs to the incident it was for, not to the next one opened.
  const outcome = lastOutcome?.incidentId === incidentId ? lastOutcome : null
  const scope = signedIn?.scope ?? null

  useEffect(() => {
    if (!scope) return
    void loadDetail(scope, incidentId)
    void loadTasks(scope, incidentId)
  }, [scope, incidentId, loadDetail, loadTasks])

  if (!scope) return null
  const data = detail.id === incidentId ? detail.data : { status: 'loading' as const }

  const advance = async (incident: StaffIncident, to: IncidentStatus) => {
    setBusy(true)
    setOutcome(null)
    try {
      await changeStatus(scope, incident, to)
      setOutcome({ kind: 'changed', status: to, incidentId: incident.id })
    } catch (error) {
      setOutcome({ kind: 'failed', error: staffDataErrorKind(error), incidentId: incident.id })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Link to="/incidents" className="font-medium text-sky-900 underline">
        {t.backToList}
      </Link>
      <AsyncBoundary state={remoteToAsync(data)} onRetry={() => void loadDetail(scope, incidentId)}>
        {(incident) => {
          if (!incident) return <EmptyState title={t.notFoundTitle} description={t.notFoundDescription} />
          const next = nextIncidentStatus(incident.status)
          return (
            <article className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-slate-900">
                  {format(t.detailTitle, { type: en.incidentTypes[incident.incidentType], waterPoint: nameOf(incident.waterPointId) })}
                </h1>
                {incident.demo && <DemoBadge />}
              </div>

              <section aria-labelledby="status-title" className="flex flex-col gap-3 rounded-md border border-slate-300 bg-white p-4">
                <h2 id="status-title" className="text-lg font-semibold text-slate-900">
                  {t.statusTitle}
                </h2>
                <IncidentStatusBadge status={incident.status} />
                <p className="text-slate-800">
                  {incident.lastStatusChange
                    ? format(t.lastChange, {
                        from: en.incidentStatuses[incident.lastStatusChange.from],
                        to: en.incidentStatuses[incident.lastStatusChange.to],
                        time: formatDateTime(incident.lastStatusChange.at),
                      })
                    : t.noChangeYet}
                </p>
                <div role="status" aria-live="polite">
                  {outcome?.kind === 'changed' && (
                    <p className="font-medium text-green-900">{format(t.statusChanged, { status: en.incidentStatuses[outcome.status] })}</p>
                  )}
                </div>
                {outcome?.kind === 'failed' && <Alert tone="error">{en.staffErrors[outcome.error]}</Alert>}
                {next ? (
                  <>
                    <Button className="self-start" loading={busy} disabled={!online} onClick={() => void advance(incident, next)}>
                      {format(t.moveTo, { status: en.incidentStatuses[next] })}
                    </Button>
                    {!online && <p className="text-sm text-slate-700">{t.onlineOnly}</p>}
                    <p className="text-sm text-slate-700">{t.statusHelp}</p>
                  </>
                ) : (
                  <p className="text-slate-800">{t.resolvedNote}</p>
                )}
              </section>

              <section aria-labelledby="report-title" className="flex flex-col gap-3 rounded-md border border-slate-300 bg-white p-4">
                <h2 id="report-title" className="text-lg font-semibold text-slate-900">
                  {t.reportTitle}
                </h2>
                <dl className="grid gap-2 sm:grid-cols-[12rem_1fr]">
                  <dt className="font-medium">{f.waterPoint}</dt>
                  <dd>{nameOf(incident.waterPointId)}</dd>
                  <dt className="font-medium">{f.description}</dt>
                  <dd className="whitespace-pre-wrap">{incident.description}</dd>
                  <dt className="font-medium">{f.incidentType}</dt>
                  <ConfirmedValue incident={incident} field="incidentType" value={en.incidentTypes[incident.incidentType]} />
                  <dt className="font-medium">{f.severity}</dt>
                  <ConfirmedValue incident={incident} field="severity" value={incident.severity ? en.severities[incident.severity] : null} />
                  <dt className="font-medium">{f.occurredAt}</dt>
                  <ConfirmedValue incident={incident} field="occurredAt" value={incident.occurredAt ? formatDateTime(incident.occurredAt) : null} />
                  <dt className="font-medium">{f.locationNote}</dt>
                  <ConfirmedValue incident={incident} field="locationNote" value={incident.locationNote ?? null} />
                  <dt className="font-medium">{f.createdAt}</dt>
                  <dd>{formatDateTime(incident.createdAt)}</dd>
                </dl>
              </section>

              <AiProvenance ai={incident.ai} />

              <section aria-labelledby="tasks-title" className="flex flex-col gap-3 rounded-md border border-slate-300 bg-white p-4">
                <h2 id="tasks-title" className="text-lg font-semibold text-slate-900">
                  {t.tasksTitle}
                </h2>
                <AsyncBoundary
                  state={remoteToAsync(tasks.incidentId === incident.id ? tasks.data : { status: 'loading' })}
                  isEmpty={(list) => list.length === 0}
                  empty={<p className="text-slate-800">{t.noTasks}</p>}
                  onRetry={() => void loadTasks(scope, incident.id)}
                >
                  {(list) => (
                    <ul className="flex flex-col gap-2">
                      {list.map((task) => (
                        <li key={task.id} className="flex flex-wrap items-center gap-2">
                          <Link to={`/maintenance/${encodeURIComponent(task.id)}`} className="font-medium text-sky-900 underline">
                            {task.title}
                          </Link>
                          <MaintenanceStatusBadge status={task.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                </AsyncBoundary>
                {online && (
                  <Link to={`/maintenance/new?incident=${incident.id}`} className={`${linkButtonClasses} self-start`}>
                    <Plus aria-hidden="true" className="size-5" />
                    {t.createTask}
                  </Link>
                )}
              </section>
            </article>
          )
        }}
      </AsyncBoundary>
    </div>
  )
}
