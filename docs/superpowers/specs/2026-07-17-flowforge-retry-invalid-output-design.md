# FlowForge — Retry on invalid output Design

**Date:** 2026-07-17
**Status:** approved, ready for implementation plan
**Builds on:** multi-step editor (`docs/superpowers/specs/2026-07-15-flowforge-multi-step-editor-design.md`)

## Context

Every structured step (`extract`, `generate`) asks an LLM to fill a Zod schema and validates
the response with `zodSchema.safeParse`. When the model returns well-formed data that fails
validation — a missing required field, a wrong type, an extra hallucinated field — the step
fails immediately and the whole run halts with a `Validation failed: …` error.

A single re-prompt that shows the model exactly what was wrong usually fixes these format slips.
This sub-project adds a **bounded retry**: on a Zod validation failure, feed the validation
error back to the model and try again, up to a limit, before recording the failure. This is the
in-scope item "Retry on invalid output" from `PROJECT-SCOPE.md`.

## Scope

**Included:**
- Bounded retry loop inside `runStructured`, the shared call→validate path for both step types.
- Retry only on Zod validation failure. Provider/network exceptions are unchanged (fail fast).
- Bound from an env-overridable constant (default 2 retries → up to 3 attempts).
- Each retry re-prompts with the previous invalid output and the validation error appended to
  the step input.
- Attempt count surfaced on the step trace and shown in the editor's trace panel.

**Out of scope:**
- Retrying provider/network errors, timeouts, or 429/503 (a separate future concern).
- Backoff/delay between attempts (validation retries are corrective, not rate-limit driven).
- Per-flow or per-step retry configuration (no schema column, no UI knob).
- Any change to the `LlmProvider` interface or provider adapters.
- A Prisma migration (the trace lives in the existing `Run.output` JSON).

## Design decisions (with rationale)

- **Retry lives in `runStructured` only.** It is the single place both `extract` and `generate`
  run their call→validate→map logic. Putting the loop there covers both step types with no
  change to the executors, `runFlow`, or the providers. (`src/lib/flow/steps/structured.ts`.)
- **Validation-only trigger.** The scope says "feed the validation error back to the model" —
  that only makes sense for a response that came back and failed Zod. A network fault has no
  model output to correct, and retrying it silently is a different feature (transient-error
  backoff) explicitly left out. Provider exceptions keep failing fast exactly as today.
- **Env-overridable constant, no per-flow knob.** Mirrors how provider models resolve
  (`GROQ_MODEL` etc.): a sensible default in code, overridable by env for tuning, with no new
  `Flow` column or editor surface. Consistent with the non-goal "no per-flow/per-step model
  selection".
- **Augment the input, not the interface.** `generateStructured` is single-shot with no
  conversation. Rather than add a messages/history parameter, the retry appends a correction
  block to the `input` string. The `LlmProvider` interface and both adapters stay untouched.
- **Attempt count, not full per-attempt trace.** One extra number (`attempts`) on the step
  trace tells first-try success apart from a recovered one without expanding the trace data
  model or panel into a per-attempt sub-list. Zod remains the source of truth (invariant 1); a
  recovered attempt is still a fully re-validated response.

## The retry loop

`runStructured` (`src/lib/flow/steps/structured.ts`) changes from a single call to a bounded
loop. Shape (illustrative, not final code):

```ts
const zodSchema = buildZodSchema(fields);
const maxRetries = getMaxValidationRetries();      // default 2
let lastErrorMessage = "";
let attempt = 0;

while (attempt <= maxRetries) {
  attempt += 1;
  const effectiveInput =
    attempt === 1 ? prompt : `${prompt}\n\n${buildCorrection(lastRaw, lastZodError)}`;

  let raw: unknown;
  try {
    raw = await provider.generateStructured({ prompt: systemInstruction, input: effectiveInput, fields });
  } catch (err) {
    // provider/network error: fail fast, no retry
    return { status: "error", output: null, errorMessage: `LLM error: ${(err as Error).message}`, attempts: attempt };
  }

  const parsed = zodSchema.safeParse(raw);
  if (parsed.success) {
    return { status: "success", output: parsed.data as Record<string, unknown>, errorMessage: null, attempts: attempt };
  }

  lastRaw = raw;
  lastZodError = parsed.error;
  lastErrorMessage = `Validation failed: ${JSON.stringify(z.treeifyError(parsed.error))}`;
}

return { status: "error", output: null, errorMessage: lastErrorMessage, attempts: attempt };
```

Notes:
- `prompt` here is the resolved step input already passed into `runStructured` today (the
  second argument); `systemInstruction` is the first. The variable name `effectiveInput` only
  augments the retry case.
- The final error message is identical in format to today's (`Validation failed: …`), built
  from the **last** attempt's Zod error — so nothing downstream that parses/records the error
  needs to change.
- A provider exception returns immediately with `attempts` = the attempt on which it threw
  (retries are not consumed by a network fault).

## The correction block

`buildCorrection(raw, zodError)` returns a plain-text addendum appended to the input:

```
The previous response did not match the required schema.
Previous response:
<JSON.stringify(raw)>
Validation errors:
<JSON.stringify(z.treeifyError(zodError))>
Return a corrected response that satisfies the schema.
```

The system instruction (`prompt` arg #1) is unchanged between attempts. Only the input carries
the correction, so the provider adapters need no awareness of retries.

## The bound

A small helper reads the limit once per call:

```ts
const DEFAULT_MAX_VALIDATION_RETRIES = 2;

function getMaxValidationRetries(): number {
  const raw = process.env.FLOWFORGE_MAX_VALIDATION_RETRIES;
  const n = raw === undefined ? DEFAULT_MAX_VALIDATION_RETRIES : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_MAX_VALIDATION_RETRIES;
}
```

- `0` disables retries (single attempt) — a valid setting.
- Non-integer / negative / unparseable values fall back to the default rather than throwing.
- Default 2 → up to 3 total attempts.

Add `FLOWFORGE_MAX_VALIDATION_RETRIES` (optional, default 2) to `.env.example` with a comment.

## Surfacing attempts

**`StepResult`** (`src/lib/flow/steps/types.ts`) gains one field:
```ts
interface StepResult {
  status: "success" | "error";
  output: Record<string, unknown> | null;
  errorMessage: string | null;
  attempts: number;          // total attempts made (>= 1)
}
```
Both executors (`extract.ts`, `generate.ts`) already `return runStructured(...)` directly, so
they pass `attempts` through with no change.

**`runFlow`** (`src/lib/flow/runFlow.ts`): `StepTrace` gains `attempts: number`. It is read from
`result.attempts` on the success path; in the `catch` block (a thrown step error, distinct from
`runStructured`'s handled errors) it defaults to `1`. The value is persisted inside the existing
`Run.output` JSON — no Prisma change.

**UI** (`src/app/flows/FlowEditor.tsx`): `StepTraceView` gains `attempts: number`. The trace
panel, which today renders `key · type · status · {ms}ms`, adds a marker when `attempts > 1`,
e.g. `attempt {s.attempts}` (muted, next to `ms`). First-try steps look exactly as they do now.

## Testing

Same philosophy: providers behind the interface, mocked, no live network (invariant 4). A mock
provider whose `generateStructured` returns a scripted sequence of responses across successive
calls drives the retry cases.

- **New `steps/structured.test.ts`:**
  - valid on first call → `status: "success"`, `attempts: 1`, one provider call.
  - invalid then valid → `status: "success"`, `attempts: 2`, two calls; the second call's
    `input` contains the correction block (previous response + validation errors).
  - invalid every time → `status: "error"`, `attempts: 3` (default bound), error message in the
    `Validation failed: …` format from the last attempt.
  - `FLOWFORGE_MAX_VALIDATION_RETRIES=0` → single attempt, `attempts: 1`, error on invalid.
  - provider throws → `status: "error"`, `errorMessage` starts `LLM error:`, **no** retry
    (one call only).
- **`runFlow.test.ts`:** existing cases assert the new `attempts` appears on each step trace
  entry (default `1` for the current single-attempt fixtures); add one case where the injected
  mock recovers on the second attempt and the persisted trace records `attempts: 2`.
- **`extract.test.ts` / `generate.test.ts`:** update their `StepResult` expectations to include
  `attempts` (their existing mock returns valid output → `attempts: 1`).
- UI change gated by `npm run build`.

## Manual verification

With a real provider key, create a flow whose schema is easy for the model to slip on (e.g. a
required `number` field described ambiguously). Run it; if the first response fails validation,
confirm the trace shows the step succeeding with `attempt 2` (or the run failing after 3
attempts with the validation error). Set `FLOWFORGE_MAX_VALIDATION_RETRIES=0` and confirm a
single-attempt failure.

## Docs upkeep

On merge: add a "Retry on invalid output" phase to `PROJECT-HISTORY.md` and remove the matching
to-do item, per the AGENTS.md upkeep rule. No `PROJECT-SCOPE.md` change — this builds an
already-in-scope capability.

## Noted future improvements

- Backoff/retry for transient provider errors (429/503) — the deliberately-excluded sibling.
- Optional per-attempt trace detail if debugging ever needs the intermediate raw responses.
