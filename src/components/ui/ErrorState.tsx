import { CircleX } from 'lucide-react'
import { en } from '../../strings/en'
import { Button } from './Button'

interface ErrorStateProps {
  title?: string
  /** Plain-language explanation for the user. Never raw error details. */
  message?: string
  onRetry?: () => void
  retryLabel?: string
}

export function ErrorState({
  title = en.states.errorTitle,
  message = en.states.errorDescription,
  onRetry,
  retryLabel = en.common.retry,
}: ErrorStateProps) {
  return (
    <section
      role="alert"
      className="flex flex-col items-center gap-3 rounded-md border border-red-700 bg-red-50 p-8 text-center"
    >
      <CircleX aria-hidden="true" className="size-8 text-red-700" />
      <h2 className="text-lg font-semibold text-red-950">{title}</h2>
      <p className="max-w-prose text-red-950">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </section>
  )
}
