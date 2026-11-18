import { AppShell } from '../components/layout/AppShell'
import { ErrorState } from '../components/ui'
import { useOnlineStatus } from '../lib/useOnlineStatus'
import { en } from '../strings/en'

/** Shown when VITE_* configuration is missing or invalid. */
export function ConfigErrorPage() {
  const online = useOnlineStatus()
  return (
    <AppShell online={online}>
      <ErrorState title={en.config.title} message={en.config.description} />
    </AppShell>
  )
}
