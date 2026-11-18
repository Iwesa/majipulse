import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'
import { FieldShell, type FieldBaseProps } from './FieldShell'
import { controlBorder, controlClasses } from './fieldStyles'
import { useFieldIds } from './fieldIds'

export type TextAreaProps = FieldBaseProps & Omit<ComponentProps<'textarea'>, 'required'>

export function TextArea({ label, hint, error, required, id, className, rows = 4, ...rest }: TextAreaProps) {
  const ids = useFieldIds(id, Boolean(hint), Boolean(error))
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} ids={ids}>
      <textarea
        {...rest}
        id={ids.fieldId}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
        className={cn(controlClasses, controlBorder(Boolean(error)), className)}
      />
    </FieldShell>
  )
}
