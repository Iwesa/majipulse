import type { AsyncState } from '../../components/ui'
import type { LocalIncidentRecord } from '../../schemas/localIncident'
import type { IncidentList } from '../../stores/incidentStore'

export function incidentListToAsync(list: IncidentList): AsyncState<LocalIncidentRecord[]> {
  switch (list.status) {
    case 'ready':
      return { status: 'ready', data: list.records }
    case 'error':
      return { status: 'error' }
    default:
      return { status: 'loading' }
  }
}
