# MajiPulse Security

## Tenant isolation
- Every business record includes `organizationId`.
- Enforce organization-level isolation in Firestore and Storage rules, not only in client code.
- Storage paths include `organizationId`, and rules check it.
- Rules must prevent changing `organizationId` after creation.

## Roles and identity
- Do not trust client-supplied roles or `organizationId` values.
- Roles and organization live in custom claims `{ organizationId, role }`, mirrored in server-written `members/{uid}`. Only Admin SDK code sets them, in two ways:
  - **Operator-run bootstrap script** (`functions/scripts/bootstrap-first-admin.ts`): creates the first organization and administrator. Run by the project owner with their own Application Default Credentials or against emulators. Never deployed, never callable from the app, no service account key files.
  - **Administrator-only Cloud Functions** (`createOrgUser`, `setUserRole`): all later user management, limited to the caller's organization. A user can never change their own role or grant themselves administrator.
- No public self-registration.
- Rules and functions read the role from the verified ID token.
- Reporter, technician, and administrator permissions must be tested separately.

## Security rules
- Default deny. Allow only the specific operations each role needs.
- Validate field types, required fields, and size limits in rules.
- Restrict Storage uploads by content type and size.
- Rules are not filters. Rules must deny list queries without the `organizationId` constraint, and clients must always include it.
- Rules enforce incident status transitions (`new → triaged → in_progress → resolved` only) and revision checks.
- Write rules tests (Firebase emulator, `@firebase/rules-unit-testing`) covering cross-organization denial, unscoped query denial, and scoped query success.

## Backend
- Privileged operations run in Cloud Functions: role changes, cross-incident AI analysis, and administrative actions.
- Verify the caller's authentication and organization in every function. Validate input with Zod.
- Enforce App Check in functions that support it.

## App Check
- Configure Firebase App Check in the client and enforce it for Firestore, Storage, AI Logic, and Functions.
- Use the debug provider only in local development, never in production builds.

## Secrets
- Never put server secrets, service account keys, or private API keys in frontend code, the repo, or logs.
- Use environment variables for client config, and Secret Manager or function config for server secrets.
- Firebase web config values are identifiers, not secrets. Security comes from rules and App Check.
- Keep `.env*` files out of git, except `.env.example`, which holds placeholders only.
- App Check debug tokens live only in `.env.development.local` and are read only under `import.meta.env.DEV`. Production builds must not contain them.

## Data handling
- Validate all input at trust boundaries (forms, IndexedDB, AI output, function requests) with Zod.
- Do not log tokens or personal data.
- Demo data is fictional Kwale County data and must be labeled as such.
