import { useEffect, useId, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useStaffIncidents, useWaterPoints } from '../../app/servicesContext'
import { IncidentStatusBadge } from '../../components/incidents/StatusBadges'
import { AsyncBoundary, EmptyState, SelectField } from '../../components/ui'
import { DemoBadge } from '../../components/waterPoints/WaterPointBits'
import { formatDateTime } from '../../lib/formatDate'
import { incidentStatusSchema } from '../../schemas/incident'
import { QUEUE_LIMIT } from '../../services/queryPlans'
import { en, format } from '../../strings/en'
import { remoteToAsync } from '../remoteState'
import { filterFromParams, useSignedInUser, useWaterPointNames } from './staffPageHelpers'

const t = en.incidents

/** Staff incident queue (T7.1, R7.1). */
export function IncidentQueuePage() {
  const signedIn = useSignedInUser()
  const queue = useStaffIncidents((s) => s.queue)
  const loadQueue = useStaffIncidents((s) => s.loadQueue)
  const points = useWaterPoints((s) => s.list)
  const nameOf = useWaterPointNames()
  const [params, setParams] = useSearchParams()
  const countId = useId()
  const filter = useMemo(() => filterFromParams(params), [params])
  const scope = signedIn?.scope ?? null

  useEffect(() => {
    if (scope) void loadQueue(scope, filter)
  }, [loadQueue, scope, filter])

  if (!scope) return null

  const setFilter = (key: 'status' | 'waterPoint' | 'order', value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const pointOptions = points.status === 'ready' ? points.points.map((p) => ({ value: p.id, label: p.name })) : []

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-slate-900">{t.title}</h1>
      <p className="text-slate-700">{t.intro}</p>
      <section aria-label={t.filtersTitle} className="grid gap-3 sm:grid-cols-3">
        <SelectField
          label={t.statusFilter}
          placeholder={t.allStatuses}
          options={incidentStatusSchema.options.map((s) => ({ value: s, label: en.incidentStatuses[s] }))}
          value={filter.status ?? ''}
          onChange={(e) => setFilter('status', e.target.value)}
          aria-controls={countId}
        />
        <SelectField
          label={t.waterPointFilter}
          placeholder={t.allWaterPoints}
          options={pointOptions}
          value={filter.waterPointId ?? ''}
          onChange={(e) => setFilter('waterPoint', e.target.value)}
          aria-controls={countId}
        />
        <SelectField
          label={t.orderFilter}
          placeholder={null}
          options={[
            { value: 'newest', label: t.newest },
            { value: 'oldest', label: t.oldest },
          ]}
          value={filter.order}
          onChange={(e) => setFilter('order', e.target.value === 'oldest' ? 'oldest' : '')}
          aria-controls={countId}
        />
      </section>
      <AsyncBoundary
        state={remoteToAsync(queue)}
        isEmpty={(items) => items.length === 0}
        empty={<EmptyState title={t.emptyTitle} description={t.emptyDescription} />}
        onRetry={() => void loadQueue(scope, filter)}
      >
        {(items) => (
          <div className="flex flex-col gap-3">
            <p id={countId} role="status" className="text-sm text-slate-700">
              {items.length === 1 ? t.countOne : format(t.count, { count: String(items.length) })}
              {items.length >= QUEUE_LIMIT && ` ${format(t.limitNote, { limit: String(QUEUE_LIMIT) })}`}
            </p>
            <ul className="flex flex-col gap-3">
              {items.map((incident) => (
                <li key={incident.id} className="flex flex-col gap-2 rounded-md border border-slate-300 bg-white p-4">
                  <Link
                    to={`/incidents/${incident.id}`}
                    className="text-lg font-semibold text-sky-900 underline-offset-4 hover:underline focus-visible:outline-3 focus-visible:outline-sky-600"
                  >
                    {format(t.detailTitle, { type: en.incidentTypes[incident.incidentType], waterPoint: nameOf(incident.waterPointId) })}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
                    <IncidentStatusBadge status={incident.status} />
                    <span>
                      {en.reports.fields.severity}: {incident.severity ? en.severities[incident.severity] : en.severities.notSure}
                    </span>
                    <span>{format(t.reportedOn, { time: formatDateTime(incident.createdAt) })}</span>
                    {incident.demo && <DemoBadge />}
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
