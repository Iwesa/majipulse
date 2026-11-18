import { zodResolver } from '@hookform/resolvers/zod'
import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useServices, useSession } from '../app/servicesContext'
import { Alert, AsyncBoundary, Badge, Button, SelectField, TextField, type AsyncState } from '../components/ui'
import { useOnlineStatus } from '../lib/useOnlineStatus'
import { roleSchema, type Role } from '../schemas/roles'
import { UserAdminClientError, type MemberSummary, type UserAdminErrorKind } from '../services/userAdmin'
import { en, format } from '../strings/en'

const ROLE_OPTIONS = roleSchema.options.map((role) => ({ value: role, label: en.roles[role] }))
const NEW_USER_ROLES = (['technician', 'reporter'] as const).map((role) => ({ value: role, label: en.roles[role] }))

const createSchema = z.object({
  displayName: z.string().trim().min(1, { error: en.users.nameRequired }).max(100),
  email: z.string().trim().pipe(z.email({ error: en.signIn.emailInvalid })),
  role: z.enum(['technician', 'reporter'], { error: en.users.roleRequired }),
})
type CreateValues = z.infer<typeof createSchema>

const errorKind = (error: unknown): UserAdminErrorKind =>
  error instanceof UserAdminClientError ? error.kind : 'unknown'

/** Administrator-only screen (T2.9). Route guard: administrators only. */
export function UsersPage() {
  const session = useSession((s) => s.session)
  const { userAdmin } = useServices()
  const online = useOnlineStatus()
  const [members, setMembers] = useState<AsyncState<MemberSummary[]>>({ status: 'loading' })

  const [reloadKey, setReloadKey] = useState(0)
  const organizationId = session.status === 'signedIn' ? session.user.organizationId : null
  const ownerUid = session.status === 'signedIn' ? session.user.uid : null

  useEffect(() => {
    if (!organizationId || !ownerUid) return
    let cancelled = false
    userAdmin.listMembers({ organizationId, ownerUid }).then(
      (data) => {
        if (!cancelled) setMembers({ status: 'ready', data })
      },
      () => {
        if (!cancelled) setMembers(navigator.onLine ? { status: 'error' } : { status: 'offline' })
      },
    )
    return () => {
      cancelled = true
    }
  }, [userAdmin, organizationId, ownerUid, reloadKey])

  /** Re-reads members while keeping the current list on screen. */
  const refresh = useCallback(() => setReloadKey((key) => key + 1), [])
  /** Shows the loading state, then re-reads (after an error). */
  const retry = useCallback(() => {
    setMembers({ status: 'loading' })
    refresh()
  }, [refresh])

  if (session.status !== 'signedIn') return null
  const selfUid = session.user.uid

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-slate-900">{en.users.title}</h1>
        <p className="text-slate-700">{en.users.intro}</p>
      </div>

      <section aria-labelledby="members-heading" className="flex flex-col gap-3">
        <h2 id="members-heading" className="text-xl font-semibold text-slate-900">
          {en.users.listTitle}
        </h2>
        <AsyncBoundary
          state={!online && members.status === 'error' ? { status: 'offline' } : members}
          isEmpty={(list) => list.length === 0}
          onRetry={retry}
        >
          {(list) => (
            <ul className="flex flex-col gap-3">
              {list.map((member) => (
                <MemberRow key={member.uid} member={member} isSelf={member.uid === selfUid} onChanged={refresh} />
              ))}
            </ul>
          )}
        </AsyncBoundary>
      </section>

      <CreateUserForm onCreated={refresh} />
    </div>
  )
}

function MemberRow({ member, isSelf, onChanged }: { member: MemberSummary; isSelf: boolean; onChanged: () => void }) {
  const { userAdmin } = useServices()
  const [role, setRole] = useState<Role>(member.role)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      await userAdmin.setRole(member.uid, role)
      setMessage({ tone: 'success', text: format(en.users.roleSaved, { name: member.displayName }) })
      onChanged()
    } catch (error) {
      setMessage({ tone: 'error', text: en.users.errors[errorKind(error)] })
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-md border border-slate-300 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">
          {member.displayName} {isSelf && <span className="font-normal text-slate-700">{en.common.you}</span>}
        </span>
        <span className="text-slate-700">{member.email}</span>
        <Badge tone="info">{en.roles[member.role]}</Badge>
        <Badge tone={member.active ? 'success' : 'neutral'}>{member.active ? en.users.active : en.users.inactive}</Badge>
      </div>
      {/* No control for the administrator's own role: setUserRole rejects it anyway. */}
      {!isSelf && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-48">
            <SelectField
              label={format(en.users.changeRoleFor, { name: member.displayName })}
              options={ROLE_OPTIONS}
              placeholder={null}
              value={role}
              onChange={(event) => setRole(roleSchema.parse(event.target.value))}
            />
          </div>
          <Button variant="secondary" loading={saving} disabled={role === member.role} onClick={() => void save()}>
            {en.users.saveRole}
          </Button>
        </div>
      )}
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
    </li>
  )
}

function CreateUserForm({ onCreated }: { onCreated: () => void }) {
  const { userAdmin } = useServices()
  const [result, setResult] = useState<{ email: string; link: string } | null>(null)
  const [failure, setFailure] = useState<UserAdminErrorKind | null>(null)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateValues>({ resolver: zodResolver(createSchema) })

  const onSubmit = handleSubmit(async (values) => {
    setFailure(null)
    setResult(null)
    try {
      const created = await userAdmin.createUser(values)
      setResult({ email: values.email, link: created.passwordResetLink })
      reset()
      onCreated()
    } catch (error) {
      setFailure(errorKind(error))
    }
  })

  return (
    <section aria-labelledby="create-user-heading" className="flex max-w-xl flex-col gap-4">
      <h2 id="create-user-heading" className="text-xl font-semibold text-slate-900">
        {en.users.createTitle}
      </h2>
      {failure && <Alert tone="error">{en.users.errors[failure]}</Alert>}
      {result && (
        <Alert tone="success" title={format(en.users.created, { email: result.email })}>
          <p>{en.users.resetLinkHelp}</p>
          <label className="mt-2 block font-medium" htmlFor="reset-link">
            {en.users.resetLinkLabel}
          </label>
          <input
            id="reset-link"
            readOnly
            value={result.link}
            onFocus={(event) => event.currentTarget.select()}
            className="mt-1 w-full rounded-md border border-slate-400 bg-white px-3 py-2 font-mono text-sm"
          />
        </Alert>
      )}
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextField label={en.users.name} required error={errors.displayName?.message} {...register('displayName')} />
        <TextField
          label={en.users.email}
          type="email"
          autoComplete="off"
          required
          error={errors.email?.message}
          {...register('email')}
        />
        <SelectField label={en.users.role} options={NEW_USER_ROLES} required error={errors.role?.message} {...register('role')} />
        <Button type="submit" loading={isSubmitting} className="self-start">
          {en.users.createSubmit}
        </Button>
      </form>
    </section>
  )
}
