import { CircleCheck, CircleX, Clock, RefreshCw, TriangleAlert } from 'lucide-react'
import type { SyncStatus } from '../../schemas/localIncident'
import { en } from '../../strings/en'
import { Badge, type Tone } from '../ui'

const look: Record<SyncStatus, { tone: Tone; icon: typeof Clock }> = {
  pending: { tone: 'info', icon: Clock },
  syncing: { tone: 'info', icon: RefreshCw },
  synced: { tone: 'success', icon: CircleCheck },
  failed: { tone: 'danger', icon: CircleX },
  conflict: { tone: 'warning', icon: TriangleAlert },
}

/** Sync status as text plus an icon, never color alone (R6). */
export function SyncStatusBadge({ status }: { status: SyncStatus }) {
  const { tone, icon: Icon } = look[status]
  return (
    <Badge tone={tone} icon={<Icon className="size-4" />}>
      {en.syncStatuses[status]}
    </Badge>
  )
}
