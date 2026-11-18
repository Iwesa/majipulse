import { AppShell } from './components/layout/AppShell'
import { useOnlineStatus } from './lib/useOnlineStatus'
import { en } from './strings/en'

function App() {
  const online = useOnlineStatus()
  return (
    <AppShell online={online}>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold text-sky-900">{en.app.name}</h1>
        <p className="text-lg text-slate-700">{en.app.tagline}</p>
        <p className="text-slate-700">{en.app.setupNotice}</p>
      </div>
    </AppShell>
  )
}

export default App
