import { CircleX } from 'lucide-react'
import { en } from '../../strings/en'
import { Button } from './Button'

interface ErrorStateProps {
  title?: string
  /** Plain-language explanation for the user. Never raw error details. */
  message?: string
  onRetry?: () => void
  retryLabel?: string
  /** 1 when the state is the whole page, so the page still has one h1. */
  headingLevel?: 1 | 2
}

export function ErrorState({
  title = en.states.errorTitle,
  message = en.states.errorDescription,
  onRetry,
  retryLabel = en.common.retry,
  headingLevel = 2,
}: ErrorStateProps) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  return (
    <section
      role="alert"
      className="flex flex-col items-center gap-3 rounded-md border border-red-700 bg-red-50 p-8 text-center"
    >
      <CircleX aria-hidden="true" className="size-8 text-red-700" />
      <Heading className="text-lg font-semibold text-red-950">{title}</Heading>
      <p className="max-w-prose text-red-950">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </section>
  )
}
