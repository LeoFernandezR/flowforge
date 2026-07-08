# FlowForge Slice #1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a thin end-to-end vertical slice where a user creates a single-step "extract structured data" flow, runs pasted text through Gemini, gets JSON validated with a dynamically-built Zod schema, and sees the persisted run history in a table.

**Architecture:** A thin execution engine (`src/lib/flow/`) with two seams — a `StepExecutor` registry (only `extract` today) and an `LlmProvider` adapter (only Gemini today). Reads use Server Components, mutations use Server Actions, and execution uses a route handler (`POST /api/flows/[id]/run`) so webhooks/async can reuse it later. Gemini's `responseSchema` forces the output shape; Zod re-validates as the source of truth.

**Tech Stack:** Next.js 16.2.10 (App Router, React 19), TypeScript, PostgreSQL + Prisma 7 (pg driver adapter), `@google/genai` 2.10.0, Zod 4, Vitest.

## Global Constraints

- **Language:** Everything committed to the repo (code, comments, identifiers, commit messages, UI copy, docs) MUST be in English.
- **Next.js is v16** — do NOT rely on pre-16 conventions. `params` is a `Promise` and must be awaited. Route handlers type the second arg with `RouteContext<'/route/path'>`. Consult `node_modules/next/dist/docs/` when unsure.
- **Prisma client import path:** `@/generated/prisma/client` (the v7 `prisma-client` generator emits `client.ts`, not an index barrel).
- **Provider adapter must stay provider-agnostic** — the final product uses Gemini **and** Groq. Only Gemini is implemented in this slice, but nothing outside `providers/gemini.ts` may reference Gemini directly.
- **Gemini model default:** `gemini-2.0-flash`, overridable via `GEMINI_MODEL`. API key via `GEMINI_API_KEY`.
- **No auth** in this slice. Do not add user concepts beyond the reserved (commented) `userId`.
- **Non-required output fields use `.nullable()`** (key present, value may be `null`), not `.optional()`.

---

## File Structure

- `vitest.config.ts` — test runner config (create)
- `.env`, `.env.example` — add `GEMINI_API_KEY`, `GEMINI_MODEL` (modify)
- `package.json` — add `test` scripts (modify)
- `prisma/schema.prisma` — replace `Post` with `Flow` + `Run` (modify)
- `src/lib/validations/flow.ts` — Zod schemas for flow CRUD + run input (create)
- `src/lib/validations/post.ts` — remove (delete)
- `src/lib/flow/types.ts` — shared engine types (create)
- `src/lib/flow/schema.ts` — `buildZodSchema`, `buildJsonSchema` (create)
- `src/lib/flow/providers/types.ts` — `LlmProvider` interface (create)
- `src/lib/flow/providers/gemini.ts` — Gemini adapter (create)
- `src/lib/flow/providers/index.ts` — `getProvider` factory (create)
- `src/lib/flow/steps/types.ts` — `StepExecutor`, `StepContext`, `StepResult` (create)
- `src/lib/flow/steps/extract.ts` — extract step executor (create)
- `src/lib/flow/steps/registry.ts` — `getStepExecutor` (create)
- `src/lib/flow/runFlow.ts` — orchestrator (create)
- `src/app/flows/actions.ts` — `createFlow`, `updateFlow`, `deleteFlow` Server Actions (create)
- `src/app/api/flows/[id]/run/route.ts` — run route handler (create)
- `src/app/page.tsx` — flow list (modify)
- `src/app/flows/new/page.tsx` — new-flow page (create)
- `src/app/flows/[id]/page.tsx` — edit + test page (create)
- `src/app/flows/FlowEditor.tsx` — client editor + test panel (create)

Tests live next to their subject as `*.test.ts` (e.g. `src/lib/flow/schema.test.ts`).

---

### Task 1: Test tooling & environment setup

**Files:**
- Create: `vitest.config.ts`
- Test: `src/lib/smoke.test.ts` (temporary, deleted at end of task)
- Modify: `package.json`, `.env`, `.env.example`

**Interfaces:**
- Consumes: nothing.
- Produces: a working `npm test` command (Vitest, node environment, `@/*` alias resolution) that later tasks rely on.

- [ ] **Step 1: Install Vitest and the tsconfig-paths resolver**

Run:
```bash
npm install -D vitest vite-tsconfig-paths
```
Expected: packages added, no errors. (`@google/genai` is already installed.)

- [ ] **Step 2: Create the Vitest config**

Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Add test scripts to package.json**

In `package.json`, add to the `"scripts"` object:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Add env vars**

Append to `.env`:
```
# Gemini (Google GenAI)
GEMINI_API_KEY=""
GEMINI_MODEL="gemini-2.0-flash"
```
Append the same two lines to `.env.example` (keep `GEMINI_API_KEY=""` empty there too).

- [ ] **Step 5: Write a temporary smoke test**

Create `src/lib/smoke.test.ts`:
```ts
import { expect, test } from "vitest";

test("vitest runs", () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 6: Run the test to verify the harness works**

Run: `npm test`
Expected: PASS, 1 test passed.

- [ ] **Step 7: Delete the smoke test and commit**

```bash
rm src/lib/smoke.test.ts
git add vitest.config.ts package.json package-lock.json .env.example
git commit -m "chore: set up Vitest and Gemini env vars"
```
(`.env` is gitignored and intentionally not staged.)

---

### Task 2: Prisma schema — Flow and Run models

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma models `Flow { id, name, prompt, taskType, fields: Json, runs, createdAt, updatedAt }` and `Run { id, flowId, flow, input, status, output: Json?, errorMessage, provider, model, durationMs, createdAt }`. Generated types importable from `@/generated/prisma/client` as `Flow`, `Run`, and the `Prisma` namespace.

- [ ] **Step 1: Replace the Post model**

In `prisma/schema.prisma`, delete the entire `Post` model and add:
```prisma
model Flow {
  id        String   @id @default(cuid())
  name      String
  prompt    String
  taskType  String   @default("extract")
  fields    Json
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
  status       String
  output       Json?
  errorMessage String?
  provider     String
  model        String
  durationMs   Int?
  createdAt    DateTime @default(now())

  @@index([flowId])
}
```

- [ ] **Step 2: Ensure the local Postgres container is running**

Run: `docker compose up -d`
Expected: `flowforge-db` container running (started earlier; this is idempotent).

- [ ] **Step 3: Create and apply the migration (also regenerates the client)**

Run: `npx prisma migrate dev --name flow_and_run`
Expected: migration `..._flow_and_run` created and applied; "Your database is now in sync with your schema."

- [ ] **Step 4: Verify the types compile**

Run: `npx tsc --noEmit`
Expected: exit 0. (Note: `src/lib/validations/post.ts` still references `Post` only via Zod, not Prisma, so it stays green; it is removed in Task 3.)

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: replace Post with Flow and Run models"
```

---

### Task 3: Zod validation schemas

**Files:**
- Create: `src/lib/validations/flow.ts`
- Delete: `src/lib/validations/post.ts`
- Test: `src/lib/validations/flow.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `fieldTypeSchema: z.ZodEnum` over `"string" | "number" | "boolean" | "string_array"`
  - `fieldDefSchema` validating `{ name, type, required, order }`
  - `flowSchema` validating `{ name, prompt, fields }`, exported type `FlowInput`
  - `runInputSchema` validating `{ input }`, exported type `RunInput`

- [ ] **Step 1: Write the failing test**

Create `src/lib/validations/flow.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { flowSchema, fieldDefSchema, runInputSchema } from "./flow";

describe("flowSchema", () => {
  const validFlow = {
    name: "Contacts",
    prompt: "Extract the contact",
    fields: [{ name: "email", type: "string", required: true, order: 0 }],
  };

  test("accepts a valid flow", () => {
    expect(flowSchema.safeParse(validFlow).success).toBe(true);
  });

  test("rejects an empty name", () => {
    expect(flowSchema.safeParse({ ...validFlow, name: "  " }).success).toBe(false);
  });

  test("rejects a flow with no fields", () => {
    expect(flowSchema.safeParse({ ...validFlow, fields: [] }).success).toBe(false);
  });
});

describe("fieldDefSchema", () => {
  test("rejects a field name that is not an identifier", () => {
    const r = fieldDefSchema.safeParse({ name: "2bad", type: "string", required: true, order: 0 });
    expect(r.success).toBe(false);
  });

  test("rejects an unknown type", () => {
    const r = fieldDefSchema.safeParse({ name: "x", type: "date", required: true, order: 0 });
    expect(r.success).toBe(false);
  });
});

describe("runInputSchema", () => {
  test("rejects empty input", () => {
    expect(runInputSchema.safeParse({ input: "   " }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/validations/flow.test.ts`
Expected: FAIL — cannot find module `./flow`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/validations/flow.ts`:
```ts
import { z } from "zod";

export const fieldTypeSchema = z.enum(["string", "number", "boolean", "string_array"]);

export const fieldDefSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Field name is required")
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Must be a valid identifier"),
  type: fieldTypeSchema,
  required: z.boolean(),
  order: z.number().int().nonnegative(),
});

export const flowSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  prompt: z.string().trim().min(1, "Prompt is required").max(10_000),
  fields: z.array(fieldDefSchema).min(1, "Add at least one field"),
});

export const runInputSchema = z.object({
  input: z.string().trim().min(1, "Input is required"),
});

export type FlowInput = z.infer<typeof flowSchema>;
export type RunInput = z.infer<typeof runInputSchema>;
```

- [ ] **Step 4: Delete the example post validation**

Run: `rm src/lib/validations/post.ts`

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/validations/flow.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/validations/flow.ts src/lib/validations/flow.test.ts
git rm src/lib/validations/post.ts
git commit -m "feat: add flow and run-input Zod schemas"
```

---

### Task 4: Shared engine types and dynamic schema builders

**Files:**
- Create: `src/lib/flow/types.ts`
- Create: `src/lib/flow/schema.ts`
- Test: `src/lib/flow/schema.test.ts`

**Interfaces:**
- Consumes: `Type` from `@google/genai`.
- Produces:
  - `types.ts`: `type FieldType = "string" | "number" | "boolean" | "string_array"`; `interface FieldDef { name: string; type: FieldType; required: boolean; order: number }`.
  - `schema.ts`: `buildZodSchema(fields: FieldDef[]): z.ZodObject<Record<string, z.ZodTypeAny>>` and `buildJsonSchema(fields: FieldDef[]): object` (a Google GenAI `responseSchema` object using the `Type` enum).

- [ ] **Step 1: Create the shared types**

Create `src/lib/flow/types.ts`:
```ts
export type FieldType = "string" | "number" | "boolean" | "string_array";

export interface FieldDef {
  name: string;
  type: FieldType;
  required: boolean;
  order: number;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/flow/schema.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { Type } from "@google/genai";
import { buildZodSchema, buildJsonSchema } from "./schema";
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

describe("buildJsonSchema", () => {
  test("maps types and required list for Gemini responseSchema", () => {
    expect(buildJsonSchema(fields)).toEqual({
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

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/lib/flow/schema.test.ts`
Expected: FAIL — cannot find module `./schema`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/flow/schema.ts`:
```ts
import { z } from "zod";
import { Type } from "@google/genai";
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

function baseJsonSchema(type: FieldDef["type"]): Record<string, unknown> {
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

export function buildJsonSchema(fields: FieldDef[]): object {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of fields) {
    const prop = baseJsonSchema(field.type);
    if (field.required) {
      required.push(field.name);
    } else {
      prop.nullable = true;
    }
    properties[field.name] = prop;
  }
  return { type: Type.OBJECT, properties, required };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/flow/schema.test.ts`
Expected: PASS, all green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/flow/types.ts src/lib/flow/schema.ts src/lib/flow/schema.test.ts
git commit -m "feat: add dynamic Zod and Gemini JSON schema builders"
```

---

### Task 5: Provider interface, Gemini adapter, and factory

**Files:**
- Create: `src/lib/flow/providers/types.ts`
- Create: `src/lib/flow/providers/gemini.ts`
- Create: `src/lib/flow/providers/index.ts`
- Test: `src/lib/flow/providers/index.test.ts`

**Interfaces:**
- Consumes: `GoogleGenAI` from `@google/genai`; `GEMINI_API_KEY`, `GEMINI_MODEL` env.
- Produces:
  - `types.ts`: `interface GenerateStructuredArgs { prompt: string; input: string; jsonSchema: object }`; `interface LlmProvider { readonly name: string; readonly model: string; generateStructured(args: GenerateStructuredArgs): Promise<unknown> }`.
  - `gemini.ts`: `createGeminiProvider(): LlmProvider` (throws `"GEMINI_API_KEY is not set"` if the key is missing).
  - `index.ts`: `getProvider(name: string): LlmProvider` (throws `Unknown provider: <name>` for anything but `"gemini"`).

- [ ] **Step 1: Write the failing test (factory behavior only — no network)**

Create `src/lib/flow/providers/index.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getProvider } from "./index";

describe("getProvider", () => {
  const original = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    process.env.GEMINI_API_KEY = original;
  });

  test("returns a gemini provider with name and model", () => {
    const provider = getProvider("gemini");
    expect(provider.name).toBe("gemini");
    expect(provider.model).toBe("gemini-2.0-flash");
  });

  test("throws on an unknown provider", () => {
    expect(() => getProvider("groq")).toThrow(/Unknown provider/);
  });

  test("gemini provider throws a clear error when the API key is missing", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(() => getProvider("gemini")).toThrow(/GEMINI_API_KEY/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/flow/providers/index.test.ts`
Expected: FAIL — cannot find module `./index`.

- [ ] **Step 3: Write the provider interface**

Create `src/lib/flow/providers/types.ts`:
```ts
export interface GenerateStructuredArgs {
  prompt: string;
  input: string;
  jsonSchema: object;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generateStructured(args: GenerateStructuredArgs): Promise<unknown>;
}
```

- [ ] **Step 4: Write the Gemini adapter**

Create `src/lib/flow/providers/gemini.ts`:
```ts
import { GoogleGenAI } from "@google/genai";
import type { GenerateStructuredArgs, LlmProvider } from "./types";

const DEFAULT_MODEL = "gemini-2.0-flash";

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
    async generateStructured({ prompt, input, jsonSchema }: GenerateStructuredArgs): Promise<unknown> {
      const response = await ai.models.generateContent({
        model,
        contents: `${prompt}\n\nInput:\n${input}`,
        config: {
          responseMimeType: "application/json",
          // Google GenAI Schema type is structurally compatible with our builder output.
          responseSchema: jsonSchema as never,
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

- [ ] **Step 5: Write the factory**

Create `src/lib/flow/providers/index.ts`:
```ts
import type { LlmProvider } from "./types";
import { createGeminiProvider } from "./gemini";

export function getProvider(name: string): LlmProvider {
  switch (name) {
    case "gemini":
      return createGeminiProvider();
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/flow/providers/index.test.ts`
Expected: PASS, all green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/flow/providers
git commit -m "feat: add LlmProvider interface, Gemini adapter, and factory"
```

---

### Task 6: Extract step executor

**Files:**
- Create: `src/lib/flow/steps/types.ts`
- Create: `src/lib/flow/steps/extract.ts`
- Test: `src/lib/flow/steps/extract.test.ts`

**Interfaces:**
- Consumes: `buildZodSchema`, `buildJsonSchema` (Task 4); `LlmProvider` (Task 5); `FieldDef` (Task 4).
- Produces:
  - `types.ts`: `interface StepContext { prompt: string; input: string; fields: FieldDef[]; provider: LlmProvider }`; `interface StepResult { status: "success" | "error"; output: Record<string, unknown> | null; errorMessage: string | null }`; `interface StepExecutor { execute(ctx: StepContext): Promise<StepResult> }`.
  - `extract.ts`: `export const extractStep: StepExecutor`.

- [ ] **Step 1: Write the step types**

Create `src/lib/flow/steps/types.ts`:
```ts
import type { FieldDef } from "../types";
import type { LlmProvider } from "../providers/types";

export interface StepContext {
  prompt: string;
  input: string;
  fields: FieldDef[];
  provider: LlmProvider;
}

export interface StepResult {
  status: "success" | "error";
  output: Record<string, unknown> | null;
  errorMessage: string | null;
}

export interface StepExecutor {
  execute(ctx: StepContext): Promise<StepResult>;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/flow/steps/extract.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { extractStep } from "./extract";
import type { LlmProvider } from "../providers/types";
import type { FieldDef } from "../types";

const fields: FieldDef[] = [
  { name: "name", type: "string", required: true, order: 0 },
  { name: "age", type: "number", required: true, order: 1 },
];

function mockProvider(returns: unknown): LlmProvider {
  return {
    name: "mock",
    model: "mock-1",
    generateStructured: async () => returns,
  };
}

describe("extractStep", () => {
  test("returns typed success when the LLM output validates", async () => {
    const result = await extractStep.execute({
      prompt: "extract",
      input: "Ada, 36",
      fields,
      provider: mockProvider({ name: "Ada", age: 36 }),
    });
    expect(result.status).toBe("success");
    expect(result.output).toEqual({ name: "Ada", age: 36 });
    expect(result.errorMessage).toBeNull();
  });

  test("returns an error when the LLM output fails Zod validation", async () => {
    const result = await extractStep.execute({
      prompt: "extract",
      input: "Ada, old",
      fields,
      provider: mockProvider({ name: "Ada", age: "old" }),
    });
    expect(result.status).toBe("error");
    expect(result.output).toBeNull();
    expect(result.errorMessage).toMatch(/Validation failed/);
  });

  test("returns an error when the provider throws", async () => {
    const provider: LlmProvider = {
      name: "mock",
      model: "mock-1",
      generateStructured: async () => {
        throw new Error("network down");
      },
    };
    const result = await extractStep.execute({ prompt: "x", input: "y", fields, provider });
    expect(result.status).toBe("error");
    expect(result.errorMessage).toMatch(/LLM error: network down/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/lib/flow/steps/extract.test.ts`
Expected: FAIL — cannot find module `./extract`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/flow/steps/extract.ts`:
```ts
import { z } from "zod";
import { buildJsonSchema, buildZodSchema } from "../schema";
import type { StepContext, StepExecutor, StepResult } from "./types";

const SYSTEM_INSTRUCTION =
  "You are a data extraction engine. Extract the requested fields from the input. " +
  "Return only the fields defined in the schema, with no extra commentary.";

export const extractStep: StepExecutor = {
  async execute({ prompt, input, fields, provider }: StepContext): Promise<StepResult> {
    const zodSchema = buildZodSchema(fields);
    const jsonSchema = buildJsonSchema(fields);

    let raw: unknown;
    try {
      raw = await provider.generateStructured({
        prompt: `${SYSTEM_INSTRUCTION}\n\n${prompt}`,
        input,
        jsonSchema,
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

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/flow/steps/extract.test.ts`
Expected: PASS, all green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/flow/steps/types.ts src/lib/flow/steps/extract.ts src/lib/flow/steps/extract.test.ts
git commit -m "feat: add extract step executor with Zod validation"
```

---

### Task 7: Step registry and runFlow orchestrator

**Files:**
- Create: `src/lib/flow/steps/registry.ts`
- Create: `src/lib/flow/runFlow.ts`
- Test: `src/lib/flow/runFlow.test.ts`

**Interfaces:**
- Consumes: `getStepExecutor` (this task); `getProvider` (Task 5); `extractStep` (Task 6); `prisma` from `@/lib/prisma`; Prisma types from `@/generated/prisma/client`; `FieldDef` (Task 4); `LlmProvider` (Task 5).
- Produces:
  - `registry.ts`: `getStepExecutor(taskType: string): StepExecutor` (throws `Unknown task type: <taskType>`).
  - `runFlow.ts`: `interface RunFlowDeps { provider?: LlmProvider }`; `runFlow(flowId: string, input: string, deps?: RunFlowDeps): Promise<Run>` (throws `"Flow not found"` when the flow is missing; otherwise always persists and returns a `Run` row).

- [ ] **Step 1: Write the registry**

Create `src/lib/flow/steps/registry.ts`:
```ts
import type { StepExecutor } from "./types";
import { extractStep } from "./extract";

const stepRegistry: Record<string, StepExecutor> = {
  extract: extractStep,
};

export function getStepExecutor(taskType: string): StepExecutor {
  const step = stepRegistry[taskType];
  if (!step) {
    throw new Error(`Unknown task type: ${taskType}`);
  }
  return step;
}
```

- [ ] **Step 2: Write the failing test (prisma mocked, provider injected)**

Create `src/lib/flow/runFlow.test.ts`:
```ts
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    flow: { findUnique: vi.fn() },
    run: { create: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { runFlow } from "./runFlow";
import type { LlmProvider } from "./providers/types";

const provider: LlmProvider = {
  name: "mock",
  model: "mock-1",
  generateStructured: async () => ({ name: "Ada" }),
};

const flowRow = {
  id: "flow_1",
  name: "Contacts",
  prompt: "extract",
  taskType: "extract",
  fields: [{ name: "name", type: "string", required: true, order: 0 }],
};

beforeEach(() => {
  vi.mocked(prisma.run.create).mockReset();
  vi.mocked(prisma.flow.findUnique).mockReset();
  vi.mocked(prisma.run.create).mockImplementation(async ({ data }: { data: unknown }) => ({
    id: "run_1",
    ...(data as object),
  }));
});

describe("runFlow", () => {
  test("throws when the flow does not exist", async () => {
    vi.mocked(prisma.flow.findUnique).mockResolvedValue(null);
    await expect(runFlow("missing", "hi", { provider })).rejects.toThrow("Flow not found");
  });

  test("persists a success run with output and provider metadata", async () => {
    vi.mocked(prisma.flow.findUnique).mockResolvedValue(flowRow as never);
    await runFlow("flow_1", "Ada", { provider });

    const arg = vi.mocked(prisma.run.create).mock.calls[0][0].data;
    expect(arg).toMatchObject({
      flowId: "flow_1",
      input: "Ada",
      status: "success",
      output: { name: "Ada" },
      provider: "mock",
      model: "mock-1",
    });
    expect(typeof arg.durationMs).toBe("number");
  });

  test("persists an error run when validation fails", async () => {
    vi.mocked(prisma.flow.findUnique).mockResolvedValue(flowRow as never);
    const badProvider: LlmProvider = { ...provider, generateStructured: async () => ({ name: 123 }) };
    await runFlow("flow_1", "Ada", { provider: badProvider });

    const arg = vi.mocked(prisma.run.create).mock.calls[0][0].data;
    expect(arg.status).toBe("error");
    expect(arg.output).toBeUndefined();
    expect(arg.errorMessage).toMatch(/Validation failed/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/lib/flow/runFlow.test.ts`
Expected: FAIL — cannot find module `./runFlow`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/flow/runFlow.ts`:
```ts
import { prisma } from "@/lib/prisma";
import type { Prisma, Run } from "@/generated/prisma/client";
import { getProvider } from "./providers";
import type { LlmProvider } from "./providers/types";
import { getStepExecutor } from "./steps/registry";
import type { FieldDef } from "./types";

export interface RunFlowDeps {
  provider?: LlmProvider;
}

export async function runFlow(flowId: string, input: string, deps: RunFlowDeps = {}): Promise<Run> {
  const flow = await prisma.flow.findUnique({ where: { id: flowId } });
  if (!flow) {
    throw new Error("Flow not found");
  }

  const provider = deps.provider ?? getProvider("gemini");
  const step = getStepExecutor(flow.taskType);
  const fields = flow.fields as unknown as FieldDef[];

  const start = Date.now();
  const result = await step.execute({ prompt: flow.prompt, input, fields, provider });
  const durationMs = Date.now() - start;

  return prisma.run.create({
    data: {
      flowId: flow.id,
      input,
      status: result.status,
      output: result.output === null ? undefined : (result.output as Prisma.InputJsonValue),
      errorMessage: result.errorMessage,
      provider: provider.name,
      model: provider.model,
      durationMs,
    },
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/flow/runFlow.test.ts`
Expected: PASS, all green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/flow/steps/registry.ts src/lib/flow/runFlow.ts src/lib/flow/runFlow.test.ts
git commit -m "feat: add step registry and runFlow orchestrator"
```

---

### Task 8: Run route handler

**Files:**
- Create: `src/app/api/flows/[id]/run/route.ts`
- Test: `src/app/api/flows/[id]/run/route.test.ts`

**Interfaces:**
- Consumes: `runFlow` (Task 7); `runInputSchema` (Task 3).
- Produces: `POST(req: NextRequest, ctx: RouteContext<'/api/flows/[id]/run'>): Promise<Response>`. Returns 400 on invalid/empty input, 404 when `runFlow` throws `"Flow not found"`, 500 for other errors, 200 with the persisted `Run` JSON on success.

- [ ] **Step 1: Write the failing test (runFlow mocked)**

Create `src/app/api/flows/[id]/run/route.test.ts`:
```ts
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/flow/runFlow", () => ({ runFlow: vi.fn() }));

import { runFlow } from "@/lib/flow/runFlow";
import { POST } from "./route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/flows/flow_1/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: "flow_1" }) };

beforeEach(() => {
  vi.mocked(runFlow).mockReset();
});

describe("POST /api/flows/[id]/run", () => {
  test("returns 400 for empty input", async () => {
    const res = await POST(makeRequest({ input: "  " }) as never, ctx as never);
    expect(res.status).toBe(400);
  });

  test("returns 200 with the persisted run on success", async () => {
    vi.mocked(runFlow).mockResolvedValue({ id: "run_1", status: "success" } as never);
    const res = await POST(makeRequest({ input: "Ada" }) as never, ctx as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "run_1", status: "success" });
  });

  test("returns 404 when the flow is not found", async () => {
    vi.mocked(runFlow).mockRejectedValue(new Error("Flow not found"));
    const res = await POST(makeRequest({ input: "Ada" }) as never, ctx as never);
    expect(res.status).toBe(404);
  });

  test("returns 500 for other errors", async () => {
    vi.mocked(runFlow).mockRejectedValue(new Error("GEMINI_API_KEY is not set"));
    const res = await POST(makeRequest({ input: "Ada" }) as never, ctx as never);
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/api/flows/[id]/run/route.test.ts`
Expected: FAIL — cannot find module `./route`.

- [ ] **Step 3: Write the implementation**

Create `src/app/api/flows/[id]/run/route.ts`:
```ts
import type { NextRequest } from "next/server";
import { runFlow } from "@/lib/flow/runFlow";
import { runInputSchema } from "@/lib/validations/flow";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/flows/[id]/run">) {
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = runInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Input is required" }, { status: 400 });
  }

  try {
    const run = await runFlow(id, parsed.data.input);
    return Response.json(run, { status: 200 });
  } catch (err) {
    const message = (err as Error).message;
    if (message === "Flow not found") {
      return Response.json({ error: message }, { status: 404 });
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run "src/app/api/flows/[id]/run/route.test.ts"`
Expected: PASS, all green.

> If the `RouteContext` global type is not yet generated, run `npx next typegen` once, then re-run. The test itself passes `ctx` structurally so it does not depend on the generated type.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/flows/[id]/run/route.ts" "src/app/api/flows/[id]/run/route.test.ts"
git commit -m "feat: add POST /api/flows/[id]/run route handler"
```

---

### Task 9: Flow CRUD Server Actions

**Files:**
- Create: `src/app/flows/actions.ts`

**Interfaces:**
- Consumes: `flowSchema` (Task 3); `prisma` from `@/lib/prisma`; `revalidatePath`, `redirect` from Next.
- Produces (all `"use server"`):
  - `createFlow(data: unknown): Promise<void>` — validates with `flowSchema`, creates the flow with `taskType: "extract"`, revalidates `/`, redirects to `/flows/<id>`.
  - `updateFlow(id: string, data: unknown): Promise<void>` — validates, updates name/prompt/fields, revalidates `/flows/<id>` and `/`.
  - `deleteFlow(id: string): Promise<void>` — deletes, revalidates `/`, redirects to `/`.

- [ ] **Step 1: Write the implementation**

Create `src/app/flows/actions.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { flowSchema } from "@/lib/validations/flow";
import type { Prisma } from "@/generated/prisma/client";

export async function createFlow(data: unknown): Promise<void> {
  const parsed = flowSchema.parse(data);
  const flow = await prisma.flow.create({
    data: {
      name: parsed.name,
      prompt: parsed.prompt,
      taskType: "extract",
      fields: parsed.fields as unknown as Prisma.InputJsonValue,
    },
  });
  revalidatePath("/");
  redirect(`/flows/${flow.id}`);
}

export async function updateFlow(id: string, data: unknown): Promise<void> {
  const parsed = flowSchema.parse(data);
  await prisma.flow.update({
    where: { id },
    data: {
      name: parsed.name,
      prompt: parsed.prompt,
      fields: parsed.fields as unknown as Prisma.InputJsonValue,
    },
  });
  revalidatePath(`/flows/${id}`);
  revalidatePath("/");
}

export async function deleteFlow(id: string): Promise<void> {
  await prisma.flow.delete({ where: { id } });
  revalidatePath("/");
  redirect("/");
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/flows/actions.ts
git commit -m "feat: add flow CRUD server actions"
```

---

### Task 10: UI — flow list, editor, and test panel

**Files:**
- Modify: `src/app/page.tsx`
- Create: `src/app/flows/new/page.tsx`
- Create: `src/app/flows/[id]/page.tsx`
- Create: `src/app/flows/FlowEditor.tsx`

**Interfaces:**
- Consumes: `createFlow`, `updateFlow`, `deleteFlow` (Task 9); `prisma` (reads); `FieldDef`, `FieldType` (Task 4); `POST /api/flows/[id]/run` (Task 8).
- Produces: the user-facing pages. `FlowEditor` is a client component: `FlowEditor({ mode, flow? }: { mode: "new" | "edit"; flow?: { id: string; name: string; prompt: string; fields: FieldDef[] } })`.

> This task has no automated tests (per the spec's testing section, the UI is verified manually in Task 11). Its gate is a clean `npm run build` plus the manual check in Task 11.

- [ ] **Step 1: Write the flow list page**

Replace the entire contents of `src/app/page.tsx`:
```tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function Home() {
  const flows = await prisma.flow.findMany({ orderBy: { updatedAt: "desc" } });

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">FlowForge</h1>
        <Link
          href="/flows/new"
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
        >
          New flow
        </Link>
      </div>

      {flows.length === 0 ? (
        <p className="text-gray-500">No flows yet. Create your first one.</p>
      ) : (
        <ul className="divide-y rounded border">
          {flows.map((flow) => (
            <li key={flow.id}>
              <Link href={`/flows/${flow.id}`} className="block px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900">
                <span className="font-medium">{flow.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Write the client editor + test panel**

Create `src/app/flows/FlowEditor.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createFlow, deleteFlow, updateFlow } from "./actions";
import type { FieldDef, FieldType } from "@/lib/flow/types";

const FIELD_TYPES: FieldType[] = ["string", "number", "boolean", "string_array"];

type EditorFlow = { id: string; name: string; prompt: string; fields: FieldDef[] };

export default function FlowEditor({ mode, flow }: { mode: "new" | "edit"; flow?: EditorFlow }) {
  const router = useRouter();
  const [name, setName] = useState(flow?.name ?? "");
  const [prompt, setPrompt] = useState(flow?.prompt ?? "");
  const [fields, setFields] = useState<FieldDef[]>(
    flow?.fields ?? [{ name: "", type: "string", required: true, order: 0 }],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  function updateField(index: number, patch: Partial<FieldDef>) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }
  function addField() {
    setFields((prev) => [...prev, { name: "", type: "string", required: true, order: prev.length }]);
  }
  function removeField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index).map((f, i) => ({ ...f, order: i })));
  }

  async function save() {
    setSaving(true);
    setError(null);
    const payload = { name, prompt, fields: fields.map((f, i) => ({ ...f, order: i })) };
    try {
      if (mode === "new") {
        await createFlow(payload);
      } else if (flow) {
        await updateFlow(flow.id, payload);
        router.refresh();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function run() {
    if (!flow) return;
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch(`/api/flows/${flow.id}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const data = await res.json();
      setResult(JSON.stringify(data, null, 2));
      router.refresh();
    } catch (err) {
      setResult(`Request failed: ${(err as Error).message}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <label className="block">
          <span className="text-sm font-medium">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Prompt</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            className="mt-1 w-full rounded border px-3 py-2 font-mono text-sm"
          />
        </label>

        <div>
          <span className="text-sm font-medium">Output fields</span>
          <div className="mt-2 space-y-2">
            {fields.map((field, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  placeholder="field_name"
                  value={field.name}
                  onChange={(e) => updateField(i, { name: e.target.value })}
                  className="flex-1 rounded border px-2 py-1 text-sm"
                />
                <select
                  value={field.type}
                  onChange={(e) => updateField(i, { type: e.target.value as FieldType })}
                  className="rounded border px-2 py-1 text-sm"
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(e) => updateField(i, { required: e.target.checked })}
                  />
                  required
                </label>
                <button type="button" onClick={() => removeField(i)} className="text-sm text-red-600">
                  remove
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addField} className="mt-2 text-sm underline">
            + add field
          </button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {saving ? "Saving…" : "Save flow"}
          </button>
          {mode === "edit" && flow && (
            <button
              type="button"
              onClick={() => deleteFlow(flow.id)}
              className="rounded border px-4 py-2 text-sm font-medium text-red-600"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {mode === "edit" && flow && (
        <div className="space-y-2 border-t pt-4">
          <h2 className="font-semibold">Test</h2>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={4}
            placeholder="Paste text to extract from…"
            className="w-full rounded border px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={run}
            disabled={running || input.trim() === ""}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {running ? "Running…" : "Run"}
          </button>
          {result && <pre className="overflow-x-auto rounded bg-gray-100 p-3 text-xs dark:bg-gray-900">{result}</pre>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write the new-flow page**

Create `src/app/flows/new/page.tsx`:
```tsx
import Link from "next/link";
import FlowEditor from "../FlowEditor";

export default function NewFlowPage() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link href="/" className="text-sm underline">
        ← Back
      </Link>
      <h1 className="mb-6 mt-2 text-2xl font-bold">New flow</h1>
      <FlowEditor mode="new" />
    </main>
  );
}
```

- [ ] **Step 4: Write the edit + history page**

Create `src/app/flows/[id]/page.tsx`:
```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import FlowEditor from "../FlowEditor";
import type { FieldDef } from "@/lib/flow/types";

export const dynamic = "force-dynamic";

export default async function FlowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const flow = await prisma.flow.findUnique({
    where: { id },
    include: { runs: { orderBy: { createdAt: "desc" }, take: 20 } },
  });

  if (!flow) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link href="/" className="text-sm underline">
        ← Back
      </Link>
      <h1 className="mb-6 mt-2 text-2xl font-bold">{flow.name}</h1>

      <FlowEditor
        mode="edit"
        flow={{
          id: flow.id,
          name: flow.name,
          prompt: flow.prompt,
          fields: flow.fields as unknown as FieldDef[],
        }}
      />

      <section className="mt-8">
        <h2 className="mb-2 font-semibold">Run history</h2>
        {flow.runs.length === 0 ? (
          <p className="text-sm text-gray-500">No runs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Output / Error</th>
                </tr>
              </thead>
              <tbody>
                {flow.runs.map((run) => (
                  <tr key={run.id} className="border-b align-top">
                    <td className="py-2 pr-4 whitespace-nowrap">{run.createdAt.toLocaleString()}</td>
                    <td className="py-2 pr-4">{run.status}</td>
                    <td className="py-2 pr-4">
                      <pre className="max-w-md overflow-x-auto text-xs">
                        {run.status === "success" ? JSON.stringify(run.output, null, 2) : run.errorMessage}
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 5: Verify the production build succeeds**

Run: `npm run build`
Expected: "Compiled successfully", TypeScript passes, routes `/`, `/flows/new`, `/flows/[id]`, and `/api/flows/[id]/run` listed. Fix any type errors before committing.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx "src/app/flows/new/page.tsx" "src/app/flows/[id]/page.tsx" src/app/flows/FlowEditor.tsx
git commit -m "feat: add flow list, editor, test panel, and run history UI"
```

---

### Task 11: End-to-end verification

**Files:** none (verification only).

**Interfaces:**
- Consumes: everything above.
- Produces: confidence that the whole slice works against real Gemini.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all suites pass (validations, schema, providers, extract, runFlow, route).

- [ ] **Step 2: Confirm a real Gemini key is set**

Ensure `.env` has a real `GEMINI_API_KEY` (get one from Google AI Studio). Confirm the DB is up: `docker compose up -d`.

- [ ] **Step 3: Start the app and drive the flow manually**

Run: `npm run dev`
Then in the browser:
1. Open `http://localhost:3000` → click **New flow**.
2. Name it "Contact extractor", prompt: "Extract the person's contact details from the text." Add fields: `name` (string, required), `email` (string, required), `phone` (string, not required).
3. **Save flow** → you land on `/flows/<id>`.
4. In **Test**, paste: `Reach Ada Lovelace at ada@example.com, she has no phone listed.`
5. Click **Run**. Expected: a JSON result with `name`, `email`, and `phone: null`; a new success row appears in **Run history**.
6. Edit the prompt to demand an impossible numeric field (add a `required` field `age` of type `number`) and run against text with no age → expect the model to still return something; if it violates the schema, expect a visible **error** run recorded by Zod.

- [ ] **Step 4: Verify persistence**

Run: `npx prisma studio`
Expected: the `Flow` and `Run` rows created above are present, with `output`, `status`, `provider = "gemini"`, `model`, and `durationMs` populated.

- [ ] **Step 5: Final confirmation**

The slice is complete: create a flow → run text through Gemini → JSON validated by Zod → persisted run visible in history. No commit needed (verification only). If any step failed, return to the relevant task.

---

## Self-Review

**Spec coverage:**
- No auth, single user → no auth code; `userId` reserved comment in schema (Task 2). ✓
- Text input → `runInputSchema` + test panel textarea (Tasks 3, 10). ✓
- Flow = name + prompt + fields → `flowSchema`, Flow model, editor (Tasks 2, 3, 10). ✓
- Fixed task "extract structured data" → `taskType` default `extract`, extract step, registry (Tasks 2, 6, 7). ✓
- Synchronous execution → route handler calls `runFlow` inline (Tasks 7, 8). ✓
- Gemini behind adapter, designed for Groq later → `LlmProvider` interface + `getProvider` factory; only `gemini.ts` names Gemini (Task 5). ✓
- JSON validated with dynamic Zod → `buildZodSchema` + extract step `safeParse` (Tasks 4, 6). ✓
- Two layers (Gemini responseSchema + Zod) → `buildJsonSchema` feeds adapter, Zod re-validates (Tasks 4, 5, 6). ✓
- Persist every run + history table → `prisma.run.create` always called; history table in `[id]` page (Tasks 7, 10). ✓
- Fields as `Json` column → Task 2 schema; validated on save via `flowSchema` (Tasks 2, 3, 9). ✓
- `nullable` for non-required → `buildZodSchema` + test (Task 4). ✓
- No retry, error recorded as visible Run → extract returns error result, runFlow persists it (Tasks 6, 7); shown in history (Task 10). ✓
- Server Actions for CRUD, route handler for run → Tasks 8, 9. ✓
- Error handling table (empty input 400, missing key clear error, LLM fail recorded, Zod fail recorded, flow 404) → Tasks 5, 6, 8. ✓
- Testing: schema, extract, runFlow, route with mock provider → Tasks 4, 6, 7, 8. ✓
- Env `GEMINI_API_KEY`, `GEMINI_MODEL` → Task 1. ✓
- Vitest runner → Task 1. ✓

**Placeholder scan:** No TBD/TODO; every code step contains full code; every command has expected output. ✓

**Type consistency:** `FieldDef`/`FieldType` (types.ts) used identically across schema, steps, runFlow, actions, UI. `LlmProvider.generateStructured` signature matches its callers in extract and gemini. `StepResult` fields (`status`, `output`, `errorMessage`) consumed unchanged by runFlow. `runFlow(flowId, input, deps?)` matches the route handler call and tests. `RouteContext<'/api/flows/[id]/run'>` matches the file path. ✓

## Noted deviations from a pure-TDD flow
- Server Actions (Task 9) and UI (Task 10) are gated by typecheck/build + the manual E2E in Task 11 rather than unit tests, matching the spec's testing scope (engine + route only). The Gemini adapter's network call (Task 5) is likewise not unit-tested; only its factory/config behavior is.
