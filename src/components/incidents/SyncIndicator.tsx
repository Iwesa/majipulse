import { Clock, RefreshCw, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useIncidents, useSync } from '../../app/servicesContext'
import { en, format } from '../../strings/en'

/** Header summary of unsent reports (T5.4). Text and icon, linking to the sync page. */
export function SyncIndicator() {
  const list = useIncidents((s) => s.list)
  const running = useSync((s) => s.status.running)
  if (list.status !== 'ready') return null
  const waiting = list.records.filter((r) => r.syncStatus === 'pending' || r.syncStatus === 'syncing').length
  const attention = list.records.filter((r) => r.syncStatus === 'failed' || r.syncStatus === 'conflict').length
  if (waiting === 0 && attention === 0) return null

  const linkClasses =
    'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-3 focus-visible:outline-sky-600'
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {waiting > 0 && (
        <Link to="/sync" className={`${linkClasses} border-sky-700 bg-sky-50 text-sky-900`}>
          {running ? <RefreshCw aria-hidden="true" className="size-4" /> : <Clock aria-hidden="true" className="size-4" />}
          {running
            ? en.sync.indicatorSending
            : waiting === 1
              ? en.sync.indicatorWaitingOne
              : format(en.sync.indicatorWaiting, { count: String(waiting) })}
        </Link>
      )}
      {attention > 0 && (
        <Link to="/sync" className={`${linkClasses} border-amber-700 bg-amber-50 text-amber-950`}>
          <TriangleAlert aria-hidden="true" className="size-4" />
          {attention === 1 ? en.sync.indicatorAttentionOne : format(en.sync.indicatorAttention, { count: String(attention) })}
        </Link>
      )}
    </span>
  )
}
