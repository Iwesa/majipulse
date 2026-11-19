import { staffDataErrorKind, type StaffDataErrorKind } from '../services/staff'

/** Server data held by a store. Pages map it to AsyncState for display. */
export type RemoteData<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'offline' }
  | { status: 'error'; kind: StaffDataErrorKind }

export const defaultIsOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false

/** A network error, or any error while the browser reports offline, shows as offline. */
export function failedState<T>(error: unknown, isOnline: () => boolean): RemoteData<T> {
  const kind = staffDataErrorKind(error)
  return kind === 'network' || !isOnline() ? { status: 'offline' } : { status: 'error', kind }
}

/**
 * Discards responses that arrive after a newer request or a reset (for
 * example after the user changed, R3.6).
 */
export function createGeneration() {
  let current = 0
  return {
    next: () => ++current,
    isCurrent: (n: number) => n === current,
    bump: () => {
      current += 1
    },
  }
}
