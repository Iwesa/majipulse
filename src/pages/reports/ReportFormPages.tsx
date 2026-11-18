import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useIncidents, useSession, useSync, useWaterPoints } from '../../app/servicesContext'
import { IncidentForm } from '../../components/incidents/IncidentForm'
import { Alert, AsyncBoundary, EmptyState, Spinner } from '../../components/ui'
import { SavedCopyNotice } from '../../components/waterPoints/WaterPointBits'
import type { WaterPointRecord } from '../../schemas/waterPoint'
import { contentOf, newIncidentId } from '../../services/incidentDrafts'
import { incidentOutboxErrorKind, isEditable, type IncidentContent, type IncidentOutboxErrorKind } from '../../services/incidents'
import { en } from '../../strings/en'
import { incidentListToAsync } from './incidentListState'

/** Water points for the picker: from the server, or the copy saved on this device. */
function WithWaterPoints({ children }: { children: (points: WaterPointRecord[]) => ReactNode }) {
  const list = useWaterPoints((s) => s.list)
  if (list.status === 'idle' || list.status === 'loading') {
    return (
      <div className="flex justify-center p-8">
        <Spinner />
      </div>
    )
  }
  if (list.status !== 'ready') {
    return <EmptyState title={en.reports.waterPointsUnavailableTitle} description={en.reports.waterPointsUnavailable} />
  }
  if (list.points.length === 0) {
    return <EmptyState title={en.reports.noWaterPointsTitle} description={en.reports.noWaterPoints} />
  }
  return (
    <>
      <SavedCopyNotice list={list} />
      {children(list.points)}
    </>
  )
}

const back = (
  <Link to="/reports" className="font-medium text-sky-900 underline">
    {en.reports.backToList}
  </Link>
)

/** New report (T4.3). Saves to this device only; works offline once the app is loaded. */
export function NewReportPage() {
  const session = useSession((s) => s.session)
  const saveNew = useIncidents((s) => s.saveNew)
  const requestSync = useSync((s) => s.requestSync)
  const navigate = useNavigate()
  // Generated once when the report is started, before any save (R3.1).
  const [id] = useState(() => newIncidentId())
  const [failure, setFailure] = useState<IncidentOutboxErrorKind | null>(null)
  if (session.status !== 'signedIn') return null

  const submit = async (content: IncidentContent) => {
    setFailure(null)
    try {
      await saveNew(session.user.scope, id, content)
      // Saved locally first (R3.2); sending starts now if there is a connection.
      void requestSync('save')
      navigate(`/reports/${id}`, { replace: true, state: { saved: 'new' } })
    } catch (error) {
      setFailure(incidentOutboxErrorKind(error))
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      {back}
      <h1 className="text-2xl font-bold text-slate-900">{en.nav.newReport}</h1>
      {failure && <Alert tone="error">{en.reports.errors[failure]}</Alert>}
      <WithWaterPoints>{(points) => <IncidentForm waterPoints={points} onSubmit={submit} />}</WithWaterPoints>
    </div>
  )
}

/** Local edit (R3.4): increments clientRevision and generates a new mutationId. */
export function EditReportPage() {
  const { incidentId = '' } = useParams()
  const session = useSession((s) => s.session)
  const list = useIncidents((s) => s.list)
  const saveEdit = useIncidents((s) => s.saveEdit)
  const requestSync = useSync((s) => s.requestSync)
  const navigate = useNavigate()
  const [failure, setFailure] = useState<IncidentOutboxErrorKind | null>(null)
  if (session.status !== 'signedIn') return null

  return (
    <div className="flex max-w-xl flex-col gap-4">
      {back}
      <h1 className="text-2xl font-bold text-slate-900">{en.reports.editTitle}</h1>
      <AsyncBoundary state={incidentListToAsync(list)}>
        {(records) => {
          const record = records.find((r) => r.id === incidentId)
          if (!record) return <EmptyState title={en.reports.notFoundTitle} description={en.reports.notFoundDescription} />
          if (record.syncStatus === 'conflict') {
            return (
              <Alert tone="warning">
                {en.conflict.reviewFirst}{' '}
                <Link to={`/reports/${record.id}`} className="font-medium underline">
                  {en.conflict.reviewLink}
                </Link>
              </Alert>
            )
          }
          if (!isEditable(record)) return <Alert tone="warning">{en.reports.notEditable}</Alert>
          const submit = async (content: IncidentContent) => {
            setFailure(null)
            try {
              await saveEdit(session.user.scope, record.id, content)
              void requestSync('save')
              navigate(`/reports/${record.id}`, { replace: true, state: { saved: 'edit' } })
            } catch (error) {
              setFailure(incidentOutboxErrorKind(error))
            }
          }
          return (
            <>
              {failure && <Alert tone="error">{en.reports.errors[failure]}</Alert>}
              <WithWaterPoints>
                {(points) => <IncidentForm key={record.mutationId} waterPoints={points} initial={contentOf(record)} onSubmit={submit} />}
              </WithWaterPoints>
            </>
          )
        }}
      </AsyncBoundary>
    </div>
  )
}
