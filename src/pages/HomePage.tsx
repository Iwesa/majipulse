import { Plus } from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useDashboard, useIncidents, useSync, useWaterPoints } from '../app/servicesContext'
import { CountCard } from '../components/dashboard/CountCard'
import { IncidentStatusBadge, MaintenanceStatusBadge } from '../components/incidents/StatusBadges'
import { SyncStatusBadge } from '../components/incidents/SyncStatusBadge'
import { Alert, Spinner } from '../components/ui'
import { WaterPointStatusBadge } from '../components/waterPoints/WaterPointBits'
import { formatDateTime } from '../lib/formatDate'
import type { SyncStatus } from '../schemas/localIncident'
import { isStaffRole, type SessionScope } from '../schemas/roles'
import type { WaterPointRecord } from '../schemas/waterPoint'
import { OPEN_INCIDENT_STATUSES, OPEN_TASK_STATUSES } from '../services/staff'
import { countSyncStatuses, countWaterPointStatuses } from '../stores/dashboardStore'
import { en, format } from '../strings/en'
import { useSignedInUser } from './incidents/staffPageHelpers'
import { linkButtonClasses } from './waterPoints/linkStyles'

const h = en.home
const SYNC_SHOWN: SyncStatus[] = ['pending', 'failed', 'conflict', 'synced']
const WATER_POINT_STATUSES: WaterPointRecord['status'][] = ['working', 'needs_repair', 'not_working', 'unknown']

function StaffCounts({ scope }: { scope: SessionScope }) {
  const counts = useDashboard((s) => s.staffCounts)
  const load = useDashboard((s) => s.loadStaffCounts)
  useEffect(() => {
    const refresh = () => void load(scope)
    refresh()
    window.addEventListener('online', refresh)
    return () => window.removeEventListener('online', refresh)
  }, [scope, load])

  const notice =
    counts.status === 'ready' ? undefined : counts.status === 'offline' ? (
      <p className="text-slate-800">{h.countsOffline}</p>
    ) : counts.status === 'error' ? (
      <Alert tone="error">{h.countsError}</Alert>
    ) : (
      <Spinner />
    )
  const data = counts.status === 'ready' ? counts.data : null

  return (
    <>
      <CountCard
        id="dash-incidents"
        title={h.incidentsTitle}
        notice={notice}
        items={OPEN_INCIDENT_STATUSES.map((s) => ({
          key: s,
          label: <IncidentStatusBadge status={s} />,
          count: data?.incidents[s] ?? 0,
          link: { to: `/incidents?status=${s}`, name: format(h.viewIncidents, { status: en.incidentStatuses[s] }) },
        }))}
      />
      <CountCard
        id="dash-tasks"
        title={h.tasksTitle}
        notice={notice}
        items={OPEN_TASK_STATUSES.map((s) => ({
          key: s,
          label: <MaintenanceStatusBadge status={s} />,
          count: data?.tasks[s] ?? 0,
          link: { to: `/maintenance?status=${s}`, name: format(h.viewTasks, { status: en.maintenanceStatuses[s] }) },
        }))}
      />
    </>
  )
}

function WaterPointCounts() {
  const list = useWaterPoints((s) => s.list)
  const ready = list.status === 'ready'
  const counts = countWaterPointStatuses(ready ? list.points : [])
  const notice = !ready ? (
    list.status === 'offline' ? <p className="text-slate-800">{en.states.offlineDescription}</p> : list.status === 'error' ? <Alert tone="error">{en.states.errorDescription}</Alert> : <Spinner />
  ) : list.points.length === 0 ? (
    <p className="text-slate-800">{h.noWaterPoints}</p>
  ) : undefined
  return (
    <CountCard
      id="dash-water-points"
      title={h.waterPointsTitle}
      notice={notice}
      items={WATER_POINT_STATUSES.map((s) => ({ key: s, label: <WaterPointStatusBadge status={s} />, count: counts[s] }))}
      footer={
        <div className="flex flex-col gap-1 text-sm text-slate-700">
          {ready && list.source === 'cache' && <p>{format(h.waterPointsSaved, { time: formatDateTime(list.cachedAt) })}</p>}
          <Link to="/water-points" className="font-medium text-sky-900 underline">
            {h.viewWaterPoints}
          </Link>
        </div>
      }
    />
  )
}

function SyncCounts() {
  const list = useIncidents((s) => s.list)
  const lastSyncAt = useSync((s) => s.status.lastSyncAt)
  const counts = countSyncStatuses(list.status === 'ready' ? list.records : [])
  const notice =
    list.status === 'error' ? <Alert tone="error">{en.states.errorDescription}</Alert> : list.status === 'ready' ? undefined : <Spinner />
  return (
    <CountCard
      id="dash-sync"
      title={h.syncTitle}
      notice={notice}
      items={SYNC_SHOWN.map((s) => ({ key: s, label: <SyncStatusBadge status={s} />, count: counts[s] + (s === 'pending' ? counts.syncing : 0) }))}
      footer={
        <div className="flex flex-col gap-1 text-sm text-slate-700">
          <p>{lastSyncAt ? format(h.lastSync, { time: formatDateTime(lastSyncAt) }) : h.neverSynced}</p>
          <Link to="/sync" className="font-medium text-sky-900 underline">
            {h.viewSync}
          </Link>
        </div>
      }
    />
  )
}

/** Role-based dashboard (T7.4). */
export function HomePage() {
  const signedIn = useSignedInUser()
  if (!signedIn) return null
  const { user, scope } = signedIn
  const staff = isStaffRole(user.role)
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-slate-900">{h.title}</h1>
      <p className="text-slate-700">{format(h.welcome, { role: en.roles[user.role] })}</p>
      <p className="text-slate-700">{staff ? h.staffIntro : h.reporterIntro}</p>
      <Link to="/reports/new" className={`${linkButtonClasses} self-start`}>
        <Plus aria-hidden="true" className="size-5" />
        {h.newReport}
      </Link>
      <div className="grid gap-4 md:grid-cols-2">
        {staff && <StaffCounts scope={scope} />}
        {staff && <WaterPointCounts />}
        <SyncCounts />
      </div>
    </div>
  )
}
