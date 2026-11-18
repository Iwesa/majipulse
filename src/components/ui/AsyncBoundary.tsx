import { CloudOff } from 'lucide-react'
import type { ReactNode } from 'react'
import { en } from '../../strings/en'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { Spinner } from './Spinner'

/** The four non-ready states every data view must handle, plus ready. */
export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; message?: string }
  | { status: 'offline' }
  | { status: 'ready'; data: T }

interface AsyncBoundaryProps<T> {
  state: AsyncState<T>
  children: (data: T) => ReactNode
  /** Treat ready data as empty, for example an empty list. */
  isEmpty?: (data: T) => boolean
  /** Rendered for empty data. Defaults to a generic EmptyState. */
  empty?: ReactNode
  loadingLabel?: string
  onRetry?: () => void
}

export function AsyncBoundary<T>({ state, children, isEmpty, empty, loadingLabel, onRetry }: AsyncBoundaryProps<T>) {
  switch (state.status) {
    case 'loading':
      return (
        <div className="flex justify-center p-8">
          <Spinner label={loadingLabel} />
        </div>
      )
    case 'error':
      return <ErrorState message={state.message} onRetry={onRetry} />
    case 'offline':
      return <EmptyState icon={CloudOff} title={en.states.offlineTitle} description={en.states.offlineDescription} />
    case 'ready':
      if (isEmpty?.(state.data)) return <>{empty ?? <EmptyState />}</>
      return <>{children(state.data)}</>
  }
}
