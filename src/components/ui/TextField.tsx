import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'
import { FieldShell, type FieldBaseProps } from './FieldShell'
import { controlBorder, controlClasses } from './fieldStyles'
import { useFieldIds } from './fieldIds'

export type TextFieldProps = FieldBaseProps & Omit<ComponentProps<'input'>, 'required'>

export function TextField({ label, hint, error, required, id, className, type = 'text', ...rest }: TextFieldProps) {
  const ids = useFieldIds(id, Boolean(hint), Boolean(error))
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} ids={ids}>
      <input
        {...rest}
        id={ids.fieldId}
        type={type}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
        className={cn(controlClasses, controlBorder(Boolean(error)), className)}
      />
    </FieldShell>
  )
}
