/**
 * Firebase AI Logic implementation of single-incident extraction (T6.4,
 * design 5A, D7). API details: docs/ai-logic-notes.md.
 */
import type { FirebaseApp } from 'firebase/app'
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, InferenceSource, Schema, type GenerativeModel } from 'firebase/ai'
import { incidentTypeSchema, inferenceSourceSchema, severitySchema } from '../../schemas/incident'
import { validateExtraction } from './extraction'
import { buildExtractionPrompt } from './prompt'
import type { ExtractionFailure, ExtractionResult, IncidentExtractor } from './types'

/** Cloud model, set explicitly so the stored `ai.model` is known. Same as the SDK's hybrid default in 13.3.0. */
export const CLOUD_MODEL = 'gemini-3.5-flash-lite'
/** Stored as `ai.model` when inference ran in the browser (Chrome Prompt API); the SDK does not name that model. */
export const ON_DEVICE_MODEL = 'chrome-built-in'
export const EXTRACTION_TIMEOUT_MS = 15_000

/** Response schema for both the cloud model and the on-device model. All fields required, null when not stated. */
export const extractionResponseSchema = Schema.object({
  properties: {
    incidentType: Schema.enumString({ enum: [...incidentTypeSchema.options], nullable: true }),
    severity: Schema.enumString({ enum: [...severitySchema.options], nullable: true }),
    occurredAt: Schema.string({ nullable: true, description: 'ISO 8601 date-time with offset, or null' }),
    locationNote: Schema.string({ nullable: true, description: 'Words from the report, or null' }),
  },
})

export interface ExtractorOptions {
  now?: () => Date
  timeoutMs?: number
  isOnline?: () => boolean
}

class Timeout extends Error {}

export function createFirebaseIncidentExtractor(app: FirebaseApp, options: ExtractorOptions = {}): IncidentExtractor {
  const now = options.now ?? (() => new Date())
  const timeoutMs = options.timeoutMs ?? EXTRACTION_TIMEOUT_MS
  const isOnline = options.isOnline ?? (() => navigator.onLine)
  let model: GenerativeModel | null = null

  // Created on first use, so the app starts even if AI Logic is not set up.
  const getModel = (): GenerativeModel => {
    model ??= getGenerativeModel(getAI(app, { backend: new GoogleAIBackend() }), {
      mode: InferenceMode.PREFER_ON_DEVICE,
      inCloudParams: {
        model: CLOUD_MODEL,
        generationConfig: { responseMimeType: 'application/json', responseSchema: extractionResponseSchema },
      },
      onDeviceParams: { promptOptions: { responseConstraint: extractionResponseSchema } },
    })
    return model
  }

  const failure = (reason: ExtractionFailure): ExtractionResult => ({ ok: false, reason })

  return {
    async extract(input) {
      // Redaction happens here, always, even if on-device inference is
      // expected: PREFER_ON_DEVICE can fall back to the cloud (design 5).
      const prompt = buildExtractionPrompt(input)
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const m = getModel()
        const call = (async () => {
          // Starts a device model download if one is possible; returns at once otherwise.
          await m.initializeDeviceModel()
          return m.generateContent(prompt.text, { timeout: timeoutMs, signal: controller.signal })
        })()
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Timeout()), timeoutMs)
        })
        const result = await Promise.race([call, timeout])
        // Recorded exactly as the SDK reports it; a missing value is not guessed.
        const source = inferenceSourceSchema.safeParse(result.response.inferenceSource)
        if (!source.success) return failure('invalid')
        let text: string
        try {
          text = result.response.text()
        } catch {
          return failure('invalid')
        }
        const generatedAt = now()
        const validation = validateExtraction(text, prompt.redactedDescription, generatedAt)
        if (!validation.ok) return failure('invalid')
        return {
          ok: true,
          suggestion: {
            suggested: validation.suggested,
            inferenceSource: source.data,
            model: source.data === InferenceSource.ON_DEVICE ? ON_DEVICE_MODEL : CLOUD_MODEL,
            generatedAt: generatedAt.toISOString(),
          },
          dropped: validation.dropped,
        }
      } catch (error) {
        // Error details are not logged: they can contain request data.
        if (error instanceof Timeout) {
          controller.abort()
          return failure('timeout')
        }
        return failure(isOnline() ? 'unavailable' : 'offline')
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
