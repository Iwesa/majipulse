/** Formats an ISO 8601 date-time for display, in the user's time zone. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })
}
