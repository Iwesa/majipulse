import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { z } from 'zod'
import { useSession, useWaterPoints } from '../../app/servicesContext'
import { Alert, AsyncBoundary, Button, EmptyState, SelectField, TextArea, TextField } from '../../components/ui'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import type { SessionScope } from '../../schemas/roles'
import {
  waterPointStatusSchema,
  waterPointTypeSchema,
  type WaterPointInput,
  type WaterPointRecord,
} from '../../schemas/waterPoint'
import { waterPointErrorKind, type WaterPointErrorKind } from '../../services/waterPoints'
import { en } from '../../strings/en'
import { listToAsyncState } from './listState'

const v = en.waterPoints.validation
const formSchema = z.object({
  name: z.string().trim().min(1, { error: v.nameRequired }).max(120, { error: v.nameTooLong }),
  type: z.enum(waterPointTypeSchema.options, { error: v.typeRequired }),
  locationDescription: z.string().trim().min(1, { error: v.locationRequired }).max(500, { error: v.locationTooLong }),
  ward: z.string().trim().max(80, { error: v.wardTooLong }),
  status: z.enum(waterPointStatusSchema.options, { error: v.statusRequired }),
})
type FormValues = z.input<typeof formSchema>

const TYPE_OPTIONS = waterPointTypeSchema.options.map((value) => ({ value, label: en.waterPointTypes[value] }))
const STATUS_OPTIONS = waterPointStatusSchema.options.map((value) => ({ value, label: en.waterPointStatuses[value] }))

const toInput = (values: z.output<typeof formSchema>): WaterPointInput => ({
  name: values.name,
  type: values.type,
  locationDescription: values.locationDescription,
  status: values.status,
  ...(values.ward ? { ward: values.ward } : {}),
})

/** Staff only (route guard). Online only: offline registration is out of scope. */
export function WaterPointFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const { waterPointId = '' } = useParams()
  const session = useSession((s) => s.session)
  const list = useWaterPoints((s) => s.list)
  const load = useWaterPoints((s) => s.load)
  if (session.status !== 'signedIn') return null
  const scope = session.user.scope

  if (mode === 'create') return <WaterPointForm scope={scope} />
  return (
    <AsyncBoundary state={listToAsyncState(list)} onRetry={() => void load(scope)}>
      {(points) => {
        const point = points.find((p) => p.id === waterPointId)
        if (!point) return <EmptyState title={en.waterPoints.notFoundTitle} description={en.waterPoints.notFoundDescription} />
        return <WaterPointForm key={point.id} scope={scope} existing={point} />
      }}
    </AsyncBoundary>
  )
}

function WaterPointForm({ scope, existing }: { scope: SessionScope; existing?: WaterPointRecord }) {
  const create = useWaterPoints((s) => s.create)
  const update = useWaterPoints((s) => s.update)
  const online = useOnlineStatus()
  const navigate = useNavigate()
  const [failure, setFailure] = useState<WaterPointErrorKind | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, z.output<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: existing
      ? {
          name: existing.name,
          type: existing.type,
          locationDescription: existing.locationDescription,
          ward: existing.ward ?? '',
          status: existing.status,
        }
      : { ward: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setFailure(null)
    if (!online) {
      setFailure('network')
      return
    }
    try {
      const input = toInput(values)
      const id = existing ? (await update(scope, existing.id, input), existing.id) : await create(scope, input)
      navigate(`/water-points/${encodeURIComponent(id)}`, { state: { saved: true } })
    } catch (error) {
      setFailure(waterPointErrorKind(error))
    }
  })

  const title = existing ? en.waterPoints.editTitle : en.waterPoints.createTitle
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <Link to={existing ? `/water-points/${encodeURIComponent(existing.id)}` : '/water-points'} className="font-medium text-sky-900 underline">
        {en.waterPoints.backToList}
      </Link>
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      {!online && <Alert tone="warning">{en.waterPoints.onlineOnly}</Alert>}
      {failure && <Alert tone="error">{en.waterPoints.errors[failure]}</Alert>}
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextField
          label={en.waterPoints.fields.name}
          hint={en.waterPoints.fields.nameHint}
          required
          error={errors.name?.message}
          {...register('name')}
        />
        <SelectField
          label={en.waterPoints.fields.type}
          options={TYPE_OPTIONS}
          required
          error={errors.type?.message}
          {...register('type')}
        />
        <TextArea
          label={en.waterPoints.fields.locationDescription}
          hint={en.waterPoints.fields.locationHint}
          required
          rows={3}
          error={errors.locationDescription?.message}
          {...register('locationDescription')}
        />
        <TextField
          label={en.waterPoints.fields.ward}
          hint={en.waterPoints.fields.wardHint}
          error={errors.ward?.message}
          {...register('ward')}
        />
        <SelectField
          label={en.waterPoints.fields.status}
          options={STATUS_OPTIONS}
          required
          error={errors.status?.message}
          {...register('status')}
        />
        <Button type="submit" loading={isSubmitting} disabled={!online} className="self-start">
          {en.waterPoints.save}
        </Button>
      </form>
    </div>
  )
}
