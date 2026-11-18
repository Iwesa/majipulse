import { useEffect } from 'react'
import { useWaterPoints } from './servicesContext'

/**
 * Keeps the water point list and its offline cache fresh: loads on sign-in
 * (or account switch), and again when the window regains focus or the
 * browser comes back online (T3.4).
 */
export function useWaterPointRefresh(organizationId: string, ownerUid: string): void {
  const load = useWaterPoints((s) => s.load)
  useEffect(() => {
    const refresh = () => void load({ organizationId, ownerUid })
    refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [load, organizationId, ownerUid])
}
