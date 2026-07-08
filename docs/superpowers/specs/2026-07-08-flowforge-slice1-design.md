# FlowForge — Slice #1: Thin Vertical Slice (Design)

**Date:** 2026-07-08
**Status:** approved, ready for implementation plan

## Project context

FlowForge is an AI automation builder: the user creates flows that take an input, process
it with an LLM (classify, extract structured data, summarize, transform), and send it to a
destination (save to DB, show table, export). Visual step editor. Stack: Next.js +
TypeScript, PostgreSQL + Prisma, Gemini/Groq, Zod validation. Deployed on Vercel + Neon;
local Postgres via `docker-compose` in development (already set up).

The full product is decomposed into independent sub-projects, each with its own
spec → plan → implementation cycle. Agreed order:

1. **Thin vertical slice** (this document): 1 flow, 1 LLM step, synchronous.
2. Visual step editor (multi-step, chaining).
3. Input sources: CSV upload + webhook.
4. Async orchestration + queues + retries.
5. Additional destinations & exports.

Each sub-project builds on something that already works.

## Slice #1 scope

**Included:**
- No authentication (single implicit user).
- Input: pasted text.
- A flow = name + prompt + list of output fields (name, type, required).
- Fixed task type: **extract structured data**.
- **Synchronous** execution.
- **Gemini** provider, behind an adapter with a common interface.
- JSON output **validated with Zod**, built dynamically from the fields.
- Persist every execution (`Run`) and show history in a table.
- Destination: save to DB + show table.

**Out of scope (later sub-projects):**
- Visual multi-step editor (#2).
- CSV / webhook (#3).
- Queues / async execution / retries (#4).
- Groq and other destinations / export (#5).
- Authentication (separate sub-project).

## Design decisions (with rationale)

- **Execution approach = thin engine (B).** The seams (step executor + provider adapter)
  are put in place without over-building. Today there is a single step type and a single
  provider, but more can be added without a rewrite. Avoids throwaway work while respecting YAGNI.
- **Gemini now, adapter designed for both.** The final version uses Gemini and Groq. The
  slice implements Gemini behind the `LlmProvider` interface; Groq slots in later without a refactor.
- **No auth in the slice.** The data model reserves `userId` (commented out) for the future.
- **Output fields stored as a `Json` column on `Flow`**, not a relational table. They are
  always read and written as a set; never queried field by field. The shape is validated with
  Zod on save, so the `Json` is not uncontrolled.
- **`required = false` → `.nullable()`** (the field is requested but `null` is allowed)
  instead of `.optional()`. With structured LLM output this gives more consistent results.
- **No retry** on validation failure in slice #1: the error is recorded as a visible `Run`
  (part of the demo). Retry with error feedback to the model is a future improvement.

## Execution data flow

```
User defines flow (name, prompt, fields)  ──►  persisted in DB
        │
        ▼
Pastes text  ──►  POST /api/flows/[id]/run { input }
        │
        ▼
runFlow(flowId, input):
   1. load the flow + its fields
   2. buildZodSchema(fields)      → Zod validator
   3. buildJsonSchema(fields)     → responseSchema for Gemini
   4. step "extract": Gemini adapter(prompt + input + responseSchema) → raw JSON
   5. Zod.safeParse(JSON)         → source of truth
   6. persist Run (input, output|error, provider, model, durationMs)
        │
        ▼
UI shows the extracted object + appends it to the history table
```

Two layers of structure: Gemini forces the shape via `responseSchema`, and Zod re-validates
as the source of truth. If the model returns something invalid, Zod catches it and it is
recorded as a visible error.

## Data model (Prisma / Postgres)

Replaces the placeholder `Post` model.

```prisma
model Flow {
  id        String   @id @default(cuid())
  name      String
  prompt    String
  taskType  String   @default("extract")   // fixed today; exists for extensibility (#2)
  fields    Json                            // [{ name, type, required, order }]
  runs      Run[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  // userId String?   ← reserved for future auth
}

model Run {
  id           String   @id @default(cuid())
  flowId       String
  flow         Flow     @relation(fields: [flowId], references: [id], onDelete: Cascade)
  input        String
  status       String   // "success" | "error"
  output       Json?    // extracted & validated object (null on error)
  errorMessage String?
  provider     String   // "gemini"
  model        String   // e.g. "gemini-2.0-flash"
  durationMs   Int?
  createdAt    DateTime @default(now())
}
```

Shape of each entry in `fields`: `{ name: string, type: "string" | "number" | "boolean" | "string_array", required: boolean, order: number }`.

## Execution engine, Gemini adapter, and dynamic Zod

Everything lives in `src/lib/flow/`:

```
src/lib/flow/
  types.ts              # FieldDef, RunResult, StepExecutor, LlmProvider…
  schema.ts             # buildZodSchema() + buildJsonSchema() from the fields
  runFlow.ts            # orchestrator: load flow → run step → persist Run
  steps/
    extract.ts          # "extract" step executor
    registry.ts         # taskType → StepExecutor  (only "extract" today)
  providers/
    types.ts            # LlmProvider interface
    gemini.ts           # Gemini implementation (responseSchema)
    index.ts            # getProvider(name) → factory
```

**The two seams (interfaces):**

```ts
// providers/types.ts — Gemini today, Groq in the future
interface LlmProvider {
  readonly name: string;      // "gemini"
  readonly model: string;     // "gemini-2.0-flash"
  generateStructured(args: {
    prompt: string;           // the flow's instruction
    input: string;            // the user's text
    jsonSchema: object;       // responseSchema derived from the fields
  }): Promise<unknown>;       // raw JSON (NOT yet trusted → Zod validates it)
}

// steps — what #2 (multi-step) will extend
interface StepExecutor {
  execute(ctx: { flow: Flow; input: string; provider: LlmProvider }): Promise<StepResult>;
}
```

**`runFlow(flowId, input)`:**
1. Load the `Flow` (or 404).
2. `getProvider("gemini")` (hardcoded today; the flow will be able to choose later).
3. Look up the `StepExecutor` by `flow.taskType` in the registry → always `extract` today.
4. Run it while measuring `durationMs`.
5. Persist the `Run` (success with `output`, or error with `errorMessage`).
6. Return `RunResult` to the API route.

**`extract` step (`steps/extract.ts`):**
1. `buildZodSchema(flow.fields)` → Zod validator.
2. `buildJsonSchema(flow.fields)` → `responseSchema` for Gemini.
3. Assemble the final prompt (instruction to extract only those fields + `flow.prompt` + `input`).
4. `provider.generateStructured(...)` → raw JSON.
5. `schema.safeParse(json)`:
   - ok → `StepResult` success with typed data.
   - fail → `StepResult` error with `z.treeifyError` detail. No retry in slice #1.

**Dynamic Zod construction (`schema.ts`) — the heart of the slice:**

```ts
const base = {
  string:       z.string(),
  number:       z.number(),
  boolean:      z.boolean(),
  string_array: z.array(z.string()),
}[field.type];

const zodField = field.required ? base : base.nullable();
// → z.object({ [name]: zodField, ... })
```

The JSON Schema for Gemini's `responseSchema` uses the same mapping
(`{ type, properties, required[] }`). One place defines the fields, two derived
representations: kept in sync by construction.

**Gemini adapter (`providers/gemini.ts`):** official Gemini SDK with
`responseMimeType: "application/json"` + `responseSchema`. Model and API key via env
(`GEMINI_API_KEY`, `GEMINI_MODEL` default `gemini-2.0-flash`). Consult the actual SDK docs
and Next docs (`node_modules/next/dist/docs/`) before writing code: `AGENTS.md` warns this
version of Next has changes relative to what is commonly known.

## UI and routes

**Rendering:** Server Components for reads + Server Actions for mutations
(create/edit/delete flow), which is idiomatic in modern Next. Execution goes through a
**route handler** (`POST /api/flows/[id]/run`) because webhooks (#3) and async triggering
(#4) need a real endpoint — that seam is put in place now.

**Pages (App Router):**

```
/                     Flow list (Server Component) + "New flow" button
/flows/new            Form: name, prompt, field editor (dynamic list)
/flows/[id]           Edit flow  +  "Test" panel:
                        · input textarea + "Run" button
                        · last run result
                        · run history table (input, status, output, date)
```

**Field editor** (client component): rows with `name` + `type`
(select: text / number / boolean / list of text) + `required` (checkbox) +
add / remove / reorder. Same component in `new` and `[id]`.

**Endpoints / actions:**
- Server Actions: `createFlow`, `updateFlow`, `deleteFlow` — validate with Zod before the DB.
- Route handler: `POST /api/flows/[id]/run` → calls `runFlow()`, returns `RunResult`.

**Input validation (Zod, in `src/lib/validations/`):** replace the example `post.ts` with
`flow.ts` containing `flowSchema`: non-empty `name`, non-empty `prompt`, `fields` with at
least 1, each field with a valid `name` (object key), `type` in the enum, `required` bool.
The same schema validates in Server Actions and the `Json` shape before persisting.

## Error handling

| Case | What happens |
|---|---|
| Empty input on run | 400 before calling the LLM |
| Missing `GEMINI_API_KEY` | Clear configuration error (not an opaque 500) |
| Gemini fails / times out | `Run.status = "error"`, `errorMessage`; UI shows it, does not crash |
| JSON fails Zod | `Run.status = "error"` with `z.treeifyError` detail — a deliberately visible error |
| Flow not found | 404 |

Principle: an execution failure **always** produces a persisted `Run` (success or error),
never an unrecorded exception. The history tells the truth about what happened.

## Testing

The provider is behind an interface: inject a mock `LlmProvider` and never call the real
Gemini in tests (neither flaky nor costly).

- **Unit `schema.ts`:** each field type → correct Zod; `required` vs `nullable`; derived
  JSON Schema matches the fields.
- **Unit `extract` step:** mock provider returning (a) valid JSON → typed success;
  (b) invalid JSON → error with Zod detail.
- **Unit `runFlow`:** mock provider, persists `Run` success and `Run` error correctly.
- **Light integration:** `POST /api/flows/[id]/run` with mock provider end-to-end.
- **Optional manual smoke:** script to paste real text against Gemini (outside the suite).

Runner: Vitest (natural with this stack); confirmed in the implementation plan.

## New environment variables

- `GEMINI_API_KEY` (required).
- `GEMINI_MODEL` (default `gemini-2.0-flash`).

Added to `.env` and `.env.example`.

## Noted future improvements

- Retry with validation-error feedback to the model.
- Per-flow provider/model selection (Gemini + Groq).
- Nested fields / enums in the output schema.
