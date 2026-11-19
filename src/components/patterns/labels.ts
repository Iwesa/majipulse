import { formatDate } from '../../lib/formatDate'
import { en, format } from '../../strings/en'

export const periodLabel = (period: { from: string; to: string }) => `${formatDate(period.from)} – ${formatDate(period.to)}`

export const incidentCountLabel = (count: number) =>
  count === 1 ? en.patterns.incidentsOne : format(en.patterns.incidentsMany, { count: String(count) })
