# MajiPulse MVP: Design

Status: REVISION 4. All decisions D1 to D7 approved (see "Decision record"). Revision 4 adds uncertain-commit reconciliation, AI privacy preprocessing, and the bootstrap existing-user guard. Implementation not started.
**[verified]** = checked against current docs. **[verify]** = must be checked before the task that uses it.

## 3. System architecture

```
Browser (React + Vite + Tailwind + React Router + Zustand)
 ├─ pages / components        UI only, text from src/strings/en.ts
 ├─ stores (Zustand)          call services, hold UI state, reset on user change
 ├─ services/offline          IndexedDB (idb): incidents outbox, water point cache, meta
 ├─ services/sync             outbox processor, Firestore transactions
 ├─ services/ai               Firebase AI Logic extraction + Zod validation
 ├─ services/firebase         App, Auth, Firestore, Functions client, App Check init
 └─ schemas                   Zod schemas shared across layers
Firebase
 ├─ Authentication            email and password, no public sign-up
 ├─ Firestore                 org-scoped data, rules enforce isolation, revisions, transitions
 ├─ App Check                 enforced for Firestore, Functions, AI Logic
 ├─ Hosting                   SPA
 └─ Cloud Functions 2nd gen   createOrgUser, setUserRole, analyzeIncidentPatterns
functions/scripts             bootstrap-first-admin (operator-run, Admin SDK, never deployed)
```

Folders under `src/`: `components/`, `pages/`, `routes/`, `stores/`, `schemas/`, `strings/`, `services/{firebase,ai,offline,sync}/`, `lib/`. `functions/` is a separate TypeScript package. `shared/` at the repo root holds dependency-free code used by both (currently the privacy redactor).

Route guards are UX only. Rules and functions enforce access.

**Localization (D6):** All user-facing text lives in `src/strings/en.ts` as a typed object. No i18n library in the MVP.

**Offline boundary (D2):** No service worker in the MVP. Offline reporting works after the app has loaded online. Reloading or first-opening the app offline fails. This is stated in the UI help text and README.

## 4. Firestore data model

Every business document has `organizationId` (immutable) and `demo` (boolean). Server timestamps unless stated.

### Query security
Firestore rules are not filters. Firestore rejects a query if any document it *could* return would fail the read rule; it does not silently drop those documents. Therefore:
- Every client list query includes `where('organizationId', '==', session.organizationId)`, plus any further constraint the rule depends on (for reporters listing incidents: `where('reporterId', '==', uid)`).
- All queries are built by `orgScopedQuery(collection, scope, ...constraints)`. Services cannot construct a raw collection query.
- Rules require `resource.data.organizationId == token.organizationId` on every read, so an unscoped query is denied.
- Rules tests cover both: unscoped (and reporter queries without `reporterId`) denied; correctly scoped queries succeed.

### `organizations/{organizationId}` (Admin SDK write only)
`name`, `county`, `demo`, `createdAt`, `createdBy`, `bootstrap: { status: 'in_progress' | 'complete', adminUid?, startedAt, completedAt? }`.

### `members/{uid}` (Admin SDK write only)
`organizationId`, `role` (`administrator | technician | reporter`), `email`, `displayName`, `active`, `createdAt`, `updatedAt`.
Mirrors the custom claims `{ organizationId, role }`. Claims are the authority for rules. Clients read their own document (admins read their org's members) and never write.

### `waterPoints/{waterPointId}`
`organizationId`, `name`, `type` (`borehole | handpump | kiosk | tap | other`), `locationDescription`, `ward` (optional), `status` (`working | needs_repair | not_working | unknown`), `demo`, `createdBy`, `createdAt`, `updatedAt`. No coordinates.

### `incidents/{incidentId}` (ID = client-generated UUID)
- Identity: `organizationId`, `waterPointId`, `reporterId`, `demo`.
- Reporter-confirmed content: `description` (max 2000), `incidentType` (`no_water | low_flow | leak | water_quality_concern | pump_or_equipment_issue | other`), `severity` (`low | medium | high | null`), `occurredAt` (optional ISO), `locationNote` (optional).
- `status`: `new | triaged | in_progress | resolved`. `lastStatusChange: { by, at, from, to }`.
- Revision fields (section 6): `serverRevision`, `baseRevision`, `clientRevision`, `mutationId`.
- `clientCreatedAt` (ISO), `createdAt`, `updatedAt`.
- `ai` (optional): `{ suggested: {...nullable fields}, inferenceSource: 'ON_DEVICE' | 'IN_CLOUD', model, generatedAt }`. Stored only after validation.
- `confirmedFields`: field names the reporter accepted or edited.

### `maintenanceTasks/{taskId}`
`organizationId`, `waterPointId`, `incidentId` (nullable), `title`, `notes`, `status` (`open | in_progress | done`), `assigneeId` (nullable, same org), `createdBy`, `createdAt`, `updatedAt`, `demo`.

### `patternAnalyses/{analysisId}` (function write only)
- `organizationId`, `requestedBy`, `createdAt`, `demo`, `model`.
- `period: { from, to }`, `scope: { waterPointId? }`, `analyzedIncidentIds`, `analyzedIncidentCount`.
- `insufficientData` (boolean), `limitations` (string[], min 1).
- `insights[]`: `{ kind: 'observation' | 'hypothesis', title, statement, supportingIncidentIds (min 1, subset of analyzed), affectedWaterPointIds (min 1, linked to the cited incidents), period: { from, to } (within analysis period), limitations (string[], min 1), confidence: 'low' | 'medium' | 'high' }`.
- No `cause` or `diagnosis` field exists.

### Local IndexedDB (database `majipulse`, versioned)
- `incidents`: key `[organizationId, ownerUid, incidentId]`. Value: incident fields plus `syncStatus` (`pending | syncing | synced | failed | conflict`), `failureKind` (`network | permission_denied | validation | unknown`, when `failed`), `lastError`, `lastAttemptAt`, `syncedAt`, `inFlight` (`{ mutationId, baseRevision, startedAt }`, set when a mutation is submitted and kept until its outcome is known, see section 6), `conflictServerSnapshot` (when `conflict`).
- `waterPointsCache`: key `[organizationId, waterPointId]`, with `cachedAt`.
- `meta`: schema version, last sync time per `[organizationId, ownerUid]`.

All access goes through a repository constructed with a `SessionScope { organizationId, ownerUid }` from verified claims. There is no unscoped read API.

## 5. Hybrid AI workflows

### Privacy preprocessing (applies to both workflows)
Omitting `reporterId` does not keep personal information away from AI, because reporters can type names, phone numbers, or ID numbers into the description. Every free-text value goes through a redaction step before any model sees it. Redaction is best-effort, and the design does not claim it catches everything.

**Redactor:** `shared/privacy/redact.ts`, a dependency-free TypeScript module used by both `src/services/ai` and `functions/src` (the functions build includes `../shared`) **[verify build wiring in T6.2]**. Shared fixtures: `shared/privacy/fixtures.json`, run by both test suites.
- Input: text. Output: `{ text, findings: [{ kind, start, end }] }`. Original values are never stored, returned to callers outside the module, or logged. Only counts per kind may be logged.
- Placeholders: `[PHONE]`, `[EMAIL]`, `[ID]`, `[NAME]`, `[NUMBER]`.

| Kind | Detection |
|---|---|
| Phone (Kenya) | Prefix `+254`, `254`, `(+254)`, or `0`, then a `7` or `1` mobile prefix and 8 more digits. Spaces, dashes, dots, and parentheses allowed between digit groups. Examples: `0712345678`, `0712 345 678`, `0712-345-678`, `+254712345678`, `+254 712 345 678`, `254712345678`, `(+254) 712 345678`, `0110 123 456`, `+254 110 123 456` |
| Other long numbers | 9 or more digits in total, either unbroken or split into groups of 3 or more digits by single spaces or dashes, not already matched. Redacted as `[NUMBER]` (over-redaction is accepted). Dates and times such as `2026-03-12 10:30` or `12/03/2026` do not match because their groups are shorter than 3 digits |
| Email | Standard `local@domain.tld`, plus spelled-out forms like `name at gmail dot com` |
| Explicit identifiers | A number or 1 to 3 following words after cue phrases, case-insensitive, in English and Swahili: `my name is`, `name:`, `I am called`, `call me`, `contact`, `jina langu ni`, `naitwa`, `ID`, `ID no`, `ID number`, `national ID`, `kitambulisho`, `passport`. ID numbers of 7 to 8 digits are redacted only after an ID cue |
| Titled names | `Mr`, `Mrs`, `Ms`, `Dr`, `Mzee`, `Mama`, `Baba` followed by one or two capitalized words |

**Known gaps (not reliably detectable):** names without a cue or title, nicknames, household descriptions ("the widow near the school"), and addresses. These are handled by the reporter warning below, not by detection.

**Model contract:** The prompt says placeholders mark removed personal information that must not be guessed, restored, or repeated. Output validation drops any AI field or insight containing a placeholder or matching a redactor detector.

**Client step (before extraction):**
1. The description field shows help text: "Describe the problem only. Do not include names, phone numbers, or ID numbers."
2. When the reporter presses "Suggest fields", the app shows a preview titled "Text that will be sent for AI suggestions". It contains the redacted text with removed parts marked, and a notice that names and other details may not be detected automatically.
3. Actions: "Send", "Edit description first" (returns focus to the description, then the preview is rebuilt), "Cancel" (no AI call, manual entry continues).
4. Redaction always applies, including when on-device inference is expected, because `PREFER_ON_DEVICE` can fall back to the cloud and the source is known only after the call.
5. Grounding checks run against the redacted text.

**Server step (pattern analysis):** The function redacts every description, truncates each to 500 characters, and excludes `locationNote`. Stored analyses never contain descriptions.

**Stored data:** The saved incident keeps the reporter's original description, which members of the organization can read under the role table. Redaction only governs what is sent to AI.

### A. Individual incident extraction (client, Firebase AI Logic, D7) [verified]
Verified API facts (Firebase AI Logic hybrid web docs):
- `getAI(app, { backend: new GoogleAIBackend() })` and `getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE })` from `firebase/ai`. Cloud model overridable with `inCloudParams`.
- `model.initializeDeviceModel()` must be called on or after a user interaction and before the request. In `PREFER_ON_DEVICE`, requests made before the model has downloaded fall back to cloud.
- `result.response.inferenceSource` returns `ON_DEVICE` or `IN_CLOUD` (SDK 12.5.0+; installed is 13.3.0).
- On-device inference requires Chrome desktop 139+ with the Prompt API flag enabled. Elsewhere the cloud model is used. Structured output (JSON) is supported on-device.
- The AI Logic console setup enforces App Check for AI Logic.

Flow:
1. Reporter presses "Suggest fields". The app shows the privacy preview (above). On "Send", the click handler calls `initializeDeviceModel()` and then sends the request. (The "Send" click is the user activation the device model needs.)
2. The prompt includes only the **redacted** description and the water-point name, inside a delimited data block. Instructions: extract only stated facts, use null when unstated, never infer causes or locations, never restore placeholders.
3. Request a JSON response schema **[verify exact structured-output config for hybrid in T6.1]**.
4. Store `response.inferenceSource` exactly as returned.
5. Parse with Zod. Reject malformed JSON, unknown enums, overlong strings. Strip extra keys.
6. Grounding check: extracted location or time text must appear in the description (normalized substring), otherwise it is dropped.
7. Show proposals. Accepted or edited fields go into `confirmedFields`.
8. Re-running extraction fills only fields not in `confirmedFields`.
9. Any failure, or a 15-second timeout, shows "AI suggestions unavailable" and leaves the manual form usable.

Without on-device support and without network, AI is unavailable. Reporting continues.

### B. Cross-incident pattern analysis (Cloud Function, D3)
1. Admin or technician picks a period and optional water point.
2. Client calls the `analyzeIncidentPatterns` callable.
3. Function (`onCall` with `enforceAppCheck: true`) checks auth, role claim, and organization, and validates input with Zod.
4. Reads the organization's incidents in scope. Fewer than 3 stores and returns `insufficientData: true`, no model call.
5. Sends minimized data: incident IDs, types, severity, dates, water-point IDs and names, and **redacted, truncated** descriptions. Structured identity fields (`reporterId`, `createdBy`, member data) and `locationNote` are not sent. Free text may still contain personal information the redactor missed.
6. Model call via `@google/genai` in Vertex mode, behind a `PatternModel` adapter interface so tests can inject a fake. **[verify: client options (`enterprise: true` or `vertexai: true`, `project`, `location`), structured-output config, service-account IAM role, model availability in the function's region]**.
7. Zod validation, then filters: drop insights containing a placeholder or matching a redactor detector, drop insights citing incidents outside the analyzed set, water points not linked to the cited incidents, periods outside the analysis period, or no limitations. Drop insights whose statement asserts a confirmed cause (fixture-tested phrases such as "confirmed", "the cause is", "diagnosed"). Analysis-level limitations always include the sample size.
8. Store in `patternAnalyses` and return.

UI labels: "Observation" for patterns in data. "Unverified hypothesis: requires inspection by a technician" for hypotheses.

## 6. Offline-first synchronization design (D1)

IndexedDB is the authoritative outbox. Firestore incidents are written only through transactions, only while online. The app does not rely on the Firestore SDK's offline write queue for incidents, because a queued write can look complete before the server has it.

### Revision fields
| Field | Where | Meaning |
|---|---|---|
| `clientRevision` | Local and server | Local edit counter. Starts at 1, +1 on each local save. |
| `baseRevision` | Local and server | The `serverRevision` the local edit is based on. 0 for a new report. |
| `serverRevision` | Server (copied locally after sync) | Accepted writes on the server. 1 after create, +1 per accepted update. |
| `mutationId` | Local and server | UUID generated on each local save. Identifies one specific write. |

### Stable mutation snapshots
1. When the engine picks a record, it reads it from IndexedDB and builds an immutable **snapshot**: the document payload plus `mutationId`, `baseRevision`, `clientRevision`. In the same IndexedDB transaction it writes `syncStatus: syncing` and `inFlight = { mutationId, baseRevision, startedAt }` from the snapshot.
2. The Firestore transaction uses only the snapshot, never the live local record.
3. A user may edit the record at any time, including while `syncing`. Each edit generates a new `mutationId`, increments `clientRevision`, and keeps `baseRevision` unchanged. Edits never touch `inFlight`.
4. On a **confirmed acknowledgement** (commit resolved, or step 4 of "Sync of one record"), the engine updates IndexedDB in one transaction that first re-reads the record. The committed revision is `inFlight.baseRevision + 1`.
   - If `record.mutationId == inFlight.mutationId`: mark `synced`, set `serverRevision` and `baseRevision` to the committed revision, clear `inFlight`.
   - If they differ (the user edited during sync): **do not mark synced**. Set `baseRevision` to the committed revision, keep the newer content, set `syncStatus: pending`, clear `inFlight`. The newer edit syncs next.
5. On any **failure or uncertain outcome** (error, timeout, page closed, lost acknowledgement), the engine **keeps `inFlight` unchanged** and does not assume the mutation failed. Status and error are updated, content is never replaced. The outcome is resolved by reconciliation before anything else is submitted.

### Uncertain commits and reconciliation
A commit can succeed on the server while the client sees an error or nothing at all. Example: mutation A commits, the user then edits (mutation B), and A's acknowledgement is lost. B's `baseRevision` still refers to the revision before A. Without reconciliation, B would look stale and be wrongly marked `conflict`.

Rule: **a record with `inFlight` set must be reconciled before its current content is submitted.** Reconciliation runs inside the next sync transaction for that record, after it reads the server document, and also after a `permission-denied` (see below). It compares the server document with `inFlight`:

| Server document | Meaning | Action |
|---|---|---|
| `server.mutationId == inFlight.mutationId` | A committed (later status changes may have advanced `serverRevision`) | Committed revision is `inFlight.baseRevision + 1`. Set local `baseRevision` to it. Clear `inFlight`. If `record.mutationId == inFlight.mutationId`, mark `synced`; otherwise continue in the same transaction to submit B from the new base |
| Missing and `inFlight.baseRevision == 0`, or `server.serverRevision == inFlight.baseRevision` | A did not commit | Clear `inFlight`. Continue to submit the current content from the unchanged `baseRevision` |
| Anything else (`server.mutationId` is neither A nor absent, and `serverRevision` is past `inFlight.baseRevision`) | A different content write is now on the server, whether or not A committed before it | Genuine conflict for the current content. Clear `inFlight` (the server state supersedes A either way), mark `conflict`, store `conflictServerSnapshot`. Local content is unchanged |
| Server cannot be read (offline, network error, read denied) | Outcome unknown | Keep `inFlight`. Mark `failed` with the relevant `failureKind`. Submit nothing. Retry reconciliation later |

Why this is safe:
- A's committed revision is deterministic: rules only accept A if `serverRevision` was `inFlight.baseRevision` and becomes `+1`.
- Status updates by administrators and technicians do not change `mutationId`, so `server.mutationId == A` still proves A committed even after triage. B then correctly conflicts, because the server revision is past A's.
- Firestore transactions use optimistic concurrency. If a delayed commit of A lands after B's transaction read the document, B's commit fails and the transaction re-runs, rereads, and reconciles again. At most one of A and B is applied from the same base.
- The engine never creates a new `inFlight` while one is unresolved, so at most one uncertain mutation exists per record.

### Rules enforcement (authoritative)
Helpers: `isMember()` (claims present and `members/{uid}` exists, is active, and matches the claims' org and role; one `get()` per request, which counts as a billed read), `sameOrg()`, `role()`, `isOwner()`, `onlyChanged(keys)` using `request.resource.data.diff(resource.data).affectedKeys().hasOnly(keys)`. Every business-data rule starts with `isMember()`.

- **Read:** `sameOrg()` and (role is administrator or technician, or `isOwner()`). For a `get` on a document that does not exist yet (the transaction's first read of a new report), allow when `resource == null` and `isMember()`. This reveals only that a random UUID is unused. **[verify behavior with rules tests]**
- **Create:** `serverRevision == 1`, `baseRevision == 0`, `organizationId == token.organizationId`, `reporterId == auth.uid`, `status == 'new'`, field types and sizes valid.
- **Reporter content update:** owner, `resource.status == 'new'`, `request.resource.baseRevision == resource.serverRevision`, `request.resource.serverRevision == resource.serverRevision + 1`, unchanged `organizationId`, `reporterId`, `status`, `lastStatusChange`, `createdAt`.
- **Status update (administrator or technician only):** same org, `onlyChanged(['status', 'lastStatusChange', 'serverRevision', 'updatedAt'])`, `serverRevision` +1, `lastStatusChange.by == auth.uid`, `lastStatusChange.from == resource.status`, `lastStatusChange.to == request.resource.status`, and the transition is one of exactly:
  - `new → triaged`
  - `triaged → in_progress`
  - `in_progress → resolved`
- Rejected: any other transition (skips, reversals, same-status writes, unknown values), any status change by a reporter, any change to content, `organizationId`, `reporterId`, `ai`, or `confirmedFields` in a status update.

### Sync of one record
1. Skip if offline.
2. Transaction reads `incidents/{id}`.
3. If the record has an unresolved `inFlight`, reconcile first (table above). This may advance the base or end the run.
4. If the record has no `inFlight`, build the snapshot (above) and set `inFlight`. Server `mutationId == snapshot.mutationId`: already applied. No write, go to step 8.
5. Server missing and `snapshot.baseRevision == 0`: create with `serverRevision = 1`.
6. Server `serverRevision == snapshot.baseRevision` and server status `new`: update with `serverRevision + 1`.
7. Otherwise: stale. Abort, store the server document as `conflictServerSnapshot`, mark `conflict`, clear `inFlight` (this snapshot was never written).
8. Confirmed commit, or step 4: apply the acknowledgement rule from "Stable mutation snapshots". Any other outcome follows rule 5 there (keep `inFlight`).

### Error classification
| Error | Result |
|---|---|
| Network, `unavailable`, `deadline-exceeded` | `failed`, `failureKind: network`, auto-retry with backoff |
| `permission-denied` | Run the follow-up check below |
| Local Zod validation failure | `failed`, `failureKind: validation`, no auto-retry |
| Anything else | `failed`, `failureKind: unknown`, manual retry |

**`permission-denied` follow-up check.** A `permission-denied` response does not say which rule condition failed. After one:
1. If the session is still valid (refresh the ID token with `getIdToken(true)` and confirm the claims still match the record's `organizationId`), do a plain `getDoc` of the incident. If the read fails, keep `inFlight` and mark `failed`.
1a. If the record has `inFlight`, reconcile first using the table above. If that shows the in-flight mutation committed, advance `baseRevision` and set the record back to `pending` (it is not a conflict). Then evaluate step 2 against the updated base.
2. Classify as **`conflict`** only when the server document shows the edit is stale or invalidated:
   - `server.serverRevision != snapshot.baseRevision`, or
   - `server.status != 'new'` (edits no longer allowed).
   Store the server document as `conflictServerSnapshot`.
3. Otherwise classify as **`failed`** with `failureKind: permission_denied`, no auto-retry. This covers: claims changed or removed, organization mismatch, the follow-up read itself denied, a missing document for an update, or a server state that matches the snapshot (meaning another rule failed, for example field validation).
4. If the claims show a different organization than the record, mark `failed` / `permission_denied` with the message "Organization changed. Contact your administrator."
5. This check never writes to IndexedDB content fields. Only status, error, and `conflictServerSnapshot` change.

Locking: single-flight per tab. Across tabs, use the Web Locks API (`navigator.locks`) when available, otherwise per-tab only **[verify browser support]**. At startup, records still `syncing` reset to `pending` and **keep `inFlight`**, so the next run reconciles before submitting. `inFlight` is cleared only by a confirmed acknowledgement or a reconciliation that determined the outcome.

### Conflict handling
- The local edit is kept unchanged. No automatic retry for `conflict`.
- The conflict review screen shows both versions:
  - **Retry on latest:** only if server status is still `new`. Sets `baseRevision` to the server's `serverRevision`, new `mutationId`, clears `inFlight`, back to `pending`.
  - **Discard my edit:** requires confirmation. Replaces the local record with the server version.
- If the server status is past `new`, only discard is offered. The local edit stays visible as "not submitted" until discarded.

### Scoping and account switching
- The engine processes only records matching the current `SessionScope`.
- On sign-out or user change: stop sync, reset all Zustand stores, drop the repository instance. IndexedDB data is not deleted.

### Status display
Each report shows one of `pending`, `syncing`, `synced`, `failed` (with reason by `failureKind`), `conflict` (needs review). A global indicator shows counts and last successful sync time. Text and icons, not color alone.

## Provisioning (D5)

### First organization and administrator: operator-run bootstrap
`functions/scripts/bootstrap-first-admin.ts`, run by the project owner from their machine. Never deployed, never callable from the app.
- Credentials: Application Default Credentials (`gcloud auth application-default login`) or emulators. No service account key files.
- Arguments: `--project <id>`, `--confirm-project <id>` (must match), `--org-id`, `--org-name`, `--email`. Optional `--emulator`, `--resume`, `--cleanup`.

**Existing-user guard.** Multi-organization membership is out of scope, and `setCustomUserClaims` replaces the user's whole custom-claims map **[verify]**. So before any write, if an Auth user already exists for `--email`, the script reads its `customClaims` and `members/{uid}` and **refuses** if either:
- `members/{uid}` exists (for any organization), or
- `customClaims` is non-empty (organization claims for any organization, or unrelated claims such as `{ beta: true }`).

The refusal message names which check failed, prints no claim values beyond their keys, and changes nothing. The only exception is **bootstrap resume** for the same organization (below), which is the single authorized recovery procedure. Anything else needs a manual, documented operator decision outside the script.

**Steps (each idempotent, safe to repeat):**
1. Preflight: project IDs match. Read `organizations/{orgId}`. Query `members` for `organizationId == orgId` and `role == administrator`. Run the existing-user guard if the email already has an Auth user.
   - If an administrator member exists and `bootstrap.status == complete`: stop with "Organization already bootstrapped."
   - If `bootstrap.status == in_progress`: stop and tell the operator to rerun with `--resume` (or `--cleanup`).
2. Create `organizations/{orgId}` with `bootstrap: { status: in_progress, startedAt }` in a transaction that fails if the document exists.
3. Look up the Auth user by email. Create it if missing (no password set). Record `bootstrap.adminUid` and `bootstrap.userCreatedByBootstrap` (true or false).
4. Re-read the user's claims immediately before writing. If they are not empty (or, on resume, not exactly the expected map), stop. Otherwise set custom claims `{ organizationId, role: 'administrator' }` **[verify `setCustomUserClaims`]**.
5. Write `members/{uid}` in a transaction that fails if the document exists with different content.
6. Set `bootstrap.status = complete`, `completedAt`.
7. Generate a password-reset link **[verify `generatePasswordResetLink`]** and print it to the terminal only.

**Resume (`--resume`):** requires `bootstrap.status == in_progress` and is the only path allowed to touch a user with existing claims or a member document. It accepts the user only if all of these hold:
- the user's UID equals `bootstrap.adminUid` (if `adminUid` is not yet recorded, the user must pass the existing-user guard as a new bootstrap would);
- `customClaims` is empty or exactly `{ organizationId: orgId, role: 'administrator' }`, with no other keys;
- `members/{uid}` is missing or matches this organization and role.

It then re-runs steps 3 to 7. If any check fails, it stops without changes. If `bootstrap.adminUid` differs from the user found by email, it stops (prevents a second administrator).

**Cleanup (`--cleanup`):** requires `bootstrap.status == in_progress` and no other members in the organization. Removes claims set by this bootstrap (only if they are exactly the expected map), deletes `members/{adminUid}` if it matches this organization, and deletes the organization document. Never deletes an Auth user that predates the bootstrap. Requires typing the org ID to confirm.

**Partial states and handling**
| State found | Cause | Handling |
|---|---|---|
| Org `in_progress`, no Auth user | Failed at step 3 | `--resume` |
| Org `in_progress`, user without claims | Failed at step 4 | `--resume` |
| Org `in_progress`, claims set, no member doc | Failed at step 5 | `--resume` |
| Org `in_progress`, everything present | Failed at step 6 | `--resume` marks complete |
| Org document missing, user has admin claims for it | Manual change or old run | Stop. Operator removes the claims (instructions printed) and reruns |
| Email belongs to a user with `members/{uid}` in another org | Existing member elsewhere | Refuse, nothing changed. Use a different email |
| Email belongs to a user with any existing claims (org or unrelated) and not this bootstrap's `adminUid` | Existing account | Refuse, nothing changed |
| Org `in_progress`, `adminUid` user has claims for another org or extra keys | Changed outside the script | Resume refuses. Operator decides manually |
| Org `complete` | Done | Refuse |

Cleanup removes claims only if they are exactly the map this bootstrap set, and deletes the Auth user only if `bootstrap.userCreatedByBootstrap` is true and the operator confirms it separately.

**Credential safety:** never accepts or prints passwords, never writes links or tokens to files or logs, prints the reset link once to stdout. The organization in `bootstrap.status: in_progress` is not usable: rules require a matching `members` document and claims, and the app shows "Organization setup incomplete" for such users.

### Later users: administrator-only Cloud Functions
- `createOrgUser` (administrator only, App Check enforced): creates a technician or reporter in the caller's organization, sets claims, writes `members`, returns a password-reset link. Cannot create administrators in the MVP. Refuses if the email already has an Auth user, so it never takes over or re-claims an existing account.
- `setUserRole` (administrator only): changes the role of another member of the same organization. Rejects `targetUid == caller uid`. Rejects targets whose current claims contain keys other than `organizationId` and `role`, or whose `organizationId` differs from the caller's, so unrelated claims are never silently dropped.
- The client calls `getIdToken(true)` after its own claims may have changed (sign-in, and on `permission-denied`).

## 9. Testing strategy

| Layer | Tool | Covers |
|---|---|---|
| Unit | Vitest | Zod schemas, AI validation and grounding, `confirmedFields` merge, revision logic, snapshot and acknowledgement rule, error classification, insight filters, strings completeness |
| Component | Vitest + Testing Library + jsdom | UI states, forms, review panel, sync and conflict UI |
| Offline storage | Vitest + fake-indexeddb | Save before network, scoping, account switching, crash recovery |
| Sync | Vitest with fake Firestore adapter, plus emulator tests | Duplicate trigger, lost acknowledgement, edit-during-sync race, uncertain commit then newer edit, unreadable server during reconciliation, stale detection, permission-denied classification, offline skip |
| Privacy | Vitest, shared fixtures run in both `src` and `functions` | Kenyan phone formats, emails, cue-phrase identifiers, titled names, long numbers, no false redaction of normal text, placeholder echo rejection, preview UI |
| Rules | `@firebase/rules-unit-testing` + Firestore emulator | Each role, cross-org denial, unscoped query denial and scoped query success, revision checks, status transitions (positive and negative), field-change limits, no client claims or member writes |
| Functions and scripts | Vitest + Functions, Auth, Firestore emulators, mocked model adapter | Bootstrap, existing-user guard, resume, cleanup, partial-state handling, `createOrgUser`, `setUserRole`, analysis checks, redaction before the model call, insight filters |
| E2E | Playwright | Sign in, offline report in loaded app, reconnect sync, failure and retry, conflict review, AI unavailable, account switching, role navigation |
| Build checks | Script | `dist/` contains no `FIREBASE_APPCHECK_DEBUG_TOKEN`; no `.env` files tracked |
| Accessibility | Playwright + manual checklist | Keyboard, labels, focus, contrast at 360px and 1280px |

Model calls are mocked in automated tests. Real model calls are manual smoke tests.

## 10. Deployment strategy

- Environments: local emulators and one demo Firebase project.
- **Billing [verified]:** Deploying Cloud Functions requires the Blaze plan (emulators do not). Vertex AI requires billing. Firebase AI Logic with the Gemini Developer API works on Spark or Blaze. The demo project must be on Blaze. Set a budget alert.
- Hosting: `vite build` to `dist/`, SPA rewrite.
- Functions: 2nd gen, Node.js 22 **[verify supported runtimes]**, region chosen where the Vertex model is available **[verify]**.
- Rules and indexes deployed from the repo.
- **Config and secrets:** Firebase web config through `VITE_*` variables. `.env.example` has placeholder values only. Real values in `.env.local` (git-ignored). The App Check debug token goes only in `.env.development.local` and is read only under `import.meta.env.DEV`. A build check fails if it appears in `dist/`.
- `.gitignore` adds: `.env`, `.env.*`, `!.env.example`, `*-service-account*.json`, `firebase-debug*.log`, `firestore-debug*.log`, `ui-debug*.log`, `.firebase/`.
- **App Check [partly verified]:** reCAPTCHA provider for web **[verify v3 versus Enterprise]**. Debug provider via `self.FIREBASE_APPCHECK_DEBUG_TOKEN` in development only. Enforce for AI Logic (console setup), Firestore, and Functions (`enforceAppCheck: true`) after confirming the app works with tokens.
- Seed and bootstrap scripts require explicit project confirmation.
- Release: lint, build, build checks, unit, rules, functions, E2E, deploy, smoke test the AC list. Roll back by redeploying the previous Hosting release.

## Decision record

| ID | Decision | Status |
|---|---|---|
| D1 | IndexedDB outbox, Firestore transaction-based sync with revision checks in rules | Approved |
| D2 | No service worker. Offline reporting after the app has loaded online. Offline cold start is stretch T-S2 | Approved |
| D3 | `@google/genai` with Vertex AI (Gemini Enterprise Agent Platform) in a 2nd gen callable Cloud Function | Approved. SDK options, auth, IAM, structured output, regional availability remain **[verify]** in T8.1 |
| D4 | `fake-indexeddb`, `@firebase/rules-unit-testing` (6.x, for firebase 13), `firebase-tools`, `jsdom` as dev dependencies | Approved, installed |
| D5 | Operator-run Admin SDK bootstrap for the first administrator. Administrator-only Cloud Functions for later users. No self-registration | Approved |
| D6 | English only, centralized strings module | Approved |
| D7 | Gemini Developer API through Firebase AI Logic (`GoogleAIBackend`) for individual extraction | Approved |

### D3 comparison (kept for reference)
| Criterion | A. `@google/genai` + Vertex AI (chosen) | B. Genkit + `onCallGenkit` |
|---|---|---|
| Complexity | One SDK, one call inside a normal `onCall` | Framework concepts (flows, plugins), CLI and Developer UI |
| Auth and IAM | Function service account via ADC, needs a Vertex role **[verify]**. No API key | API key in Secret Manager (Google AI plugin) or ADC (Vertex plugin) |
| Firebase integration | `onCall` with `enforceAppCheck`, claims, Admin SDK | `onCallGenkit` with the same options plus `authPolicy` |
| Billing | Blaze plus Vertex AI billing | Same Blaze requirement |
| Structured output and Zod | JSON response schema **[verify]**, our Zod 4 validation | Native Zod output, Zod 4 compatibility unverified |
| Deployment | `firebase deploy --only functions`, Vertex API and IAM | Same, plus secret or IAM setup |
| Emulator testing | Functions emulator, injected model adapter | Same. Developer UI helps manual testing only |
