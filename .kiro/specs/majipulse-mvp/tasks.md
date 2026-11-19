# MajiPulse MVP: Implementation Tasks

Status: REVISION 4. Decisions D1 to D7 approved. Nothing is implemented. Phase 0 starts only after explicit authorization. Each task is small and independently testable. After each task run lint, build, and the task's tests.

Markers: **[approval]** needs your approval (dependency, console, or billing action). **[verify]** check current docs first. **[user]** needs action in the Firebase or Google Cloud console that only you can do.

## Phase P: Platform prerequisites (checklist, runs alongside Phase 0 and 1)

- [ ] **TP.1 Platform checklist document.** Write `docs/platform-checklist.md` covering: Blaze plan and budget alert, Firebase project ID, Auth email/password enabled, Firestore location, Functions 2nd gen region and Node runtime, Vertex AI API enabled and model available in the region, function service account IAM role, AI Logic setup (Gemini Developer API), App Check web provider and debug tokens. **[verify]** each item against current docs.
  *Test:* you review the document.
- [ ] **TP.2 Console setup.** You complete the checklist items in the console. **[user]**
  *Test:* checklist ticked. Blocks Phases 2 (deploy only), 6 (real calls), 8 and 9. Emulator work does not wait for it.

## Phase 0: Foundations

- [x] **T0.1 Strict TypeScript.** Set `"strict": true` in `tsconfig.app.json` and `tsconfig.node.json`. Fix resulting errors only.
  *Test:* `npm run build` passes.
- [x] **T0.2 Secrets hygiene.** Extend `.gitignore` (design section 10). Add `.env.example` with placeholder values only. Add `scripts/check-build.mjs` that fails if `dist/` contains `FIREBASE_APPCHECK_DEBUG_TOKEN`, and a `check:build` script.
  *Test:* script fails on a planted string, passes on a clean build. `git check-ignore .env.local .env.development.local` succeeds. Refs: S6, AC14.
- [x] **T0.3 Tailwind setup.** Add `@tailwindcss/vite` to `vite.config.ts`, import Tailwind in `index.css`, remove the Vite template UI.
  *Test:* build passes. Smoke component test.
- [x] **T0.4 Test tooling.** Vitest config (jsdom, jest-dom, fake-indexeddb setup), Playwright config, scripts `test`, `test:e2e`. One trivial test each. Uses the already-installed D4 packages.
  *Test:* both scripts run.
- [x] **T0.5 Folder structure and strings module.** Create the folders in design section 3 and `src/strings/en.ts` with a typed shape.
  *Test:* build passes. Unit test that the strings object has no empty values. Refs: R12.1.
- [x] **T0.6 Env config module.** `services/firebase/config.ts` reads `VITE_*` values validated with Zod.
  *Test:* unit tests for missing and invalid values.

## Phase 1: Schemas and shared UI

- [x] **T1.1 Zod schemas.** Organization, member, waterPoint, incident (with revision fields, `ai`, `confirmedFields`), local incident record (with `syncStatus` including `conflict`), maintenanceTask, patternAnalysis (insights with required supporting IDs, water points, period, limitations, no cause field).
  *Test:* valid and invalid fixtures for every schema, including an insight with no limitations (rejected).
- [x] **T1.2 UI primitives.** Button, TextField, SelectField, TextArea, Badge, Alert, Spinner, EmptyState, ErrorState, `AsyncBoundary`. All text from strings module.
  *Test:* component tests per state and label association.
- [x] **T1.3 App layout.** Responsive shell, role nav placeholder, skip link, `aria-live` region, connectivity indicator, "Demo data (fictional)" banner, help text stating the offline-after-load boundary.
  *Test:* component tests. Refs: R10.1, D2.

## Phase 2: Firebase, auth, provisioning and rules (emulator first)

- [x] **T2.1 Firebase init.** App, Auth, Firestore, Functions client. App Check init with `ReCaptcha*Provider` **[verify]** and the debug token only under `import.meta.env.DEV`. Emulator connection in dev and tests.
  *Test:* mocked SDK unit test. Build check passes. Refs: S5.
- [x] **T2.2 firebase.json and emulators.** Configure Auth, Firestore, Functions, Hosting emulators. `test:rules` script.
  *Test:* emulators start. Trivial rules test runs.
- [x] **T2.3 Rules: base, organizations, members.** Default deny, `isMember()` and claim helpers, org read for members, no client writes.
  *Test:* per-role tests, cross-org denial, client write to `members` denied, user with claims but no member document denied, inactive member denied. Refs: S2, S12, R11.8.
- [x] **T2.4 Functions package skeleton.** `functions/` TypeScript package with `firebase-functions` and `firebase-admin`. **[approval]** for these two dependencies.
  *Test:* `npm run build` in `functions/`. Emulator loads it.
- [x] **T2.5 Bootstrap first administrator script.** Per design "Provisioning", steps 1 to 7 with `bootstrap.status` tracking. **[verify]** Admin SDK `setCustomUserClaims` and `generatePasswordResetLink`.
  *Test:* emulator tests: creates org, user, claims, member doc, status `complete`. Refuses a second run for the same org. Refuses mismatched `--confirm-project`. Output contains no password or token other than the single reset link. **Existing-user guard:** (a) email belongs to a user with `members/{uid}` in another org: refused, that user's claims, member doc, and the target org are unchanged (org document not created); (b) email belongs to a user with organization claims for another org and no member doc: refused, claims unchanged; (c) user with unrelated claims only (`{ beta: true }`): refused, claims unchanged; (d) claims added between preflight and step 4: step 4 re-read stops without writing. Refs: R11.1, R11.2, R11.7, R11.9, AC12, AC22.
  *Done:* steps 6 and 7 swapped (reset link printed before marking complete, so a link failure can be resumed). Script lives in `functions/src/scripts/`.
- [x] **T2.5b Bootstrap resume and cleanup.** `--resume` and `--cleanup` per the design's "Partial states" table.
  *Test:* emulator tests with a failure injected after each of steps 3, 4, 5, 6: resume ends `complete` with exactly one administrator. `adminUid` mismatch refuses. Org missing but claims present refuses with instructions. Resume accepts the recorded `adminUid` with exactly the expected claims, and refuses when that user's claims have changed to another org or gained extra keys. Cleanup requires confirmation, refuses when other members exist, removes claims only if they are exactly the expected map, never deletes a pre-existing Auth user, and removes only bootstrap-created data. Refs: R11.6, R11.9, AC20, AC22.
- [x] **T2.6 `createOrgUser` and `setUserRole` functions.** Admin only, App Check enforced, Zod input, caller's org only, self role change rejected.
  *Test:* emulator tests: technician and reporter denied, cross-org denied, self-change denied, valid calls set claims. `createOrgUser` with an email that already has an Auth user refused, existing user unchanged. `setUserRole` on a target with unrelated claims refused, claims unchanged. Refs: R11.3, R11.4, R11.10, AC22.
- [x] **T2.7 Auth service and session store.** Sign in, sign out, claims from `getIdTokenResult`, token refresh, `SessionScope`, reset of all stores on sign-out or user change.
  *Test:* store tests with mock auth: user change clears state. Refs: R1.1, R3.6, R11.5.
- [x] **T2.8 Routing, guards, sign-in screen.** No sign-up route.
  *Test:* component tests per role. Refs: R1.2, R1.4.
- [x] **T2.9 Users screen.** Admin creates technician and reporter accounts and changes other users' roles through the functions.
  *Test:* component tests with mocked functions client. Own role control is not shown.
- [x] **T2.10 Rules: waterPoints.** Org read, admin and technician write, immutable `organizationId`, field validation.
  *Test:* rules tests per role. Query without `organizationId` filter denied. Query with the filter succeeds for each role. Refs: S1, AC2.
- [x] **T2.11 Rules: incidents (create, read, reporter update).** Create, read including `get` on a nonexistent ID, reporter content update with revision checks, reporter reads own only.
  *Test:* stale `baseRevision` denied, wrong `serverRevision` increment denied, edit after triage denied, cross-org denied. Reporter list query without `reporterId` denied, with `organizationId` and `reporterId` succeeds. Admin and technician org-scoped list succeeds, unscoped denied. `get` of a nonexistent ID allowed for members only. Refs: R5.5, S1, AC2, AC6.
- [x] **T2.11b Rules: incident status transitions.** Allowed transitions only, administrator and technician only, `onlyChanged` limits, `lastStatusChange` consistency.
  *Test:* positive: each of the three allowed transitions by administrator and by technician. Negative: `new → in_progress`, `new → resolved`, `triaged → resolved`, every reversal, same-status write, unknown status, reporter changing status (including own incident), status update that also changes `description`, `organizationId`, `reporterId`, `ai`, or `confirmedFields`, wrong `lastStatusChange.from` or `.by`, missing `serverRevision` increment, cross-org status update. Refs: R7.2, R7.3, AC19.
- [x] **T2.12 Rules: maintenanceTasks, patternAnalyses.** Task access per role, assignee in same org, `patternAnalyses` client write denied.
  *Test:* rules tests.
- [x] **T2.13 Demo seed script.** Fictional Kwale County org and a second fictional org, three users per org, 6 water points, 12 incidents, all `demo: true`. Requires explicit project confirmation.
  *Test:* emulator run asserts counts, flags, claims. Refs: R10, S10.

## Phase 3: Water points

- [x] **T3.1 `orgScopedQuery` helper and water point service.**
  *Test:* unit test that every service query includes the org filter. Store tests with fake service. Refs: S1, AC2.
- [x] **T3.2 Water point list and detail.** All UI states.
  *Test:* component tests.
- [x] **T3.3 Water point form.**
  *Test:* validation and submit tests. Refs: R2.1, R2.3.
- [x] **T3.4 Water point cache.** IndexedDB, keyed by organization, refreshed on sign-in and focus.
  *Test:* fake-indexeddb tests, other org's cache not readable. Refs: R2.2.
  *Done:* cache keyed by `[organizationId, ownerUid, waterPointId]` (scoped by user as well as organization). Refreshed on sign-in, focus, and reconnect.

## Phase 4: Offline incident capture

- [x] **T4.1 IndexedDB repository.** Scoped by `SessionScope`, compound keys, versioned schema, `syncing` reset on startup.
  *Test:* CRUD, user A records invisible to user B, records survive sign-out, crash recovery. Refs: R3.5, R3.6, S11.
- [x] **T4.2 Draft and revision logic.** UUID before first save, `clientRevision` and `mutationId` on each save, `baseRevision` handling, `confirmedFields` merge.
  *Test:* unit tests. Refs: R3.1, R3.4, R4.5.
- [x] **T4.3 New report screen (manual).**
  *Test:* save writes locally with network mocked off, shows `pending`. Refs: R3.2, R3.3.
- [x] **T4.4 My reports screen.** Five statuses with text and icon, edit while allowed.
  *Test:* component tests per status. Refs: R6.
- [x] **T4.5 Playwright: offline capture in a loaded app.** Go offline after load, create report, reconnect, reload, report still present.
  *Test:* E2E. Refs: AC3.

## Phase 5: Synchronization

- [x] **T5.1 Incident sync adapter.** Transaction implementing design section 6 "Sync of one record", using only the mutation snapshot. Fake adapter for unit tests.
  *Test:* create, lost-ack retry (same `mutationId`) does not write, matching base updates, stale detected inside the transaction goes to conflict. Emulator test against real rules. Refs: R5.1, R5.2, R5.5, R5.7.
- [x] **T5.2 Sync engine.** Online check, snapshot creation, acknowledgement rule, single-flight lock, backoff, scope filter, no auto-retry for `conflict` or `permission_denied`.
  *Test:* duplicate trigger single write, failure then retry, offline skip, other user's records ignored, no deletion. **Race:** edit the record after the snapshot is taken and before the acknowledgement; assert the record stays `pending` with the newer content and new `mutationId`, `baseRevision` advances to the committed revision, and the next run syncs the newer content (emulator: one document, newer content). Same race with a failed acknowledgement: newer content kept. Refs: R5.3, R5.4, R5.6, R5.8, R5.11, R5.12, AC17.
- [x] **T5.2a Uncertain-commit reconciliation.** Durable `inFlight`, reconciliation table from design section 6, startup reset that keeps `inFlight`.
  *Test (unit, fake adapter):* each reconciliation row: A committed (record still A → `synced`; record now B → base advanced, `pending`, no conflict); A not committed; other write present → `conflict`; server unreadable → `inFlight` kept, nothing submitted. `inFlight` survives a simulated restart.
  *Test (emulator, AC17b):* for a new report and for an update: commit A against the emulator, drop the acknowledgement (adapter throws after commit), edit to B, run sync. Assert B commits, server has B's content, `mutationId == B`, `serverRevision == A's revision + 1`, local `synced`, one document, no `conflict` at any point.
  *Test (emulator, AC17c):* same, with the reconciliation read failing first, then an app restart, then success: same final state as AC17b.
  *Test (emulator, AC17d):* commit A, drop the acknowledgement, administrator triages, edit to B, sync: `conflict`, local B content unchanged.
  Refs: R5.13, R5.14, R5.15, AC17b, AC17c, AC17d.
- [x] **T5.2b Error classification and permission-denied check.** Classifier per design "Error classification".
  *Test:* genuine conflicts classified `conflict`: server `serverRevision` ahead of `baseRevision`; server status `triaged`. Unrelated failures classified `failed`/`permission_denied`: claims removed, organization claim changed, follow-up read denied, server state equal to the snapshot (field validation failure), document missing for an update. Every case asserts local content and `mutationId` are unchanged. Emulator variants for the stale-revision and claims-removed cases. Refs: R5.9, R5.10, AC18.
- [x] **T5.3 Triggers and sync store.** Start, `online` event, after save, manual retry, stop on sign-out.
  *Test:* store tests with fake timers.
- [x] **T5.4 Sync status UI.**
  *Test:* component tests. Refs: R6.
- [x] **T5.5 Conflict review screen.** Side-by-side view, retry on latest (only while server status is `new`), discard with confirmation.
  *Test:* component tests, no retry until an action is chosen. Refs: R5.6.
- [x] **T5.6 Playwright: sync, failure, conflict, account switching.**
  *Test:* E2E. Refs: AC4, AC5, AC6, AC13.

## Phase 6: AI-assisted extraction

- [x] **T6.1 Confirm AI Logic details.** Record in `docs/ai-logic-notes.md`: structured output config in hybrid mode, `initializeDeviceModel` usage, error types. Core API facts are already verified (design section 5A). **[verify]**
  *Test:* you review the notes.
- [x] **T6.1b Privacy redactor (shared).** `shared/privacy/redact.ts` and `shared/privacy/fixtures.json` per design "Privacy preprocessing". Wire `shared/` into the app and `functions/` builds **[verify]**.
  *Test:* fixtures run in both test suites. Kenyan phones: `0712345678`, `0712 345 678`, `0712-345-678`, `0712.345.678`, `+254712345678`, `+254 712 345 678`, `254712345678`, `(+254) 712 345678`, `0110123456`, `0110 123 456`, `+254 110 123 456`. Emails: standard, with subdomains and `+` tags, spelled out (`name at gmail dot com`). Explicit identifiers: "my name is Amina Otieno", "name: J. Mwangi", "jina langu ni Baraka", "naitwa Zawadi", "ID number 12345678", "national ID 2345678", "kitambulisho 3456789", "call me on ...". Titled names: "Mr Kahindi", "Mama Rehema Said". Long numbers: 9+ digits. Negatives (unchanged): "pump broken since 3 days", "tap 2 leaking", "200 litres", "7am to 9am", "borehole 14", dates and times like "12/03/2026" and "2026-03-12 10:30", "Mama mboga stall" (lowercase after title). Output contains only placeholders, never originals. Refs: R4.8, AC21.
- [x] **T6.2 Extraction schema and validator.** Zod, grounding check (against redacted text), strip unknown keys, placeholder and detector echo rejection.
  *Test:* fixtures: malformed JSON, invented location, unknown enum, overlong text, output containing `[PHONE]`, output containing a phone number or email. Refs: R4.3, R4.6, R4.10, AC9, AC21.
- [x] **T6.3 Prompt builder.** Delimited data block, redacted description and water-point name only.
  *Test:* snapshot and injection-text fixtures. A description with a phone, email, and "my name is" produces a prompt containing only placeholders (asserted on the built prompt). Refs: S7, S8, R4.8, AC21.
- [x] **T6.4 Extraction service.** Wraps `firebase/ai`, timeout, typed success with `inferenceSource` or typed failure.
  *Test:* mocked SDK: `ON_DEVICE`, `IN_CLOUD`, timeout, unavailable, invalid output. Refs: R4.1, R4.2, R4.7.
- [x] **T6.4b Privacy preview.** Description help text, preview of the redacted text with marked removals, warning about undetected details, send, edit first, and cancel actions.
  *Test:* component tests: no AI call until "Send"; "Cancel" makes no call and manual entry works; "Edit description first" returns focus and rebuilds the preview; preview never shows the original removed values; warning text present and announced. Refs: R4.9, AC21.
- [x] **T6.5 Review panel.** Per-field accept or edit, source label, unavailable message.
  *Test:* component tests, re-run preserves confirmed fields. Refs: R4.4, R4.5, AC7, AC8.
- [x] **T6.6 Store AI provenance.** `ai` block and `confirmedFields` saved and synced. Rules updated if needed.
  *Test:* unit and rules tests.
- [x] **T6.7 Playwright: AI unavailable.**
  *Test:* E2E with AI mocked as failing. Refs: R4.7.

## Phase 7: Triage and maintenance

- [x] **T7.1 Incident list.** Org-scoped query, filters, indexes.
  *Test:* store, component, and emulator query tests. Refs: R7.1.
- [x] **T7.2 Incident detail and triage.** Confirmed versus AI-suggested values, status transitions.
  *Test:* transition unit tests, component tests. Refs: R7.2.
- [x] **T7.3 Maintenance tasks.** Create from incident, list, detail, assign, status.
  *Test:* store, component, rules tests. Refs: R8, AC10.
- [x] **T7.4 Dashboard.** Role-based counts and sync summary.
  *Test:* component tests per role.

## Phase 8: Pattern analysis (D3 approved; real calls wait for TP.2)

- [ ] **T8.1 Server AI setup.** Add `@google/genai` to `functions/` **[approval]**. Confirm Vertex mode client options, authentication through the function's service account, IAM role, structured output config, and model availability in the chosen region **[verify]**. Record in `docs/ai-logic-notes.md`.
  *Test:* function builds. Manual smoke call in the demo project.
- [ ] **T8.2 Insight schemas and filters.** Citation, water point, period, and limitations checks. Confirmed-cause phrase filter.
  *Test:* fixtures: foreign incident ID dropped, unlinked water point dropped, missing limitations dropped, "the cause is" statement dropped, insight containing a placeholder or a phone number dropped. Refs: R9.4, R9.5, R4.10.
- [ ] **T8.3 `analyzeIncidentPatterns` function.** `enforceAppCheck: true`, role and org checks, insufficient-data short circuit, minimized prompt with redacted and truncated descriptions and no `locationNote`, model adapter, write to `patternAnalyses`.
  *Test:* emulator with mocked adapter: denial cases, fewer than 3 incidents, valid result. Seeded incidents containing phones, emails, and "my name is" produce a captured model request with only placeholders and no `reporterId`, `createdBy`, or `locationNote`. Logs contain only redaction counts. Refs: R9.1 to R9.3, S4, S7, AC21.
- [ ] **T8.4 Pattern analysis screen.** Observation and hypothesis labels, incidents, water points, period, limitations.
  *Test:* component tests. Refs: AC11.

## Phase 9: Hardening and release

- [ ] **T9.1 App Check enforcement.** Register provider, enforce for Firestore and Functions, confirm AI Logic enforcement, verify the app works. **[user][verify]**
  *Test:* manual checklist, request without token rejected. Refs: S5.
- [ ] **T9.2 Accessibility pass.**
  *Test:* Playwright checks and manual checklist at 360px and 1280px. Refs: AC16.
- [ ] **T9.3 Hosting and deploy config.** SPA rewrite, rules and indexes deploy, `.firebaserc` with placeholder.
  *Test:* hosting emulator smoke test.
- [ ] **T9.4 Demo deployment.** Deploy, bootstrap, seed (with your confirmation), walk through all acceptance criteria.
  *Test:* results in `docs/acceptance-results.md`.

## Stretch (only after all above pass)

- [ ] **T-S1 Photo attachment** with Storage rules and App Check.
- [ ] **T-S2 Offline cold start** with a service worker (new dependency or custom code, needs approval).
- [ ] **T-S3 Optional device location** as a reporter-confirmed note.
