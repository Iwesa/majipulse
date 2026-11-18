import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { DESCRIPTION_MAX, LOCATION_NOTE_MAX, incidentTypeSchema, severitySchema } from '../../schemas/incident'
import type { WaterPointRecord } from '../../schemas/waterPoint'
import type { IncidentContent } from '../../services/incidents'
import { en } from '../../strings/en'
import { Button, SelectField, TextArea, TextField } from '../ui'

const v = en.reports.validation
const NOT_SURE = ''

/** `datetime-local` value (local time, no offset) <-> ISO 8601 with offset. */
const toLocalInput = (iso: string): string => {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromLocalInput = (value: string): string => new Date(value).toISOString()

const formSchema = (now: () => Date) =>
  z.object({
    waterPointId: z.string().min(1, { error: v.waterPointRequired }),
    description: z.string().trim().min(1, { error: v.descriptionRequired }).max(DESCRIPTION_MAX, { error: v.descriptionTooLong }),
    incidentType: z.enum(incidentTypeSchema.options, { error: v.incidentTypeRequired }),
    severity: z.union([z.literal(NOT_SURE), severitySchema]),
    occurredAt: z
      .string()
      .refine((s) => s === '' || !Number.isNaN(Date.parse(s)), { error: v.occurredAtInvalid })
      .refine((s) => s === '' || Number.isNaN(Date.parse(s)) || Date.parse(s) <= now().getTime(), { error: v.occurredAtFuture }),
    locationNote: z.string().trim().max(LOCATION_NOTE_MAX, { error: v.locationNoteTooLong }),
  })
type Schema = ReturnType<typeof formSchema>
type FormInput = z.input<Schema>
type FormOutput = z.output<Schema>

const toContent = (values: FormOutput): IncidentContent => ({
  waterPointId: values.waterPointId,
  description: values.description,
  incidentType: values.incidentType,
  severity: values.severity === NOT_SURE ? null : values.severity,
  ...(values.occurredAt ? { occurredAt: fromLocalInput(values.occurredAt) } : {}),
  ...(values.locationNote ? { locationNote: values.locationNote } : {}),
})

const TYPE_OPTIONS = incidentTypeSchema.options.map((value) => ({ value, label: en.incidentTypes[value] }))
const SEVERITY_OPTIONS = [
  { value: NOT_SURE, label: en.severities.notSure },
  ...severitySchema.options.map((value) => ({ value, label: en.severities[value] })),
]

interface IncidentFormProps {
  waterPoints: readonly WaterPointRecord[]
  initial?: IncidentContent
  onSubmit(content: IncidentContent): Promise<void>
  now?: () => Date
}

/**
 * Manual report entry (T4.3). Needs no connection: it only reads the water
 * points already on this device and hands the content to the caller.
 */
export function IncidentForm({ waterPoints, initial, onSubmit, now = () => new Date() }: IncidentFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema(now)),
    defaultValues: {
      waterPointId: initial?.waterPointId ?? '',
      description: initial?.description ?? '',
      incidentType: initial?.incidentType,
      severity: initial?.severity ?? NOT_SURE,
      occurredAt: initial?.occurredAt ? toLocalInput(initial.occurredAt) : '',
      locationNote: initial?.locationNote ?? '',
    },
  })

  const pointOptions = waterPoints.map((p) => ({ value: p.id, label: p.ward ? `${p.name} (${p.ward})` : p.name }))
  // Keep a report's water point selectable even if it is no longer in the list.
  if (initial && !waterPoints.some((p) => p.id === initial.waterPointId)) {
    pointOptions.push({ value: initial.waterPointId, label: en.reports.unknownWaterPoint })
  }

  return (
    <form noValidate onSubmit={handleSubmit((values) => onSubmit(toContent(values)))} className="flex flex-col gap-4">
      <SelectField
        label={en.reports.fields.waterPoint}
        options={pointOptions}
        required
        error={errors.waterPointId?.message}
        {...register('waterPointId')}
      />
      <TextArea
        label={en.reports.fields.description}
        hint={en.reports.fields.descriptionHint}
        required
        rows={5}
        maxLength={DESCRIPTION_MAX}
        error={errors.description?.message}
        {...register('description')}
      />
      <SelectField
        label={en.reports.fields.incidentType}
        options={TYPE_OPTIONS}
        required
        error={errors.incidentType?.message}
        {...register('incidentType')}
      />
      <SelectField
        label={en.reports.fields.severity}
        hint={en.reports.fields.severityHint}
        options={SEVERITY_OPTIONS}
        placeholder={null}
        error={errors.severity?.message}
        {...register('severity')}
      />
      <TextField
        label={en.reports.fields.occurredAt}
        hint={en.reports.fields.occurredAtHint}
        type="datetime-local"
        error={errors.occurredAt?.message}
        {...register('occurredAt')}
      />
      <TextField
        label={en.reports.fields.locationNote}
        hint={en.reports.fields.locationNoteHint}
        maxLength={LOCATION_NOTE_MAX}
        error={errors.locationNote?.message}
        {...register('locationNote')}
      />
      <Button type="submit" loading={isSubmitting} className="self-start">
        {en.reports.save}
      </Button>
    </form>
  )
}
