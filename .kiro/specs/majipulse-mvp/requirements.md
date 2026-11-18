# MajiPulse MVP: Requirements

Status: REVISION 3. Decisions D1 to D7 approved (see `design.md`, "Decision record"). No implementation has started.
Governed by `.kiro/steering/*`. Design is in `design.md`, tasks in `tasks.md`.

## 1. Product requirements

**Goal:** A responsive web app where field reporters log water-point incidents without connectivity, AI helps structure the report, and administrators and technicians triage incidents, review recurring patterns, and manage maintenance.

**Users:** Community water organizations, NGOs, and water departments. Each is one *organization*.

### In scope (hackathon MVP)
| ID | Requirement |
|---|---|
| R1 | Sign in with Firebase Authentication (email and password). No public self-registration. |
| R2 | Administrators and technicians register and edit water points. Online only. |
| R3 | Reporters create incident reports online, or offline after the app has loaded. |
| R4 | The app suggests structured fields from free-text incident descriptions (AI extraction). |
| R5 | Reports persist locally first and synchronize idempotently. |
| R6 | Users see the true sync status of each report. |
| R7 | Administrators and technicians triage incidents and change their status. |
| R8 | Administrators and technicians create and update maintenance tasks linked to incidents. |
| R9 | Administrators and technicians run recurring-pattern analysis across incidents (cloud AI). |
| R10 | Demo mode loads clearly labeled fictional Kwale County data. |
| R11 | The first organization and first administrator are provisioned by a secure Admin SDK procedure. Administrators then create users. |

### Offline support boundary
The MVP supports offline reporting **after the application has loaded** in the browser while online. Opening the app for the first time, or reloading it while offline (offline cold start), is not supported in the MVP and is a stretch feature (T-S2).

### Out of scope (do not build)
Offline cold start (stretch only), offline water-point registration, photo attachments (stretch only), push notifications, SMS or USSD, maps, IoT or sensor data, billing, users in multiple organizations, native apps, data export, languages other than English, advanced analytics dashboards.

### Requirement statements (EARS)

**Authentication, provisioning and access**
- R1.1 WHEN a user signs in with valid credentials, THE SYSTEM SHALL read their role and organization from verified ID token claims and route them to their home screen.
- R1.2 WHEN a user is unauthenticated, THE SYSTEM SHALL allow access to the sign-in screen only.
- R1.3 WHILE offline with a previously signed-in session in a loaded app, THE SYSTEM SHALL let the user continue to create and edit reports.
- R1.4 THE SYSTEM SHALL NOT offer public sign-up.
- R11.1 THE SYSTEM SHALL provision the first organization and its first administrator only through a bootstrap script that uses the Firebase Admin SDK with the operator's own Google Cloud credentials.
- R11.2 THE bootstrap script SHALL require an explicit project ID confirmation and SHALL refuse to run if the target organization already has an administrator.
- R11.3 WHEN an administrator creates a user, THE SYSTEM SHALL do so through an administrator-only Cloud Function that sets claims for the caller's organization only.
- R11.4 THE SYSTEM SHALL NOT allow any user to change their own role or organization, or to grant themselves administrator privileges.
- R11.5 WHEN a user's claims change, THE SYSTEM SHALL refresh the ID token before using the new role.
- R11.6 IF the bootstrap fails partway, THEN THE bootstrap script SHALL record the partial state, SHALL support a resume that completes it without creating a second administrator, and SHALL support a confirmed cleanup that removes only what the bootstrap created.
- R11.7 THE bootstrap script SHALL NOT accept, print, or store passwords or tokens, and SHALL print the password-reset link only to the terminal.
- R11.8 THE SYSTEM SHALL NOT grant access to business data unless the user has both custom claims and a matching active `members/{uid}` document, so a partially bootstrapped administrator has no access.

**Water points**
- R2.1 WHEN an administrator or technician submits a valid water-point form, THE SYSTEM SHALL create the record with the user's `organizationId`.
- R2.2 THE SYSTEM SHALL cache the organization's water points locally, scoped by organization, so reporters can choose one while offline.
- R2.3 WHEN a water-point form is invalid, THE SYSTEM SHALL show field-level errors and not save.

**Incident reporting**
- R3.1 WHEN a reporter starts a report, THE SYSTEM SHALL generate a stable incident UUID before the first local save.
- R3.2 WHEN a reporter saves a report, THE SYSTEM SHALL write it to IndexedDB before any network call.
- R3.3 THE SYSTEM SHALL require a water point, a description, and a reporter-confirmed incident type. Severity is optional.
- R3.4 WHEN the user edits a local report, THE SYSTEM SHALL preserve the edit locally and increment `clientRevision`.
- R3.5 THE SYSTEM SHALL scope every local record by `organizationId` and owner user ID, and SHALL show and sync only the signed-in user's records for their current organization.
- R3.6 WHEN a user signs out or a different user signs in, THE SYSTEM SHALL clear in-memory state and SHALL NOT expose the previous user's local records. Unsynced records stay on the device for their owner.

**AI-assisted extraction**
- R4.1 WHEN the reporter requests extraction, THE SYSTEM SHALL call Firebase AI Logic with `InferenceMode.PREFER_ON_DEVICE`, which falls back to the cloud model when on-device inference is unavailable.
- R4.2 THE SYSTEM SHALL record the SDK-reported `response.inferenceSource` (`ON_DEVICE` or `IN_CLOUD`) with each suggestion and display it.
- R4.3 THE SYSTEM SHALL validate AI output with Zod and discard invalid output, showing that suggestions are unavailable.
- R4.4 THE SYSTEM SHALL show suggestions as editable proposals. Nothing is applied until the reporter accepts it.
- R4.5 WHEN the reporter has confirmed or edited a field, THE SYSTEM SHALL NOT overwrite it on a later extraction.
- R4.6 THE SYSTEM SHALL NOT present invented facts, causes, or locations. Fields absent from the report stay empty.
- R4.7 IF AI is unavailable, times out, or fails, THEN THE SYSTEM SHALL let the reporter complete and save the report manually.

**Synchronization**
- R5.1 WHEN online, THE SYSTEM SHALL submit pending reports through a Firestore transaction and mark each `synced` only after the transaction commits.
- R5.2 THE SYSTEM SHALL use the incident UUID as the Firestore document ID so retries do not create duplicates.
- R5.3 IF a sync attempt fails, THEN THE SYSTEM SHALL keep the report, record the error, mark it `failed`, and allow retry.
- R5.4 THE SYSTEM SHALL NOT delete unsynced local data before server confirmation.
- R5.5 THE SYSTEM SHALL reject stale writes: a write applies only if its `baseRevision` equals the server's current `serverRevision`. Security rules enforce this.
- R5.6 WHEN a write is rejected as stale, THE SYSTEM SHALL mark the report `conflict`, keep the local edit unchanged, and require the reporter to review it before any retry.
- R5.7 WHEN a retry finds the server already holds this exact mutation (same `mutationId`), THE SYSTEM SHALL mark the report `synced` without writing again.
- R5.8 THE SYSTEM SHALL NOT run sync transactions while offline.
- R5.9 WHEN a sync write returns `permission-denied`, THE SYSTEM SHALL read the server document if the user is still authorized, and SHALL mark `conflict` only if the server revision or status shows the edit is stale or no longer allowed. Otherwise it SHALL mark the report `failed` with reason "permission denied".
- R5.10 THE permission-denied check SHALL NOT change the report's local content.
- R5.11 THE SYSTEM SHALL submit an immutable snapshot of each mutation, identified by its `mutationId`.
- R5.12 WHEN the user edits a report while an earlier mutation is in flight, THE SYSTEM SHALL keep the newer content and its `pending` status. An acknowledgement for the older mutation SHALL NOT mark the newer edit `synced`.

**Triage and maintenance**
- R7.1 WHEN an administrator or technician views incidents, THE SYSTEM SHALL list their organization's incidents, filtered by status and water point.
- R7.2 THE SYSTEM SHALL allow only the status transitions `new → triaged`, `triaged → in_progress`, and `in_progress → resolved`, and record who changed it and when.
- R7.3 Security rules SHALL reject any other transition, any status change by a reporter, and any change to fields other than `status`, `lastStatusChange`, `serverRevision`, and `updatedAt` during a status update.
- R8.1 WHEN a technician or administrator creates a maintenance task from an incident, THE SYSTEM SHALL link it by `incidentId` and `waterPointId`.
- R8.2 THE SYSTEM SHALL allow assignment to a technician in the same organization and status updates `open → in_progress → done`.

**Pattern analysis**
- R9.1 WHEN an administrator or technician requests analysis, THE SYSTEM SHALL run it in a Cloud Function using cloud AI.
- R9.2 THE SYSTEM SHALL validate the result with Zod before storing or displaying it.
- R9.3 WHEN fewer than 3 incidents match the scope, THE SYSTEM SHALL report insufficient data and make no model call.
- R9.4 THE SYSTEM SHALL present every insight as an *observation* (a pattern in the data) or a *hypothesis* (an unverified possible explanation). It SHALL NOT present a verified mechanical cause or diagnosis.
- R9.5 EVERY insight SHALL retain its supporting incident IDs, affected water-point IDs, analysis period, and stated limitations. Insights missing any of these are discarded.

**Demo data**
- R10.1 THE SYSTEM SHALL mark demo records with `demo: true` and show a visible "Demo data (fictional)" label wherever they appear.

**Localization readiness**
- R12.1 THE SYSTEM SHALL keep all user-facing text in one English strings module, so it can be localized later without code changes elsewhere.

## 2. User roles and permissions

Roles come from verified ID token claims set only by trusted Admin SDK code. The client cannot set them.

| Capability | Administrator | Technician | Reporter |
|---|---|---|---|
| Sign in, view own profile | Yes | Yes | Yes |
| Create users and set roles in own org | Yes (not own role) | No | No |
| View water points | Yes | Yes | Yes |
| Create and edit water points | Yes | Yes | No |
| Create incident | Yes | Yes | Yes |
| View incidents | All in org | All in org | Own only |
| Edit incident content | Own, while `new` | Own, while `new` | Own, while `new` |
| Change incident status | Yes | Yes | No |
| Create and update maintenance tasks | Yes | Yes | No |
| View maintenance tasks | All in org | All in org | No |
| Run and view pattern analysis | Yes | Yes | No |

All access is limited to the user's own `organizationId`. No role has cross-organization access.

## 7. Security and privacy requirements

- S1 Every business document includes `organizationId`, immutable after creation. Firestore rules are not filters: every client query must include the `organizationId` constraint (and, for reporters listing incidents, the `reporterId` constraint) that its rules require. Unscoped queries are denied.
- S2 Firestore rules default to deny and enforce organization isolation, the role table, and revision checks. Roles are never read from client-writable data.
- S3 Claims are set only by Admin SDK code: the bootstrap script and administrator-only Cloud Functions.
- S4 Pattern analysis runs only in a Cloud Function that enforces App Check, verifies auth, role, and organization, and validates input with Zod.
- S5 Firebase App Check is configured in the client and enforced for Firestore, Cloud Functions, and Firebase AI Logic (and Storage if T-S1 is built).
- S6 No server secrets, service account keys, or App Check debug tokens in frontend code, the repo, build output, or logs. `.env.example` contains placeholders only. Real `.env*` files are git-ignored.
- S7 AI prompts receive the minimum data needed. Reporter identity and contact details are never sent to AI.
- S8 Report text is treated as data, not as instructions to the AI.
- S9 Logs exclude tokens and personal data.
- S10 Demo data contains no real people, phone numbers, or real facility records.
- S11 IndexedDB records are scoped by organization and owner. A different user on the same device cannot see or sync them. IndexedDB is not encrypted; shared-device risk beyond this is out of scope for the MVP and is documented.
- S12 Security rules are covered by emulator tests per role, cross-organization denial, and stale-revision denial.

## 8. UI and screen requirements

General: mobile-first, responsive, accessible (semantic HTML, labeled controls, visible focus, keyboard use, status not conveyed by color alone, `aria-live` for async status). Every data view handles loading, empty, error, and offline states. A persistent connectivity and sync indicator is shown. A "Demo data (fictional)" banner appears when demo records are shown. All text comes from the strings module.

| Screen | Roles | Purpose |
|---|---|---|
| Sign in | All | Email and password. Clear error states. No sign-up link. |
| Home | All | Role-based. Reporter: new report, pending and conflict counts. Admin and technician: open incidents, open tasks, sync status. |
| Users | Admin | Create technician and reporter accounts, change roles of other users. |
| Water points list and detail | All view, admin and technician edit | Search, view, register and edit form. |
| New report | All | Water point picker, description, "Suggest fields", review panel with accept or edit per field, save. |
| My reports | All | Local and synced reports with status (`pending`, `syncing`, `synced`, `failed`, `conflict`), retry, edit if allowed. |
| Conflict review | Report owner | Server version beside the local edit. Actions: retry on latest version (if still allowed) or discard the local edit after confirmation. |
| Incident list and detail | Admin, technician | Filters, triage, AI-suggested versus confirmed values with provenance, create maintenance task. |
| Maintenance list and detail | Admin, technician | Task status, assignee, linked incident. |
| Pattern analysis | Admin, technician | Scope, run, insights labeled "Observation" or "Unverified hypothesis", each with incidents, water points, period, and limitations. |
| Sync status panel | All | Queue, last successful sync, errors, retry. |

## 11. Acceptance criteria

The MVP is accepted when all of the following hold on the demo dataset:

1. **AC1** Three seeded users (administrator, technician, reporter) in the fictional Kwale County organization sign in and see only what their role allows. No sign-up option exists.
2. **AC2** A user from a second fictional organization cannot read or write any record of the first (rules tests). Unscoped queries are denied and correctly scoped queries succeed for each role (rules tests). Every client query includes the `organizationId` filter (service tests).
3. **AC3** In a loaded app with the network disabled, a reporter creates a report. It appears as `pending` and stays after the app reconnects and reloads. (Reload while offline is not required.)
4. **AC4** On reconnect, the report syncs to exactly one Firestore document. A duplicated sync call and a retry after a lost acknowledgement produce no second write. Status becomes `synced` only after commit.
5. **AC5** A forced server failure leaves the report `failed` with content and error intact, and retry succeeds.
6. **AC6** A stale edit (server `serverRevision` ahead of the edit's `baseRevision`) is rejected by rules, marked `conflict`, kept unchanged, and not retried until the reporter reviews it.
7. **AC7** Extraction shows the SDK-reported `inferenceSource`. Invalid AI output is rejected and manual entry still works. With AI unavailable, reporting still works.
8. **AC8** A field the reporter edited is unchanged after re-running extraction.
9. **AC9** Extraction output contains no location, cause, or fact absent from the description (fixture set).
10. **AC10** An administrator triages an incident, creates a linked maintenance task, and moves it to `done`.
11. **AC11** Pattern analysis on demo data returns insights labeled observation or hypothesis, each with supporting incident IDs, affected water points, period, and limitations. No insight states a verified cause. Fewer than 3 incidents returns "insufficient data".
12. **AC12** The bootstrap script creates the first organization and administrator in the emulator, refuses a second run for the same organization, and refuses a mismatched project ID. No client or non-admin can set claims, and an administrator cannot change their own role.
13. **AC13** After user A signs out and user B signs in on the same browser, B sees none of A's local reports, and A's unsynced reports are still present and sync when A signs in again.
14. **AC14** `.env.example` has placeholders only. The production build contains no App Check debug token setting. `git status` shows no `.env` files tracked.
15. **AC15** `npm run lint`, `npm run build`, `npm test`, rules tests, functions tests, and the Playwright offline flow pass.
16. **AC16** The app is deployed to Firebase Hosting with App Check enforced, and the main flows pass an accessibility check at 360px and 1280px widths.
17. **AC17 Sync race.** If a report is edited while an earlier mutation is in flight, the older acknowledgement does not mark it `synced`. The newer content stays `pending`, then syncs, and the server ends with the newer content and one document.
18. **AC18 Permission-denied classification.** A `permission-denied` caused by a stale revision or a status past `new` is marked `conflict`. A `permission-denied` caused by changed claims, a different organization, or failed field validation is marked `failed` with reason "permission denied". Local content is unchanged in both cases.
19. **AC19 Status transitions.** Rules allow exactly `new → triaged`, `triaged → in_progress`, `in_progress → resolved` by administrators and technicians. They deny skipped, reversed, and same-status transitions, any reporter status change, and any other field change in a status update.
20. **AC20 Bootstrap recovery.** For each partial state in the design's "Partial states" table, the script either resumes to a complete state with exactly one administrator, or refuses with instructions. Cleanup removes only bootstrap-created data after confirmation. Users of an incomplete organization cannot read business data. No password or token appears in output or logs except the single printed reset link.
