import { useMemo } from 'react'
import { useSession, useWaterPoints } from '../../app/servicesContext'
import { incidentStatusSchema } from '../../schemas/incident'
import type { SessionScope } from '../../schemas/roles'
import type { IncidentQueueFilter } from '../../services/queryPlans'
import type { SessionUser } from '../../services/session'
import { en } from '../../strings/en'

/** The signed-in user and a scope object that keeps its identity while the user is the same. */
export function useSignedInUser(): { user: SessionUser; scope: SessionScope } | null {
  const session = useSession((s) => s.session)
  const user = session.status === 'signedIn' ? session.user : null
  const organizationId = user?.organizationId ?? null
  const ownerUid = user?.uid ?? null
  const scope = useMemo(
    () => (organizationId && ownerUid ? { organizationId, ownerUid } : null),
    [organizationId, ownerUid],
  )
  return user && scope ? { user, scope } : null
}

/** Water point names from the server list or the copy saved on this device. */
export function useWaterPointNames(): (id: string) => string {
  const list = useWaterPoints((s) => s.list)
  return useMemo(() => {
    const names = new Map(list.status === 'ready' ? list.points.map((p) => [p.id, p.name]) : [])
    return (id: string) => names.get(id) ?? en.reports.unknownWaterPoint
  }, [list])
}

/** The URL holds the queue filter, so dashboard links and the back button work. Unknown values are ignored. */
export function filterFromParams(params: URLSearchParams): IncidentQueueFilter {
  const status = incidentStatusSchema.safeParse(params.get('status'))
  const waterPointId = params.get('waterPoint')
  return {
    status: status.success ? status.data : null,
    waterPointId: waterPointId && waterPointId.length <= 128 ? waterPointId : null,
    order: params.get('order') === 'oldest' ? 'oldest' : 'newest',
  }
}
