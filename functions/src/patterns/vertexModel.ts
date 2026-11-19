/**
 * Vertex AI (Gemini Enterprise Agent Platform) adapter for pattern analysis,
 * through `@google/genai` (D3, T8.1). Authenticates with the function's
 * service account (Application Default Credentials); no API key.
 * See docs/ai-logic-notes.md, "Server pattern analysis".
 */
import { GoogleGenAI } from '@google/genai'
import { ModelUnavailableError, type PatternModel } from './analysis.js'

export const DEFAULT_PATTERN_MODEL = 'gemini-3.5-flash'
/** No Gemini endpoint exists in africa-south1; see the notes. */
export const DEFAULT_PATTERN_MODEL_LOCATION = 'global'
const TIMEOUT_MS = 90_000

export interface VertexModelOptions {
  /** The Google Cloud project ID. Demo projects (`demo-*`, emulators) never call the model. */
  project: string | undefined
  location: string
  model: string
}

export function createVertexPatternModel(options: VertexModelOptions): PatternModel {
  const { project, location, model } = options
  const usable = Boolean(project) && !project?.startsWith('demo-')
  let client: GoogleGenAI | null = null

  return {
    name: model,
    async generate(request) {
      if (!usable) throw new ModelUnavailableError('no-model-in-demo-project')
      client ??= new GoogleGenAI({ enterprise: true, project, location })
      const response = await client.models.generateContent({
        model,
        contents: request.prompt,
        config: {
          systemInstruction: request.systemInstruction,
          responseMimeType: 'application/json',
          responseJsonSchema: request.responseJsonSchema,
          temperature: 0.2,
          abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        },
      })
      const text = response.text
      if (!text) throw new ModelUnavailableError('empty-response')
      return text
    },
  }
}
