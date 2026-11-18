/**
 * Pure sync decisions (design section 6). No I/O: the adapter and engine
 * call these with server state they have read.
 */
import type { InFlight } from '../../schemas/localIncident'
import type { MutationSnapshot, ServerIncident } from './types'

export type WriteDecision =
  | { kind: 'create' }
  | { kind: 'update' }
  | { kind: 'alreadyApplied' }
  | { kind: 'stale' }
  | { kind: 'missing' }

/** What to do with a snapshot, given the server document read inside the transaction. */
export function decideWrite(snapshot: Pick<MutationSnapshot, 'mutationId' | 'baseRevision'>, server: ServerIncident | null): WriteDecision {
  if (server && server.mutationId === snapshot.mutationId) return { kind: 'alreadyApplied' }
  if (snapshot.baseRevision === 0) return server ? { kind: 'stale' } : { kind: 'create' }
  if (!server) return { kind: 'missing' }
  if (server.serverRevision === snapshot.baseRevision && server.status === 'new') return { kind: 'update' }
  return { kind: 'stale' }
}

export type Reconciliation =
  /** The in-flight mutation is on the server. Its committed revision is inFlight.baseRevision + 1. */
  | { kind: 'committed'; revision: number }
  /** It did not commit: submit the current content from the unchanged base. */
  | { kind: 'notCommitted' }
  /** A different write is on the server: the current content conflicts. */
  | { kind: 'superseded'; server: ServerIncident }

/**
 * Resolves an uncertain earlier submission (lost acknowledgement, timeout,
 * closed tab) against the server document (design "Uncertain commits").
 * Status changes by staff keep `mutationId`, so a match still proves A
 * committed even after triage.
 */
export function reconcileInFlight(inFlight: InFlight, server: ServerIncident | null): Reconciliation {
  if (server && server.mutationId === inFlight.mutationId) return { kind: 'committed', revision: inFlight.baseRevision + 1 }
  if (!server || server.serverRevision === inFlight.baseRevision) return { kind: 'notCommitted' }
  return { kind: 'superseded', server }
}

export type PermissionDeniedClass =
  | { kind: 'committed' }
  | { kind: 'conflict'; server: ServerIncident }
  | { kind: 'permissionDenied' }

/**
 * After a permission-denied write, the follow-up server read decides (AC18).
 * Only a server state that shows the edit is stale or no longer allowed is a
 * conflict; anything else (claims changed, field validation, missing
 * document, unreadable) stays a permission failure.
 */
export function classifyPermissionDenied(
  snapshot: Pick<MutationSnapshot, 'mutationId' | 'baseRevision'>,
  server: ServerIncident | null,
): PermissionDeniedClass {
  if (!server) return { kind: 'permissionDenied' }
  if (server.mutationId === snapshot.mutationId) return { kind: 'committed' }
  if (server.serverRevision !== snapshot.baseRevision || server.status !== 'new') return { kind: 'conflict', server }
  return { kind: 'permissionDenied' }
}
