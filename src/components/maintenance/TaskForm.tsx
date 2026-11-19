import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import type { MaintenanceTaskInput } from '../../schemas/maintenanceTask'
import { en } from '../../strings/en'
import { Button, SelectField, TextArea, TextField, type SelectOption } from '../ui'

const m = en.maintenance
const v = m.validation
const UNASSIGNED = ''

const formSchema = z.object({
  title: z.string().trim().min(1, { error: v.titleRequired }).max(120, { error: v.titleTooLong }),
  notes: z.string().trim().max(2000, { error: v.notesTooLong }),
  assigneeId: z.string(),
})
type FormValues = z.infer<typeof formSchema>

interface TaskFormProps {
  /** People the task can be assigned to. "Unassigned" is always offered. */
  assignees: readonly SelectOption[]
  assigneeHint: string
  initial?: MaintenanceTaskInput
  submitLabel: string
  disabled?: boolean
  onSubmit(input: MaintenanceTaskInput): Promise<void>
}

/** Title, notes, and assignee of a maintenance task (T7.3). */
export function TaskForm({ assignees, assigneeHint, initial, submitLabel, disabled = false, onSubmit }: TaskFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { title: initial?.title ?? '', notes: initial?.notes ?? '', assigneeId: initial?.assigneeId ?? UNASSIGNED },
  })

  // Keep the current assignee selectable even if they are not in the list (for example for a technician).
  const options = [...assignees]
  if (initial?.assigneeId && !options.some((o) => o.value === initial.assigneeId)) {
    options.push({ value: initial.assigneeId, label: m.assignedToOther })
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={handleSubmit((values) =>
        onSubmit({ title: values.title, notes: values.notes, assigneeId: values.assigneeId === UNASSIGNED ? null : values.assigneeId }),
      )}
    >
      <TextField label={m.titleField} hint={m.titleHint} required maxLength={120} error={errors.title?.message} {...register('title')} />
      <TextArea label={m.notesField} hint={m.notesHint} rows={4} maxLength={2000} error={errors.notes?.message} {...register('notes')} />
      <SelectField label={m.assigneeField} hint={assigneeHint} placeholder={m.unassigned} options={options} {...register('assigneeId')} />
      <Button type="submit" className="self-start" loading={isSubmitting} disabled={disabled}>
        {submitLabel}
      </Button>
    </form>
  )
}
