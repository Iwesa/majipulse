import { Plus } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession, useWaterPoints } from '../../app/servicesContext'
import { AsyncBoundary, EmptyState, TextField } from '../../components/ui'
import { DemoBadge, SavedCopyNotice, WaterPointStatusBadge } from '../../components/waterPoints/WaterPointBits'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { isStaffRole } from '../../schemas/roles'
import type { WaterPointRecord } from '../../schemas/waterPoint'
import { en, format } from '../../strings/en'
import { linkButtonClasses } from './linkStyles'
import { listToAsyncState } from './listState'

const matches = (point: WaterPointRecord, query: string) =>
  [point.name, point.ward ?? '', point.locationDescription].some((text) => text.toLowerCase().includes(query))

export function WaterPointsPage() {
  const session = useSession((s) => s.session)
  const list = useWaterPoints((s) => s.list)
  const load = useWaterPoints((s) => s.load)
  const online = useOnlineStatus()
  const [query, setQuery] = useState('')
  const countId = useId()

  const normalized = query.trim().toLowerCase()
  const state = useMemo(() => listToAsyncState(list), [list])
  if (session.status !== 'signedIn') return null
  const staff = isStaffRole(session.user.role)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{en.nav.waterPoints}</h1>
        {staff && online && (
          <Link to="/water-points/new" className={linkButtonClasses}>
            <Plus aria-hidden="true" className="size-5" />
            {en.waterPoints.register}
          </Link>
        )}
      </div>
      {staff && !online && <p className="text-slate-700">{en.waterPoints.onlineOnly}</p>}

      <SavedCopyNotice list={list} />

      <AsyncBoundary
        state={state}
        isEmpty={(points) => points.length === 0}
        empty={
          <EmptyState
            title={en.waterPoints.emptyTitle}
            description={staff ? en.waterPoints.emptyStaff : en.waterPoints.emptyReporter}
          />
        }
        onRetry={() => void load(session.user.scope)}
      >
        {(points) => {
          const shown = normalized ? points.filter((p) => matches(p, normalized)) : points
          return (
            <div className="flex flex-col gap-3">
              <div className="max-w-md">
                <TextField
                  label={en.waterPoints.search}
                  hint={en.waterPoints.searchHint}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-controls={countId}
                />
              </div>
              <p id={countId} role="status" className="text-sm text-slate-700">
                {shown.length === 1 ? en.waterPoints.countOne : format(en.waterPoints.count, { count: String(shown.length) })}
              </p>
              {shown.length === 0 ? (
                <p className="text-slate-700">{en.waterPoints.noMatches}</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {shown.map((point) => (
                    <li key={point.id} className="rounded-md border border-slate-300 bg-white p-4">
                      <Link
                        to={`/water-points/${encodeURIComponent(point.id)}`}
                        className="text-lg font-semibold text-sky-900 underline-offset-4 hover:underline focus-visible:outline-3 focus-visible:outline-sky-600"
                      >
                        {point.name}
                      </Link>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-700">
                        <span>{en.waterPointTypes[point.type]}</span>
                        {point.ward && <span>· {point.ward}</span>}
                        <WaterPointStatusBadge status={point.status} />
                        {point.demo && <DemoBadge />}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        }}
      </AsyncBoundary>
    </div>
  )
}
