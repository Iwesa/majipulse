# Firebase AI Logic notes (T6.1)

Checked against the installed SDK (`firebase` 13.3.0, `@firebase/ai` 3.1.0:
`node_modules/@firebase/ai/dist/ai-public.d.ts` and `dist/esm/index.esm.js`)
and the hybrid web docs:

- https://firebase.google.com/docs/ai-logic/hybrid-on-device-inference
- https://firebase.google.com/docs/ai-logic/hybrid/web/generate-structured-output

Recheck these facts when the `firebase` package is upgraded.

## Setup

```ts
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, Schema } from 'firebase/ai'

const ai = getAI(app, { backend: new GoogleAIBackend() }) // Gemini Developer API backend (D7)
const model = getGenerativeModel(ai, {
  mode: InferenceMode.PREFER_ON_DEVICE, // value 'prefer_on_device'
  inCloudParams: { model: CLOUD_MODEL, generationConfig: { responseMimeType: 'application/json', responseSchema: schema } },
  onDeviceParams: { promptOptions: { responseConstraint: schema } },
})
```

- `getGenerativeModel(ai, ModelParams | HybridParams, requestOptions?)`.
  `HybridParams` is `{ mode, onDeviceParams?, inCloudParams? }`, and
  `inCloudParams` is a full `ModelParams`, so `model` is required there.
- The SDK's default hybrid cloud model is `gemini-3.5-flash-lite`
  (`DEFAULT_HYBRID_IN_CLOUD_MODEL`). MajiPulse sets it explicitly so the stored
  `ai.model` value is known.
- App Check: AI Logic requests carry the app's App Check token automatically.
  Enforcement is switched on in the Firebase console (AI Logic settings).
- There is no AI Logic emulator. Emulator builds still call the real endpoint
  (`firebasevertexai.googleapis.com`), which fails without a real App Check
  token. E2E tests block that host and test the "unavailable" path.

## Structured output in hybrid mode

Both configurations are needed, because the source is decided per request:

- Cloud: `inCloudParams.generationConfig` with `responseMimeType: 'application/json'`
  and `responseSchema`.
- On-device (Chrome Prompt API): `onDeviceParams.promptOptions.responseConstraint`.
  It accepts a `Schema` helper object or a plain JSON schema.

The JSON comes back as a string from `result.response.text()`. It is still
untrusted and is parsed and validated with Zod (`src/services/ai/extraction.ts`).

Schema helpers used: `Schema.object({ properties, optionalProperties? })`,
`Schema.string({ nullable, description })`, `Schema.enumString({ enum, nullable })`.
All object properties are required unless listed in `optionalProperties`.

## `initializeDeviceModel`

- `model.initializeDeviceModel(onDownloadProgress?): Promise<void>`.
- Must be called on or after a user interaction (button click or key press).
  Without one, a needed download fails.
- In `PREFER_ON_DEVICE` it does not throw when the Prompt API is missing; it
  returns at once. If the model is downloadable it starts the download and
  returns without waiting for it.
- Requests sent before the device model is available go to the cloud.
- MajiPulse calls it from the "Send" click handler of the privacy preview,
  right before `generateContent`.

## Where inference ran

- `result.response.inferenceSource?: InferenceSource`.
- `InferenceSource.ON_DEVICE === 'on_device'`, `InferenceSource.IN_CLOUD === 'in_cloud'`.
  The spec first used upper-case names; the stored values are the lower-case
  strings above (schema, rules, and tests use them).
- The field is optional in the types. MajiPulse treats a missing value as an
  invalid response instead of guessing a source.

## Requests and timeouts

- `generateContent(request, singleRequestOptions?)`. `SingleRequestOptions`
  has `timeout` (ms) and `signal` (`AbortSignal`). The on-device path does not
  use them, so MajiPulse also races the call against its own 15 second timer.

## Errors

`AIError` (extends `FirebaseError`) has `code: AIErrorCode`. Codes in 3.1.0:
`error`, `request-error`, `response-error`, `fetch-error`, `session-closed`,
`invalid-content`, `api-not-enabled`, `invalid-schema`, `no-api-key`,
`no-app-id`, `no-model`, `no-project-id`, `parse-failed`, `unsupported`,
`already-initialized`.

MajiPulse does not branch on these codes. Every SDK error becomes
"AI suggestions unavailable", reported as `offline` when the browser is
offline. Error messages are never logged, because they can echo request data.

## Availability

- On-device inference needs Chrome desktop 139+ with the Prompt API enabled.
  Elsewhere, `PREFER_ON_DEVICE` uses the cloud model.
- Offline without a device model, the cloud request fails. Reporting continues
  manually (R4.7).
