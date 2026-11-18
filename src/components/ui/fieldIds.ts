import { useId } from 'react'

export interface FieldIds {
  fieldId: string
  hintId: string
  errorId: string
  /** Value for aria-describedby, or undefined when there is no hint or error. */
  describedBy: string | undefined
}

/** IDs linking a control to its label, hint, and error message. */
export function useFieldIds(id: string | undefined, hasHint: boolean, hasError: boolean): FieldIds {
  const generated = useId()
  const fieldId = id ?? generated
  const hintId = `${fieldId}-hint`
  const errorId = `${fieldId}-error`
  const describedBy = [hasHint && hintId, hasError && errorId].filter(Boolean).join(' ') || undefined
  return { fieldId, hintId, errorId, describedBy }
}
