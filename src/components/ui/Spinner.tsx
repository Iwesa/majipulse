import { LoaderCircle } from 'lucide-react'
import { cn } from '../../lib/cn'
import { en } from '../../strings/en'

interface SpinnerProps {
  /** Text announced to screen readers. Ignored when decorative. */
  label?: string
  /** Hide from assistive technology, for spinners inside labeled controls. */
  decorative?: boolean
  className?: string
}

export function Spinner({ label = en.common.loading, decorative = false, className }: SpinnerProps) {
  const icon = <LoaderCircle aria-hidden="true" className={cn('size-5 animate-spin motion-reduce:animate-none', className)} />
  if (decorative) return icon
  return (
    <span role="status" className="inline-flex items-center gap-2">
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  )
}
