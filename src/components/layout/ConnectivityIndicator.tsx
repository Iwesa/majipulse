import { Wifi, WifiOff } from 'lucide-react'
import { cn } from '../../lib/cn'
import { en } from '../../strings/en'

interface ConnectivityIndicatorProps {
  online: boolean
}

/**
 * Shows the browser's connectivity hint with text and an icon, not color
 * alone. role="status" announces changes politely. Per-report sync status is
 * shown separately in later phases.
 */
export function ConnectivityIndicator({ online }: ConnectivityIndicatorProps) {
  const Icon = online ? Wifi : WifiOff
  return (
    <p
      role="status"
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium',
        online ? 'border-green-700 bg-green-50 text-green-900' : 'border-amber-700 bg-amber-50 text-amber-950',
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      {online ? en.connectivity.online : en.connectivity.offline}
    </p>
  )
}
