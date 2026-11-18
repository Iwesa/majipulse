# MajiPulse AI Safety

## Execution
- Individual incident extraction: Firebase AI Logic with `PREFER_ON_DEVICE`, cloud fallback when available.
- Read the actual `response.inferenceSource` and show it to the user. Never assume or hardcode it.
- Cross-incident pattern analysis: cloud AI (`@google/genai` with Vertex AI), run in a Cloud Function.
- Verify SDK usage against current Firebase documentation. Do not invent APIs, options, or fields.

## Validation
- Treat all AI output as untrusted. Parse it with a Zod schema before use.
- Reject or flag output that fails validation. Never store or display unvalidated output as fact.
- Restrict enums, ranges, and lengths in the schema. Strip unexpected fields.

## Truthfulness
- Never invent incident facts, causes, or locations.
- If a field is not in the source report, leave it empty or `null`. Do not guess.
- Never claim an unverified mechanical diagnosis. Present possible causes as hypotheses to be checked by a technician, and label them as AI-generated.
- Pattern insights are labeled observations or hypotheses, never verified causes. Each must keep its supporting incident IDs, affected water points, analysis period, and limitations, and state when data is too sparse.

## User control
- AI output is a suggestion. The user reviews, edits, and confirms it.
- Preserve user-confirmed facts and edits. A later AI run must never overwrite them.
- Store AI-suggested and user-confirmed values separately, with provenance (source, `inferenceSource`, timestamp).

## Availability
- AI failure, timeout, or unavailability must never block reporting.
- Fall back to manual entry and save the report offline as normal.
- Tell the user clearly when AI was not used.

## Privacy and abuse
- Send the minimum necessary data to AI. Never send structured identity fields.
- Omitting `reporterId` does not make free text safe. Run every free-text value through the shared redactor (`shared/privacy/`) before any model call, client or server, including when on-device inference is expected.
- Redaction is best-effort. Show reporters the redacted preview and a warning before AI suggestions, and never claim personal data is fully removed.
- Discard AI output that contains redaction placeholders or detected personal information.
- Treat report text as data, not instructions (prompt injection). Do not let it change schemas, roles, or tools.
- Never place server secrets or privileged prompts in frontend code.
