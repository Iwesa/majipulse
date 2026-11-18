import { Pencil } from 'lucide-react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useSession, useWaterPoints } from '../../app/servicesContext'
import { Alert, AsyncBoundary, EmptyState } from '../../components/ui'
import { DemoBadge, SavedCopyNotice, WaterPointStatusBadge } from '../../components/waterPoints/WaterPointBits'
import { formatDateTime } from '../../lib/formatDate'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { isStaffRole } from '../../schemas/roles'
import { en } from '../../strings/en'
import { listToAsyncState } from './listState'
import { linkButtonClasses } from './linkStyles'

const backLink = (
  <Link to="/water-points" className="font-medium text-sky-900 underline">
    {en.waterPoints.backToList}
  </Link>
)

export function WaterPointDetailPage() {
  const { waterPointId = '' } = useParams()
  const session = useSession((s) => s.session)
  const list = useWaterPoints((s) => s.list)
  const load = useWaterPoints((s) => s.load)
  const online = useOnlineStatus()
  const saved = (useLocation().state as { saved?: boolean } | null)?.saved === true
  if (session.status !== 'signedIn') return null
  const staff = isStaffRole(session.user.role)

  return (
    <div className="flex flex-col gap-4">
      {backLink}
      <SavedCopyNotice list={list} />
      <AsyncBoundary state={listToAsyncState(list)} onRetry={() => void load(session.user.scope)}>
        {(points) => {
          const point = points.find((p) => p.id === waterPointId)
          if (!point) {
            return <EmptyState title={en.waterPoints.notFoundTitle} description={en.waterPoints.notFoundDescription} />
          }
          return (
            <article className="flex flex-col gap-4">
              {saved && <Alert tone="success">{en.waterPoints.saved}</Alert>}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-2xl font-bold text-slate-900">{point.name}</h1>
                {staff && online && (
                  <Link to={`/water-points/${encodeURIComponent(point.id)}/edit`} className={linkButtonClasses}>
                    <Pencil aria-hidden="true" className="size-5" />
                    {en.waterPoints.edit}
                  </Link>
                )}
              </div>
              {staff && !online && <p className="text-slate-700">{en.waterPoints.onlineOnly}</p>}
              <div className="flex flex-wrap gap-2">
                <WaterPointStatusBadge status={point.status} />
                {point.demo && <DemoBadge />}
              </div>
              <dl className="grid gap-3 sm:grid-cols-[12rem_1fr]">
                <dt className="font-medium text-slate-900">{en.waterPoints.fields.type}</dt>
                <dd className="text-slate-800">{en.waterPointTypes[point.type]}</dd>
                <dt className="font-medium text-slate-900">{en.waterPoints.fields.locationDescription}</dt>
                <dd className="text-slate-800">{point.locationDescription}</dd>
                <dt className="font-medium text-slate-900">{en.waterPoints.fields.ward}</dt>
                <dd className="text-slate-800">{point.ward ?? en.waterPoints.fields.noWard}</dd>
                <dt className="font-medium text-slate-900">{en.waterPoints.fields.updatedAt}</dt>
                <dd className="text-slate-800">{formatDateTime(point.updatedAt)}</dd>
              </dl>
            </article>
          )
        }}
      </AsyncBoundary>
    </div>
  )
}
