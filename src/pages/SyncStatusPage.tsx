import { Link } from 'react-router-dom'
import { useIncidents, useSession, useSync, useWaterPoints } from '../app/servicesContext'
import { SyncStatusBadge } from '../components/incidents/SyncStatusBadge'
import { Alert, AsyncBoundary, Button } from '../components/ui'
import { formatDateTime } from '../lib/formatDate'
import { useOnlineStatus } from '../lib/useOnlineStatus'
import type { SyncStatus } from '../schemas/localIncident'
import { en, format } from '../strings/en'
import { incidentListToAsync } from './reports/incidentListState'

const ORDER: SyncStatus[] = ['pending', 'syncing', 'failed', 'conflict', 'synced']

/** Sync status (T5.4): counts per status, last successful send, send now, and reports needing attention. */
export function SyncStatusPage() {
  const session = useSession((s) => s.session)
  const list = useIncidents((s) => s.list)
  const load = useIncidents((s) => s.load)
  const status = useSync((s) => s.status)
  const enabled = useSync((s) => s.enabled)
  const requestSync = useSync((s) => s.requestSync)
  const points = useWaterPoints((s) => s.list)
  const online = useOnlineStatus()
  if (session.status !== 'signedIn') return null
  const nameOf = (id: string) =>
    (points.status === 'ready' ? points.points.find((p) => p.id === id)?.name : undefined) ?? en.reports.unknownWaterPoint

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-slate-900">{en.sync.title}</h1>
      <p className="text-slate-700">{en.sync.intro}</p>
      <p className="text-slate-800">
        {status.lastSyncAt ? format(en.sync.lastSync, { time: formatDateTime(status.lastSyncAt) }) : en.sync.neverSynced}
      </p>
      {!online && <Alert tone="info">{en.sync.offlineNote}</Alert>}
      {online && status.lastRun === 'busy' && <Alert tone="info">{en.sync.busyNote}</Alert>}
      {enabled && (
        <Button className="self-start" loading={status.running} disabled={!online} onClick={() => void requestSync('manual')}>
          {status.running ? en.sync.sending : en.sync.sendNow}
        </Button>
      )}

      <AsyncBoundary state={incidentListToAsync(list)} onRetry={() => void load(session.user.scope)}>
        {(records) => {
          const count = (s: SyncStatus) => records.filter((r) => r.syncStatus === s).length
          const attention = records.filter((r) => r.syncStatus === 'failed' || r.syncStatus === 'conflict')
          const unsent = records.some((r) => r.syncStatus !== 'synced')
          return (
            <div className="flex flex-col gap-6">
              {records.length > 0 && !unsent && <Alert tone="success">{en.sync.allSent}</Alert>}
              {attention.some((r) => r.syncStatus === 'failed') && <Alert tone="warning">{en.sync.failedNote}</Alert>}

              <section aria-labelledby="counts-heading" className="flex flex-col gap-2">
                <h2 id="counts-heading" className="text-xl font-semibold">
                  {en.sync.countsTitle}
                </h2>
                <ul className="flex flex-wrap gap-3">
                  {ORDER.map((s) => (
                    <li key={s} className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2">
                      <SyncStatusBadge status={s} />
                      <span className="font-semibold">{count(s)}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section aria-labelledby="attention-heading" className="flex flex-col gap-2">
                <h2 id="attention-heading" className="text-xl font-semibold">
                  {en.sync.attentionTitle}
                </h2>
                {attention.length === 0 ? (
                  <p className="text-slate-700">{en.sync.noAttention}</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {attention.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border border-slate-300 bg-white p-3">
                        <Link to={`/reports/${r.id}`} className="font-medium text-sky-900 underline">
                          {en.incidentTypes[r.incidentType]}: {nameOf(r.waterPointId)}
                        </Link>
                        <SyncStatusBadge status={r.syncStatus} />
                        {r.syncStatus === 'failed' && r.failureKind && (
                          <span className="text-sm text-slate-700">{en.failureKinds[r.failureKind]}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )
        }}
      </AsyncBoundary>
    </div>
  )
}
