# MajiPulse

Offline-first, AI-assisted water infrastructure monitoring for community water organizations. Field reporters log water-point incidents with or without a connection, AI suggests structured fields from the description, and administrators and technicians triage incidents, manage maintenance, and review recurring patterns.

All demo data is fictional Kwale County data and is labeled "Demo data (fictional)" in the app.

- Spec: `.kiro/specs/majipulse-mvp/` (requirements, design, tasks). Project rules: `.kiro/steering/`.
- Console setup: [`docs/platform-checklist.md`](docs/platform-checklist.md).
- Release, smoke tests, and acceptance walkthrough: [`docs/release-checklist.md`](docs/release-checklist.md).
- AI SDK notes (Firebase AI Logic and `@google/genai`): [`docs/ai-logic-notes.md`](docs/ai-logic-notes.md).

## Stack

React 19, TypeScript (strict), Vite, Tailwind CSS 4, React Router, Zustand, Zod, IndexedDB (`idb`), Firebase (Auth, Firestore, App Check, AI Logic, Hosting), Cloud Functions 2nd gen (Node.js 22) with `@google/genai` (Vertex AI) for pattern analysis, Vitest, and Playwright.

## Offline boundary

Offline reporting works after the app has loaded online once. Opening or reloading the app while offline is not supported (no service worker in the MVP).

## Prerequisites (Windows)

- Node.js 22 or later and npm. Cloud Functions run on Node.js 22. A newer local Node prints an `EBADENGINE` warning in `functions/`, which is harmless.
- Java 21 (OpenJDK) for the Firestore emulator, for example Microsoft Build of OpenJDK 21.
- Microsoft Edge or Chrome for Playwright. The commands below use the installed Edge (`PLAYWRIGHT_CHANNEL=msedge`), so `npx playwright install` is not needed.
- After installing Java, open a new terminal, or refresh `PATH` in the current PowerShell session:

  ```powershell
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
  ```

## Install

```powershell
npm install
npm --prefix functions install
```

Do not approve install scripts for `esbuild`, `@firebase/util`, or `protobufjs`, and do not run `npm audit fix --force`. The project works without them.

## Configuration

1. Copy `.env.example` to **`.env.local`** (note the leading dot) and fill in the web app config from the Firebase console (Project settings > Your apps) and the reCAPTCHA Enterprise site key. These values are identifiers, not secrets.
2. For local development against the real project with App Check, put the App Check debug token only in **`.env.development.local`**:

   ```
   VITE_APPCHECK_DEBUG_TOKEN=<token registered in the console>
   ```

   It is read only by `npm run dev`. Production builds never contain it, and `npm run check:build` fails if they do.
3. `.env*` files are git-ignored except `.env.example`.

Vite only reads files whose names start with a dot. A file named `env.local` (no dot) is ignored, and the app then shows "MajiPulse is not configured".

## Run locally

```powershell
npm run dev             # Vite dev server against the project in .env.local
npm run emulators       # Auth, Firestore, Functions, Hosting emulators and the Emulator UI (http://127.0.0.1:4000)
```

To point the dev server at the emulators, set `VITE_USE_EMULATORS=true` in `.env.development.local`. Emulator builds use a placeholder App Check token; the emulators do not verify it.

## Tests

| Command | What it runs |
|---|---|
| `npm run typecheck` | `tsc -b` over the app, tests, scripts, and `functions/` |
| `npm run lint` | ESLint |
| `npm test` | Unit and component tests (Vitest, jsdom), shared redactor fixtures, accessibility audit of every screen, functions logic with fakes |
| `npm run test:emulators` | Security rules, sync, staff, and Functions tests against the Auth, Firestore, and Functions emulators (needs Java) |
| `npm run test:hosting` | Builds `dist` and smoke-tests the Hosting config (SPA rewrite) on the Hosting emulator |
| `npm run build` then `npm run check:build` | Production build, then a check that it contains no App Check debug token |
| `$env:PLAYWRIGHT_CHANNEL='msedge'; npm run test:e2e` | Browser smoke tests of the unconfigured shell (builds `dist-smoke`) |
| `$env:PLAYWRIGHT_CHANNEL='msedge'; npm run test:e2e:emulators` | Browser flows against the emulators with the demo seed: offline capture, sync, conflicts, account switching, AI unavailable, triage and maintenance, and accessibility at 360 and 1280 px (builds `dist-e2e`) |

Run the emulator suites one at a time. Running several at once on one machine overloads the emulators and makes timing-sensitive tests fail.

On Windows the Hosting emulator applies no custom headers (a path-normalization issue in the emulator), so `test:hosting` checks headers only on other platforms. `npm test` checks the header rules in `firebase.json` on every platform (`scripts/hosting-config.test.mjs`).

## First administrator (operator-run bootstrap)

There is no public sign-up. The first organization and administrator are created by a script that you run with your own Google Cloud credentials (Application Default Credentials). It is never deployed. No service account key files are used.

```powershell
gcloud auth application-default login
npm --prefix functions run build
npm --prefix functions run bootstrap-first-admin -- `
  --project <project-id> --confirm-project <project-id> `
  --org-id <org-id> --org-name "<Organization name>" --county <county> `
  --email <admin email> --admin-name "<Admin name>"
```

- `--project` and `--confirm-project` must match. The script refuses if the organization already has an administrator, or if the email belongs to an account that already has a `members` record or custom claims.
- It prints a one-time password-setup link to the terminal only. Share it privately.
- Add `--demo` to mark the organization as fictional demo data.
- If a run stops partway, run the same command with `--resume`. It completes the recorded state without creating a second administrator.
- To remove an incomplete bootstrap: add `--cleanup --confirm-org <org-id>`. Add `--delete-created-user` to also delete an Auth user the bootstrap created. Cleanup removes only what the bootstrap created.
- Against the emulators, add `--emulator` (with `FIREBASE_AUTH_EMULATOR_HOST` and `FIRESTORE_EMULATOR_HOST` set).

Later users are created by an administrator on the Users screen (the `createOrgUser` and `setUserRole` functions).

## Demo data

```powershell
$env:MAJIPULSE_DEMO_PASSWORD = '<12 or more characters>'
npm --prefix functions run seed-demo -- --project <project-id> --confirm-project <project-id>
```

Creates two fictional organizations (Kwale and Pwani), an administrator, technician, and reporter in each (`administrator.kwale@example.org`, `technician.kwale@example.org`, `reporter.kwale@example.org`, and the same for `pwani`), water points, and incidents, all marked `demo: true`. Add `--emulator` to seed the emulators. Only run it against the real project after confirming that you want demo data there.

## Deploy

Do not deploy before the console setup in [`docs/platform-checklist.md`](docs/platform-checklist.md) is complete. The full order, including App Check enforcement and smoke tests, is in [`docs/release-checklist.md`](docs/release-checklist.md). In short:

```powershell
npx firebase login
npx firebase use majipulse
npx firebase deploy --only firestore:rules,firestore:indexes
npx firebase deploy --only functions
npx firebase deploy --only hosting
```

The Hosting predeploy step runs `npm run build` and `npm run check:build`, so `dist` is always rebuilt from `.env.local` before upload.

## Project layout

```
src/components, src/pages   UI only (strings from src/strings/en.ts)
src/stores                  Zustand stores (reset on sign-out or user change)
src/services/firebase       Firebase access (Auth, Firestore, Functions, App Check)
src/services/ai             AI Logic extraction, prompt, redaction preview, validation
src/services/sync           Outbox processing, revisions, conflicts
src/services/offline        IndexedDB outbox and water point cache
src/schemas                 Zod schemas shared by all layers
shared/privacy              Redactor used by the app and the functions
functions/                  Cloud Functions and operator scripts (separate package)
tests/                      Emulator and Hosting tests
e2e/, e2e-emulator/         Playwright tests
```
