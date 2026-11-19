import { CircleCheck, CircleDot, ClipboardCheck, Hammer, Sparkle, type LucideIcon } from 'lucide-react'
import type { IncidentStatus } from '../../schemas/incident'
import type { MaintenanceStatus } from '../../schemas/maintenanceTask'
import { en } from '../../strings/en'
import { Badge, type Tone } from '../ui'

const incidentLook: Record<IncidentStatus, { tone: Tone; icon: LucideIcon }> = {
  new: { tone: 'info', icon: Sparkle },
  triaged: { tone: 'warning', icon: ClipboardCheck },
  in_progress: { tone: 'warning', icon: Hammer },
  resolved: { tone: 'success', icon: CircleCheck },
}

const taskLook: Record<MaintenanceStatus, { tone: Tone; icon: LucideIcon }> = {
  open: { tone: 'info', icon: CircleDot },
  in_progress: { tone: 'warning', icon: Hammer },
  done: { tone: 'success', icon: CircleCheck },
}

/** Server status of an incident. Text and icon, never color alone. */
export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  const { tone, icon: Icon } = incidentLook[status]
  return (
    <Badge tone={tone} icon={<Icon className="size-4" />}>
      {en.incidentStatuses[status]}
    </Badge>
  )
}

export function MaintenanceStatusBadge({ status }: { status: MaintenanceStatus }) {
  const { tone, icon: Icon } = taskLook[status]
  return (
    <Badge tone={tone} icon={<Icon className="size-4" />}>
      {en.maintenanceStatuses[status]}
    </Badge>
  )
}
