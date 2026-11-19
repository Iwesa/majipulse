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

# Server pattern analysis with `@google/genai` (T8.1)

Checked on 2026-11-19 against the installed SDK (`@google/genai` 3.6.1 in
`functions/`: `dist/genai.d.ts` and the bundled `README.md`) and these docs:

- Supported locations: https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/locations
- Gemini 3.5 Flash model card: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash
- Access control: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/access-control

Vertex AI is now called "Gemini Enterprise Agent Platform" in the docs.
Content was rephrased for compliance with licensing restrictions.

## Install

`npm install @google/genai --ignore-scripts` in `functions/` only (approved).
It pulls in `protobufjs`, whose install script was not run. The root
frontend package does not depend on it.

## Client options

```ts
import { GoogleGenAI } from '@google/genai'
const ai = new GoogleGenAI({ enterprise: true, project, location })
```

- `enterprise: true` selects the Agent Platform (Vertex) API. The SDK README
  recommends it over the older `vertexai: true`, which still works. Setting
  both with different values throws.
- No API key. In Node.js the SDK authenticates with Application Default
  Credentials (`google-auth-library`). In a deployed 2nd gen function these
  are the function's runtime service account (by default the Compute Engine
  default service account, `PROJECT_NUMBER-compute@developer.gserviceaccount.com`).
- `project` comes from the function environment (`GCLOUD_PROJECT`).

## IAM

The runtime service account needs `roles/aiplatform.user` (Agent Platform
User) on the project, and the Vertex AI API (`aiplatform.googleapis.com`)
must be enabled. Both are TP.1/TP.2 console items. A dedicated service
account with only this role (plus Firestore access) is preferable to the
default compute account, which may hold Editor.

## Region

- The function runs in `africa-south1`, next to Firestore.
- No Google model endpoint is listed for `africa-south1` (Johannesburg). The
  regional tables cover the US, Americas, Europe, Asia Pacific, and the Middle
  East.
- `gemini-3.5-flash` (structured output supported) lists Standard PayGo on
  `global` and the `us`/`eu` multi-regions only.
- MajiPulse uses `location: 'global'` by default (parameter
  `PATTERN_MODEL_LOCATION`). The docs note that with the global endpoint you
  cannot choose where ML processing happens; set `eu` or `us` if the
  organization needs a known processing region. Only redacted, truncated
  descriptions and IDs are sent (see design "Privacy preprocessing").
- Model: `gemini-3.5-flash` by default (parameter `PATTERN_MODEL`).
- **Not verified here:** an actual call in the demo project. It needs billing,
  the API, and the IAM role (TP.2). Manual smoke test after TP.2.

## Structured output

```ts
await ai.models.generateContent({
  model,
  contents: prompt,
  config: {
    systemInstruction,
    responseMimeType: 'application/json',
    responseJsonSchema, // plain JSON Schema object
    temperature: 0.2,
    abortSignal,        // client-side cancel only
  },
})
```

- `responseJsonSchema` accepts a JSON Schema subset (`type`, `properties`,
  `required`, `items`, `enum`, `minItems`, `maxItems`, `additionalProperties`,
  and a few more). MajiPulse writes the schema by hand instead of generating
  it, so it uses only listed keywords.
- `response.text` (a getter, `string | undefined`) holds the JSON. It is
  untrusted: parsed and validated with Zod, then filtered (T8.2).

## Emulators and tests

- There is no Vertex emulator. In projects whose ID starts with `demo-` (all
  emulator runs), the adapter refuses to call the model and the function
  returns "unavailable". Tests inject a fake model through the
  `PatternModel` port and capture the outbound request.
