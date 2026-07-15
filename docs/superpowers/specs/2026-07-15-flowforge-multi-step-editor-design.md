# FlowForge — Visual multi-step editor (chaining) Design

**Date:** 2026-07-15
**Status:** approved, ready for implementation plan
**Builds on:** multi-provider (`docs/superpowers/specs/2026-07-14-flowforge-multi-provider-design.md`)

## Context

Today a `Flow` is a single implicit step: `{ name, prompt, taskType: "extract",
provider, fields[] }`. `runFlow(flowId, input)` runs one `extract` step (LLM call →
Zod-validated JSON) and writes a `Run`. A step **registry** keyed by `taskType` already
exists for extensibility, but only `extract` is registered.

This sub-project turns a flow into a **linear pipeline of steps** that chain: each step's
output can feed later steps' prompts. The editor becomes a **visual, multi-step editor**
where steps are cards you add, configure, reorder, and test as a chain.

## Scope

**Included:**
- A flow holds an **ordered array of steps** (linear pipeline), stored as a JSON column.
- Two step types: **`extract`** (existing shape: prompt + user-defined output fields →
  validated JSON) and **`generate`** (a single free-text output).
- **Chaining via template variables:** each step's prompt is a template; upstream outputs
  and the flow input are interpolated via `{{key.field}}` and `{{input}}` tokens.
- **Per-step provider** with a flow-level default (new steps inherit the default).
- **Full per-step run trace** persisted on each `Run`.
- Visual editor: vertical step cards with a variable-chip inserter, up/down reordering,
  per-step provider override, and a test panel that shows the per-step trace.
- Save-time validation of the chain (unique keys, no forward/unknown references).

**Out of scope:**
- Branching / DAG topology (steps are a straight sequence).
- Explicit input-binding UI (chaining is template tokens, not per-input dropdowns).
- Additional step types beyond `extract` and `generate` (registry stays open for later).
- Per-step model selection (each provider keeps its env-overridable default model).
- Drag-and-drop reordering (up/down buttons instead — no new dependency).
- Retries, streaming, parallelism, cost tracking, auth.
- Data migration / backfill — dev data is throwaway; the DB is reset (see below).

## Design decisions (with rationale)

- **Steps stored as a JSON array on `Flow`, not a relational `Step` table.** Steps are
  always loaded with their flow, edited as a whole in the client, and saved atomically, and
  **reordering is a primary interaction**. A JSON array makes order just the array index —
  free, atomic, no `position` column and no multi-row renumbering. A relational table would
  force an explicit `position` column (or fractional ordering that eventually needs
  rebalancing), turn each reorder into a transactional multi-row `UPDATE`, and make the
  atomic "Save flow" a diff-or-recreate operation. The only thing a table would buy —
  cross-flow step querying / per-row integrity — is not a current need. Chaining references
  use a stable `key` (not a DB id), so references survive reorders regardless of storage.

- **`generate` is modeled as a structured single-field step (`text: string`).** Instead of
  adding a `generateText()` method to the `LlmProvider` interface, a `generate` step reuses
  the existing structured-output path with one implicit required `string` field named
  `text`, plus a generation-oriented system instruction and no field editor. This keeps the
  variable model uniform (every step's output is an object, referenced `{{key.field}}`),
  and reuses the entire provider/schema/validation stack. Cost: `generate` output is forced
  through structured JSON — acceptable, and it keeps output clean. Alternative (a real
  free-text provider method) was rejected as added surface area for no gain here.

- **Chaining via prompt template tokens, not explicit input bindings.** Each step keeps a
  prompt template; the "mapping" is simply which `{{...}}` tokens it references. Minimal new
  UI (a clickable chip inserter), reuses the existing prompt+fields step shape.

- **Stable, immutable step keys.** Keys are auto-generated slugs (`extract1`, `generate2`,
  …), unique within a flow, and never change once created — so `{{key.field}}` references
  never dangle when steps are reordered or renamed. `name` is the editable human label.

- **Halt-on-first-error execution.** A step failure (LLM error, output validation, or an
  unresolved template token) stops the chain; the `Run` is marked `error` and the trace
  records the failing step. Simple and predictable; no partial-continue semantics.

## Data model

### `Flow` (Prisma) — replace single-step columns with `steps`

Drop `prompt`, `taskType`, `fields`. Result:

```prisma
model Flow {
  id        String   @id @default(cuid())
  name      String
  provider  String   @default("gemini")   // flow-level DEFAULT provider
  steps     Json                          // ordered Step[]
  runs      Run[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### `Step` (shape inside the `steps` JSON array)

```ts
interface Step {
  key: string;                      // stable slug, unique in flow, e.g. "extract1"
  type: "extract" | "generate";
  name?: string;                    // optional human label
  prompt: string;                   // template with {{...}} tokens
  provider?: "gemini" | "groq";     // omitted ⇒ inherit flow.provider
  fields?: FieldDef[];              // extract only; user-defined output fields
}
```

- `extract` output = its `fields` object, e.g. `{ author: "Ana" }`.
- `generate` output = `{ text: "…" }` (implicit single field; `fields` omitted).

### `Run` — richer output trace

Columns unchanged (`status`, `errorMessage`, `durationMs`, `provider`, `model`). `output`
now holds the full trace:

```jsonc
output = {
  final: { sentiment: "positive" },        // last successful step's output (or null on error)
  steps: [
    { key: "extract1", type: "extract", status: "success",
      output: { author: "Ana" }, error: null, model: "gemini-flash-latest", ms: 320 },
    { key: "generate1", type: "generate", status: "success",
      output: { text: "…" }, error: null, model: "…", ms: 500 }
  ]
}
```

`Run.provider`/`Run.model` record the flow default / last step (kept for the history table's
top-level columns); per-step model lives in the trace.

### Migration

Dev data is throwaway. Reset the dev DB and apply the new schema outright — no backfill.

## Variable model & resolution

Available tokens when editing/executing step *N* (0-indexed position in the array):

- `{{input}}` — the run's raw input string.
- `{{key.field}}` for **every prior step** (position `< N`), one token per output field
  (extract fields, or `text` for generate).

Resolution walks steps in array order, accumulating:

```ts
context = { input: "...", [key]: { ...stepOutputs } }
```

Before a step runs, its `prompt` is interpolated against `context`:

- `{{input}}` → the input string.
- `{{key.field}}` → `context[key][field]`, **stringified** if non-string (numbers/booleans
  via `String()`, arrays/objects via `JSON.stringify`).
- A token that resolves to `undefined` at runtime ⇒ **run error** with a clear message.
  (Forward/unknown references are rejected earlier at save time — see Validation.)

## Execution (`runFlow` rewrite)

Sequential, halt-on-first-error:

```
context = { input }
trace = []
for step in flow.steps:            // array order
    provider = getProvider(step.provider ?? flow.provider)
    resolved = interpolate(step.prompt, context)          // unresolved token → error
    result   = getStepExecutor(step.type).execute({ prompt: resolved, fields, provider })
    trace.push({ key, type, status, output, error, model: provider.model, ms })
    if result.status === "error": break                    // stop the chain
    context[step.key] = result.output                      // feed forward
status = any step errored ? "error" : "success"
Run = { status, output: { final: lastSuccessfulOutput, steps: trace }, errorMessage, ... }
```

- The step **registry** stays (`extract`, `generate`).
- `StepContext` drops the separate `input` argument — everything now flows through the
  resolved prompt template (`{{input}}` covers the raw input case).
- `extract` executor: unchanged logic (build Zod schema from `fields`, call provider,
  validate). `generate` executor: same path with fixed `fields: [{ name: "text", type:
  "string", required: true, order: 0 }]` and a generation system instruction.

## Visual editor (`FlowEditor`)

Vertical list of **step cards**, read top-to-bottom as the pipeline:

```
┌ Flow: name ─────────────────── default provider [gemini ▾] ┐
│ ┌ [extract1]  extract   provider [↳ flow default ▾]  ✕ ↑↓ ┐│
│ │ prompt template:                                        ││
│ │  ┌───────────────────────────────────────────────────┐ ││
│ │  │ Extract the author from {{input}}                 │ ││
│ │  └───────────────────────────────────────────────────┘ ││
│ │  vars: [ {{input}} ]           ← click a chip to insert ││
│ │  output fields: [author  string ☑req ✕] [+ add field]  ││
│ └─────────────────────────────────────────────────────────┘│
│ ┌ [generate1] generate  provider [groq ▾]            ✕ ↑↓ ┐│
│ │  prompt: Write a bio for {{extract1.author}}            ││
│ │  vars: [ {{input}} ] [ {{extract1.author}} ]            ││
│ │  outputs: {{generate1.text}}                            ││
│ └─────────────────────────────────────────────────────────┘│
│ [ + add step ▾ ]   (extract | generate)                     │
└─────────────────────────────────────────────────────────────┘
```

- **Flow header:** name, default provider dropdown.
- **Step card:** key badge, type, optional name, provider override dropdown (default =
  "flow default"), remove, up/down reorder buttons.
- **Prompt template:** textarea with a **variable chip bar** listing tokens available at
  that step (`{{input}}` + each prior step's fields). Clicking a chip inserts the token at
  the cursor.
- **extract card:** the existing per-field editor (name / type / required / remove, + add).
- **generate card:** no field editor; shows its output token `{{key.text}}`.
- **Reorder:** up/down buttons only (no drag-drop dependency). Keys are stable, so tokens
  are never rewritten; a reorder that makes a reference illegal (step now references a later
  one) is caught by save-time validation.
- **Keys:** auto-generated and immutable; `name` is the editable label.
- **Add step:** picks `extract` or `generate`; assigns the next free key for that type.
- **Test panel:** input textarea → Run → renders the per-step trace (each step's status,
  output, ms) plus the final output.

## Validation

**Save-time (Zod, `flowSchema` / `stepSchema`):**

- Flow: `name` required; `provider` ∈ providers (default `gemini`); `steps` array, **≥ 1**.
- Step: `key` a valid identifier, **unique within the flow**; `type` ∈ {`extract`,
  `generate`}; `prompt` non-empty; `provider` optional ∈ providers.
- `extract`: `fields` **≥ 1**, field names valid identifiers and **unique within the step**
  (existing rules, now per step).
- `generate`: no user `fields`.
- **Reference check:** every `{{token}}` in a step's prompt must be `input` or
  `{{key.field}}` where `key` is a **prior** step and `field` is one of that step's outputs.
  Rejects unknown refs and forward refs.

**Runtime:** halt on first step error (LLM error, output validation failure, or unresolved
token); `Run.status = "error"`; trace records the failing step and its `error`.

## Testing (vitest, matching existing patterns)

- **Template resolver:** interpolation of `{{input}}` and `{{key.field}}`; non-string
  stringification (number/boolean/array); unresolved token → error.
- **Schema validation:** unique step keys; per-step field rules; **forward/unknown
  reference rejection**; `generate` rejects user fields.
- **`runFlow` orchestration** (fake provider): multi-step chaining and context
  accumulation; per-step provider selection (override vs flow default); halt-on-first-error
  with correct trace; `generate` output shape `{ text }`.
- Keep existing extract/provider tests green (extract executor logic unchanged).

## Affected files (indicative)

- `prisma/schema.prisma` — `Flow.steps`, drop `prompt`/`taskType`/`fields`.
- `src/lib/flow/types.ts` — `Step`, `StepType`; keep `FieldDef`.
- `src/lib/flow/template.ts` *(new)* — token parsing + resolver.
- `src/lib/flow/steps/{types,registry,extract}.ts` — `StepContext` drops `input`; add
  `generate.ts`; register `generate`.
- `src/lib/flow/runFlow.ts` — sequential chained executor + trace.
- `src/lib/validations/flow.ts` — `stepSchema`, chain/reference validation.
- `src/app/flows/actions.ts` — persist `steps`.
- `src/app/flows/FlowEditor.tsx` — step-card UI, chip inserter, reorder, provider override,
  trace-aware test panel.
- `src/app/flows/[id]/page.tsx` — pass `steps`; trace-aware run history.
- `src/app/api/flows/[id]/run/route.ts` — unchanged contract (still `{ input }`).
```
