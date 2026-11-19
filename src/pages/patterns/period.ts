/** Analysis period helpers for the run form (T8.4). Mirrors the function's limits. */
export const DAY = 86_400_000
export const MAX_DAYS = 366

/** `YYYY-MM-DD` in local time, for date inputs. */
export const toDateInput = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Local whole days -> ISO period, ending no later than now. Null if invalid. */
export function periodFromInputs(from: string, to: string, now: Date): { from: string; to: string } | null {
  const start = new Date(`${from}T00:00:00`)
  const endOfDay = new Date(`${to}T23:59:59.999`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(endOfDay.getTime())) return null
  const end = endOfDay > now ? now : endOfDay
  if (start >= end || start > now || end.getTime() - start.getTime() > MAX_DAYS * DAY) return null
  return { from: start.toISOString(), to: end.toISOString() }
}
