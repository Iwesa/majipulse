import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

const toneClasses: Record<Tone, string> = {
  neutral: 'border-slate-400 bg-slate-100 text-slate-900',
  info: 'border-sky-700 bg-sky-50 text-sky-900',
  success: 'border-green-700 bg-green-50 text-green-900',
  warning: 'border-amber-700 bg-amber-50 text-amber-950',
  danger: 'border-red-700 bg-red-50 text-red-900',
}

interface BadgeProps {
  tone?: Tone
  /** Decorative icon shown before the text. The text always carries the meaning. */
  icon?: ReactNode
  children: string
  className?: string
}

export function Badge({ tone = 'neutral', icon, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-medium',
        toneClasses[tone],
        className,
      )}
    >
      {icon && (
        <span aria-hidden="true" className="inline-flex">
          {icon}
        </span>
      )}
      {children}
    </span>
  )
}
