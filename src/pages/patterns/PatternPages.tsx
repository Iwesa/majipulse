import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { usePatterns, useWaterPoints } from '../../app/servicesContext'
import { AnalysisView } from '../../components/patterns/AnalysisView'
import { incidentCountLabel, periodLabel } from '../../components/patterns/labels'
import { Alert, AsyncBoundary, Button, EmptyState, SelectField, TextField } from '../../components/ui'
import { DemoBadge } from '../../components/waterPoints/WaterPointBits'
import { formatDateTime } from '../../lib/formatDate'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { staffDataErrorKind, type StaffDataErrorKind } from '../../services/staff'
import { en, format } from '../../strings/en'
import { useSignedInUser, useWaterPointNames } from '../incidents/staffPageHelpers'
import { remoteToAsync } from '../remoteState'
import { DAY, periodFromInputs, toDateInput } from './period'

const p = en.patterns
type RunOutcome = { kind: 'failed'; error: StaffDataErrorKind } | { kind: 'invalid' } | null

function RunForm({ now = () => new Date() }: { now?: () => Date }) {
  const signedIn = useSignedInUser()
  const run = usePatterns((s) => s.run)
  const points = useWaterPoints((s) => s.list)
  const online = useOnlineStatus()
  const navigate = useNavigate()
  const [from, setFrom] = useState(() => toDateInput(new Date(now().getTime() - 90 * DAY)))
  const [to, setTo] = useState(() => toDateInput(now()))
  const [waterPointId, setWaterPointId] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<RunOutcome>(null)
  if (!signedIn) return null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setOutcome(null)
    const period = periodFromInputs(from, to, now())
    if (!period) {
      setOutcome({ kind: 'invalid' })
      return
    }
    setBusy(true)
    try {
      const result = await run(signedIn.scope, { ...period, ...(waterPointId ? { waterPointId } : {}) })
      navigate(`/patterns/${encodeURIComponent(result.analysisId)}`, { state: { ran: result.insufficientData ? 'insufficient' : 'done' } })
    } catch (error) {
      setOutcome({ kind: 'failed', error: staffDataErrorKind(error) })
    } finally {
      setBusy(false)
    }
  }

  const options = points.status === 'ready' ? points.points.map((wp) => ({ value: wp.id, label: wp.name })) : []

  return (
    <section aria-labelledby="run-title" className="flex flex-col gap-3 rounded-md border border-slate-300 bg-white p-4">
      <h2 id="run-title" className="text-lg font-semibold text-slate-900">
        {p.runTitle}
      </h2>
      <p className="text-sm text-slate-700">{p.privacyNote}</p>
      <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label={p.from} hint={p.periodHint} type="date" required value={from} onChange={(e) => setFrom(e.target.value)} />
          <TextField label={p.to} type="date" required value={to} onChange={(e) => setTo(e.target.value)} />
          <SelectField label={p.waterPoint} placeholder={p.allWaterPoints} options={options} value={waterPointId} onChange={(e) => setWaterPointId(e.target.value)} />
        </div>
        <Button type="submit" className="self-start" loading={busy} disabled={!online}>
          {p.run}
        </Button>
      </form>
      <div role="status" aria-live="polite">
        {busy && <p className="text-slate-800">{p.running}</p>}
      </div>
      {!online && <p className="text-sm text-slate-700">{p.onlineOnly}</p>}
      {outcome?.kind === 'invalid' && <Alert tone="error">{p.invalidPeriod}</Alert>}
      {outcome?.kind === 'failed' && (
        <Alert tone="error" title={p.runFailed}>
          {en.staffErrors[outcome.error]}
        </Alert>
      )}
    </section>
  )
}

/** Run and list pattern analyses (T8.4). */
export function PatternAnalysisPage() {
  const signedIn = useSignedInUser()
  const list = usePatterns((s) => s.list)
  const loadList = usePatterns((s) => s.loadList)
  const nameOf = useWaterPointNames()
  const scope = signedIn?.scope ?? null

  useEffect(() => {
    if (scope) void loadList(scope)
  }, [scope, loadList])

  if (!scope) return null
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-bold text-slate-900">{p.title}</h1>
      <p className="text-slate-700">{p.intro}</p>
      <RunForm />
      <section aria-labelledby="saved-title" className="flex flex-col gap-3">
        <h2 id="saved-title" className="text-xl font-semibold">
          {p.savedTitle}
        </h2>
        <AsyncBoundary
          state={remoteToAsync(list)}
          isEmpty={(items) => items.length === 0}
          empty={<EmptyState title={p.emptyTitle} description={p.emptyDescription} />}
          onRetry={() => void loadList(scope)}
        >
          {(items) => (
            <ul className="flex flex-col gap-3">
              {items.map((a) => (
                <li key={a.id} className="flex flex-col gap-1 rounded-md border border-slate-300 bg-white p-4">
                  <Link to={`/patterns/${encodeURIComponent(a.id)}`} className="text-lg font-semibold text-sky-900 underline-offset-4 hover:underline">
                    {format(p.detailTitle, { period: periodLabel(a.period) })}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
                    <span>{a.scope.waterPointId ? format(p.forPoint, { name: nameOf(a.scope.waterPointId) }) : p.allPoints}</span>
                    <span>{incidentCountLabel(a.analyzedIncidentCount)}</span>
                    <span>{a.insufficientData ? p.insufficientTitle : `${p.insightsTitle}: ${a.insights.length}`}</span>
                    <span>{formatDateTime(a.createdAt)}</span>
                    {a.demo && <DemoBadge />}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </AsyncBoundary>
      </section>
    </div>
  )
}

/** One saved analysis (T8.4, AC11). */
export function PatternDetailPage() {
  const { analysisId = '' } = useParams()
  const location = useLocation()
  const signedIn = useSignedInUser()
  const detail = usePatterns((s) => s.detail)
  const loadDetail = usePatterns((s) => s.loadDetail)
  const nameOf = useWaterPointNames()
  const scope = signedIn?.scope ?? null
  const ran = useMemo(() => (location.state as { ran?: 'done' | 'insufficient' } | null)?.ran ?? null, [location.state])

  useEffect(() => {
    if (scope) void loadDetail(scope, analysisId)
  }, [scope, analysisId, loadDetail])

  if (!scope) return null
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Link to="/patterns" className="font-medium text-sky-900 underline">
        {p.backToList}
      </Link>
      <div role="status" aria-live="polite">
        {ran && <p className="font-medium text-green-900">{ran === 'done' ? p.runDone : p.runInsufficient}</p>}
      </div>
      <AsyncBoundary state={remoteToAsync(detail.id === analysisId ? detail.data : { status: 'loading' })} onRetry={() => void loadDetail(scope, analysisId)}>
        {(analysis) =>
          analysis ? (
            <article className="flex flex-col gap-4">
              <h1 className="text-2xl font-bold text-slate-900">{format(p.detailTitle, { period: periodLabel(analysis.period) })}</h1>
              <AnalysisView analysis={analysis} nameOf={nameOf} />
            </article>
          ) : (
            <EmptyState title={p.notFoundTitle} description={p.notFoundDescription} />
          )
        }
      </AsyncBoundary>
    </div>
  )
}
