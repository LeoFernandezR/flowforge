# Visual Multi-Step Editor (Chaining) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a single-step FlowForge flow into a linear pipeline of chained steps (extract + generate), edited in a visual step-card editor, with per-step providers and a full per-step run trace.

**Architecture:** A `Flow` gains a `steps` JSON array (ordered = execution order). Each step keeps a prompt *template* that interpolates upstream outputs via `{{key.field}}` / `{{input}}` tokens. `runFlow` walks steps in order, resolving each template against an accumulating context, halting on the first error, and persisting a `{ final, steps[] }` trace on the `Run`. The editor renders a card per step with a variable-chip inserter, up/down reordering, and a provider override.

**Tech Stack:** Next.js 16 (App Router, server actions), React 19, Prisma 7 (Postgres, migrations), Zod 4, Vitest 4, Tailwind 4.

## Global Constraints

- **Next.js 16 has breaking changes vs. training data.** Before editing any server action, route handler, or component, read the relevant guide under `node_modules/next/dist/docs/`. Heed deprecation notices. (From `AGENTS.md`.)
- **English only** in all code, comments, UI copy, commit messages, and this repo's artifacts.
- **Single source for provider names:** `PROVIDER_NAMES` / `ProviderName` in `src/lib/validations/flow.ts`. Do not hardcode `"gemini"`/`"groq"` elsewhere.
- **Prisma client is generated** at `src/generated/prisma/` (import from `@/generated/prisma/client`). Never hand-edit generated files.
- **DB is Postgres via `docker-compose.yml`** (service `db`, creds `flowforge`/`flowforge`). Migrations live in `prisma/migrations/`. Ensure the DB is up before any Prisma command: `docker compose up -d db`.
- **Testing:** `npm test` runs the full suite (`vitest run`); a single file is `npx vitest run <path>`. TDD applies to pure logic (template, validation, executors, `runFlow`). The repo has **no React test setup**, so UI tasks are verified with `npx tsc --noEmit`, `npm run lint`, `npm run build`, and a manual run — not unit tests.
- **Fresh start:** existing flow data is throwaway. Schema changes reset the dev DB; no backfill.

---

## File Structure

- `src/lib/flow/template.ts` *(new)* — token parsing, template resolution, output-field helpers. Pure, no I/O.
- `src/lib/flow/types.ts` *(modify)* — add `StepType`, `Step`; keep `FieldDef`.
- `src/lib/flow/steps/types.ts` *(modify)* — `StepContext` drops `input` (everything flows through the resolved prompt).
- `src/lib/flow/steps/extract.ts` *(modify)* — adapt to new `StepContext`.
- `src/lib/flow/steps/generate.ts` *(new)* — free-text step producing `{ text }`.
- `src/lib/flow/steps/registry.ts` *(modify)* — register `generate`.
- `src/lib/flow/runFlow.ts` *(modify)* — sequential chained executor + trace.
- `src/lib/validations/flow.ts` *(modify)* — `stepSchema`, `flowSchema` (steps), reference validation.
- `src/app/flows/actions.ts` *(modify)* — persist `steps`.
- `src/app/flows/FlowEditor.tsx` *(modify)* — step-card UI, chip inserter, reorder, provider override, trace-aware test panel.
- `src/app/flows/[id]/page.tsx` *(modify)* — pass `steps`, trace-aware run history.
- `prisma/schema.prisma` *(modify, twice)* — expand (add `steps`), then contract (drop legacy columns).

Task order keeps `tsc` green and unit tests passing at every task boundary. Legacy columns (`prompt`/`taskType`/`fields`) survive until the final task so intermediate tasks never break the build; `actions.ts` writes filler values into them during the transition.

---

### Task 1: Template engine

**Files:**
- Create: `src/lib/flow/template.ts`
- Modify: `src/lib/flow/types.ts`
- Test: `src/lib/flow/template.test.ts`

**Interfaces:**
- Consumes: `FieldDef` from `src/lib/flow/types.ts`.
- Produces:
  - `type StepType = "extract" | "generate"`
  - `interface Step { key: string; type: StepType; name?: string; prompt: string; provider?: string; fields?: FieldDef[] }`
  - `interface TemplateRef { raw: string; step: string | null; field: string | null }`
  - `function parseRefs(template: string): TemplateRef[]`
  - `type ResolveContext = { input: string } & Record<string, Record<string, unknown>>`
  - `function resolveTemplate(template: string, ctx: ResolveContext): string` — throws `Error("Unresolved template variable: {{<raw>}}")` on an unknown ref.
  - `function stepOutputFields(step: Step): string[]` — extract → field names; generate → `["text"]`.
  - `function availableRefs(priorSteps: Step[]): string[]` — `["input", "<key>.<field>", ...]`.

- [ ] **Step 1: Add `Step`/`StepType` to `types.ts`**

Append to `src/lib/flow/types.ts` (leave the existing `FieldType`/`FieldDef` untouched):

```ts
export type StepType = "extract" | "generate";

export interface Step {
  key: string;
  type: StepType;
  name?: string;
  prompt: string;
  provider?: string; // omitted ⇒ inherit flow default; constrained to a ProviderName by Zod
  fields?: FieldDef[]; // extract only
}
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/flow/template.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { parseRefs, resolveTemplate, stepOutputFields, availableRefs } from "./template";
import type { Step } from "./types";

const extractStepDef: Step = {
  key: "extract1",
  type: "extract",
  prompt: "",
  fields: [
    { name: "author", type: "string", required: true, order: 0 },
    { name: "count", type: "number", required: true, order: 1 },
  ],
};
const generateStepDef: Step = { key: "gen1", type: "generate", prompt: "" };

describe("parseRefs", () => {
  test("finds the input token and field tokens", () => {
    const refs = parseRefs("Given {{input}} and {{extract1.author}}");
    expect(refs).toEqual([
      { raw: "input", step: null, field: null },
      { raw: "extract1.author", step: "extract1", field: "author" },
    ]);
  });

  test("treats a bare non-input token as an invalid field ref", () => {
    expect(parseRefs("{{oops}}")).toEqual([{ raw: "oops", step: "oops", field: null }]);
  });
});

describe("resolveTemplate", () => {
  test("interpolates the flow input", () => {
    expect(resolveTemplate("Hi {{input}}", { input: "Ada" })).toBe("Hi Ada");
  });

  test("interpolates a prior step's field and stringifies non-strings", () => {
    const ctx = { input: "x", extract1: { author: "Ana", count: 3, tags: ["a", "b"] } };
    expect(resolveTemplate("{{extract1.author}} / {{extract1.count}} / {{extract1.tags}}", ctx)).toBe(
      'Ana / 3 / ["a","b"]',
    );
  });

  test("throws on an unknown step", () => {
    expect(() => resolveTemplate("{{nope.x}}", { input: "" })).toThrow(
      "Unresolved template variable: {{nope.x}}",
    );
  });

  test("throws on a missing field", () => {
    expect(() => resolveTemplate("{{extract1.missing}}", { input: "", extract1: { author: "A" } })).toThrow(
      "Unresolved template variable: {{extract1.missing}}",
    );
  });

  test("throws on a bare non-input token", () => {
    expect(() => resolveTemplate("{{oops}}", { input: "" })).toThrow(
      "Unresolved template variable: {{oops}}",
    );
  });
});

describe("stepOutputFields", () => {
  test("returns field names for extract steps", () => {
    expect(stepOutputFields(extractStepDef)).toEqual(["author", "count"]);
  });

  test("returns ['text'] for generate steps", () => {
    expect(stepOutputFields(generateStepDef)).toEqual(["text"]);
  });
});

describe("availableRefs", () => {
  test("lists input plus every prior step's outputs", () => {
    expect(availableRefs([extractStepDef, generateStepDef])).toEqual([
      "input",
      "extract1.author",
      "extract1.count",
      "gen1.text",
    ]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/lib/flow/template.test.ts`
Expected: FAIL — `template.ts` does not exist / exports not found.

- [ ] **Step 4: Implement `template.ts`**

Create `src/lib/flow/template.ts`:

```ts
import type { Step } from "./types";

// One matcher instance per call — a shared global-flag regex would carry `lastIndex` between calls.
const tokenRe = () => /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)\s*\}\}/g;

export interface TemplateRef {
  raw: string; // e.g. "input" or "extract1.author"
  step: string | null; // null for {{input}}
  field: string | null; // null for {{input}}
}

export type ResolveContext = { input: string } & Record<string, Record<string, unknown>>;

export function parseRefs(template: string): TemplateRef[] {
  const refs: TemplateRef[] = [];
  for (const match of template.matchAll(tokenRe())) {
    const raw = match[1];
    if (raw === "input") {
      refs.push({ raw, step: null, field: null });
      continue;
    }
    const dot = raw.indexOf(".");
    if (dot === -1) {
      refs.push({ raw, step: raw, field: null }); // bare non-input token — invalid ref
    } else {
      refs.push({ raw, step: raw.slice(0, dot), field: raw.slice(dot + 1) });
    }
  }
  return refs;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function resolveTemplate(template: string, ctx: ResolveContext): string {
  return template.replace(tokenRe(), (_full, raw: string) => {
    if (raw === "input") return ctx.input;
    const dot = raw.indexOf(".");
    if (dot === -1) throw new Error(`Unresolved template variable: {{${raw}}}`);
    const step = raw.slice(0, dot);
    const field = raw.slice(dot + 1);
    const bag = ctx[step];
    if (!bag || !(field in bag)) {
      throw new Error(`Unresolved template variable: {{${raw}}}`);
    }
    return stringify(bag[field]);
  });
}

export function stepOutputFields(step: Step): string[] {
  if (step.type === "generate") return ["text"];
  return (step.fields ?? []).map((field) => field.name);
}

export function availableRefs(priorSteps: Step[]): string[] {
  const refs = ["input"];
  for (const step of priorSteps) {
    for (const field of stepOutputFields(step)) refs.push(`${step.key}.${field}`);
  }
  return refs;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/flow/template.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Verify the whole project still type-checks**

Run: `npx tsc --noEmit`
Expected: no errors (the new `Step` type and `template.ts` are additive; nothing else references them yet).

- [ ] **Step 7: Commit**

```bash
git add src/lib/flow/template.ts src/lib/flow/template.test.ts src/lib/flow/types.ts
git commit -m "feat: add template engine for step chaining"
```

---

### Task 2: Prisma expand — add `steps` column

**Files:**
- Modify: `prisma/schema.prisma`
- Generated: `prisma/migrations/<timestamp>_add_flow_steps/` (created by the CLI)

**Interfaces:**
- Consumes: nothing.
- Produces: `Flow.steps` (nullable `Json`) available on the Prisma client. Legacy `prompt`/`taskType`/`fields` remain **unchanged and non-null** for now.

- [ ] **Step 1: Ensure the database is running**

Run: `docker compose up -d db`
Expected: the `flowforge-db` container is up (re-run is a no-op if already running).

- [ ] **Step 2: Add the `steps` column to the schema**

In `prisma/schema.prisma`, add one line to `model Flow` (keep all existing fields):

```prisma
model Flow {
  id        String   @id @default(cuid())
  name      String
  prompt    String
  taskType  String   @default("extract")
  provider  String   @default("gemini")   // "gemini" | "groq"
  fields    Json
  steps     Json?                          // ordered Step[]; source of truth (legacy cols dropped later)
  runs      Run[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 3: Create and apply the migration**

Run: `npx prisma migrate dev --name add_flow_steps`
Expected: a new migration is created and applied; the Prisma client regenerates. Adding a nullable column prompts no data-loss warning.

- [ ] **Step 4: Verify type-check and tests still pass**

Run: `npx tsc --noEmit && npm test`
Expected: `tsc` clean; all existing tests pass (no code reads `steps` yet).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add nullable Flow.steps column (expand)"
```

---

### Task 3: Execution engine — chained runFlow + generate step

**Files:**
- Modify: `src/lib/flow/steps/types.ts`
- Modify: `src/lib/flow/steps/extract.ts`
- Create: `src/lib/flow/steps/generate.ts`
- Modify: `src/lib/flow/steps/registry.ts`
- Modify: `src/lib/flow/runFlow.ts`
- Test: `src/lib/flow/steps/extract.test.ts` (update), `src/lib/flow/steps/generate.test.ts` (new), `src/lib/flow/runFlow.test.ts` (rewrite)

**Interfaces:**
- Consumes: `resolveTemplate`, `ResolveContext` from `template.ts`; `Step` from `types.ts`; `getProvider`, `LlmProvider`; `buildZodSchema`.
- Produces:
  - `StepContext` is now `{ prompt: string; fields: FieldDef[]; provider: LlmProvider }` (no `input`). `prompt` is the fully-resolved instruction.
  - `generateStep: StepExecutor` producing `{ text: string }`.
  - `runFlow(flowId, input, deps?)` persists `Run.output = { final, steps: StepTrace[] }`, where `StepTrace = { key, type, status, output, error, model, ms }`. Halts on the first errored step. `deps.provider`, when given, overrides the provider for **every** step (used by tests).

- [ ] **Step 1: Update `StepContext` (drop `input`)**

Replace the `StepContext` interface in `src/lib/flow/steps/types.ts` (leave `StepResult` and `StepExecutor` unchanged):

```ts
export interface StepContext {
  prompt: string; // fully-resolved instruction (template already interpolated)
  fields: FieldDef[]; // output fields (extract). generate ignores this and uses its own.
  provider: LlmProvider;
}
```

- [ ] **Step 2: Update the extract executor test**

Replace `src/lib/flow/steps/extract.test.ts` with (the executor now receives the resolved `prompt` only — no separate `input`):

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
  return { name: "mock", model: "mock-1", generateStructured: async () => returns };
}

describe("extractStep", () => {
  test("returns typed success when the LLM output validates", async () => {
    const result = await extractStep.execute({
      prompt: "Extract from: Ada, 36",
      fields,
      provider: mockProvider({ name: "Ada", age: 36 }),
    });
    expect(result.status).toBe("success");
    expect(result.output).toEqual({ name: "Ada", age: 36 });
    expect(result.errorMessage).toBeNull();
  });

  test("returns an error when the LLM output fails Zod validation", async () => {
    const result = await extractStep.execute({
      prompt: "Extract from: Ada, old",
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
    const result = await extractStep.execute({ prompt: "x", fields, provider });
    expect(result.status).toBe("error");
    expect(result.errorMessage).toMatch(/LLM error: network down/);
  });
});
```

- [ ] **Step 3: Update the extract executor**

Replace `src/lib/flow/steps/extract.ts`:

```ts
import { z } from "zod";
import { buildZodSchema } from "../schema";
import type { StepContext, StepExecutor, StepResult } from "./types";

const SYSTEM_INSTRUCTION =
  "You are a data extraction engine. Extract the requested fields from the input. " +
  "Return only the fields defined in the schema, with no extra commentary.";

export const extractStep: StepExecutor = {
  async execute({ prompt, fields, provider }: StepContext): Promise<StepResult> {
    const zodSchema = buildZodSchema(fields);

    let raw: unknown;
    try {
      raw = await provider.generateStructured({ prompt: SYSTEM_INSTRUCTION, input: prompt, fields });
    } catch (err) {
      return { status: "error", output: null, errorMessage: `LLM error: ${(err as Error).message}` };
    }

    const parsed = zodSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        status: "error",
        output: null,
        errorMessage: `Validation failed: ${JSON.stringify(z.treeifyError(parsed.error))}`,
      };
    }

    return { status: "success", output: parsed.data as Record<string, unknown>, errorMessage: null };
  },
};
```

- [ ] **Step 4: Write the failing generate test**

Create `src/lib/flow/steps/generate.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { generateStep } from "./generate";
import type { LlmProvider } from "../providers/types";

function mockProvider(returns: unknown): LlmProvider {
  return { name: "mock", model: "mock-1", generateStructured: async () => returns };
}

describe("generateStep", () => {
  test("returns { text } on success", async () => {
    const result = await generateStep.execute({
      prompt: "Write a haiku about Ada",
      fields: [],
      provider: mockProvider({ text: "code blooms in spring" }),
    });
    expect(result.status).toBe("success");
    expect(result.output).toEqual({ text: "code blooms in spring" });
  });

  test("errors when the model omits text", async () => {
    const result = await generateStep.execute({
      prompt: "x",
      fields: [],
      provider: mockProvider({ notText: 1 }),
    });
    expect(result.status).toBe("error");
    expect(result.errorMessage).toMatch(/Validation failed/);
  });

  test("errors when the provider throws", async () => {
    const provider: LlmProvider = {
      name: "mock",
      model: "mock-1",
      generateStructured: async () => {
        throw new Error("boom");
      },
    };
    const result = await generateStep.execute({ prompt: "x", fields: [], provider });
    expect(result.status).toBe("error");
    expect(result.errorMessage).toMatch(/LLM error: boom/);
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npx vitest run src/lib/flow/steps/generate.test.ts`
Expected: FAIL — `generate.ts` does not exist.

- [ ] **Step 6: Implement the generate executor**

Create `src/lib/flow/steps/generate.ts`:

```ts
import { z } from "zod";
import { buildZodSchema } from "../schema";
import type { FieldDef } from "../types";
import type { StepContext, StepExecutor, StepResult } from "./types";

const SYSTEM_INSTRUCTION =
  "You are a helpful assistant. Produce the requested text. " +
  "Return the result as the `text` field, with no extra commentary.";

// A generate step is a structured step with one implicit field, so it reuses the whole
// structured-output path (no new provider method) and outputs a uniform { text } object.
const GENERATE_FIELDS: FieldDef[] = [{ name: "text", type: "string", required: true, order: 0 }];

export const generateStep: StepExecutor = {
  async execute({ prompt, provider }: StepContext): Promise<StepResult> {
    const zodSchema = buildZodSchema(GENERATE_FIELDS);

    let raw: unknown;
    try {
      raw = await provider.generateStructured({
        prompt: SYSTEM_INSTRUCTION,
        input: prompt,
        fields: GENERATE_FIELDS,
      });
    } catch (err) {
      return { status: "error", output: null, errorMessage: `LLM error: ${(err as Error).message}` };
    }

    const parsed = zodSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        status: "error",
        output: null,
        errorMessage: `Validation failed: ${JSON.stringify(z.treeifyError(parsed.error))}`,
      };
    }

    return { status: "success", output: parsed.data as Record<string, unknown>, errorMessage: null };
  },
};
```

- [ ] **Step 7: Register the generate step**

Replace `src/lib/flow/steps/registry.ts`:

```ts
import type { StepExecutor } from "./types";
import { extractStep } from "./extract";
import { generateStep } from "./generate";

const stepRegistry: Record<string, StepExecutor> = {
  extract: extractStep,
  generate: generateStep,
};

export function getStepExecutor(taskType: string): StepExecutor {
  const step = stepRegistry[taskType];
  if (!step) {
    throw new Error(`Unknown task type: ${taskType}`);
  }
  return step;
}
```

- [ ] **Step 8: Rewrite the runFlow test**

Replace `src/lib/flow/runFlow.test.ts`:

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

const oneStepFlow = {
  id: "flow_1",
  name: "Contacts",
  provider: "gemini",
  steps: [
    {
      key: "extract1",
      type: "extract",
      prompt: "Extract from {{input}}",
      fields: [{ name: "name", type: "string", required: true, order: 0 }],
    },
  ],
};

beforeEach(() => {
  vi.mocked(prisma.run.create).mockReset();
  vi.mocked(prisma.flow.findUnique).mockReset();
  vi.mocked(prisma.run.create).mockImplementation((async ({ data }: { data: unknown }) => ({
    id: "run_1",
    ...(data as object),
  })) as never);
});

describe("runFlow", () => {
  test("throws when the flow does not exist", async () => {
    vi.mocked(prisma.flow.findUnique).mockResolvedValue(null);
    await expect(runFlow("missing", "hi", { provider })).rejects.toThrow("Flow not found");
  });

  test("persists a success run with a final output and per-step trace", async () => {
    vi.mocked(prisma.flow.findUnique).mockResolvedValue(oneStepFlow as never);
    await runFlow("flow_1", "Ada", { provider });

    const arg = vi.mocked(prisma.run.create).mock.calls[0][0].data as {
      status: string;
      output: { final: unknown; steps: Array<{ key: string; status: string }> };
      provider: string;
      model: string;
      durationMs: number;
    };
    expect(arg.status).toBe("success");
    expect(arg.output.final).toEqual({ name: "Ada" });
    expect(arg.output.steps).toHaveLength(1);
    expect(arg.output.steps[0]).toMatchObject({ key: "extract1", status: "success" });
    expect(arg.provider).toBe("mock");
    expect(arg.model).toBe("mock-1");
    expect(typeof arg.durationMs).toBe("number");
  });

  test("feeds each step's output into the next step's template", async () => {
    vi.mocked(prisma.flow.findUnique).mockResolvedValue({
      ...oneStepFlow,
      steps: [
        {
          key: "extract1",
          type: "extract",
          prompt: "Extract from {{input}}",
          fields: [{ name: "name", type: "string", required: true, order: 0 }],
        },
        {
          key: "extract2",
          type: "extract",
          prompt: "Greet {{extract1.name}}",
          fields: [{ name: "name", type: "string", required: true, order: 0 }],
        },
      ],
    } as never);

    const calls: string[] = [];
    const capturing: LlmProvider = {
      name: "mock",
      model: "mock-1",
      generateStructured: async ({ input }) => {
        calls.push(input);
        return { name: "Ada" };
      },
    };
    await runFlow("flow_1", "raw text", { provider: capturing });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("raw text"); // {{input}} resolved
    expect(calls[1]).toContain("Ada"); // {{extract1.name}} resolved from step 1's output
  });

  test("halts on the first errored step", async () => {
    vi.mocked(prisma.flow.findUnique).mockResolvedValue({
      ...oneStepFlow,
      steps: [
        {
          key: "extract1",
          type: "extract",
          prompt: "Extract {{input}}",
          fields: [{ name: "name", type: "string", required: true, order: 0 }],
        },
        {
          key: "extract2",
          type: "extract",
          prompt: "Then {{extract1.name}}",
          fields: [{ name: "name", type: "string", required: true, order: 0 }],
        },
      ],
    } as never);

    const badProvider: LlmProvider = { ...provider, generateStructured: async () => ({ name: 123 }) };
    await runFlow("flow_1", "Ada", { provider: badProvider });

    const arg = vi.mocked(prisma.run.create).mock.calls[0][0].data as {
      status: string;
      errorMessage: string;
      output: { final: unknown; steps: unknown[] };
    };
    expect(arg.status).toBe("error");
    expect(arg.output.steps).toHaveLength(1); // second step never ran
    expect(arg.output.final).toBeNull();
    expect(arg.errorMessage).toMatch(/Validation failed/);
  });
});
```

- [ ] **Step 9: Run it to verify it fails**

Run: `npx vitest run src/lib/flow/runFlow.test.ts`
Expected: FAIL — `runFlow` still reads the old single-step shape.

- [ ] **Step 10: Rewrite `runFlow`**

Replace `src/lib/flow/runFlow.ts`:

```ts
import { prisma } from "@/lib/prisma";
import type { Prisma, Run } from "@/generated/prisma/client";
import { getProvider } from "./providers";
import type { LlmProvider } from "./providers/types";
import { getStepExecutor } from "./steps/registry";
import { resolveTemplate, type ResolveContext } from "./template";
import type { Step } from "./types";

export interface RunFlowDeps {
  provider?: LlmProvider;
}

interface StepTrace {
  key: string;
  type: string;
  status: "success" | "error";
  output: Record<string, unknown> | null;
  error: string | null;
  model: string;
  ms: number;
}

export async function runFlow(flowId: string, input: string, deps: RunFlowDeps = {}): Promise<Run> {
  const flow = await prisma.flow.findUnique({ where: { id: flowId } });
  if (!flow) {
    throw new Error("Flow not found");
  }

  const steps = (flow.steps ?? []) as unknown as Step[];
  const context: ResolveContext = { input };
  const trace: StepTrace[] = [];
  let finalOutput: Record<string, unknown> | null = null;
  let runStatus: "success" | "error" = "success";
  let runErrorMessage: string | null = null;
  let lastProviderName = flow.provider;
  let lastModel = "";

  for (const step of steps) {
    const provider = deps.provider ?? getProvider(step.provider ?? flow.provider);
    lastProviderName = provider.name;
    lastModel = provider.model;

    const start = Date.now();
    let status: "success" | "error";
    let output: Record<string, unknown> | null;
    let error: string | null;
    try {
      const resolved = resolveTemplate(step.prompt, context);
      const result = await getStepExecutor(step.type).execute({
        prompt: resolved,
        fields: step.fields ?? [],
        provider,
      });
      status = result.status;
      output = result.output;
      error = result.errorMessage;
    } catch (err) {
      status = "error";
      output = null;
      error = (err as Error).message;
    }
    const ms = Date.now() - start;

    trace.push({ key: step.key, type: step.type, status, output, error, model: provider.model, ms });

    if (status === "error") {
      runStatus = "error";
      runErrorMessage = error;
      break;
    }
    context[step.key] = output ?? {};
    finalOutput = output;
  }

  const durationMs = trace.reduce((sum, entry) => sum + entry.ms, 0);

  return prisma.run.create({
    data: {
      flowId: flow.id,
      input,
      status: runStatus,
      output: { final: finalOutput, steps: trace } as unknown as Prisma.InputJsonValue,
      errorMessage: runErrorMessage,
      provider: lastProviderName,
      model: lastModel,
      durationMs,
    },
  });
}
```

- [ ] **Step 11: Run the full suite and type-check**

Run: `npx tsc --noEmit && npm test`
Expected: `tsc` clean; all tests pass (template, extract, generate, runFlow, providers, route, validations).

- [ ] **Step 12: Commit**

```bash
git add src/lib/flow/steps src/lib/flow/runFlow.ts src/lib/flow/runFlow.test.ts
git commit -m "feat: chained multi-step runFlow with generate step and trace"
```

---

### Task 4: Validation + server actions

**Files:**
- Modify: `src/lib/validations/flow.ts`
- Modify: `src/app/flows/actions.ts`
- Test: `src/lib/validations/flow.test.ts` (rewrite)

**Interfaces:**
- Consumes: `parseRefs`, `stepOutputFields` from `template.ts`; `Step` from `types.ts`.
- Produces:
  - `stepSchema`, `stepTypeSchema`, and a rewritten `flowSchema` shaped `{ name, provider, steps: Step[] }` with: ≥1 step, unique step keys, extract steps need ≥1 uniquely-named field, and every prompt token must reference `input` or a **prior** step's output field.
  - `PROVIDER_NAMES`, `ProviderName`, `fieldDefSchema`, `runInputSchema` unchanged in name/shape.
  - `createFlow` / `updateFlow` persist `steps` (plus transitional legacy filler).

- [ ] **Step 1: Rewrite the validation test**

Replace `src/lib/validations/flow.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { flowSchema, fieldDefSchema, runInputSchema } from "./flow";

const extractStep = {
  key: "extract1",
  type: "extract",
  prompt: "Extract the contact from {{input}}",
  fields: [{ name: "email", type: "string", required: true, order: 0 }],
};

const validFlow = { name: "Contacts", steps: [extractStep] };

describe("flowSchema", () => {
  test("accepts a valid one-step flow", () => {
    expect(flowSchema.safeParse(validFlow).success).toBe(true);
  });

  test("rejects an empty name", () => {
    expect(flowSchema.safeParse({ ...validFlow, name: "  " }).success).toBe(false);
  });

  test("rejects a flow with no steps", () => {
    expect(flowSchema.safeParse({ ...validFlow, steps: [] }).success).toBe(false);
  });

  test("rejects an extract step with no fields", () => {
    expect(
      flowSchema.safeParse({ ...validFlow, steps: [{ ...extractStep, fields: [] }] }).success,
    ).toBe(false);
  });

  test("rejects duplicate field names within a step", () => {
    const step = {
      ...extractStep,
      fields: [
        { name: "email", type: "string", required: true, order: 0 },
        { name: "email", type: "number", required: false, order: 1 },
      ],
    };
    expect(flowSchema.safeParse({ ...validFlow, steps: [step] }).success).toBe(false);
  });

  test("rejects duplicate step keys", () => {
    const flow = { ...validFlow, steps: [extractStep, { ...extractStep, prompt: "Again {{input}}" }] };
    expect(flowSchema.safeParse(flow).success).toBe(false);
  });

  test("accepts a generate step with no fields", () => {
    const flow = {
      ...validFlow,
      steps: [extractStep, { key: "gen1", type: "generate", prompt: "Bio for {{extract1.email}}" }],
    };
    expect(flowSchema.safeParse(flow).success).toBe(true);
  });

  test("rejects an unknown variable reference", () => {
    const flow = { ...validFlow, steps: [{ ...extractStep, prompt: "Use {{nope.x}}" }] };
    expect(flowSchema.safeParse(flow).success).toBe(false);
  });

  test("rejects a forward reference to a later step", () => {
    const flow = {
      ...validFlow,
      steps: [
        { ...extractStep, prompt: "Use {{gen1.text}}" }, // references a step defined AFTER it
        { key: "gen1", type: "generate", prompt: "hi" },
      ],
    };
    expect(flowSchema.safeParse(flow).success).toBe(false);
  });

  test("accepts a valid backward reference", () => {
    const flow = {
      ...validFlow,
      steps: [
        extractStep,
        { key: "gen1", type: "generate", prompt: "Bio for {{extract1.email}} from {{input}}" },
      ],
    };
    expect(flowSchema.safeParse(flow).success).toBe(true);
  });

  test("accepts a valid provider and rejects an unknown one", () => {
    expect(flowSchema.safeParse({ ...validFlow, provider: "groq" }).success).toBe(true);
    expect(flowSchema.safeParse({ ...validFlow, provider: "openai" }).success).toBe(false);
  });

  test("defaults the provider to gemini", () => {
    expect(flowSchema.parse(validFlow).provider).toBe("gemini");
  });
});

describe("fieldDefSchema", () => {
  test("rejects a field name that is not an identifier", () => {
    expect(fieldDefSchema.safeParse({ name: "2bad", type: "string", required: true, order: 0 }).success).toBe(
      false,
    );
  });

  test("rejects an unknown type", () => {
    expect(fieldDefSchema.safeParse({ name: "x", type: "date", required: true, order: 0 }).success).toBe(false);
  });
});

describe("runInputSchema", () => {
  test("rejects empty input", () => {
    expect(runInputSchema.safeParse({ input: "   " }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/validations/flow.test.ts`
Expected: FAIL — `flowSchema` still expects the old flat `{ prompt, fields }` shape.

- [ ] **Step 3: Rewrite `validations/flow.ts`**

Replace `src/lib/validations/flow.ts`:

```ts
import { z } from "zod";
import { parseRefs, stepOutputFields } from "@/lib/flow/template";
import type { Step } from "@/lib/flow/types";

export const PROVIDER_NAMES = ["gemini", "groq"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

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

export const stepTypeSchema = z.enum(["extract", "generate"]);

export const stepSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Step key must be a valid identifier"),
    type: stepTypeSchema,
    name: z.string().trim().max(120).optional(),
    prompt: z.string().trim().min(1, "Prompt is required").max(10_000),
    provider: z.enum(PROVIDER_NAMES).optional(),
    fields: z.array(fieldDefSchema).optional(),
  })
  .superRefine((step, ctx) => {
    if (step.type === "extract") {
      const fields = step.fields ?? [];
      if (fields.length < 1) {
        ctx.addIssue({ code: "custom", message: "Extract steps need at least one field", path: ["fields"] });
      }
      if (new Set(fields.map((f) => f.name)).size !== fields.length) {
        ctx.addIssue({ code: "custom", message: "Field names must be unique", path: ["fields"] });
      }
    }
  });

export const flowSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120),
    provider: z.enum(PROVIDER_NAMES).default("gemini"),
    steps: z.array(stepSchema).min(1, "Add at least one step"),
  })
  .superRefine((flow, ctx) => {
    const keys = flow.steps.map((s) => s.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: "custom", message: "Step keys must be unique", path: ["steps"] });
    }

    flow.steps.forEach((step, i) => {
      const prior = flow.steps.slice(0, i) as Step[];
      const allowed = new Set<string>(["input"]);
      for (const p of prior) {
        for (const field of stepOutputFields(p)) allowed.add(`${p.key}.${field}`);
      }
      for (const ref of parseRefs(step.prompt)) {
        if (!allowed.has(ref.raw)) {
          ctx.addIssue({
            code: "custom",
            message: `Unknown variable {{${ref.raw}}}`,
            path: ["steps", i, "prompt"],
          });
        }
      }
    });
  });

export const runInputSchema = z.object({
  input: z.string().trim().min(1, "Input is required"),
});

export type FlowInput = z.infer<typeof flowSchema>;
export type RunInput = z.infer<typeof runInputSchema>;
```

- [ ] **Step 4: Run the validation test to verify it passes**

Run: `npx vitest run src/lib/validations/flow.test.ts`
Expected: PASS.

- [ ] **Step 5: Update `actions.ts` to persist `steps`**

Replace the `createFlow` and `updateFlow` functions in `src/app/flows/actions.ts` (keep the imports and `deleteFlow`). Legacy columns are still `NOT NULL` until Task 6, so we fill them from the first step:

```ts
export async function createFlow(data: unknown): Promise<void> {
  const parsed = flowSchema.parse(data);
  const flow = await prisma.flow.create({
    data: {
      name: parsed.name,
      provider: parsed.provider,
      steps: parsed.steps as unknown as Prisma.InputJsonValue,
      // Legacy columns (dropped in a later task) — filled to satisfy NOT NULL.
      prompt: parsed.steps[0].prompt,
      taskType: "extract",
      fields: (parsed.steps[0].fields ?? []) as unknown as Prisma.InputJsonValue,
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
      provider: parsed.provider,
      steps: parsed.steps as unknown as Prisma.InputJsonValue,
      // Legacy columns (dropped in a later task) — kept in sync to satisfy NOT NULL.
      prompt: parsed.steps[0].prompt,
      taskType: "extract",
      fields: (parsed.steps[0].fields ?? []) as unknown as Prisma.InputJsonValue,
    },
  });
  revalidatePath(`/flows/${id}`);
  revalidatePath("/");
}
```

- [ ] **Step 6: Type-check and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: `tsc` clean; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/validations/flow.ts src/lib/validations/flow.test.ts src/app/flows/actions.ts
git commit -m "feat: validate and persist multi-step flows with chaining refs"
```

---

### Task 5: Visual step-card editor + trace-aware page

**Files:**
- Modify: `src/app/flows/FlowEditor.tsx`
- Modify: `src/app/flows/[id]/page.tsx`

**Interfaces:**
- Consumes: `createFlow`/`updateFlow`/`deleteFlow`; `Step`/`StepType`/`FieldDef`/`FieldType` from `types.ts`; `stepOutputFields` from `template.ts`; `PROVIDER_NAMES`/`ProviderName`.
- Produces: an editor that emits the `{ name, provider, steps: Step[] }` payload `flowSchema` expects, and a page that maps `flow.steps` into the editor and renders the run trace.

> **Before editing:** this is Next.js 16. Skim the App Router client-component / server-action guides under `node_modules/next/dist/docs/` if anything about `"use client"`, server actions, or `router.refresh()` looks unfamiliar.

> **No unit tests** for this task (no React test setup). Verify with type-check, lint, build, and a manual run (Steps 3–5).

- [ ] **Step 1: Rewrite `FlowEditor.tsx`**

Replace `src/app/flows/FlowEditor.tsx` in full:

```tsx
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createFlow, deleteFlow, updateFlow } from "./actions";
import type { FieldDef, FieldType, Step, StepType } from "@/lib/flow/types";
import { stepOutputFields } from "@/lib/flow/template";
import { PROVIDER_NAMES, type ProviderName } from "@/lib/validations/flow";

const FIELD_TYPES: FieldType[] = ["string", "number", "boolean", "string_array"];

type EditorStep = {
  key: string;
  type: StepType;
  name: string;
  prompt: string;
  provider: ProviderName | ""; // "" = inherit flow default
  fields: FieldDef[]; // used by extract; empty for generate
};

type EditorFlow = { id: string; name: string; provider: ProviderName; steps: EditorStep[] };

type StepTraceView = {
  key: string;
  type: string;
  status: string;
  output: unknown;
  error: string | null;
  ms: number;
};
type RunResult = {
  status: string;
  output: { final: unknown; steps: StepTraceView[] } | null;
  errorMessage: string | null;
};

function nextKey(type: StepType, steps: EditorStep[]): string {
  const used = new Set(steps.map((s) => s.key));
  let n = 1;
  while (used.has(`${type}${n}`)) n++;
  return `${type}${n}`;
}

function emptyExtractStep(steps: EditorStep[]): EditorStep {
  return {
    key: nextKey("extract", steps),
    type: "extract",
    name: "",
    prompt: "",
    provider: "",
    fields: [{ name: "", type: "string", required: true, order: 0 }],
  };
}

function emptyGenerateStep(steps: EditorStep[]): EditorStep {
  return { key: nextKey("generate", steps), type: "generate", name: "", prompt: "", provider: "", fields: [] };
}

function refsBefore(steps: EditorStep[], index: number): string[] {
  const refs = ["input"];
  for (let i = 0; i < index; i++) {
    for (const field of stepOutputFields(steps[i] as unknown as Step)) {
      refs.push(`${steps[i].key}.${field}`);
    }
  }
  return refs;
}

export default function FlowEditor({ mode, flow }: { mode: "new" | "edit"; flow?: EditorFlow }) {
  const router = useRouter();
  const [name, setName] = useState(flow?.name ?? "");
  const [provider, setProvider] = useState<ProviderName>(flow?.provider ?? "gemini");
  const [steps, setSteps] = useState<EditorStep[]>(flow?.steps ?? [emptyExtractStep([])]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);

  const promptRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  function updateStep(index: number, patch: Partial<EditorStep>) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }
  function addStep(type: StepType) {
    setSteps((prev) => [...prev, type === "extract" ? emptyExtractStep(prev) : emptyGenerateStep(prev)]);
  }
  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }
  function moveStep(index: number, dir: -1 | 1) {
    setSteps((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  function updateField(stepIndex: number, fieldIndex: number, patch: Partial<FieldDef>) {
    setSteps((prev) =>
      prev.map((s, i) =>
        i === stepIndex
          ? { ...s, fields: s.fields.map((f, k) => (k === fieldIndex ? { ...f, ...patch } : f)) }
          : s,
      ),
    );
  }
  function addField(stepIndex: number) {
    setSteps((prev) =>
      prev.map((s, i) =>
        i === stepIndex
          ? { ...s, fields: [...s.fields, { name: "", type: "string", required: true, order: s.fields.length }] }
          : s,
      ),
    );
  }
  function removeField(stepIndex: number, fieldIndex: number) {
    setSteps((prev) =>
      prev.map((s, i) =>
        i === stepIndex
          ? { ...s, fields: s.fields.filter((_, k) => k !== fieldIndex).map((f, k) => ({ ...f, order: k })) }
          : s,
      ),
    );
  }

  function insertToken(index: number, ref: string) {
    const token = `{{${ref}}}`;
    const step = steps[index];
    const el = promptRefs.current[step.key];
    if (!el) {
      updateStep(index, { prompt: step.prompt + token });
      return;
    }
    const start = el.selectionStart ?? step.prompt.length;
    const end = el.selectionEnd ?? step.prompt.length;
    updateStep(index, { prompt: step.prompt.slice(0, start) + token + step.prompt.slice(end) });
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + token.length;
      el.setSelectionRange(caret, caret);
    });
  }

  function toPayloadStep(s: EditorStep): Step {
    const step: Step = { key: s.key, type: s.type, prompt: s.prompt };
    if (s.name.trim()) step.name = s.name.trim();
    if (s.provider) step.provider = s.provider;
    if (s.type === "extract") step.fields = s.fields.map((f, i) => ({ ...f, order: i }));
    return step;
  }

  async function save() {
    setSaving(true);
    setError(null);
    const payload = { name, provider, steps: steps.map(toPayloadStep) };
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
      if (!res.ok) {
        setResult({ status: "error", output: null, errorMessage: JSON.stringify(data) });
      } else {
        setResult({ status: data.status, output: data.output, errorMessage: data.errorMessage });
        router.refresh();
      }
    } catch (err) {
      setResult({ status: "error", output: null, errorMessage: (err as Error).message });
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
          <span className="text-sm font-medium">Default provider</span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as ProviderName)}
            className="mt-1 block w-full rounded border px-3 py-2"
          >
            {PROVIDER_NAMES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-4">
        <span className="text-sm font-medium">Steps</span>
        {steps.map((step, i) => (
          <div key={step.key} className="rounded border p-3 space-y-3">
            <div className="flex items-center gap-2">
              <span className="rounded bg-gray-200 px-2 py-0.5 font-mono text-xs dark:bg-gray-800">
                {step.key}
              </span>
              <span className="text-xs text-gray-500">{step.type}</span>
              <input
                placeholder="label (optional)"
                value={step.name}
                onChange={(e) => updateStep(i, { name: e.target.value })}
                className="flex-1 rounded border px-2 py-1 text-sm"
              />
              <select
                value={step.provider}
                onChange={(e) => updateStep(i, { provider: e.target.value as ProviderName | "" })}
                className="rounded border px-2 py-1 text-sm"
              >
                <option value="">↳ flow default</option>
                {PROVIDER_NAMES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => moveStep(i, -1)}
                disabled={i === 0}
                className="px-1 text-sm disabled:opacity-30"
                aria-label="Move step up"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveStep(i, 1)}
                disabled={i === steps.length - 1}
                className="px-1 text-sm disabled:opacity-30"
                aria-label="Move step down"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => removeStep(i)}
                className="text-sm text-red-600"
                aria-label="Remove step"
              >
                ✕
              </button>
            </div>

            <label className="block">
              <span className="text-xs text-gray-500">Prompt template</span>
              <textarea
                ref={(el) => {
                  promptRefs.current[step.key] = el;
                }}
                value={step.prompt}
                onChange={(e) => updateStep(i, { prompt: e.target.value })}
                rows={3}
                className="mt-1 w-full rounded border px-3 py-2 font-mono text-sm"
              />
            </label>

            <div className="flex flex-wrap items-center gap-1 text-xs">
              <span className="text-gray-500">insert:</span>
              {refsBefore(steps, i).map((ref) => (
                <button
                  key={ref}
                  type="button"
                  onClick={() => insertToken(i, ref)}
                  className="rounded border px-1.5 py-0.5 font-mono hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  {`{{${ref}}}`}
                </button>
              ))}
            </div>

            {step.type === "extract" ? (
              <div>
                <span className="text-xs text-gray-500">Output fields</span>
                <div className="mt-1 space-y-2">
                  {step.fields.map((field, k) => (
                    <div key={k} className="flex items-center gap-2">
                      <input
                        placeholder="field_name"
                        value={field.name}
                        onChange={(e) => updateField(i, k, { name: e.target.value })}
                        className="flex-1 rounded border px-2 py-1 text-sm"
                      />
                      <select
                        value={field.type}
                        onChange={(e) => updateField(i, k, { type: e.target.value as FieldType })}
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
                          onChange={(e) => updateField(i, k, { required: e.target.checked })}
                        />
                        required
                      </label>
                      <button
                        type="button"
                        onClick={() => removeField(i, k)}
                        className="text-sm text-red-600"
                      >
                        remove
                      </button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => addField(i)} className="mt-2 text-sm underline">
                  + add field
                </button>
              </div>
            ) : (
              <p className="text-xs text-gray-500">
                Outputs <span className="font-mono">{`{{${step.key}.text}}`}</span>
              </p>
            )}
          </div>
        ))}

        <div className="flex gap-2">
          <button type="button" onClick={() => addStep("extract")} className="text-sm underline">
            + add extract step
          </button>
          <button type="button" onClick={() => addStep("generate")} className="text-sm underline">
            + add generate step
          </button>
        </div>
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

      {mode === "edit" && flow && (
        <div className="space-y-2 border-t pt-4">
          <h2 className="font-semibold">Test</h2>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={4}
            placeholder="Paste input text…"
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

          {result && (
            <div className="space-y-2">
              <p className="text-sm">
                Status: <span className="font-medium">{result.status}</span>
              </p>
              {result.output?.steps.map((s) => (
                <div key={s.key} className="rounded border p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono">{s.key}</span>
                    <span className="text-gray-500">{s.type}</span>
                    <span>{s.status}</span>
                    <span className="text-gray-500">{s.ms}ms</span>
                  </div>
                  <pre className="overflow-x-auto">
                    {s.status === "success" ? JSON.stringify(s.output, null, 2) : s.error}
                  </pre>
                </div>
              ))}
              {result.errorMessage && <p className="text-xs text-red-600">{result.errorMessage}</p>}
              {result.output && (
                <div>
                  <span className="text-xs text-gray-500">Final output</span>
                  <pre className="overflow-x-auto rounded bg-gray-100 p-3 text-xs dark:bg-gray-900">
                    {JSON.stringify(result.output.final, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update `[id]/page.tsx` to pass steps and render the trace**

Replace `src/app/flows/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import FlowEditor from "../FlowEditor";
import type { Step } from "@/lib/flow/types";
import type { ProviderName } from "@/lib/validations/flow";

export const dynamic = "force-dynamic";

type RunTrace = { final: unknown; steps: Array<{ key: string; status: string; ms: number }> };

export default async function FlowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const flow = await prisma.flow.findUnique({
    where: { id },
    include: { runs: { orderBy: { createdAt: "desc" }, take: 20 } },
  });

  if (!flow) {
    notFound();
  }

  const steps = ((flow.steps ?? []) as unknown as Step[]).map((s) => ({
    key: s.key,
    type: s.type,
    name: s.name ?? "",
    prompt: s.prompt,
    provider: (s.provider ?? "") as ProviderName | "",
    fields: s.fields ?? [],
  }));

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link href="/" className="text-sm underline">
        ← Back
      </Link>
      <h1 className="mb-6 mt-2 text-2xl font-bold">{flow.name}</h1>

      <FlowEditor
        mode="edit"
        flow={{ id: flow.id, name: flow.name, provider: flow.provider as ProviderName, steps }}
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
                {flow.runs.map((run) => {
                  const trace = run.output as unknown as RunTrace | null;
                  return (
                    <tr key={run.id} className="border-b align-top">
                      <td className="py-2 pr-4 whitespace-nowrap">{run.createdAt.toLocaleString()}</td>
                      <td className="py-2 pr-4">{run.status}</td>
                      <td className="py-2 pr-4">
                        {run.status === "success" ? (
                          <>
                            <div className="mb-1 text-xs text-gray-500">
                              {trace?.steps.map((s) => `${s.key}:${s.status} (${s.ms}ms)`).join("  ")}
                            </div>
                            <pre className="max-w-md overflow-x-auto text-xs">
                              {JSON.stringify(trace?.final, null, 2)}
                            </pre>
                          </>
                        ) : (
                          <pre className="max-w-md overflow-x-auto text-xs">{run.errorMessage}</pre>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Type-check, lint, and build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all clean (no type errors, no lint errors, successful production build).

- [ ] **Step 4: Manual smoke test — build a chained flow**

Ensure a provider key is set in `.env` (Groq is the reliable one: `GROQ_API_KEY`). Then:

```bash
docker compose up -d db
npm run dev
```

In the browser:
1. Create a new flow. Add an **extract** step (`extract1`): prompt `Extract the author from {{input}}`, field `author` (string, required).
2. Add a **generate** step (`generate1`), set its provider explicitly, prompt `Write a one-line bio for {{extract1.author}}` — insert the `{{extract1.author}}` chip.
3. Save. Confirm redirect to the flow page and both step cards reload with their values.
4. In Test, paste an input mentioning an author, Run.

Expected: the trace shows `extract1` success with `{ author: ... }`, then `generate1` success with `{ text: ... }`, and a Final output. The run appears in Run history with the per-step status line.

- [ ] **Step 5: Manual smoke test — reorder + validation guard**

1. Reorder the two steps so `generate1` is first. Save.

Expected: the save is **rejected** with an "Unknown variable {{extract1.author}}" error (the generate step now references a step that comes after it), proving reorder-aware validation works. Move it back and confirm it saves.

- [ ] **Step 6: Commit**

```bash
git add src/app/flows/FlowEditor.tsx "src/app/flows/[id]/page.tsx"
git commit -m "feat: visual multi-step editor with chaining and trace panel"
```

---

### Task 6: Prisma contract — drop legacy columns

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/app/flows/actions.ts`
- Generated: `prisma/migrations/<timestamp>_drop_flow_legacy_columns/`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Flow.steps` becomes non-null (`Json`); `prompt`/`taskType`/`fields` are removed. `actions.ts` no longer writes filler.

- [ ] **Step 1: Reset the dev DB (fresh start — throwaway data)**

Run: `docker compose up -d db && npx prisma migrate reset --force`
Expected: the database is dropped, recreated, and all existing migrations reapply. No prompts (the `--force` flag confirms).

- [ ] **Step 2: Make `steps` required and drop legacy columns**

Edit `model Flow` in `prisma/schema.prisma` to:

```prisma
model Flow {
  id        String   @id @default(cuid())
  name      String
  provider  String   @default("gemini")   // "gemini" | "groq"
  steps     Json                          // ordered Step[]
  runs      Run[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 3: Create and apply the migration**

Run: `npx prisma migrate dev --name drop_flow_legacy_columns`
Expected: a new migration drops `prompt`/`taskType`/`fields` and makes `steps` NOT NULL, applied to the empty DB without prompts; the Prisma client regenerates.

- [ ] **Step 4: Remove the legacy filler from `actions.ts`**

In `src/app/flows/actions.ts`, delete the legacy filler lines from both `createFlow` and `updateFlow`, leaving:

```ts
// createFlow's create data:
    data: {
      name: parsed.name,
      provider: parsed.provider,
      steps: parsed.steps as unknown as Prisma.InputJsonValue,
    },
```

```ts
// updateFlow's update data:
    data: {
      name: parsed.name,
      provider: parsed.provider,
      steps: parsed.steps as unknown as Prisma.InputJsonValue,
    },
```

- [ ] **Step 5: Type-check, test, lint, build**

Run: `npx tsc --noEmit && npm test && npm run lint && npm run build`
Expected: all clean. `tsc` confirms nothing still references the dropped columns.

- [ ] **Step 6: Manual re-verification**

With `npm run dev`, create and run a two-step flow again (as in Task 5, Step 4).
Expected: create, save, run, and the trace/history all work against the contracted schema.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/app/flows/actions.ts
git commit -m "refactor: drop legacy single-step Flow columns (contract)"
```

---

## Self-Review

**Spec coverage:**
- Steps as JSON array on `Flow` → Tasks 2, 6. ✅
- `extract` + `generate` step types → Task 3. ✅
- Chaining via `{{key.field}}`/`{{input}}` template tokens + resolver → Task 1, wired in Task 3. ✅
- Stringify rules for non-strings, unresolved-token error → Task 1. ✅
- Stable/immutable step keys → Task 5 (`nextKey`, key-based state). ✅
- Per-step provider with flow default → Tasks 3 (execution), 4 (schema), 5 (UI override). ✅
- Full per-step run trace persisted → Task 3; surfaced in Task 5 (test panel + history). ✅
- Visual step-card editor (chip inserter, up/down reorder, provider override) → Task 5. ✅
- Save-time validation: unique keys, ≥1 field per extract, unique field names, forward/unknown-ref rejection → Task 4. ✅
- Halt-on-first-error runtime → Task 3. ✅
- Fresh start / DB reset, no backfill → Tasks 2 and 6. ✅
- Route contract unchanged (`{ input }`) → untouched; `route.test.ts` mocks `runFlow` and stays green. ✅

**Placeholder scan:** No TBD/TODO; every code and test step contains complete content; UI steps that can't be unit-tested specify explicit tsc/lint/build + manual checks. ✅

**Type consistency:** `Step`/`StepType` defined in Task 1 and reused verbatim in Tasks 3–5. `StepContext` (Task 3) is `{ prompt, fields, provider }` and every executor + `runFlow` call site matches. `resolveTemplate`/`parseRefs`/`stepOutputFields` signatures are identical where consumed (Tasks 3, 4, 5). Run trace shape `{ final, steps: [{ key, type, status, output, error, model, ms }] }` is produced in Task 3 and read with matching field names in Task 5. `flowSchema` payload `{ name, provider, steps }` produced by the editor (Task 5) matches the schema (Task 4) and `actions.ts` consumer (Tasks 4/6). ✅
