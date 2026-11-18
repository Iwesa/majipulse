// Extraction service against a mocked Firebase AI Logic SDK (T6.4; R4.1, R4.2, R4.7, AC7, AC21).
// The mock captures the real outbound request. Fictional text.
import type { FirebaseApp } from 'firebase/app'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({
  modelParams: [] as unknown[],
  requests: [] as unknown[],
  initializeDeviceModel: vi.fn(async () => undefined),
  generateContent: vi.fn(),
}))

vi.mock('firebase/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/ai')>()
  return {
    ...actual,
    getAI: vi.fn(() => ({ fake: 'ai' })),
    getGenerativeModel: vi.fn((_ai: unknown, params: unknown) => {
      sdk.modelParams.push(params)
      return { initializeDeviceModel: sdk.initializeDeviceModel, generateContent: sdk.generateContent }
    }),
  }
})

const { CLOUD_MODEL, ON_DEVICE_MODEL, createFirebaseIncidentExtractor, extractionResponseSchema } = await import('./firebaseExtractor')

const APP = {} as FirebaseApp
const NOW = new Date('2026-03-20T12:00:00Z')
const DESCRIPTION = 'My name is Amina Otieno, call 0712 345 678. Tap 2 near the trough is leaking since 12/03/2026.'
const INPUT = { description: DESCRIPTION, waterPointName: 'Mwamanga Borehole (fictional)' }
const OUTPUT = { incidentType: 'leak', severity: null, occurredAt: '2026-03-12T00:00:00Z', locationNote: 'near the trough' }

const respond = (text: string, inferenceSource?: string) =>
  sdk.generateContent.mockImplementationOnce(async (request: unknown) => {
    sdk.requests.push(request)
    return { response: { text: () => text, inferenceSource } }
  })

let online = true
const extractor = (timeoutMs?: number) =>
  createFirebaseIncidentExtractor(APP, { now: () => NOW, isOnline: () => online, ...(timeoutMs ? { timeoutMs } : {}) })

beforeEach(() => {
  sdk.modelParams.length = 0
  sdk.requests.length = 0
  sdk.generateContent.mockReset()
  sdk.initializeDeviceModel.mockClear()
  online = true
})
afterEach(() => {
  vi.useRealTimers()
})

describe('model configuration (design 5A, docs/ai-logic-notes.md)', () => {
  it('uses PREFER_ON_DEVICE with structured output for both cloud and device', async () => {
    respond(JSON.stringify(OUTPUT), 'in_cloud')
    await extractor().extract(INPUT)
    expect(sdk.modelParams).toEqual([
      {
        mode: 'prefer_on_device',
        inCloudParams: {
          model: CLOUD_MODEL,
          generationConfig: { responseMimeType: 'application/json', responseSchema: extractionResponseSchema },
        },
        onDeviceParams: { promptOptions: { responseConstraint: extractionResponseSchema } },
      },
    ])
    expect(sdk.initializeDeviceModel).toHaveBeenCalledOnce()
    expect(sdk.initializeDeviceModel.mock.invocationCallOrder[0]).toBeLessThan(sdk.generateContent.mock.invocationCallOrder[0])
  })

  it('the response schema allows only the four fields, with the app enums', () => {
    expect(JSON.parse(JSON.stringify(extractionResponseSchema))).toMatchObject({
      type: 'object',
      properties: {
        incidentType: { enum: ['no_water', 'low_flow', 'leak', 'water_quality_concern', 'pump_or_equipment_issue', 'other'], nullable: true },
        severity: { enum: ['low', 'medium', 'high'], nullable: true },
        occurredAt: { type: 'string', nullable: true },
        locationNote: { type: 'string', nullable: true },
      },
    })
  })
})

describe('outbound request (AC21)', () => {
  it('sends only redacted text, never the original personal details', async () => {
    respond(JSON.stringify(OUTPUT), 'on_device')
    await extractor().extract(INPUT)
    expect(sdk.requests).toHaveLength(1)
    const sent = JSON.stringify(sdk.requests[0])
    for (const secret of ['Amina', 'Otieno', '0712', '345 678']) expect(sent).not.toContain(secret)
    expect(sent).toContain('My name is [NAME], call [PHONE].')
    expect(sent).toContain('Mwamanga Borehole (fictional)')
  })
})

describe('results', () => {
  it.each([
    ['on_device', ON_DEVICE_MODEL],
    ['in_cloud', CLOUD_MODEL],
  ] as const)('records inferenceSource %s exactly as reported (R4.2)', async (source, model) => {
    respond(JSON.stringify(OUTPUT), source)
    const result = await extractor().extract(INPUT)
    expect(result).toEqual({
      ok: true,
      suggestion: { suggested: OUTPUT, inferenceSource: source, model, generatedAt: NOW.toISOString() },
      dropped: [],
    })
  })

  it('a missing inferenceSource is invalid, not guessed', async () => {
    respond(JSON.stringify(OUTPUT))
    expect(await extractor().extract(INPUT)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('an unknown inferenceSource is invalid', async () => {
    respond(JSON.stringify(OUTPUT), 'ON_DEVICE')
    expect(await extractor().extract(INPUT)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('invalid output is rejected (R4.3)', async () => {
    respond('{"incidentType": "burst"', 'in_cloud')
    expect(await extractor().extract(INPUT)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('a response whose text() throws (for example blocked content) is invalid', async () => {
    sdk.generateContent.mockImplementationOnce(async () => ({
      response: {
        text: () => {
          throw new Error('blocked')
        },
        inferenceSource: 'in_cloud',
      },
    }))
    expect(await extractor().extract(INPUT)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('ungrounded fields are dropped and reported', async () => {
    respond(JSON.stringify({ ...OUTPUT, locationNote: 'behind the school' }), 'in_cloud')
    const result = await extractor().extract(INPUT)
    expect(result).toMatchObject({ ok: true, suggestion: { suggested: { locationNote: null } }, dropped: ['locationNote'] })
  })
})

describe('failures never throw (R4.7)', () => {
  it('SDK error while online -> unavailable', async () => {
    sdk.generateContent.mockRejectedValueOnce(new Error('fetch-error'))
    expect(await extractor().extract(INPUT)).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('SDK error while offline -> offline', async () => {
    online = false
    sdk.generateContent.mockRejectedValueOnce(new Error('fetch-error'))
    expect(await extractor().extract(INPUT)).toEqual({ ok: false, reason: 'offline' })
  })

  it('initializeDeviceModel failing -> unavailable', async () => {
    sdk.initializeDeviceModel.mockRejectedValueOnce(new Error('download failed'))
    expect(await extractor().extract(INPUT)).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('no answer within the timeout -> timeout, and the request is aborted', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    sdk.generateContent.mockImplementationOnce((_request: unknown, options: { signal: AbortSignal; timeout: number }) => {
      signal = options.signal
      expect(options.timeout).toBe(15_000)
      return new Promise(() => undefined)
    })
    const pending = extractor().extract(INPUT)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await pending).toEqual({ ok: false, reason: 'timeout' })
    expect(signal?.aborted).toBe(true)
  })

  it('model creation failing (AI Logic not set up) -> unavailable', async () => {
    const { getGenerativeModel } = await import('firebase/ai')
    vi.mocked(getGenerativeModel).mockImplementationOnce(() => {
      throw new Error('no-api-key')
    })
    expect(await extractor().extract(INPUT)).toEqual({ ok: false, reason: 'unavailable' })
  })
})
