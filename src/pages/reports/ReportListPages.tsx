import { Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useIncidents, useSession, useSync, useWaterPoints } from '../../app/servicesContext'
import { ConflictReview } from '../../components/incidents/ConflictReview'
import { SyncStatusBadge } from '../../components/incidents/SyncStatusBadge'
import { Alert, AsyncBoundary, Button, EmptyState } from '../../components/ui'
import { formatDateTime } from '../../lib/formatDate'
import { isEditable } from '../../services/incidents'
import { en, format } from '../../strings/en'
import { linkButtonClasses } from '../waterPoints/linkStyles'
import { incidentListToAsync } from './incidentListState'

/** Water point names from the server list or the saved copy. */
function useWaterPointName(): (id: string) => string {
  const list = useWaterPoints((s) => s.list)
  const names = new Map(list.status === 'ready' ? list.points.map((p) => [p.id, p.name]) : [])
  return (id) => names.get(id) ?? en.reports.unknownWaterPoint
}

/** My reports (T4.4): this user's reports on this device, newest first. */
export function MyReportsPage() {
  const session = useSession((s) => s.session)
  const list = useIncidents((s) => s.list)
  const load = useIncidents((s) => s.load)
  const nameOf = useWaterPointName()
  if (session.status !== 'signedIn') return null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{en.nav.myReports}</h1>
        <Link to="/reports/new" className={linkButtonClasses}>
          <Plus aria-hidden="true" className="size-5" />
          {en.reports.newReportLink}
        </Link>
      </div>
      <p className="text-slate-700">{en.reports.myReportsIntro}</p>
      <AsyncBoundary
        state={incidentListToAsync(list)}
        isEmpty={(records) => records.length === 0}
        empty={<EmptyState title={en.reports.emptyTitle} description={en.reports.emptyDescription} />}
        onRetry={() => void load(session.user.scope)}
      >
        {(records) => (
          <ul className="flex flex-col gap-3">
            {records.map((record) => (
              <li key={record.id} className="flex flex-col gap-2 rounded-md border border-slate-300 bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/reports/${record.id}`}
                    className="text-lg font-semibold text-sky-900 underline-offset-4 hover:underline focus-visible:outline-3 focus-visible:outline-sky-600"
                  >
                    {en.incidentTypes[record.incidentType]}: {nameOf(record.waterPointId)}
                  </Link>
                  <SyncStatusBadge status={record.syncStatus} />
                </div>
                <p className="line-clamp-2 text-slate-800">{record.description}</p>
                <p className="text-sm text-slate-700">{format(en.reports.createdOn, { time: formatDateTime(record.clientCreatedAt) })}</p>
              </li>
            ))}
          </ul>
        )}
      </AsyncBoundary>
    </div>
  )
}

export function ReportDetailPage() {
  const { incidentId = '' } = useParams()
  const session = useSession((s) => s.session)
  const list = useIncidents((s) => s.list)
  const nameOf = useWaterPointName()
  const saved = (useLocation().state as { saved?: 'new' | 'edit' } | null)?.saved
  const syncEnabled = useSync((s) => s.enabled)
  const retry = useSync((s) => s.retry)
  const [resolved, setResolved] = useState<'retryOnLatest' | 'discardMyEdit' | null>(null)
  if (session.status !== 'signedIn') return null

  return (
    <div className="flex flex-col gap-4">
      <Link to="/reports" className="font-medium text-sky-900 underline">
        {en.reports.backToList}
      </Link>
      <AsyncBoundary state={incidentListToAsync(list)}>
        {(records) => {
          const record = records.find((r) => r.id === incidentId)
          if (!record) return <EmptyState title={en.reports.notFoundTitle} description={en.reports.notFoundDescription} />
          const f = en.reports.fields
          return (
            <article className="flex flex-col gap-4">
              {saved && !resolved && <Alert tone="success">{saved === 'new' ? en.reports.savedNew : en.reports.savedEdit}</Alert>}
              {resolved && <Alert tone="success">{resolved === 'discardMyEdit' ? en.conflict.discarded : en.conflict.retrying}</Alert>}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-2xl font-bold text-slate-900">
                  {en.incidentTypes[record.incidentType]}: {nameOf(record.waterPointId)}
                </h1>
                {isEditable(record) && (
                  <Link to={`/reports/${record.id}/edit`} className={linkButtonClasses}>
                    <Pencil aria-hidden="true" className="size-5" />
                    {en.reports.edit}
                  </Link>
                )}
              </div>
              <section aria-label={f.status} className="flex flex-col gap-2 rounded-md border border-slate-300 bg-white p-4">
                <SyncStatusBadge status={record.syncStatus} />
                <p className="text-slate-800">{en.syncStatusHelp[record.syncStatus]}</p>
                {record.syncStatus === 'failed' && record.failureKind && (
                  <p className="text-slate-800">{en.failureKinds[record.failureKind]}</p>
                )}
                {record.syncStatus === 'failed' && syncEnabled && (
                  <div className="flex flex-col gap-1">
                    <Button variant="secondary" className="self-start" onClick={() => void retry(record.id)}>
                      {en.sync.retry}
                    </Button>
                    {record.failureKind !== 'network' && <p className="text-sm text-slate-700">{en.sync.retryHelp}</p>}
                  </div>
                )}
              </section>
              {record.syncStatus === 'conflict' && (
                <ConflictReview record={record} scope={session.user.scope} waterPointName={nameOf} onResolved={setResolved} />
              )}
              <dl className="grid gap-3 sm:grid-cols-[12rem_1fr]">
                <dt className="font-medium">{f.waterPoint}</dt>
                <dd>{nameOf(record.waterPointId)}</dd>
                <dt className="font-medium">{f.description}</dt>
                <dd className="whitespace-pre-wrap">{record.description}</dd>
                <dt className="font-medium">{f.severity}</dt>
                <dd>{record.severity ? en.severities[record.severity] : en.severities.notSure}</dd>
                <dt className="font-medium">{f.occurredAt}</dt>
                <dd>{record.occurredAt ? formatDateTime(record.occurredAt) : f.notRecorded}</dd>
                <dt className="font-medium">{f.locationNote}</dt>
                <dd>{record.locationNote ?? f.notRecorded}</dd>
                <dt className="font-medium">{f.createdAt}</dt>
                <dd>{formatDateTime(record.clientCreatedAt)}</dd>
              </dl>
            </article>
          )
        }}
      </AsyncBoundary>
    </div>
  )
}
