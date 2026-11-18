# MajiPulse Architecture

## Stack
- React + TypeScript + Vite
- Tailwind CSS
- React Router
- Zustand (UI and app state)
- Firebase: Authentication, Cloud Firestore, Storage, AI Logic, App Check, Hosting
- Cloud Functions for trusted server operations
- IndexedDB for durable offline incident storage (the repo already has `idb`)
- Zod for runtime validation
- Vitest and Playwright for testing

Installed: Tailwind (`tailwindcss`, `@tailwindcss/vite`), `firebase`, `@playwright/test`, `fake-indexeddb`, `@firebase/rules-unit-testing`, `firebase-tools`, `jsdom`. Any other dependency, including `functions/` packages (`firebase-functions`, `firebase-admin`, `@google/genai`), needs user approval before install.

## Layering
Keep these separate. UI code must not call Firebase SDKs directly.
- `components/`, `pages/`: UI only. Reusable components, no business logic.
- `services/firebase/`: Auth, Firestore, Storage, App Check initialization and access.
- `services/ai/`: Firebase AI Logic calls, prompts, output validation.
- `services/sync/`: outbox processing, retries, conflict handling.
- `services/offline/`: IndexedDB storage.
- `stores/`: Zustand stores that call services.
- `schemas/`: Zod schemas and inferred types shared by all layers.
- `functions/`: Cloud Functions (separate package, trusted code only).

## AI
- Individual incident extraction: Firebase AI Logic (Gemini Developer API backend) with `InferenceMode.PREFER_ON_DEVICE` and cloud fallback.
- Record the actual `response.inferenceSource` (`'on_device'` or `'in_cloud'`, the values of `InferenceSource.ON_DEVICE` and `IN_CLOUD`). Do not infer or hardcode it.
- Cross-incident pattern analysis: cloud AI only, via `@google/genai` with Vertex AI in a 2nd gen callable Cloud Function.
- Check the current Firebase AI Logic docs before writing SDK code. Do not guess API names or options.
- See `ai-safety.md`.

## Offline and sync
- **Offline boundary:** No service worker in the MVP. Offline reporting works after the app has loaded online. Opening or reloading the app offline is not supported (stretch feature).
- IndexedDB is the authoritative outbox. Write each report there before any network call.
- Scope every local record by `organizationId` and owner uid. Never expose one user's local records to another.
- Generate a stable UUID before the first local save. Reuse it as the Firestore document ID.
- Write incidents only through Firestore transactions, only while online. Do not use queued writes (`setDoc` offline) as a sync mechanism.
- Revisions: `clientRevision` (local edit count), `baseRevision` (server revision the edit is based on), `serverRevision` (accepted server writes), `mutationId` (one per local save). Rules reject stale `baseRevision`.
- Submit a stable snapshot of each mutation. An acknowledgement only marks `synced` if the local record still has that `mutationId`.
- Keep a durable `inFlight` record for each submitted mutation until its outcome is known. A failed or lost acknowledgement does not mean the write did not commit. Reconcile against the server's `mutationId` before submitting newer content.
- Per-record status: `pending`, `syncing`, `synced`, `failed`, `conflict`. `conflict` needs user review before retry.
- `permission-denied` is not proof of conflict. Classify `conflict` only after reading server state.
- Never delete or overwrite local data until the server confirms it. Show the real status in the UI.

## Data
- Every business record has `organizationId`.
- Firestore rules are not filters. Every client query must include the `organizationId` constraint its rules require, or it is denied.
- Validate data with Zod when reading from IndexedDB, Firestore, AI, and forms.

## Testing
- Vitest for unit and component tests. Playwright for end-to-end flows, including offline.
- Add missing test scripts (`test`, `test:e2e`, `test:rules`) to `package.json` when first needed.
- Spec: `.kiro/specs/majipulse-mvp/`.
