import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'
import { en } from '../../strings/en'
import { FieldShell, type FieldBaseProps } from './FieldShell'
import { controlBorder, controlClasses } from './fieldStyles'
import { useFieldIds } from './fieldIds'

export interface SelectOption {
  value: string
  label: string
}

export type SelectFieldProps = FieldBaseProps &
  Omit<ComponentProps<'select'>, 'required' | 'children'> & {
    options: readonly SelectOption[]
    /** Text for the empty first option. Set to null to omit it. */
    placeholder?: string | null
  }

export function SelectField({
  label,
  hint,
  error,
  required,
  id,
  className,
  options,
  placeholder = en.common.selectPlaceholder,
  ...rest
}: SelectFieldProps) {
  const ids = useFieldIds(id, Boolean(hint), Boolean(error))
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} ids={ids}>
      <select
        {...rest}
        id={ids.fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
        className={cn(controlClasses, controlBorder(Boolean(error)), className)}
      >
        {placeholder !== null && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  )
}
