import { CircleCheck, CircleX, Info, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type AlertTone = 'info' | 'success' | 'warning' | 'error'

const tones: Record<AlertTone, { icon: LucideIcon; classes: string }> = {
  info: { icon: Info, classes: 'border-sky-700 bg-sky-50 text-sky-950' },
  success: { icon: CircleCheck, classes: 'border-green-700 bg-green-50 text-green-950' },
  warning: { icon: TriangleAlert, classes: 'border-amber-700 bg-amber-50 text-amber-950' },
  error: { icon: CircleX, classes: 'border-red-700 bg-red-50 text-red-950' },
}

interface AlertProps {
  tone?: AlertTone
  title?: string
  children: ReactNode
  className?: string
}

/**
 * Inline message. Errors and warnings use role="alert" (announced at once);
 * info and success use role="status" (announced politely).
 */
export function Alert({ tone = 'info', title, children, className }: AlertProps) {
  const { icon: Icon, classes } = tones[tone]
  const role = tone === 'error' || tone === 'warning' ? 'alert' : 'status'
  return (
    <div role={role} className={cn('flex gap-3 rounded-md border-l-4 p-4', classes, className)}>
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div className="flex flex-col gap-1">
        {title && <p className="font-semibold">{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  )
}
