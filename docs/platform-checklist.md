# Platform checklist (TP.1)

Console setup for the demo project. You complete these items (TP.2); deployment (T9.4) waits for them. Each item says what the app expects. The facts were checked against the docs listed at the end, some in earlier phases (see `design.md` and `docs/ai-logic-notes.md`), the rest on 2026-11-19. Content from those docs was rephrased.

Project: `majipulse-4575c` (alias `majipulse` in `.firebaserc`). Firebase web config values and the project ID are identifiers, not secrets.

## 1. Billing and budget

- [ ] Project is on the **Blaze** plan. Deploying Cloud Functions needs it, and Vertex AI (pattern analysis) needs a billing account. The emulators do not.
- [ ] A **budget alert** is set on the billing account (Google Cloud console > Billing > Budgets & alerts), for example at a small monthly amount with email alerts at 50%, 90%, and 100%.

## 2. Authentication

- [ ] Authentication > Sign-in method: **Email/Password** enabled. Email link sign-in and all other providers off.
- [ ] Public sign-up is not offered by the app. Users are created by the bootstrap script or by an administrator.

## 3. Firestore

- [ ] Database `(default)` in **`africa-south1`** (Native mode). This matches `firebase.json`. The location cannot be changed later.
- [ ] Rules and indexes are deployed from the repository (release checklist step 3), not edited in the console.

## 4. Cloud Functions

- [ ] Functions (2nd gen) region **`africa-south1`**, runtime **Node.js 22** (`nodejs22` in `firebase.json`). Node.js 22 is supported; Google's runtime schedule lists its deprecation in 2027, so plan an upgrade before then.
- [ ] APIs enabled on first deploy (the CLI enables them): Cloud Functions, Cloud Run, Cloud Build, Artifact Registry, Eventarc.
- [ ] **Dedicated runtime service account** for the functions (recommended instead of the Compute Engine default account, which may hold Editor), for example `majipulse-functions@majipulse-4575c.iam.gserviceaccount.com`, with:
  - `roles/aiplatform.user` (Agent Platform / Vertex AI User) for pattern analysis
  - `roles/datastore.user` for Firestore
  - `roles/firebaseauth.admin` for `createOrgUser` and `setUserRole` (creating users, setting claims, password-setup links)

  Set it per function or for the codebase with `serviceAccount` in the function options or the console, then redeploy. If you keep the default account, give it `roles/aiplatform.user`.

## 5. Vertex AI (pattern analysis)

- [ ] **`aiplatform.googleapis.com`** (Vertex AI / Agent Platform API) enabled.
- [ ] Model location chosen. There is no Gemini endpoint in `africa-south1`, so the function (in `africa-south1`) calls the model in another location:
  - `global` (default): best availability, but you cannot choose where processing happens.
  - `eu` or `us`: known processing region.

  Set it in `functions/.env` (read by the Firebase CLI at deploy time and uploaded with the functions; not a secret, but git-ignored like all `.env` files, so create it on the machine you deploy from):

  ```
  PATTERN_MODEL_LOCATION=global
  PATTERN_MODEL=gemini-3.5-flash
  ```
- [ ] Model `gemini-3.5-flash` is available for the chosen location (Agent Platform > Model Garden).

## 6. Firebase AI Logic (report extraction)

- [ ] AI Logic set up with the **Gemini Developer API** provider (Firebase console > AI Logic > Get started). This enables the Firebase AI Logic API and creates its key for the project; the key never goes into the app code.
- [ ] App Check is enforced for AI Logic. The AI Logic docs state that App Check enforcement is required to use AI Logic from 2 November 2026.
- [ ] On-device inference needs Chrome on desktop 139 or later with the Prompt API enabled. Other browsers use the cloud model.

## 7. App Check (T9.1)

- [ ] **reCAPTCHA Enterprise** score-based site key created for the web app (Google Cloud console > Security > reCAPTCHA), with the Hosting domains (`majipulse-4575c.web.app`, `majipulse-4575c.firebaseapp.com`, and any custom domain) and `localhost` for development.
- [ ] Firebase console > App Check > Apps: web app registered with the **reCAPTCHA Enterprise** provider and that site key. The same key goes in `.env.local` as `VITE_APPCHECK_SITE_KEY`.
- [ ] A **debug token** registered under App Check > Apps > Manage debug tokens for local development only. It goes only in `.env.development.local` as `VITE_APPCHECK_DEBUG_TOKEN`. Never in `.env.local`, the repo, or builds.
- [ ] Enforcement turned on for **Cloud Firestore**, **Firebase AI Logic**, and confirm Cloud Functions callables reject requests without a token (`enforceAppCheck: true` in code). Turn on enforcement only after checking the App Check metrics show verified requests from the deployed app (release checklist step 6).

## 8. Local files

- [ ] `.env.local` exists with the real web config and site key, `VITE_USE_EMULATORS=false`. The name starts with a dot; Vite ignores `env.local`.
- [ ] `.env.development.local` holds only the debug token (and `VITE_USE_EMULATORS=true` if you develop against the emulators).
- [ ] `git status` shows no `.env` files.

## Sources

- Firebase pricing plans and Functions billing: https://firebase.google.com/pricing
- Cloud Functions locations and runtimes: https://cloud.google.com/functions/docs/runtime-support
- Firestore locations: https://firebase.google.com/docs/firestore/locations
- App Check with reCAPTCHA Enterprise (web): https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider
- App Check debug provider (web): https://firebase.google.com/docs/app-check/web/debug-provider
- Firebase AI Logic locations and App Check requirement: https://firebase.google.com/docs/ai-logic/locations
- Firebase AI Logic hybrid on-device inference: https://firebase.google.com/docs/ai-logic/hybrid-on-device-inference
- Agent Platform (Vertex AI) locations: https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/locations
- Agent Platform access control: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/access-control
