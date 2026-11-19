import type { AsyncState } from '../components/ui'
import type { RemoteData } from '../stores/remoteData'
import { en } from '../strings/en'

/** Store data -> what AsyncBoundary shows. Errors use plain-language staff messages. */
export function remoteToAsync<T>(remote: RemoteData<T>): AsyncState<T> {
  switch (remote.status) {
    case 'idle':
    case 'loading':
      return { status: 'loading' }
    case 'offline':
      return { status: 'offline' }
    case 'error':
      return { status: 'error', message: en.staffErrors[remote.kind] }
    case 'ready':
      return { status: 'ready', data: remote.data }
  }
}
