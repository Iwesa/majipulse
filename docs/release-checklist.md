# Release and acceptance checklist (T9.1, T9.4)

Order for the first demo deployment, the live smoke tests that automated tests cannot cover, and the AC1 to AC22 walkthrough. Record results in `docs/acceptance-results.md` (T9.4).

Nothing here has been run against the real project yet. The automated suites run against emulators.

## 1. Before you start

- [ ] Every item in [`platform-checklist.md`](platform-checklist.md) is done (TP.2).
- [ ] `.env.local` (with the leading dot) has the real web config, `VITE_APPCHECK_SITE_KEY`, and `VITE_USE_EMULATORS=false`.
- [ ] `functions/.env` sets `PATTERN_MODEL_LOCATION` (and optionally `PATTERN_MODEL`).
- [ ] All local checks pass, one at a time:

  ```powershell
  npm run typecheck; npm run lint; npm test
  npm run test:emulators
  npm run test:hosting
  npm run build; npm run check:build
  $env:PLAYWRIGHT_CHANNEL='msedge'; npm run test:e2e
  $env:PLAYWRIGHT_CHANNEL='msedge'; npm run test:e2e:emulators
  ```
- [ ] `git status` is clean and shows no `.env` files.

## 2. Select the project

```powershell
npx firebase login
npx firebase use majipulse
npx firebase projects:list   # confirm majipulse-4575c is current
```

## 3. Rules and indexes

```powershell
npx firebase deploy --only firestore:rules,firestore:indexes
```

- [ ] Firebase console > Firestore > Indexes: all 14 composite indexes show **Enabled** (building can take minutes). Queries fail with `failed-precondition` until they are.

## 4. Functions

```powershell
npx firebase deploy --only functions
```

- [ ] `createOrgUser`, `setUserRole`, and `analyzeIncidentPatterns` are deployed in `africa-south1`, Node.js 22, with the intended runtime service account.

## 5. Hosting

```powershell
npx firebase deploy --only hosting
```

The predeploy step rebuilds `dist` from `.env.local` and runs `check:build`.

- [ ] `https://majipulse-4575c.web.app` loads the sign-in screen (not "MajiPulse is not configured").
- [ ] A deep link such as `/incidents` loads the app (SPA rewrite).
- [ ] Response headers (browser dev tools > Network > document): `Cache-Control: no-cache` on the page, `public, max-age=31536000, immutable` on `/assets/*.js`, plus `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Strict-Transport-Security`, `Content-Security-Policy`, and `Content-Security-Policy-Report-Only`.

## 6. App Check (T9.1)

1. Before enforcing: use the app for a few minutes (sign in, open water points, save a report, run a suggestion).
2. Firebase console > App Check > APIs: the metrics for Cloud Firestore and Firebase AI Logic show mostly **verified** requests from the app.
3. Turn on **Enforce** for Cloud Firestore and Firebase AI Logic. Callable functions already enforce it in code (`enforceAppCheck: true`).
4. Verify, and record each result:
   - [ ] The deployed app still works: sign in, list water points, save and sync a report, open incidents as staff.
   - [ ] A request without a token is rejected. For example in PowerShell, a Firestore REST read with a valid ID token but no `X-Firebase-AppCheck` header returns 401 or 403:

     ```powershell
     $token = '<ID token copied from the app session; do not save or share it>'
     curl.exe -s -o NUL -w "%{http_code}`n" -H "Authorization: Bearer $token" "https://firestore.googleapis.com/v1/projects/majipulse-4575c/databases/(default)/documents/waterPoints?pageSize=1"
     ```
   - [ ] A callable without a token is rejected (401):

     ```powershell
     curl.exe -s -o NUL -w "%{http_code}`n" -X POST -H "Authorization: Bearer $token" -H "Content-Type: application/json" -d '{\"data\":{}}' "https://africa-south1-majipulse-4575c.cloudfunctions.net/analyzeIncidentPatterns"
     ```
   - [ ] Clear `$token` afterwards (`Remove-Variable token`).
   - [ ] `npm run check:build` passed, and `dist` contains no `FIREBASE_APPCHECK_DEBUG_TOKEN` (AC14).

## 7. First administrator and demo data (with your confirmation)

```powershell
gcloud auth application-default login
npm --prefix functions run build
npm --prefix functions run bootstrap-first-admin -- --project majipulse-4575c --confirm-project majipulse-4575c `
  --org-id <org-id> --org-name "<name>" --county Kwale --email <admin email> --admin-name "<name>" [--demo]
```

- [ ] The password-setup link printed once in the terminal works, and the administrator can sign in.
- [ ] Only if you want demo data in this project: run `seed-demo` (README, "Demo data") and confirm the "Demo data (fictional)" banner appears.

## 8. Content Security Policy

The enforced `Content-Security-Policy` only blocks framing, plugins, `<base>` changes, and form posts elsewhere, so it cannot break the app. The source allowlist is sent as `Content-Security-Policy-Report-Only` until it is proven on the live site:

- [ ] With dev tools open, sign in, save and sync a report, run AI suggestions, and run a pattern analysis. The console shows **no** "Content-Security-Policy-Report-Only" violation reports. If one appears, add the reported source to the report-only policy in `firebase.json` and redeploy Hosting.
- [ ] Then copy the report-only value into `Content-Security-Policy` (replacing the short policy), update `scripts/hosting-config.test.mjs`, run the tests, and redeploy Hosting.

## 9. Live AI smoke tests

Automated tests mock both models. These checks use the real services.

### Report extraction (Firebase AI Logic, T6.1 and T6.4)

- [ ] **Cloud:** in Edge or Chrome without the Prompt API, as a reporter: New report, description "Tap 2 near the trough is leaking since 12/03/2026, call 0712 345 678 (fictional)", Suggest fields. The preview shows `[PHONE]`; press Send. Suggestions appear with "Suggested by a cloud AI model". In dev tools > Network, the request to `firebasevertexai.googleapis.com` contains `[PHONE]` and not the number.
- [ ] **On device:** in Chrome desktop 139+ with `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` enabled and the model downloaded, repeat. Suggestions show "Suggested by AI on this device".
- [ ] Accept one suggestion, save, and sync. The report detail shows the AI source and time; the Firestore document has `ai.inferenceSource` `in_cloud` or `on_device` and the model name.
- [ ] Turn off the network, then press Send: "AI suggestions unavailable", and the report still saves.

### Pattern analysis (Vertex AI, T8.1)

- [ ] As a technician, Pattern analysis, last 90 days, all water points, Run. With 3 or more incidents: an analysis with insights labeled "Observation" or "Unverified hypothesis", each with supporting incidents, water points, period, and limitations.
- [ ] With a water point that has fewer than 3 incidents: "Not enough data", and no model call (Cloud Logging shows "pattern analysis: insufficient data").
- [ ] Cloud Logging for `analyzeIncidentPatterns` shows only counts (`incidents`, `insightsKept`, `redacted_*`), never descriptions or names.
- [ ] If the call fails: check `roles/aiplatform.user` on the runtime service account, the Vertex AI API, and the model and location in `functions/.env`.

## 10. Accessibility (AC16, T9.2)

Automated: every screen passes the audit in jsdom (`src/test/a11y.test.tsx`) and in the browser at 360 and 1280 px, including contrast, target size, reflow, focus indicators, and keyboard behavior (`e2e-emulator/accessibility.spec.ts`). Manual, on the deployed app:

- [ ] At 360 px and 1280 px: complete a report, triage an incident, and create a task using only the keyboard. Focus is always visible, and Escape closes the mobile menu.
- [ ] With a screen reader (Narrator or NVDA): page titles change on navigation, form errors are read with their fields, "Report saved", sync status, and AI results are announced.
- [ ] Zoom to 200%: no content is cut off and nothing scrolls sideways.
- [ ] Windows High Contrast mode: status badges remain readable (they use text and icons, not color alone).

## 11. Acceptance walkthrough (AC1 to AC22)

"Automated" lists the tests that cover the criterion against emulators or fakes. "Manual" is what to check on the deployed demo project. Record each manual result in `docs/acceptance-results.md`.

| AC | Criterion (short) | Automated | Manual on the demo project |
|---|---|---|---|
| AC1 | Three seeded roles see only what their role allows; no sign-up | `src/routes/routing.test.tsx`, `src/pages/SignInPage.test.tsx`, `tests/emulator/rules/*` | Sign in as Kwale administrator, technician, reporter; check menus; no sign-up link |
| AC2 | Second org cannot read or write the first; unscoped queries denied | `tests/emulator/rules/*`, `tests/emulator/staff/staff.emulator.test.ts`, `src/services/queryPlans.test.ts` | Sign in as a Pwani user; Kwale records never appear |
| AC3 | Offline report is `pending`, survives reconnect and reload | `e2e-emulator/offline-capture.spec.ts`, `src/services/offline/incidentOutbox.test.ts` | Dev tools offline, save a report, reconnect, reload |
| AC4 | One document per report; no second write on retry | `e2e-emulator/offline-capture.spec.ts`, `tests/emulator/sync/sync.emulator.test.ts`, `src/services/sync/syncEngine.test.ts` | Firestore console shows one document for the report |
| AC5 | Forced failure leaves `failed` with content; retry succeeds | `src/pages/reports/syncUi.test.tsx`, `src/services/sync/syncEngine.test.ts` | Optional: block `firestore.googleapis.com` in dev tools, save, unblock, Try sending again |
| AC6 | Stale edit rejected, `conflict`, kept until reviewed | `e2e-emulator/sync.spec.ts`, `tests/emulator/rules/incidents.test.ts` | Reporter edits after staff triage; conflict review appears |
| AC7 | SDK-reported `inferenceSource` shown; AI failure does not block | `src/services/ai/firebaseExtractor.test.ts`, `src/components/incidents/AiAssist.test.tsx`, `e2e-emulator/ai-unavailable.spec.ts` | Section 9, report extraction |
| AC8 | Edited field unchanged after re-running extraction | `src/components/incidents/AiAssist.test.tsx` | Edit a suggested field, run Suggest again, value kept |
| AC9 | No invented location, cause, or fact | `src/services/ai/extraction.test.ts` | Section 9: suggestions only repeat stated facts |
| AC10 | Admin triages, creates a linked task, moves it to done | `e2e-emulator/triage-maintenance.spec.ts`, `tests/emulator/staff/staff.emulator.test.ts` | Same flow on the demo project |
| AC11 | Insights labeled, cited, with period and limitations; <3 is insufficient | `functions/test/patterns.test.ts`, `functions/test/emulator/patterns.emulator.test.ts`, `src/pages/patterns/patterns.test.tsx` | Section 9, pattern analysis |
| AC12 | Bootstrap creates, refuses rerun and project mismatch; no client claims | `functions/test/bootstrap.test.ts`, `functions/test/emulator/*`, `tests/emulator/rules/base.test.ts` | Section 7; a second bootstrap run for the same org refuses |
| AC13 | Account switch hides A's reports; A's unsynced reports sync later | `e2e-emulator/sync.spec.ts`, `src/stores/*.test.ts` | Two reporters on one browser |
| AC14 | `.env.example` placeholders only; no debug token in build; no `.env` tracked | `scripts/check-build.test.mjs`, `tests/hosting/hosting.test.ts` | `git ls-files` shows no `.env` files; section 6 |
| AC15 | Lint, build, unit, rules, functions, and Playwright offline flow pass | All suites (section 1) | — |
| AC16 | Deployed with App Check enforced; accessibility at 360 and 1280 px | `src/test/a11y.test.tsx`, `e2e-emulator/accessibility.spec.ts`, `scripts/hosting-config.test.mjs` | Sections 5, 6, and 10 |
| AC17 | Edit during sync; lost ack; unreadable server; ack then triage | `src/services/sync/syncEngine.test.ts`, `tests/emulator/sync/sync.emulator.test.ts` | — (covered by emulator tests) |
| AC18 | Permission-denied classified as conflict or failed | `src/services/sync/syncEngine.test.ts`, `tests/emulator/sync/sync.emulator.test.ts` | — |
| AC19 | Only `new → triaged → in_progress → resolved` by staff | `tests/emulator/rules/incidentStatus.test.ts`, `tests/emulator/staff/staff.emulator.test.ts` | Incident detail offers only the next status |
| AC20 | Bootstrap partial states resume or refuse; cleanup is scoped | `functions/test/bootstrap.test.ts`, `functions/test/emulator/bootstrap.emulator.test.ts` | — |
| AC21 | Redactor fixtures; only redacted text sent; preview and cancel | `src/services/ai/redact.test.ts`, `functions/test/redact.test.ts`, `src/services/ai/prompt.test.ts`, `functions/test/patterns.test.ts`, `e2e-emulator/ai-unavailable.spec.ts` | Section 9: network request contains placeholders only |
| AC22 | Bootstrap refuses existing users; callables refuse unrelated claims | `functions/test/bootstrap.test.ts`, `functions/test/userAdmin.test.ts` | — |
