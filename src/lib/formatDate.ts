/** Formats an ISO 8601 date-time for display, in the user's time zone. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })
}

/** Formats an ISO 8601 date-time as a date only, in the user's time zone. */
export function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-KE', { dateStyle: 'medium' })
}