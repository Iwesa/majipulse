import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

const getSnapshot = (): boolean => navigator.onLine

/**
 * The browser's connectivity hint, for display only. `navigator.onLine` can
 * report true without real connectivity, so sync logic must rely on request
 * results instead (design section 6).
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true)
}
