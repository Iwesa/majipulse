/**
 * The shared redactor, for server code that sends text to a model (pattern
 * analysis, Phase 8). It is the same module the app uses, compiled into
 * lib/shared by this package's build (rootDir is the repository root).
 */
export { PLACEHOLDERS, containsPersonalData, countByKind, redact } from '../../shared/privacy/redact.js'
export type { RedactionFinding, RedactionKind, RedactionResult } from '../../shared/privacy/redact.js'
