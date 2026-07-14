# FlowForge Multi-provider (Groq) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Groq as a second LLM provider, selectable per flow from the UI, by moving schema-building behind the provider boundary so each provider builds its own request schema from the neutral field list.

**Architecture:** Approach A — `LlmProvider.generateStructured` receives the neutral `fields` (not a pre-built schema). Gemini builds its `Type`-enum schema internally; Groq builds standard strict JSON Schema and uses `json_schema` structured output. `Flow.provider` (a new column) is chosen in the editor and read by `runFlow`. Zod remains the source of truth for validation across both providers.

**Tech Stack:** Next.js 16, Prisma 7 (Postgres), Zod 4, `@google/genai` (Gemini), `groq-sdk` 1.3 (Groq), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-14-flowforge-multi-provider-design.md`

## Global Constraints

- All repo artifacts (code, comments, identifiers, commit messages, UI copy) in **English**.
- **Next.js 16** conventions: async `params`, `RouteContext<...>`, Server Actions for mutations. Consult `node_modules/next/dist/docs/` if unsure.
- Prisma client imported from `@/generated/prisma/client`.
- **Provider-agnostic boundary:** only `providers/gemini.ts` may import `@google/genai`; only `providers/groq.ts` may import `groq-sdk`. `types.ts`, `index.ts`, `schema.ts`, `steps/`, and `runFlow.ts` must not import a vendor SDK.
- **`flowSchema` is the single source of truth** for the allowed provider set (`z.enum(["gemini","groq"])`).
- Non-required fields use Zod `.nullable()` (key present, value may be null). Gemini expresses this as `nullable: true` (excluded from `required`); Groq strict mode expresses it as a null-union type with the key still in `required`.
- Groq uses `response_format: { type: "json_schema", json_schema: { name, schema, strict: true } }`.
- The provider receives an already-composed `prompt` (the step prepends its system instruction); providers must NOT prepend another system instruction — use `args.prompt` as-is.

---

## File Structure

- `providers/types.ts` — modify: `GenerateStructuredArgs.jsonSchema` → `fields: FieldDef[]`
- `schema.ts` — modify: remove `buildJsonSchema`/`baseJsonSchema` + `Type` import; keep `buildZodSchema`
- `schema.test.ts` — modify: drop the `buildJsonSchema` block + `Type` import
- `providers/gemini.ts` — modify: add exported `buildGeminiSchema(fields)`; `generateStructured` builds schema from `fields`
- `providers/gemini.schema.test.ts` — create: the migrated `Type`-enum assertions
- `providers/groq.ts` — create: `createGroqProvider()` + exported `buildGroqSchema(fields)`
- `providers/groq.schema.test.ts` — create: `buildGroqSchema` unit test
- `providers/index.ts` — modify: add `"groq"` case
- `providers/index.test.ts` — modify: add Groq factory tests
- `steps/extract.ts` — modify: pass `fields`, drop `buildJsonSchema`
- `prisma/schema.prisma` — modify: add `Flow.provider`
- `validations/flow.ts` — modify: add `provider` enum
- `validations/flow.test.ts` — modify: add provider tests
- `runFlow.ts` — modify: `getProvider(flow.provider)`
- `runFlow.test.ts` — modify: add `provider` to fixture
- `app/flows/actions.ts` — modify: persist `provider`
- `app/flows/FlowEditor.tsx` — modify: provider dropdown
- `app/flows/[id]/page.tsx` — modify: pass `flow.provider`
- `.env`, `.env.example` — modify: add `GROQ_API_KEY`, `GROQ_MODEL`
- `package.json` — modify: add `groq-sdk`

---

### Task 1: Interface refactor — provider receives `fields` (no behavior change)

Pure refactor: the interface stops carrying a pre-built schema; Gemini builds its own. Gemini remains the only provider and its runtime behavior is unchanged.

**Files:**
- Modify: `src/lib/flow/providers/types.ts`, `src/lib/flow/providers/gemini.ts`, `src/lib/flow/schema.ts`, `src/lib/flow/schema.test.ts`, `src/lib/flow/steps/extract.ts`
- Create: `src/lib/flow/providers/gemini.schema.test.ts`

**Interfaces:**
- Consumes: `FieldDef` from `../types`.
- Produces: `GenerateStructuredArgs { prompt: string; input: string; fields: FieldDef[] }`; `buildGeminiSchema(fields: FieldDef[]): object` (exported from `gemini.ts`); `schema.ts` exports only `buildZodSchema`.

- [ ] **Step 1: Change the interface to carry `fields`**

Replace the whole contents of `src/lib/flow/providers/types.ts`:
```ts
import type { FieldDef } from "../types";

export interface GenerateStructuredArgs {
  prompt: string;
  input: string;
  fields: FieldDef[];
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generateStructured(args: GenerateStructuredArgs): Promise<unknown>;
}
```

- [ ] **Step 2: Move the Gemini schema builder into `gemini.ts` and build from `fields`**

Replace the whole contents of `src/lib/flow/providers/gemini.ts`:
```ts
import { GoogleGenAI, Type } from "@google/genai";
import type { FieldDef } from "../types";
import type { GenerateStructuredArgs, LlmProvider } from "./types";

const DEFAULT_MODEL = "gemini-flash-latest";

function baseGeminiType(type: FieldDef["type"]): Record<string, unknown> {
  switch (type) {
    case "string":
      return { type: Type.STRING };
    case "number":
      return { type: Type.NUMBER };
    case "boolean":
      return { type: Type.BOOLEAN };
    case "string_array":
      return { type: Type.ARRAY, items: { type: Type.STRING } };
  }
}

export function buildGeminiSchema(fields: FieldDef[]): object {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of fields) {
    const prop = baseGeminiType(field.type);
    if (field.required) {
      required.push(field.name);
    } else {
      prop.nullable = true;
    }
    properties[field.name] = prop;
  }
  return { type: Type.OBJECT, properties, required };
}

export function createGeminiProvider(): LlmProvider {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const ai = new GoogleGenAI({ apiKey });

  return {
    name: "gemini",
    model,
    async generateStructured({ prompt, input, fields }: GenerateStructuredArgs): Promise<unknown> {
      const responseSchema = buildGeminiSchema(fields);
      const response = await ai.models.generateContent({
        model,
        contents: `${prompt}\n\nInput:\n${input}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema as never,
        },
      });
      const text = response.text;
      if (!text) {
        throw new Error("Gemini returned an empty response");
      }
      return JSON.parse(text);
    },
  };
}
```

- [ ] **Step 3: Trim `schema.ts` to `buildZodSchema` only**

Replace the whole contents of `src/lib/flow/schema.ts`:
```ts
import { z } from "zod";
import type { FieldDef } from "./types";

function baseZod(type: FieldDef["type"]): z.ZodTypeAny {
  switch (type) {
    case "string":
      return z.string();
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "string_array":
      return z.array(z.string());
  }
}

export function buildZodSchema(fields: FieldDef[]): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    const base = baseZod(field.type);
    shape[field.name] = field.required ? base : base.nullable();
  }
  return z.object(shape);
}
```

- [ ] **Step 4: Update `extract.ts` to pass `fields`**

Replace the whole contents of `src/lib/flow/steps/extract.ts`:
```ts
import { z } from "zod";
import { buildZodSchema } from "../schema";
import type { StepContext, StepExecutor, StepResult } from "./types";

const SYSTEM_INSTRUCTION =
  "You are a data extraction engine. Extract the requested fields from the input. " +
  "Return only the fields defined in the schema, with no extra commentary.";

export const extractStep: StepExecutor = {
  async execute({ prompt, input, fields, provider }: StepContext): Promise<StepResult> {
    const zodSchema = buildZodSchema(fields);

    let raw: unknown;
    try {
      raw = await provider.generateStructured({
        prompt: `${SYSTEM_INSTRUCTION}\n\n${prompt}`,
        input,
        fields,
      });
    } catch (err) {
      return {
        status: "error",
        output: null,
        errorMessage: `LLM error: ${(err as Error).message}`,
      };
    }

    const parsed = zodSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        status: "error",
        output: null,
        errorMessage: `Validation failed: ${JSON.stringify(z.treeifyError(parsed.error))}`,
      };
    }

    return {
      status: "success",
      output: parsed.data as Record<string, unknown>,
      errorMessage: null,
    };
  },
};
```

- [ ] **Step 5: Migrate the Gemini schema test out of `schema.test.ts`**

Replace the whole contents of `src/lib/flow/schema.test.ts` (removes the `buildJsonSchema` block and the `Type` import):
```ts
import { describe, expect, test } from "vitest";
import { buildZodSchema } from "./schema";
import type { FieldDef } from "./types";

const fields: FieldDef[] = [
  { name: "name", type: "string", required: true, order: 0 },
  { name: "age", type: "number", required: true, order: 1 },
  { name: "tags", type: "string_array", required: false, order: 2 },
];

describe("buildZodSchema", () => {
  test("accepts a matching object (nullable field present as null)", () => {
    const schema = buildZodSchema(fields);
    const r = schema.safeParse({ name: "Ada", age: 36, tags: null });
    expect(r.success).toBe(true);
  });

  test("rejects a wrong type", () => {
    const schema = buildZodSchema(fields);
    const r = schema.safeParse({ name: "Ada", age: "old", tags: null });
    expect(r.success).toBe(false);
  });

  test("requires the key even when the field is not required (nullable, not optional)", () => {
    const schema = buildZodSchema(fields);
    const r = schema.safeParse({ name: "Ada", age: 36 });
    expect(r.success).toBe(false);
  });
});
```

Create `src/lib/flow/providers/gemini.schema.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { Type } from "@google/genai";
import { buildGeminiSchema } from "./gemini";
import type { FieldDef } from "../types";

const fields: FieldDef[] = [
  { name: "name", type: "string", required: true, order: 0 },
  { name: "age", type: "number", required: true, order: 1 },
  { name: "tags", type: "string_array", required: false, order: 2 },
];

describe("buildGeminiSchema", () => {
  test("maps types and required list for Gemini responseSchema", () => {
    expect(buildGeminiSchema(fields)).toEqual({
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        age: { type: Type.NUMBER },
        tags: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
      },
      required: ["name", "age"],
    });
  });
});
```

- [ ] **Step 6: Run the suite + typecheck**

Run: `npm test`
Expected: all suites pass (the `buildGeminiSchema` test replaces the old `buildJsonSchema` one; `extract.test.ts` still passes because its mock provider ignores its arguments).

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/lib/flow/providers/types.ts src/lib/flow/providers/gemini.ts src/lib/flow/schema.ts src/lib/flow/schema.test.ts src/lib/flow/providers/gemini.schema.test.ts src/lib/flow/steps/extract.ts
git commit -m "refactor: providers build their own schema from fields"
```

---

### Task 2: Groq provider adapter + factory

**Files:**
- Create: `src/lib/flow/providers/groq.ts`, `src/lib/flow/providers/groq.schema.test.ts`
- Modify: `src/lib/flow/providers/index.ts`, `src/lib/flow/providers/index.test.ts`, `.env`, `.env.example`, `package.json`

**Interfaces:**
- Consumes: `FieldDef` from `../types`; `LlmProvider`, `GenerateStructuredArgs` from `./types`.
- Produces: `buildGroqSchema(fields: FieldDef[]): object` (standard strict JSON Schema); `createGroqProvider(): LlmProvider` (throws `"GROQ_API_KEY is not set"` if the key is missing; default model `openai/gpt-oss-20b`); `getProvider("groq")` returns it.

- [ ] **Step 1: Install the Groq SDK**

Run: `npm install groq-sdk`
Expected: added, no errors. (Confirm the installed default export is the client class: `import Groq from "groq-sdk"`.)

- [ ] **Step 2: Write the failing `buildGroqSchema` test**

Create `src/lib/flow/providers/groq.schema.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { buildGroqSchema } from "./groq";
import type { FieldDef } from "../types";

const fields: FieldDef[] = [
  { name: "name", type: "string", required: true, order: 0 },
  { name: "age", type: "number", required: true, order: 1 },
  { name: "tags", type: "string_array", required: false, order: 2 },
];

describe("buildGroqSchema", () => {
  test("builds strict JSON schema; non-required is a null-union but still required", () => {
    expect(buildGroqSchema(fields)).toEqual({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
        tags: { type: ["array", "null"], items: { type: "string" } },
      },
      required: ["name", "age", "tags"],
      additionalProperties: false,
    });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/lib/flow/providers/groq.schema.test.ts`
Expected: FAIL — cannot find module `./groq`.

- [ ] **Step 4: Write the Groq adapter**

Create `src/lib/flow/providers/groq.ts`:
```ts
import Groq from "groq-sdk";
import type { FieldDef } from "../types";
import type { GenerateStructuredArgs, LlmProvider } from "./types";

const DEFAULT_MODEL = "openai/gpt-oss-20b";

function baseGroqType(type: FieldDef["type"], nullable: boolean): Record<string, unknown> {
  const scalar = (t: string) => (nullable ? [t, "null"] : t);
  switch (type) {
    case "string":
      return { type: scalar("string") };
    case "number":
      return { type: scalar("number") };
    case "boolean":
      return { type: scalar("boolean") };
    case "string_array":
      return { type: scalar("array"), items: { type: "string" } };
  }
}

export function buildGroqSchema(fields: FieldDef[]): object {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of fields) {
    properties[field.name] = baseGroqType(field.type, !field.required);
    // Strict mode requires every key present; "optional" is expressed as null-union.
    required.push(field.name);
  }
  return { type: "object", properties, required, additionalProperties: false };
}

export function createGroqProvider(): LlmProvider {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set");
  }
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;
  const groq = new Groq({ apiKey });

  return {
    name: "groq",
    model,
    async generateStructured({ prompt, input, fields }: GenerateStructuredArgs): Promise<unknown> {
      const schema = buildGroqSchema(fields);
      const response = await groq.chat.completions.create({
        model,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: input },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "extraction", schema: schema as Record<string, unknown>, strict: true },
        },
      });
      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("Groq returned an empty response");
      }
      return JSON.parse(content);
    },
  };
}
```

> If `npx tsc --noEmit` rejects the `response_format`/`schema` shape, inspect `node_modules/groq-sdk/resources/chat/completions.d.ts` for the exact `json_schema` type and adjust the cast (do not use `any`/`@ts-ignore` without reporting). Also confirm `openai/gpt-oss-20b` is currently a `json_schema`-capable Groq model per Groq's structured-outputs docs; if it was renamed/removed, set `DEFAULT_MODEL` to the current equivalent and note it in your report.

- [ ] **Step 5: Run the schema test to verify it passes**

Run: `npx vitest run src/lib/flow/providers/groq.schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the `"groq"` case to the factory**

Replace the whole contents of `src/lib/flow/providers/index.ts`:
```ts
import type { LlmProvider } from "./types";
import { createGeminiProvider } from "./gemini";
import { createGroqProvider } from "./groq";

export function getProvider(name: string): LlmProvider {
  switch (name) {
    case "gemini":
      return createGeminiProvider();
    case "groq":
      return createGroqProvider();
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}
```

- [ ] **Step 7: Add factory tests for Groq**

Replace the whole contents of `src/lib/flow/providers/index.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getProvider } from "./index";

describe("getProvider", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GROQ_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("returns a gemini provider with name and model", () => {
    const provider = getProvider("gemini");
    expect(provider.name).toBe("gemini");
    expect(provider.model).toBe("gemini-flash-latest");
  });

  test("returns a groq provider with name and model", () => {
    const provider = getProvider("groq");
    expect(provider.name).toBe("groq");
    expect(provider.model).toBe("openai/gpt-oss-20b");
  });

  test("throws on an unknown provider", () => {
    expect(() => getProvider("openai")).toThrow(/Unknown provider/);
  });

  test("gemini provider throws a clear error when the API key is missing", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(() => getProvider("gemini")).toThrow(/GEMINI_API_KEY/);
  });

  test("groq provider throws a clear error when the API key is missing", () => {
    vi.stubEnv("GROQ_API_KEY", "");
    expect(() => getProvider("groq")).toThrow(/GROQ_API_KEY/);
  });
});
```

- [ ] **Step 8: Add env vars**

Append to `.env`:
```
# Groq
GROQ_API_KEY=""
GROQ_MODEL="openai/gpt-oss-20b"
```
Append the same two lines to `.env.example`.

- [ ] **Step 9: Run the suite + typecheck**

Run: `npm test`
Expected: all pass (including the two new Groq factory tests and the schema test).

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add src/lib/flow/providers/groq.ts src/lib/flow/providers/groq.schema.test.ts src/lib/flow/providers/index.ts src/lib/flow/providers/index.test.ts .env.example package.json package-lock.json
git commit -m "feat: add Groq provider with strict json_schema output"
```
(`.env` is gitignored and intentionally not staged.)

---

### Task 3: Data model — `Flow.provider` + validation

**Files:**
- Modify: `prisma/schema.prisma`, `src/lib/validations/flow.ts`, `src/lib/validations/flow.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Flow.provider String @default("gemini")`; `flowSchema` gains `provider: z.enum(["gemini","groq"]).default("gemini")`; `FlowInput` includes `provider`.

- [ ] **Step 1: Add the column to the schema**

In `prisma/schema.prisma`, inside `model Flow`, add after the `taskType` line:
```prisma
  provider  String   @default("gemini")   // "gemini" | "groq"
```

- [ ] **Step 2: Ensure Postgres is up and create the migration**

Run: `docker compose up -d`
Then: `npx prisma migrate dev --name flow_provider`
Expected: migration `..._flow_provider` created and applied; client regenerated. Existing `Flow` rows get `provider = "gemini"`.

- [ ] **Step 3: Write the failing validation tests**

In `src/lib/validations/flow.test.ts`, add these tests inside the `describe("flowSchema", ...)` block (after the duplicate-names test):
```ts
  test("accepts a valid provider", () => {
    expect(flowSchema.safeParse({ ...validFlow, provider: "groq" }).success).toBe(true);
  });

  test("rejects an unknown provider", () => {
    expect(flowSchema.safeParse({ ...validFlow, provider: "openai" }).success).toBe(false);
  });

  test("defaults the provider to gemini", () => {
    const parsed = flowSchema.parse(validFlow);
    expect(parsed.provider).toBe("gemini");
  });
```

- [ ] **Step 4: Run to verify the new tests fail**

Run: `npx vitest run src/lib/validations/flow.test.ts`
Expected: the three new tests FAIL (`provider` unknown key is stripped/undefined, enum not enforced).

- [ ] **Step 5: Add the provider field to `flowSchema`**

In `src/lib/validations/flow.ts`, add a `provider` key to the `flowSchema` object (alongside `name`, `prompt`, `fields`):
```ts
  provider: z.enum(["gemini", "groq"]).default("gemini"),
```
The full `flowSchema` becomes:
```ts
export const flowSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  prompt: z.string().trim().min(1, "Prompt is required").max(10_000),
  provider: z.enum(["gemini", "groq"]).default("gemini"),
  fields: z
    .array(fieldDefSchema)
    .min(1, "Add at least one field")
    .refine(
      (fields) => new Set(fields.map((f) => f.name)).size === fields.length,
      "Field names must be unique",
    ),
});
```

- [ ] **Step 6: Run to verify all pass**

Run: `npx vitest run src/lib/validations/flow.test.ts`
Expected: PASS (all existing + three new).

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/validations/flow.ts src/lib/validations/flow.test.ts
git commit -m "feat: add per-flow provider column and validation"
```

---

### Task 4: Wire provider through runFlow and server actions

**Files:**
- Modify: `src/lib/flow/runFlow.ts`, `src/lib/flow/runFlow.test.ts`, `src/app/flows/actions.ts`

**Interfaces:**
- Consumes: `getProvider` (Task 2); `flow.provider` (Task 3); `flowSchema` (Task 3).
- Produces: `runFlow` resolves the provider from `flow.provider`; `createFlow`/`updateFlow` persist `provider`.

- [ ] **Step 1: Resolve the provider from the flow**

In `src/lib/flow/runFlow.ts`, change the provider line (currently `const provider = deps.provider ?? getProvider("gemini");`) to:
```ts
  const provider = deps.provider ?? getProvider(flow.provider);
```

- [ ] **Step 2: Update the runFlow test fixture**

In `src/lib/flow/runFlow.test.ts`, add `provider: "gemini",` to the `flowRow` object so the fixture matches the real row shape:
```ts
const flowRow = {
  id: "flow_1",
  name: "Contacts",
  prompt: "extract",
  taskType: "extract",
  provider: "gemini",
  fields: [{ name: "name", type: "string", required: true, order: 0 }],
};
```

- [ ] **Step 3: Run the runFlow tests**

Run: `npx vitest run src/lib/flow/runFlow.test.ts`
Expected: PASS (the injected `deps.provider` still short-circuits `getProvider`, so behavior is unchanged; the fixture now carries `provider`).

- [ ] **Step 4: Persist provider in the server actions**

In `src/app/flows/actions.ts`, add `provider: parsed.provider,` to both the `create` and `update` data objects. `createFlow`'s data becomes:
```ts
    data: {
      name: parsed.name,
      prompt: parsed.prompt,
      taskType: "extract",
      provider: parsed.provider,
      fields: parsed.fields as unknown as Prisma.InputJsonValue,
    },
```
and `updateFlow`'s data becomes:
```ts
    data: {
      name: parsed.name,
      prompt: parsed.prompt,
      provider: parsed.provider,
      fields: parsed.fields as unknown as Prisma.InputJsonValue,
    },
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/flow/runFlow.ts src/lib/flow/runFlow.test.ts src/app/flows/actions.ts
git commit -m "feat: run flows with their selected provider"
```

---

### Task 5: UI — provider dropdown in the editor

**Files:**
- Modify: `src/app/flows/FlowEditor.tsx`, `src/app/flows/[id]/page.tsx`

**Interfaces:**
- Consumes: `createFlow`/`updateFlow` (Task 4); `flow.provider` (Task 3).
- Produces: a Provider dropdown whose value is included in the save payload; the `[id]` page passes `flow.provider` into the editor.

> No automated tests (UI is build-gated, per the project's testing scope). Gate: `npm run build`.

- [ ] **Step 1: Add provider state, dropdown, and payload wiring in `FlowEditor.tsx`**

Make these edits to `src/app/flows/FlowEditor.tsx`:

(a) Add a provider constant and extend the `EditorFlow` type (after line 8's `FIELD_TYPES`):
```ts
const PROVIDERS = ["gemini", "groq"] as const;

type EditorFlow = { id: string; name: string; prompt: string; provider: string; fields: FieldDef[] };
```
(replace the existing `type EditorFlow = ...` line).

(b) Add provider state (after the `prompt` state line):
```ts
  const [provider, setProvider] = useState(flow?.provider ?? "gemini");
```

(c) Include provider in the save payload (replace the `const payload = ...` line in `save()`):
```ts
    const payload = { name, prompt, provider, fields: fields.map((f, i) => ({ ...f, order: i })) };
```

(d) Add the dropdown in the form — insert this block between the Prompt `</label>` and the `<div>` that holds "Output fields":
```tsx
        <label className="block">
          <span className="text-sm font-medium">Provider</span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="mt-1 block w-full rounded border px-3 py-2"
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
```

- [ ] **Step 2: Pass `flow.provider` from the `[id]` page**

In `src/app/flows/[id]/page.tsx`, add `provider: flow.provider,` to the `flow` prop passed to `<FlowEditor>`:
```tsx
        flow={{
          id: flow.id,
          name: flow.name,
          prompt: flow.prompt,
          provider: flow.provider,
          fields: flow.fields as unknown as FieldDef[],
        }}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds; routes `/`, `/flows/new`, `/flows/[id]`, `/api/flows/[id]/run` present, no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/flows/FlowEditor.tsx "src/app/flows/[id]/page.tsx"
git commit -m "feat: choose the LLM provider per flow in the editor"
```

---

### Task 6: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Full suite + build + typecheck**

Run: `npm test` → all pass.
Run: `npx tsc --noEmit` → exit 0.
Run: `npm run build` → succeeds.

- [ ] **Step 2: Manual Groq run (needs a real key)**

Set a real `GROQ_API_KEY` in `.env`, ensure `docker compose up -d`, then `npm run dev`. Create a flow, select **Groq**, run the Support-ticket example text; confirm the extracted JSON and a success `Run` recorded with `provider: "groq"` and the resolved model. Run the nullable case (input omitting order/products) and confirm null fields.

- [ ] **Step 3: Regression — Gemini still works**

With a working `GEMINI_API_KEY` (once Gemini's 503 clears), create/select a Gemini flow and confirm a successful run recorded with `provider: "gemini"`.

- [ ] **Step 4: Verify persistence**

`npx prisma studio` → confirm the new `Flow.provider` column is populated and `Run` rows show the correct `provider`/`model`.

---

## Self-Review

**Spec coverage:**
- Groq adapter behind `LlmProvider` → Task 2. ✓
- Per-flow provider selection (column + dropdown) → Tasks 3, 5. ✓
- Interface refactor (approach A: provider builds own schema from `fields`) → Task 1. ✓
- Groq `json_schema` strict + null-union nullable matching Zod → Task 2 (`buildGroqSchema`). ✓
- `flowSchema` single source of truth for provider set → Task 3. ✓
- `runFlow` reads `flow.provider` → Task 4. ✓
- Provider-agnostic boundary (only gemini.ts/groq.ts import SDKs) → Tasks 1, 2. ✓
- Env vars `GROQ_API_KEY`/`GROQ_MODEL` → Task 2. ✓
- Error handling consistent (missing key thrown; API errors → visible error Run) → inherited from extract/runFlow (unchanged), Groq throws mirror Gemini. ✓
- Testing: buildGroqSchema, buildGeminiSchema (migrated), getProvider groq, flow provider validation → Tasks 1–3. ✓

**Placeholder scan:** No TBD/TODO. `DEFAULT_MODEL = "openai/gpt-oss-20b"` is concrete with a build-time confirmation note (Task 2 Step 4). ✓

**Type consistency:** `GenerateStructuredArgs.fields: FieldDef[]` used by both `extract.ts` (passes `fields`) and both providers (destructure `fields`). `buildGeminiSchema`/`buildGroqSchema` both `(fields: FieldDef[]) => object`. `flow.provider` (string column) read by `runFlow` and written by actions; `flowSchema.provider` enum feeds `parsed.provider`. `EditorFlow.provider` matches the `[id]` page's `flow.provider`. ✓

## Noted deviations
- Server actions (Task 4) and UI (Task 5) are gated by `tsc`/`npm run build` rather than unit tests, matching the project's testing scope. The Groq network call path is not unit-tested (only `buildGroqSchema` and the factory are), mirroring the Gemini approach.
