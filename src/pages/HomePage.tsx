import { useSession } from '../app/servicesContext'
import { en, format } from '../strings/en'

export function HomePage() {
  const session = useSession((s) => s.session)
  if (session.status !== 'signedIn') return null
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-bold text-slate-900">{en.home.title}</h1>
      <p className="text-slate-700">{format(en.home.welcome, { role: en.roles[session.user.role] })}</p>
      <p className="text-slate-700">{en.home.comingSoon}</p>
    </div>
  )
}
