/** Water point service types shared by the Firebase service, store, UI, and tests. */
import type { SessionScope } from '../schemas/roles'
import type { WaterPointInput, WaterPointRecord } from '../schemas/waterPoint'

export type WaterPointErrorKind = 'permission' | 'network' | 'notFound' | 'invalid' | 'unknown'

export class WaterPointServiceError extends Error {
  readonly kind: WaterPointErrorKind

  constructor(kind: WaterPointErrorKind) {
    super(kind)
    this.name = 'WaterPointServiceError'
    this.kind = kind
  }
}

export const waterPointErrorKind = (error: unknown): WaterPointErrorKind =>
  error instanceof WaterPointServiceError ? error.kind : 'unknown'

/**
 * Remote water point access. Reads come from the server only and writes need
 * a connection: registering and editing water points is online only (R2).
 * All methods throw WaterPointServiceError.
 */
export interface WaterPointService {
  /** The organization's water points, sorted by name. */
  list(scope: SessionScope): Promise<WaterPointRecord[]>
  /** Returns the new document ID. */
  create(scope: SessionScope, input: WaterPointInput): Promise<string>
  update(scope: SessionScope, id: string, input: WaterPointInput): Promise<void>
}

/** Local copy of the organization's water points, for offline reading (R2.2). */
export interface WaterPointCache {
  /** Null when nothing was saved for this scope. */
  read(scope: SessionScope): Promise<{ points: WaterPointRecord[]; cachedAt: string } | null>
  /** Replaces everything saved for this scope. */
  replace(scope: SessionScope, points: readonly WaterPointRecord[], cachedAt: string): Promise<void>
}

export const sortByName = (points: WaterPointRecord[]): WaterPointRecord[] =>
  [...points].sort((a, b) => a.name.localeCompare(b.name))
