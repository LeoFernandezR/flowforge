# FlowForge — Multi-provider (Groq) Design

**Date:** 2026-07-14
**Status:** approved, ready for implementation plan
**Builds on:** slice #1 (`docs/superpowers/specs/2026-07-08-flowforge-slice1-design.md`)

## Context

Slice #1 shipped a single-provider (Gemini) extract flow. The `LlmProvider` interface
and `getProvider` factory were built so a second provider could be added without a rewrite.
This sub-project adds **Groq** as a second provider and makes the provider **selectable
per flow** from the UI.

The blocker that motivated doing this now: Gemini's free tier for older models was removed
and its servers intermittently return 503, making end-to-end testing unreliable. Groq gives
a fast, free, reliable alternative — and exercises the multi-provider design for real.

## Scope

**Included:**
- Groq provider adapter behind the existing `LlmProvider` interface.
- Per-flow provider selection (`Flow.provider`), chosen from a dropdown in the editor.
- Interface refactor (approach A): the provider receives the neutral `fields`, not a
  pre-built schema, and each provider builds its own request schema.
- Groq uses `json_schema` **strict** structured output.

**Out of scope:**
- Per-flow model selection (each provider uses an env-overridable default model).
- Additional providers beyond Gemini and Groq.
- Streaming, retries/backoff, cost tracking.
- Auth / rate limiting (still a separate later sub-project).

## Design decisions (with rationale)

- **Approach A — each provider builds its own schema from `fields`.** Gemini and Groq need
  different schema formats (Gemini's `Type` enum is uppercase; Groq/OpenAI need standard
  lowercase JSON Schema). Passing the neutral `fields` through the interface keeps the
  boundary honest (no provider format leaks through it), isolates each adapter, and avoids
  disturbing Gemini's proven request path (which is hard to verify live while Gemini 503s).
  The only cost is a small per-provider type-mapping switch — acceptable for the isolation.
- **Provider-only selection (no per-flow model).** Each provider carries an env-overridable
  default model; the resolved model is already recorded on `Run.model`. A per-flow model
  column + dependent dropdown was judged unnecessary surface area.
- **Groq `json_schema` strict mode.** Matches Gemini's enforced-output behavior. Zod remains
  the source of truth regardless, so if a configured model lacks support the API error is
  recorded as a visible error `Run` rather than producing silent bad data.
- **`flowSchema` is the single source of truth for the allowed provider set** (`z.enum`),
  used by the server actions and mirrored by the UI dropdown.

## Interface refactor (approach A)

```ts
// src/lib/flow/providers/types.ts
interface GenerateStructuredArgs {
  prompt: string;
  input: string;
  fields: FieldDef[];          // was: jsonSchema: object
}

interface LlmProvider {
  readonly name: string;       // "gemini" | "groq"
  readonly model: string;
  generateStructured(args: GenerateStructuredArgs): Promise<unknown>;
}
```

**Where schema-building lives after the refactor:**
- `schema.ts` keeps **only** `buildZodSchema(fields)` — validation, provider-agnostic, still
  called by `extract.ts`.
- `providers/gemini.ts` owns `buildGeminiSchema(fields)` (the `Type`-enum builder moved out
  of `schema.ts`, unchanged in behavior).
- `providers/groq.ts` owns `buildGroqSchema(fields)` (standard JSON Schema).
- `steps/extract.ts` builds the Zod validator and passes `fields` to the provider; it no
  longer builds any request schema.

**`extract.ts` after the change:**
```ts
const zodSchema = buildZodSchema(fields);
const raw = await provider.generateStructured({
  prompt: `${SYSTEM_INSTRUCTION}\n\n${prompt}`,
  input,
  fields,
});
// zodSchema.safeParse(raw) → source of truth (unchanged)
```

## Data model & validation

**Prisma — one new column on `Flow`:**
```prisma
provider String @default("gemini")   // "gemini" | "groq"
```
A migration adds it; existing rows default to `"gemini"`. No model column — the resolved
model comes from the provider's env default and is recorded on `Run.model`.

**Validation (`validations/flow.ts`):**
```ts
provider: z.enum(["gemini", "groq"]).default("gemini")
```
Added to `flowSchema`. Single source of truth for the allowed set.

## UI

`FlowEditor.tsx` gains a **Provider** dropdown (Gemini / Groq) alongside name/prompt. Its
value is included in the `createFlow` / `updateFlow` payload. The `/flows/[id]` page passes
`flow.provider` into the editor; `actions.ts` persists it. Default selection for a new flow
is Gemini.

## Groq adapter

`providers/groq.ts`, using the `groq-sdk` (OpenAI-compatible) package.

```ts
export function createGroqProvider(): LlmProvider {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set");
  const model = process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL;
  const groq = new Groq({ apiKey });
  return {
    name: "groq",
    model,
    async generateStructured({ prompt, input, fields }) {
      const schema = buildGroqSchema(fields);
      const res = await groq.chat.completions.create({
        model,
        messages: [
          { role: "system", content: `${SYSTEM_INSTRUCTION}\n\n${prompt}` },
          { role: "user", content: input },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "extraction", schema, strict: true },
        },
      });
      const content = res.choices[0]?.message?.content;
      if (!content) throw new Error("Groq returned an empty response");
      return JSON.parse(content);
    },
  };
}
```

**`DEFAULT_GROQ_MODEL`:** a Groq model that currently supports `json_schema` strict
structured output (e.g. `openai/gpt-oss-20b`). The implementer confirms the default against
Groq's structured-outputs documentation at build time, since the supported-model list
changes. Env-overridable via `GROQ_MODEL`.

**`buildGroqSchema(fields)` — matches the Zod `.nullable()` contract.** Strict JSON Schema
requires every property in `required`, so "optional" is expressed as a null-union type,
which is exactly what `buildZodSchema` produces with `.nullable()` (key present, value may
be null):
- type mapping: `string → "string"`, `number → "number"`, `boolean → "boolean"`,
  `string_array → { "type": "array", "items": { "type": "string" } }`.
- required field: plain type, listed in `required`.
- non-required field: null-union type (`{ "type": ["string", "null"] }`, or for arrays
  `{ "type": ["array", "null"], "items": { "type": "string" } }`), **also** listed in
  `required` (strict mode requires all keys present).
- result: `{ "type": "object", "properties": {...}, "required": [<all field names>],
  "additionalProperties": false }`.

## runFlow wiring & error handling

**`runFlow`:** one line changes.
```ts
const provider = deps.provider ?? getProvider(flow.provider);  // was getProvider("gemini")
```
`getProvider` gains a `"groq"` case → `createGroqProvider()`. Because `flow.provider` is
enum-validated on save, the factory only receives valid values; it still throws
`Unknown provider: <name>` defensively.

**Errors (consistent with Gemini):**

| Case | Behavior |
|---|---|
| Missing `GROQ_API_KEY` | Thrown config error `"GROQ_API_KEY is not set"` → surfaces as the hardened generic 500 + server-side log |
| Groq 429 / 503 / API error | Caught in the extract step → recorded as a visible error `Run` (`status: "error"`) |
| Model lacks `json_schema` support | Same as an API error → visible error `Run`; Zod is the safety net |

## Environment variables

Add to `.env` and `.env.example` (Gemini vars unchanged):
- `GROQ_API_KEY` (required to use the Groq provider).
- `GROQ_MODEL` (default `openai/gpt-oss-20b` — a `json_schema`-capable Groq model;
  the implementer confirms this default against Groq's structured-outputs docs at build time).

## Testing

Same philosophy as slice #1: providers behind an interface, mocked in tests; no live
network calls.

- **`buildGroqSchema` unit test:** each field type → correct lowercase JSON Schema;
  non-required → null-union type and still in `required`; all field names in `required`;
  `additionalProperties: false`.
- **`buildGeminiSchema` unit test:** the `Type`-enum assertions migrated out of the current
  `schema.test.ts`. `schema.test.ts` is trimmed to `buildZodSchema` only.
- **`getProvider` test:** `"groq"` returns a provider with name and default model; throws
  without `GROQ_API_KEY`; existing `"gemini"` and unknown-provider cases retained.
- **`extract.test.ts`:** update the mock provider's `generateStructured` to the new
  `{ prompt, input, fields }` signature; the three outcome assertions are unchanged.
- **`runFlow.test.ts`:** add `provider` to the flow fixture; continues to inject
  `deps.provider`.
- **`flow.test.ts`:** `provider` accepts `gemini`/`groq`, rejects other values, defaults to
  `gemini`.
- No live Groq network test. UI change gated by `npm run build`.

## Manual verification

With a real `GROQ_API_KEY` set: create a flow, choose **Groq**, run the Support-ticket
example text, confirm the extracted JSON + a success `Run` recorded with
`provider: "groq"` and the resolved model. Repeat with the nullable-field case.

## Noted future improvements

- Per-flow (or per-run) model selection.
- Retry/backoff for transient 429/503 across providers.
- A `json_object` fallback path for Groq models without `json_schema` support.
