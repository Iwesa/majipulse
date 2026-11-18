import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { useSession } from '../app/servicesContext'
import { AppShell } from '../components/layout/AppShell'
import { Alert, Button, TextField } from '../components/ui'
import { useOnlineStatus } from '../lib/useOnlineStatus'
import { SignInError, type SignInErrorKind } from '../services/session'
import { en } from '../strings/en'

const signInSchema = z.object({
  email: z.string().trim().pipe(z.email({ error: en.signIn.emailInvalid })),
  password: z.string().min(1, { error: en.signIn.passwordRequired }),
})
type SignInValues = z.infer<typeof signInSchema>

const errorText: Record<SignInErrorKind, string> = {
  invalidCredentials: en.signIn.invalidCredentials,
  network: en.signIn.network,
  tooManyAttempts: en.signIn.tooManyAttempts,
  unknown: en.signIn.unknown,
}

/** Email and password only. There is no sign-up (R1.4). */
export function SignInPage() {
  const session = useSession((s) => s.session)
  const signIn = useSession((s) => s.signIn)
  const online = useOnlineStatus()
  const navigate = useNavigate()
  const location = useLocation()
  const [failure, setFailure] = useState<SignInErrorKind | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInValues>({ resolver: zodResolver(signInSchema) })

  const from = (location.state as { from?: string } | null)?.from ?? '/'
  if (session.status === 'signedIn') return <Navigate to={from} replace />

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setFailure(null)
    try {
      await signIn(email, password)
      navigate(from, { replace: true })
    } catch (error) {
      setFailure(error instanceof SignInError ? error.kind : 'unknown')
    }
  })

  return (
    <AppShell online={online}>
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <h1 className="text-2xl font-bold text-slate-900">{en.signIn.title}</h1>
        <p className="text-slate-700">{en.signIn.intro}</p>
        {failure && <Alert tone="error">{errorText[failure]}</Alert>}
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
          <TextField
            label={en.signIn.email}
            type="email"
            autoComplete="email"
            required
            error={errors.email?.message}
            {...register('email')}
          />
          <TextField
            label={en.signIn.password}
            type="password"
            autoComplete="current-password"
            required
            error={errors.password?.message}
            {...register('password')}
          />
          <Button type="submit" loading={isSubmitting}>
            {en.signIn.submit}
          </Button>
        </form>
      </div>
    </AppShell>
  )
}
