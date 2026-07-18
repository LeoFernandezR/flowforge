# Retry on invalid output — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a structured step's LLM output fails Zod validation, feed the validation error back to the model and retry a bounded number of times before recording a failure.

**Architecture:** All retry logic lives in `runStructured` — the single call→validate→map path both `extract` and `generate` share. On a Zod failure it re-prompts with the previous invalid output and the validation error appended to the step input, up to an env-overridable bound. The attempt count is threaded through `StepResult` → `runFlow`'s persisted step trace → the editor's trace panel. No provider-interface change, no Prisma migration.

**Tech Stack:** TypeScript, Next.js, Zod (v4, `z.treeifyError`), Vitest, Prisma (read-only here), React (editor UI).

## Global Constraints

- **English only** in all code, comments, commits, and UI copy.
- **Zod is the source of truth for model output** — a recovered attempt is a fully re-validated response; never trust provider-side enforcement alone.
- **No live LLM calls in tests** — providers are injected as mocks; use scripted mock providers.
- **Do not change the `LlmProvider` interface** (`generateStructured({ prompt, input, fields })`) or any provider adapter.
- **No Prisma migration** — the attempt count rides inside the existing `Run.output` JSON.
- **Retry only on Zod validation failure.** Provider/network exceptions fail fast, unchanged.
- Default bound: **2 retries → up to 3 total attempts**, overridable via `FLOWFORGE_MAX_VALIDATION_RETRIES`; `0` disables retries.
- Restart `next dev` is not needed (no schema change), but run `npm run test` and `npm run build` before claiming done.

---

### Task 1: Bounded retry loop in `runStructured`

**Files:**
- Modify: `src/lib/flow/steps/types.ts` (add `attempts` to `StepResult`)
- Modify: `src/lib/flow/steps/structured.ts` (the retry loop, bound helper, correction builder)
- Modify: `.env.example` (document the new env var)
- Test: `src/lib/flow/steps/structured.test.ts` (new)

**Interfaces:**
- Consumes: `buildZodSchema(fields: FieldDef[])` from `../schema`; `LlmProvider.generateStructured({ prompt, input, fields })` from `../providers/types`; `z.treeifyError` from `zod`.
- Produces: `runStructured(systemInstruction: string, prompt: string, fields: FieldDef[], provider: LlmProvider): Promise<StepResult>` — unchanged signature. `StepResult` now includes `attempts: number` (total attempts made, ≥ 1). Success path returns `{ status: "success", output, errorMessage: null, attempts }`; validation-exhausted returns `{ status: "error", output: null, errorMessage: "Validation failed: …", attempts }`; provider throw returns `{ status: "error", output: null, errorMessage: "LLM error: …", attempts }` with no retry.

- [ ] **Step 1: Add `attempts` to `StepResult`**

In `src/lib/flow/steps/types.ts`, change the `StepResult` interface to:

```ts
export interface StepResult {
  status: "success" | "error";
  output: Record<string, unknown> | null;
  errorMessage: string | null;
  attempts: number; // total attempts made (>= 1), including the first
}
```

- [ ] **Step 2: Write the failing test file**

Create `src/lib/flow/steps/structured.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from "vitest";
import { runStructured } from "./structured";
import type { LlmProvider } from "../providers/types";
import type { FieldDef } from "../types";

const SYS = "system instruction";
const fields: FieldDef[] = [{ name: "name", type: "string", required: true, order: 0 }];

// Returns each scripted value in turn on successive calls (repeating the last once exhausted),
// and records every `input` it was called with so retries can be inspected.
function scriptedProvider(responses: unknown[]): { provider: LlmProvider; inputs: string[] } {
  const inputs: string[] = [];
  let i = 0;
  const provider: LlmProvider = {
    name: "mock",
    model: "mock-1",
    generateStructured: async ({ input }) => {
      inputs.push(input);
      const r = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return r;
    },
  };
  return { provider, inputs };
}

afterEach(() => vi.unstubAllEnvs());

describe("runStructured", () => {
  test("succeeds on the first attempt", async () => {
    const { provider, inputs } = scriptedProvider([{ name: "Ada" }]);
    const result = await runStructured(SYS, "extract", fields, provider);
    expect(result).toEqual({
      status: "success",
      output: { name: "Ada" },
      errorMessage: null,
      attempts: 1,
    });
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toBe("extract"); // no correction block on the first attempt
  });

  test("retries after an invalid response and records the attempt count", async () => {
    const { provider, inputs } = scriptedProvider([{ name: 123 }, { name: "Ada" }]);
    const result = await runStructured(SYS, "extract", fields, provider);
    expect(result.status).toBe("success");
    expect(result.output).toEqual({ name: "Ada" });
    expect(result.attempts).toBe(2);
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toContain("did not match the required schema");
    expect(inputs[1]).toContain("Validation errors");
  });

  test("fails after exhausting the default bound of 2 retries", async () => {
    const { provider, inputs } = scriptedProvider([{ name: 1 }, { name: 2 }, { name: 3 }, { name: 4 }]);
    const result = await runStructured(SYS, "extract", fields, provider);
    expect(result.status).toBe("error");
    expect(result.output).toBeNull();
    expect(result.errorMessage).toMatch(/Validation failed/);
    expect(result.attempts).toBe(3); // 1 initial + 2 retries
    expect(inputs).toHaveLength(3);
  });

  test("FLOWFORGE_MAX_VALIDATION_RETRIES=0 disables retries", async () => {
    vi.stubEnv("FLOWFORGE_MAX_VALIDATION_RETRIES", "0");
    const { provider, inputs } = scriptedProvider([{ name: 1 }, { name: "Ada" }]);
    const result = await runStructured(SYS, "extract", fields, provider);
    expect(result.status).toBe("error");
    expect(result.attempts).toBe(1);
    expect(inputs).toHaveLength(1);
  });

  test("an unparseable env value falls back to the default bound", async () => {
    vi.stubEnv("FLOWFORGE_MAX_VALIDATION_RETRIES", "not-a-number");
    const { provider } = scriptedProvider([{ name: 1 }, { name: 2 }, { name: 3 }, { name: 4 }]);
    const result = await runStructured(SYS, "extract", fields, provider);
    expect(result.attempts).toBe(3); // fell back to default 2 retries
  });

  test("does not retry when the provider throws", async () => {
    let calls = 0;
    const provider: LlmProvider = {
      name: "mock",
      model: "mock-1",
      generateStructured: async () => {
        calls += 1;
        throw new Error("network down");
      },
    };
    const result = await runStructured(SYS, "extract", fields, provider);
    expect(result.status).toBe("error");
    expect(result.errorMessage).toMatch(/LLM error: network down/);
    expect(result.attempts).toBe(1);
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test -- src/lib/flow/steps/structured.test.ts`
Expected: FAIL — current `runStructured` returns no `attempts` field and does not retry (e.g. "retries after an invalid response" fails because it returns an error on the first invalid response).

- [ ] **Step 4: Rewrite `runStructured` with the retry loop**

Replace the entire contents of `src/lib/flow/steps/structured.ts` with:

```ts
import { z } from "zod";
import { buildZodSchema } from "../schema";
import type { FieldDef } from "../types";
import type { LlmProvider } from "../providers/types";
import type { StepResult } from "./types";

const DEFAULT_MAX_VALIDATION_RETRIES = 2;

// Read the retry bound once per call. Default 2 (→ up to 3 attempts); overridable via env for
// tuning. 0 disables retries (single attempt). Unparseable/negative values fall back to the
// default rather than throwing, so a bad env var can never crash a run.
function getMaxValidationRetries(): number {
  const raw = process.env.FLOWFORGE_MAX_VALIDATION_RETRIES;
  if (raw === undefined) return DEFAULT_MAX_VALIDATION_RETRIES;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_MAX_VALIDATION_RETRIES;
}

// The correction addendum appended to the step input on each retry: the previous invalid
// response plus the Zod errors, so the model can fix its own output. The system instruction is
// left unchanged, so provider adapters need no awareness of retries.
function buildCorrection(raw: unknown, error: z.ZodError): string {
  return (
    "The previous response did not match the required schema.\n" +
    `Previous response:\n${JSON.stringify(raw)}\n` +
    `Validation errors:\n${JSON.stringify(z.treeifyError(error))}\n` +
    "Return a corrected response that satisfies the schema."
  );
}

// Shared structured-output path for step executors that ask the LLM to fill a Zod schema
// (extract's user-defined fields, generate's implicit `{ text }` field). Owns the
// call → validate → success/error mapping, plus bounded retry: on a Zod validation failure it
// re-prompts with the validation error fed back, up to the configured bound, before failing.
export async function runStructured(
  systemInstruction: string,
  prompt: string,
  fields: FieldDef[],
  provider: LlmProvider,
): Promise<StepResult> {
  const zodSchema = buildZodSchema(fields);
  const maxRetries = getMaxValidationRetries();

  let lastRaw: unknown;
  let lastError: z.ZodError | null = null;
  let lastErrorMessage = "";
  let attempt = 0;

  while (attempt <= maxRetries) {
    attempt += 1;
    // First attempt uses the plain input; retries append the correction block.
    const input = lastError === null ? prompt : `${prompt}\n\n${buildCorrection(lastRaw, lastError)}`;

    let raw: unknown;
    try {
      raw = await provider.generateStructured({ prompt: systemInstruction, input, fields });
    } catch (err) {
      // Provider/network error: fail fast, no retry.
      return {
        status: "error",
        output: null,
        errorMessage: `LLM error: ${(err as Error).message}`,
        attempts: attempt,
      };
    }

    const parsed = zodSchema.safeParse(raw);
    if (parsed.success) {
      return {
        status: "success",
        output: parsed.data as Record<string, unknown>,
        errorMessage: null,
        attempts: attempt,
      };
    }

    lastRaw = raw;
    lastError = parsed.error;
    lastErrorMessage = `Validation failed: ${JSON.stringify(z.treeifyError(parsed.error))}`;
  }

  return { status: "error", output: null, errorMessage: lastErrorMessage, attempts: attempt };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- src/lib/flow/steps/structured.test.ts`
Expected: PASS (all six cases).

- [ ] **Step 6: Confirm the existing step tests still pass**

Run: `npm run test -- src/lib/flow/steps`
Expected: PASS — `extract.test.ts` and `generate.test.ts` assert individual fields (`result.status`, `result.output`, `result.errorMessage`), not the whole object, so the added `attempts` field does not break them.

- [ ] **Step 7: Document the env var in `.env.example`**

In `.env.example`, after the Groq lines (around line 13), add:

```
# Max retries when the model returns output that fails Zod validation (default 2 → up to 3
# attempts). Set to 0 to disable retries.
FLOWFORGE_MAX_VALIDATION_RETRIES="2"
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/flow/steps/types.ts src/lib/flow/steps/structured.ts src/lib/flow/steps/structured.test.ts .env.example
git commit -m "feat: bounded retry on invalid structured output

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Thread `attempts` through the persisted step trace

**Files:**
- Modify: `src/lib/flow/runFlow.ts` (`StepTrace` interface + capture `result.attempts`)
- Test: `src/lib/flow/runFlow.test.ts` (add a recovery case)

**Interfaces:**
- Consumes: `StepResult.attempts` from Task 1 (via `getStepExecutor(step.type).execute(...)`).
- Produces: each entry in the persisted `Run.output.steps[]` now carries `attempts: number`. On the thrown-error path (a step executor or `getProvider` throwing, distinct from `runStructured`'s handled errors) `attempts` defaults to `1`.

- [ ] **Step 1: Write the failing test**

In `src/lib/flow/runFlow.test.ts`, add this test inside the `describe("runFlow", …)` block (after the "persists a success run…" test):

```ts
test("records the attempt count on each step trace entry", async () => {
  vi.mocked(prisma.flow.findUnique).mockResolvedValue(oneStepFlow as never);

  let call = 0;
  const retryingProvider: LlmProvider = {
    name: "mock",
    model: "mock-1",
    generateStructured: async () => {
      call++;
      return call === 1 ? { name: 123 } : { name: "Ada" }; // first invalid, then valid on retry
    },
  };
  await runFlow("flow_1", "Ada", { provider: retryingProvider });

  const arg = vi.mocked(prisma.run.create).mock.calls[0][0].data as unknown as {
    status: string;
    output: { steps: Array<{ status: string; attempts: number }> };
  };
  expect(arg.status).toBe("success");
  expect(arg.output.steps[0].status).toBe("success");
  expect(arg.output.steps[0].attempts).toBe(2);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/lib/flow/runFlow.test.ts -t "records the attempt count"`
Expected: FAIL — `arg.output.steps[0].attempts` is `undefined` (trace does not yet carry `attempts`).

- [ ] **Step 3: Add `attempts` to the `StepTrace` interface**

In `src/lib/flow/runFlow.ts`, update the `StepTrace` interface (currently lines 13–21) to add one field:

```ts
interface StepTrace {
  key: string;
  type: string;
  status: "success" | "error";
  output: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  model: string;
  ms: number;
}
```

- [ ] **Step 4: Capture `result.attempts` in the step loop**

In `src/lib/flow/runFlow.ts`, inside the `for (const step of steps)` loop:

1. After the `let model = lastModel;` line, add a declaration defaulting to 1:

```ts
    let attempts = 1;
```

2. In the `try` block, after `error = result.errorMessage;`, add:

```ts
      attempts = result.attempts;
```

3. Update the `trace.push(...)` call to include `attempts`:

```ts
    trace.push({ key: step.key, type: step.type, status, output, error, attempts, model, ms });
```

(The `catch` block leaves `attempts` at its default of `1`, which is correct for a thrown step/provider error.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- src/lib/flow/runFlow.test.ts`
Expected: PASS — the new case plus all existing `runFlow` cases.

- [ ] **Step 6: Commit**

```bash
git add src/lib/flow/runFlow.ts src/lib/flow/runFlow.test.ts
git commit -m "feat: record per-step attempt count in the run trace

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Show the attempt count in the editor trace panel

**Files:**
- Modify: `src/app/flows/FlowEditor.tsx` (`StepTraceView` type + trace-panel render)

**Interfaces:**
- Consumes: `attempts: number` on each persisted step trace entry (Task 2), surfaced in the run API response the editor already renders as `result.output.steps[]`.
- Produces: no new exports. The trace panel shows a muted `attempt N` marker next to `{ms}ms` when `attempts > 1`; first-try steps render exactly as before.

- [ ] **Step 1: Add `attempts` to the `StepTraceView` type**

In `src/app/flows/FlowEditor.tsx`, update the `StepTraceView` type (currently lines 30–37) to add:

```ts
type StepTraceView = {
  key: string;
  type: string;
  status: string;
  output: unknown;
  error: string | null;
  attempts: number;
  ms: number;
};
```

- [ ] **Step 2: Render the attempt marker in the trace panel**

In `src/app/flows/FlowEditor.tsx`, in the trace-panel step row, the header currently reads:

```tsx
                  <div className="flex items-center gap-2">
                    <span className="font-mono">{s.key}</span>
                    <span className="text-gray-500">{s.type}</span>
                    <span>{s.status}</span>
                    <span className="text-gray-500">{s.ms}ms</span>
                  </div>
```

Add the marker after the `{s.ms}ms` span:

```tsx
                  <div className="flex items-center gap-2">
                    <span className="font-mono">{s.key}</span>
                    <span className="text-gray-500">{s.type}</span>
                    <span>{s.status}</span>
                    <span className="text-gray-500">{s.ms}ms</span>
                    {s.attempts > 1 && <span className="text-gray-500">attempt {s.attempts}</span>}
                  </div>
```

- [ ] **Step 3: Verify types and lint pass**

Run: `npm run lint`
Expected: PASS with no new errors.

- [ ] **Step 4: Verify the build passes**

Run: `npm run build`
Expected: PASS — Next.js build completes with no type errors (this is the gate for the UI change, which has no unit test).

- [ ] **Step 5: Commit**

```bash
git add src/app/flows/FlowEditor.tsx
git commit -m "feat: show retry attempt count in the trace panel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Docs upkeep

**Files:**
- Modify: `docs/PROJECT-HISTORY.md` (add the phase, remove the to-do item)

**Interfaces:** none (documentation only). Per the AGENTS.md upkeep rule, no `PROJECT-SCOPE.md` change — this builds an already-in-scope capability.

- [ ] **Step 1: Add the phase and remove the to-do item**

In `docs/PROJECT-HISTORY.md`:

1. After the "Phase 3 — Visual multi-step editor" block (before the `---` that precedes `## To do`), add:

```markdown
## Phase 4 — Retry on invalid output

*Spec & plan: `2026-07-17-flowforge-retry-invalid-output`. Merged 2026-07-17.*

- Bounded retry in `runStructured` on Zod validation failure (both `extract` and `generate`)
- Validation error + previous output fed back to the model on each retry
- Bound from `FLOWFORGE_MAX_VALIDATION_RETRIES` (default 2 → up to 3 attempts; `0` disables)
- Per-step attempt count recorded in the run trace and shown in the editor trace panel
```

2. In the `## To do` list, remove the line:

```markdown
- [ ] Retry on invalid output (feed the Zod error back and retry before failing)
```

- [ ] **Step 2: Run the full test suite and build as a final gate**

Run: `npm run test && npm run build`
Expected: both PASS.

- [ ] **Step 3: Commit**

```bash
git add docs/PROJECT-HISTORY.md
git commit -m "docs: record retry-on-invalid-output phase

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Manual verification (after all tasks)

With a real provider key, create a flow whose schema is easy for the model to slip on (e.g. a required `number` field described ambiguously). Run it: if the first response fails validation, confirm the trace shows the step succeeding with `attempt 2` (or the run failing after 3 attempts with the validation error). Then set `FLOWFORGE_MAX_VALIDATION_RETRIES=0` and confirm a single-attempt failure.

## Self-review notes

- **Spec coverage:** retry loop (Task 1), validation-only trigger + fail-fast provider errors (Task 1 tests), env-overridable bound incl. `0` and bad-value fallback (Task 1), correction block fed back (Task 1), `attempts` on `StepResult` → trace → UI (Tasks 1–3), `.env.example` (Task 1), docs upkeep (Task 4). No Prisma change, no interface change — all held.
- **Types:** `attempts: number` defined once on `StepResult` (Task 1), consumed by `StepTrace` (Task 2) and `StepTraceView` (Task 3) under the same name. `runStructured` signature unchanged.
