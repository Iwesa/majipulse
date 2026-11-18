import { Timestamp } from 'firebase/firestore'

/**
 * Firestore stores times as Timestamps (so rules can compare them with
 * request.time). The app's schemas use ISO 8601 strings. These helpers convert
 * at the Firebase service boundary only.
 */

export function timestampToIso(value: Timestamp): string {
  return value.toDate().toISOString()
}

/** Parses an ISO 8601 string with an offset. Throws on invalid input. */
export function isoToTimestamp(iso: string): Timestamp {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms) || !/T.*(Z|[+-]\d{2}:\d{2})$/.test(iso)) {
    throw new RangeError('Expected an ISO 8601 date-time with an offset')
  }
  return Timestamp.fromMillis(ms)
}

/**
 * Deep-converts every Timestamp in Firestore document data to an ISO string,
 * leaving other values unchanged. Use before validating with a Zod schema.
 */
export function timestampsToIso(value: unknown): unknown {
  if (value instanceof Timestamp) return timestampToIso(value)
  if (Array.isArray(value)) return value.map(timestampsToIso)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, timestampsToIso(inner)]))
  }
  return value
}
