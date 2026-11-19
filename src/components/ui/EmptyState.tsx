import { Inbox, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { en } from '../../strings/en'

interface EmptyStateProps {
  title?: string
  description?: string
  /** Optional call to action, such as a Button. */
  action?: ReactNode
  icon?: LucideIcon
  /** 1 when the state is the whole page, so the page still has one h1. */
  headingLevel?: 1 | 2
}

export function EmptyState({ title = en.states.emptyTitle, description, action, icon: Icon = Inbox, headingLevel = 2 }: EmptyStateProps) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  return (
    <section className="flex flex-col items-center gap-3 rounded-md border border-dashed border-slate-400 p-8 text-center">
      <Icon aria-hidden="true" className="size-8 text-slate-600" />
      <Heading className="text-lg font-semibold text-slate-900">{title}</Heading>
      {description && <p className="max-w-prose text-slate-700">{description}</p>}
      {action}
    </section>
  )
}
