import { useState } from 'react'
import { useIncidents, useSync } from '../../app/servicesContext'
import type { LocalIncidentRecord } from '../../schemas/localIncident'
import type { SessionScope } from '../../schemas/roles'
import { incidentOutboxErrorKind, type IncidentOutboxErrorKind } from '../../services/incidents'
import { canRetryOnLatest } from '../../services/sync/transitions'
import { en } from '../../strings/en'
import { Alert, Button } from '../ui'

interface ConflictReviewProps {
  record: LocalIncidentRecord
  scope: SessionScope
  waterPointName: (id: string) => string
  /** Called after the reporter's choice is saved on this device. */
  onResolved?: (action: 'retryOnLatest' | 'discardMyEdit') => void
}

/**
 * Conflict review (T5.5): your version beside the server's. Nothing happens
 * until the reporter chooses. "Send my version" is offered only while the
 * server copy is still new; discarding needs a second, explicit confirmation.
 */
export function ConflictReview({ record, scope, waterPointName, onResolved }: ConflictReviewProps) {
  const resolveConflict = useIncidents((s) => s.resolveConflict)
  const requestSync = useSync((s) => s.requestSync)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<IncidentOutboxErrorKind | null>(null)
  const server = record.conflictServerSnapshot
  if (!server) return null
  const retryAllowed = canRetryOnLatest(record)

  const act = async (action: 'retryOnLatest' | 'discardMyEdit') => {
    setBusy(true)
    setFailure(null)
    try {
      await resolveConflict(scope, record.id, action)
      onResolved?.(action)
      if (action === 'retryOnLatest') void requestSync('manual')
    } catch (error) {
      setFailure(incidentOutboxErrorKind(error))
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  const f = en.reports.fields
  const rows: Array<[string, string, string]> = [
    [f.waterPoint, waterPointName(record.waterPointId), waterPointName(server.waterPointId)],
    [f.incidentType, en.incidentTypes[record.incidentType], en.incidentTypes[server.incidentType]],
    [f.description, record.description, server.description],
    [f.severity, record.severity ? en.severities[record.severity] : en.severities.notSure, server.severity ? en.severities[server.severity] : en.severities.notSure],
    [f.locationNote, record.locationNote ?? f.notRecorded, server.locationNote ?? f.notRecorded],
    [en.conflict.status, en.incidentStatuses[record.status], en.incidentStatuses[server.status]],
  ]

  return (
    <section aria-labelledby="conflict-title" className="flex flex-col gap-4 rounded-md border border-amber-700 bg-amber-50 p-4">
      <h2 id="conflict-title" className="text-xl font-semibold text-amber-950">
        {en.conflict.title}
      </h2>
      <p className="text-amber-950">{en.conflict.explanation}</p>
      {failure && <Alert tone="error">{en.reports.errors[failure]}</Alert>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse bg-white text-left">
          <caption className="sr-only">{en.conflict.title}</caption>
          <thead>
            <tr>
              <td className="border border-slate-300 p-2" />
              <th scope="col" className="border border-slate-300 p-2">
                {en.conflict.yours}
              </th>
              <th scope="col" className="border border-slate-300 p-2">
                {en.conflict.server}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, mine, theirs]) => (
              <tr key={label} className={mine !== theirs ? 'bg-amber-50' : undefined}>
                <th scope="row" className="border border-slate-300 p-2 font-medium">
                  {label}
                </th>
                <td className="border border-slate-300 p-2 whitespace-pre-wrap">{mine}</td>
                <td className="border border-slate-300 p-2 whitespace-pre-wrap">{theirs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {retryAllowed ? (
        <div className="flex flex-col gap-1">
          <Button loading={busy} disabled={confirming} className="self-start" onClick={() => void act('retryOnLatest')}>
            {en.conflict.retryOnLatest}
          </Button>
          <p className="text-sm text-amber-950">{en.conflict.retryHelp}</p>
        </div>
      ) : (
        <p className="text-amber-950">{en.conflict.triagedNote}</p>
      )}

      {confirming ? (
        <div role="alertdialog" aria-labelledby="discard-title" aria-describedby="discard-text" className="flex flex-col gap-3 rounded-md border border-red-700 bg-white p-4">
          <h3 id="discard-title" className="font-semibold text-red-900">
            {en.conflict.confirmTitle}
          </h3>
          <p id="discard-text">{en.conflict.confirmText}</p>
          <div className="flex flex-wrap gap-3">
            <Button variant="danger" loading={busy} onClick={() => void act('discardMyEdit')}>
              {en.conflict.confirmDiscard}
            </Button>
            <Button variant="secondary" disabled={busy} autoFocus onClick={() => setConfirming(false)}>
              {en.conflict.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <Button variant="secondary" disabled={busy} className="self-start" onClick={() => setConfirming(true)}>
            {en.conflict.discard}
          </Button>
          <p className="text-sm text-amber-950">{en.conflict.discardHelp}</p>
        </div>
      )}
    </section>
  )
}
