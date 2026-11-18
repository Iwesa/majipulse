# MajiPulse Coding Standards

## TypeScript
- Strict mode on. Set `"strict": true` explicitly in the tsconfig files.
- Do not use `any`. Use `unknown` and narrow with Zod or type guards.
- Derive types from Zod schemas (`z.infer`) instead of duplicating them.
- Keep `erasableSyntaxOnly` and `verbatimModuleSyntax` as already configured (no enums; use `import type`).

## Structure
- Keep UI, Firebase, AI, and sync services separate (see `architecture.md`).
- Build reusable components. Extract one when a pattern is used twice.
- Components render and handle events. Data access lives in services and stores.

## UI states
Every data-driven view handles: loading, empty, error, and offline.

## Responsive and accessible
- Mobile-first layouts with Tailwind.
- Semantic HTML, labeled form controls, visible focus, keyboard operability.
- Sufficient color contrast. Never use color alone to convey status (sync, severity).
- Announce async status changes (for example `aria-live`).

## Dependencies and scope
- Do not add dependencies without user approval. Ask first, with the reason.
- Avoid unrelated rewrites. Change only what the task needs.
- Follow existing conventions. Run `npm run lint` and `npm run build` before finishing.

## Testing
- Write and run tests for critical functionality: validation schemas, AI output validation, offline storage, sync idempotency and failure handling, role and organization access, security rules.
- Report test results honestly. If a test cannot run, say so.

## Errors and logs
- Surface errors to the user in plain language.
- Never log secrets, tokens, or personal data.
