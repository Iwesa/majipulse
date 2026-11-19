import { Link } from 'react-router-dom'
import type { NavKey } from '../components/layout/navigation'
import { EmptyState } from '../components/ui'
import { en } from '../strings/en'

/** Stand-in for screens built in later phases. */
export function PlaceholderPage({ navKey }: { navKey: NavKey }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-slate-900">{en.nav[navKey]}</h1>
      <EmptyState title={en.nav[navKey]} description={en.placeholder.description} />
    </div>
  )
}

export function NotFoundPage() {
  return (
    <EmptyState
      headingLevel={1}
      title={en.access.notFoundTitle}
      description={en.access.notFoundDescription}
      action={
        <Link to="/" className="font-medium text-sky-900 underline">
          {en.access.backHome}
        </Link>
      }
    />
  )
}
