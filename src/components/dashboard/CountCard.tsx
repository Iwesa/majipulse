import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export interface CountItem {
  key: string
  /** Visible label, for example a status badge. */
  label: ReactNode
  count: number
  /** Optional link to the matching list, with an accessible name. */
  link?: { to: string; name: string }
}

interface CountCardProps {
  id: string
  title: string
  items: readonly CountItem[]
  /** Shown instead of the counts, for example offline or error states. */
  notice?: ReactNode
  footer?: ReactNode
}

/** A titled list of counts on the dashboard (T7.4). Counts are text, never color alone. */
export function CountCard({ id, title, items, notice, footer }: CountCardProps) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-md border border-slate-300 bg-white p-4">
      <h2 id={id} className="text-lg font-semibold text-slate-900">
        {title}
      </h2>
      {notice ?? (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.key} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">{item.label}</span>
              {item.link ? (
                <Link
                  to={item.link.to}
                  aria-label={`${item.link.name}: ${item.count}`}
                  className="min-w-11 rounded-md px-2 py-1 text-right text-xl font-bold text-sky-900 underline focus-visible:outline-3 focus-visible:outline-sky-600"
                >
                  {item.count}
                </Link>
              ) : (
                <span className="text-xl font-bold text-slate-900">{item.count}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {footer}
    </section>
  )
}
