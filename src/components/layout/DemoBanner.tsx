import { FlaskConical } from 'lucide-react'
import { en } from '../../strings/en'

/** Shown whenever demo records are on screen (R10.1). */
export function DemoBanner() {
  return (
    <div className="border-b border-amber-700 bg-amber-100 px-4 py-2 text-amber-950">
      <p className="mx-auto flex max-w-6xl items-center gap-2 text-sm font-medium">
        <FlaskConical aria-hidden="true" className="size-4 shrink-0" />
        {en.layout.demoBanner}
      </p>
    </div>
  )
}
