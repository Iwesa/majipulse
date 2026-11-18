import { CircleCheck, CircleHelp, CircleX, FlaskConical, Wrench } from 'lucide-react'
import { formatDateTime } from '../../lib/formatDate'
import type { WaterPoint } from '../../schemas/waterPoint'
import type { WaterPointList } from '../../stores/waterPointStore'
import { en, format } from '../../strings/en'
import { Alert, Badge, type Tone } from '../ui'

const statusTone: Record<WaterPoint['status'], { tone: Tone; icon: typeof CircleCheck }> = {
  working: { tone: 'success', icon: CircleCheck },
  needs_repair: { tone: 'warning', icon: Wrench },
  not_working: { tone: 'danger', icon: CircleX },
  unknown: { tone: 'neutral', icon: CircleHelp },
}

/** Status always shown as text with an icon, never color alone. */
export function WaterPointStatusBadge({ status }: { status: WaterPoint['status'] }) {
  const { tone, icon: Icon } = statusTone[status]
  return (
    <Badge tone={tone} icon={<Icon className="size-4" />}>
      {en.waterPointStatuses[status]}
    </Badge>
  )
}

/** Shown on every demo record (R10.1). */
export function DemoBadge() {
  return (
    <Badge tone="warning" icon={<FlaskConical className="size-4" />}>
      {en.waterPoints.demoBadge}
    </Badge>
  )
}

/** Explains that the list comes from this device, and since when. */
export function SavedCopyNotice({ list }: { list: WaterPointList }) {
  if (list.status !== 'ready' || list.source !== 'cache') return null
  const template = list.reason === 'offline' ? en.waterPoints.savedCopyOffline : en.waterPoints.savedCopyError
  return (
    <Alert tone="info">
      {format(template, { time: formatDateTime(list.cachedAt) })} {en.waterPoints.savedCopyNote}
    </Alert>
  )
}
