import { CircleX } from 'lucide-react'
import type { ReactNode } from 'react'
import { en } from '../../strings/en'
import type { FieldIds } from './fieldIds'

export interface FieldBaseProps {
  label: string
  hint?: string
  /** Error message. When set, the control is marked invalid. */
  error?: string
  required?: boolean
}

interface FieldShellProps extends FieldBaseProps {
  ids: FieldIds
  children: ReactNode
}

/** Label, hint, and error layout shared by all form fields. */
export function FieldShell({ label, hint, error, required, ids, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={ids.fieldId} className="font-medium text-slate-900">
        {label}
        {required && (
          <>
            {' '}
            <span className="text-sm font-normal text-slate-700">{en.common.required}</span>
          </>
        )}
      </label>
      {hint && (
        <p id={ids.hintId} className="text-sm text-slate-700">
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p id={ids.errorId} className="flex items-center gap-1 text-sm font-medium text-red-700">
          <CircleX aria-hidden="true" className="size-4 shrink-0" />
          <span>
            <span className="sr-only">{en.common.errorPrefix}</span> {error}
          </span>
        </p>
      )}
    </div>
  )
}
