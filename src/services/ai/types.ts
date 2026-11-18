import type { AiSuggestion, ExtractableField } from '../../schemas/incident'
import type { ExtractionInput } from './prompt'

export type { ExtractionInput } from './prompt'

/**
 * Why no suggestions are available. The UI shows the same message for all of
 * them and the manual form stays usable (R4.7).
 */
export type ExtractionFailure = 'unavailable' | 'offline' | 'timeout' | 'invalid'

export type ExtractionResult =
  | {
      ok: true
      /** Validated suggestion with provenance, ready to store as `ai` (R4.2). */
      suggestion: AiSuggestion
      /** Fields the model returned but validation removed (not grounded or personal data). */
      dropped: ExtractableField[]
    }
  | { ok: false; reason: ExtractionFailure }

/** Single-incident AI extraction. Never throws; every failure is a result. */
export interface IncidentExtractor {
  /**
   * Call from the click handler of the reporter's "Send" action: the
   * on-device model may only start downloading after a user interaction.
   */
  extract(input: ExtractionInput): Promise<ExtractionResult>
}
