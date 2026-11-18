import type { AsyncState } from '../../components/ui'
import type { WaterPointRecord } from '../../schemas/waterPoint'
import type { WaterPointList } from '../../stores/waterPointStore'

export function listToAsyncState(list: WaterPointList): AsyncState<WaterPointRecord[]> {
  switch (list.status) {
    case 'idle':
    case 'loading':
      return { status: 'loading' }
    case 'offline':
      return { status: 'offline' }
    case 'error':
      return { status: 'error' }
    case 'ready':
      return { status: 'ready', data: list.points }
  }
}
