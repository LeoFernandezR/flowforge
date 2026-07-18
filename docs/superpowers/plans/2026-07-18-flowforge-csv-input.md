# CSV Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user upload a CSV, pick the column that feeds `{{input}}`, and run the flow once per row with a live progress bar and an inline results table.

**Architecture:** The CSV concern is entirely client-side. The browser parses the CSV (papaparse), then drives a strictly sequential loop over the *existing* `POST /api/flows/[id]/run` endpoint — one request per row, each carrying a shared `batchId`. Every row persists as one `Run` (tagged with `batchId`); run history groups a batch's rows into one entry. No new endpoint, no background jobs, no streaming.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Prisma 7 + Postgres, Zod 4, papaparse, Vitest.

## Global Constraints

- **English only** in all artifacts (code, comments, commits, UI copy).
- **No live LLM calls in tests** (invariant #4) — providers are injected mocks; DB (`@/lib/prisma`) is mocked with `vi.mock`.
- **Every execution persists a `Run`** (invariant #2) — one per row, success or error.
- **Read `node_modules/next/dist/docs/` before writing Next.js code** if unsure — this Next.js has breaking changes vs. training data.
- **Restart `next dev` after any Prisma migration** — the dev server caches a stale Prisma client and will throw phantom "column does not exist" errors otherwise.
- **Row cap: 50.** A CSV with more than 50 data rows is rejected up front.
- **Sequential loop only** — one request in flight at a time. No concurrency.
- Test runner: `npx vitest run <path>` (single file) or `npm test` (all). Match existing test style: `vi.mock("@/lib/prisma", …)`, `describe`/`test`/`expect` from `vitest`.

---

### Task 1: Accept an optional `batchId` in run input validation

**Files:**
- Modify: `src/lib/validations/flow.ts:76-78` (`runInputSchema`)
- Test: `src/lib/validations/flow.test.ts:115-119` (`runInputSchema` describe block)

**Interfaces:**
- Consumes: nothing new.
- Produces: `runInputSchema` now parses `{ input: string; batchId?: string }`. `RunInput` type gains optional `batchId: string | undefined`.

- [ ] **Step 1: Write the failing tests**

Add these tests inside the existing `describe("runInputSchema", …)` block in `src/lib/validations/flow.test.ts`:

```ts
  test("accepts input with a batchId", () => {
    expect(runInputSchema.safeParse({ input: "Ada", batchId: "b1" }).success).toBe(true);
  });

  test("accepts input without a batchId", () => {
    expect(runInputSchema.safeParse({ input: "Ada" }).success).toBe(true);
  });

  test("rejects a non-string batchId", () => {
    expect(runInputSchema.safeParse({ input: "Ada", batchId: 5 }).success).toBe(false);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/validations/flow.test.ts -t "batchId"`
Expected: FAIL — the `non-string batchId` test fails because the current schema strips unknown keys and passes (or the assertion mismatches). Confirm red before proceeding.

- [ ] **Step 3: Add the field to the schema**

In `src/lib/validations/flow.ts`, change `runInputSchema`:

```ts
export const runInputSchema = z.object({
  input: z.string().trim().min(1, "Input is required"),
  batchId: z.string().optional(),
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/validations/flow.test.ts`
Expected: PASS (all runInputSchema tests, including the new ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/flow.ts src/lib/validations/flow.test.ts
git commit -m "feat: accept optional batchId in run input schema"
```

---

### Task 2: Persist `batchId` on the `Run` (schema + migration + runFlow)

**Files:**
- Modify: `prisma/schema.prisma:25-39` (`Run` model)
- Create: `prisma/migrations/<timestamp>_add_run_batch_id/migration.sql` (generated)
- Modify: `src/lib/flow/runFlow.ts:24` (signature) and `:82-93` (`prisma.run.create` data)
- Test: `src/lib/flow/runFlow.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `runFlow(flowId: string, input: string, deps?: RunFlowDeps, batchId?: string): Promise<Run>`. The created `Run` has `batchId: string | null`.

- [ ] **Step 1: Write the failing tests**

Add to `describe("runFlow", …)` in `src/lib/flow/runFlow.test.ts`:

```ts
  test("persists the given batchId on the run", async () => {
    vi.mocked(prisma.flow.findUnique).mockResolvedValue(oneStepFlow as never);
    await runFlow("flow_1", "Ada", { provider }, "batch_42");

    const arg = vi.mocked(prisma.run.create).mock.calls[0][0].data as unknown as { batchId: string | null };
    expect(arg.batchId).toBe("batch_42");
  });

  test("persists a null batchId when none is given", async () => {
    vi.mocked(prisma.flow.findUnique).mockResolvedValue(oneStepFlow as never);
    await runFlow("flow_1", "Ada", { provider });

    const arg = vi.mocked(prisma.run.create).mock.calls[0][0].data as unknown as { batchId: string | null };
    expect(arg.batchId).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/flow/runFlow.test.ts -t "batchId"`
Expected: FAIL — `runFlow` ignores the 4th arg and `data.batchId` is `undefined`, not `"batch_42"`/`null`.

- [ ] **Step 3: Add the column to the Prisma schema**

In `prisma/schema.prisma`, update the `Run` model — add the `batchId` field and its index:

```prisma
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
  batchId      String?                       // groups rows from one CSV upload; null for single runs
  createdAt    DateTime @default(now())

  @@index([flowId])
  @@index([batchId])
}
```

- [ ] **Step 4: Create and apply the migration**

Run: `npx prisma migrate dev --name add_run_batch_id`
Expected: a new migration under `prisma/migrations/`, applied to the dev DB, and the Prisma client regenerated. (Requires `DATABASE_URL` to be set for the dev database.)

Then **restart `next dev`** if it is running (stale-client rule).

- [ ] **Step 5: Thread `batchId` through `runFlow`**

In `src/lib/flow/runFlow.ts`, change the signature:

```ts
export async function runFlow(
  flowId: string,
  input: string,
  deps: RunFlowDeps = {},
  batchId?: string,
): Promise<Run> {
```

And add `batchId` to the `prisma.run.create` data object (place it next to `input`):

```ts
  return prisma.run.create({
    data: {
      flowId: flow.id,
      input,
      batchId: batchId ?? null,
      status: runStatus,
      output: { final: finalOutput, steps: trace } as unknown as Prisma.InputJsonValue,
      errorMessage: runErrorMessage,
      provider: lastProviderName,
      model: lastModel,
      durationMs,
    },
  });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/lib/flow/runFlow.test.ts`
Expected: PASS (all existing runFlow tests plus the two new ones).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/flow/runFlow.ts src/lib/flow/runFlow.test.ts src/generated/prisma
git commit -m "feat: persist batchId on Run"
```

---

### Task 3: Thread `batchId` from the run route into `runFlow`

**Files:**
- Modify: `src/app/api/flows/[id]/run/route.ts:21` (the `runFlow` call)
- Test: `src/app/api/flows/[id]/run/route.test.ts`

**Interfaces:**
- Consumes: `runInputSchema` (Task 1), `runFlow(flowId, input, deps?, batchId?)` (Task 2).
- Produces: nothing new; the route now forwards `batchId`.

- [ ] **Step 1: Write the failing test**

Add to `describe("POST /api/flows/[id]/run", …)` in `route.test.ts`:

```ts
  test("forwards batchId to runFlow", async () => {
    vi.mocked(runFlow).mockResolvedValue({ id: "run_1", status: "success" } as never);
    await POST(makeRequest({ input: "Ada", batchId: "batch_9" }) as never, ctx as never);
    expect(vi.mocked(runFlow)).toHaveBeenCalledWith("flow_1", "Ada", {}, "batch_9");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/app/api/flows/[id]/run/route.test.ts" -t "forwards batchId"`
Expected: FAIL — current call is `runFlow(id, parsed.data.input)`, so the assertion on 4 args fails.

- [ ] **Step 3: Forward the batchId**

In `src/app/api/flows/[id]/run/route.ts`, change the call inside the `try`:

```ts
    const run = await runFlow(id, parsed.data.input, {}, parsed.data.batchId);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run "src/app/api/flows/[id]/run/route.test.ts"`
Expected: PASS (all route tests).

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/flows/[id]/run/route.ts" "src/app/api/flows/[id]/run/route.test.ts"
git commit -m "feat: forward batchId from run route to runFlow"
```

---

### Task 4: CSV parsing wrapper (papaparse)

**Files:**
- Modify: `package.json` (add `papaparse` + `@types/papaparse`)
- Create: `src/lib/flow/csv.ts`
- Test: `src/lib/flow/csv.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] }`.

- [ ] **Step 1: Add the dependency**

Run: `npm install papaparse && npm install -D @types/papaparse`
Expected: both appear in `package.json`; `npm install` exits 0.

- [ ] **Step 2: Write the failing tests**

Create `src/lib/flow/csv.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  test("parses headers and rows keyed by header", () => {
    const { headers, rows } = parseCsv("name,email\nAda,ada@x.com\nGrace,grace@y.com");
    expect(headers).toEqual(["name", "email"]);
    expect(rows).toEqual([
      { name: "Ada", email: "ada@x.com" },
      { name: "Grace", email: "grace@y.com" },
    ]);
  });

  test("handles quoted fields with embedded commas and newlines", () => {
    const { rows } = parseCsv('text,label\n"Hello, world\nsecond line",greeting');
    expect(rows).toEqual([{ text: "Hello, world\nsecond line", label: "greeting" }]);
  });

  test("handles CRLF line endings", () => {
    const { headers, rows } = parseCsv("a,b\r\n1,2\r\n");
    expect(headers).toEqual(["a", "b"]);
    expect(rows).toEqual([{ a: "1", b: "2" }]);
  });

  test("skips empty lines", () => {
    const { rows } = parseCsv("a\n1\n\n2\n");
    expect(rows).toEqual([{ a: "1" }, { a: "2" }]);
  });

  test("returns empty headers and rows for empty input", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/flow/csv.test.ts`
Expected: FAIL — `./csv` module does not exist.

- [ ] **Step 4: Implement the wrapper**

Create `src/lib/flow/csv.ts`:

```ts
import Papa from "papaparse";

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

/**
 * Parse CSV text with the first row as headers. Values are always strings.
 * papaparse handles RFC-4180 edge cases (quoted fields, embedded commas /
 * newlines, CRLF). Empty lines are skipped.
 */
export function parseCsv(text: string): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  return {
    headers: result.meta.fields ?? [],
    rows: result.data,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/flow/csv.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/flow/csv.ts src/lib/flow/csv.test.ts
git commit -m "feat: add papaparse-backed CSV parsing wrapper"
```

---

### Task 5: Group consecutive same-batch runs (pure helper)

**Files:**
- Create: `src/lib/flow/runGroups.ts`
- Test: `src/lib/flow/runGroups.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type RunLike = { batchId: string | null; status: string };
  export type RunGroup<T extends RunLike> =
    | { kind: "single"; run: T }
    | { kind: "batch"; batchId: string; runs: T[]; total: number; succeeded: number; failed: number };
  export function groupRuns<T extends RunLike>(runs: T[]): RunGroup<T>[];
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/flow/runGroups.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { groupRuns } from "./runGroups";

describe("groupRuns", () => {
  test("leaves runs with a null batchId as singles", () => {
    const groups = groupRuns([
      { batchId: null, status: "success" },
      { batchId: null, status: "error" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.kind === "single")).toBe(true);
  });

  test("collapses consecutive runs sharing a batchId with correct counts", () => {
    const groups = groupRuns([
      { batchId: "b1", status: "success" },
      { batchId: "b1", status: "error" },
      { batchId: "b1", status: "success" },
    ]);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.kind).toBe("batch");
    if (g.kind === "batch") {
      expect(g.total).toBe(3);
      expect(g.succeeded).toBe(2);
      expect(g.failed).toBe(1);
      expect(g.batchId).toBe("b1");
    }
  });

  test("separates a single run sitting between two batches", () => {
    const groups = groupRuns([
      { batchId: "b2", status: "success" },
      { batchId: null, status: "success" },
      { batchId: "b1", status: "success" },
      { batchId: "b1", status: "success" },
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["batch", "single", "batch"]);
  });

  test("does not merge two different adjacent batches", () => {
    const groups = groupRuns([
      { batchId: "b2", status: "success" },
      { batchId: "b1", status: "success" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.kind === "batch")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/flow/runGroups.test.ts`
Expected: FAIL — `./runGroups` module does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/lib/flow/runGroups.ts`:

```ts
export type RunLike = { batchId: string | null; status: string };

export type RunGroup<T extends RunLike> =
  | { kind: "single"; run: T }
  | { kind: "batch"; batchId: string; runs: T[]; total: number; succeeded: number; failed: number };

/**
 * Collapse consecutive runs that share a non-null batchId into one batch group.
 * Runs with a null batchId (single runs) are passed through untouched. Order is
 * preserved; callers pass runs already sorted (newest first).
 */
export function groupRuns<T extends RunLike>(runs: T[]): RunGroup<T>[] {
  const groups: RunGroup<T>[] = [];
  let current: { batchId: string; runs: T[] } | null = null;

  const flush = () => {
    if (!current) return;
    const succeeded = current.runs.filter((r) => r.status === "success").length;
    groups.push({
      kind: "batch",
      batchId: current.batchId,
      runs: current.runs,
      total: current.runs.length,
      succeeded,
      failed: current.runs.length - succeeded,
    });
    current = null;
  };

  for (const run of runs) {
    if (run.batchId === null) {
      flush();
      groups.push({ kind: "single", run });
      continue;
    }
    if (current && current.batchId === run.batchId) {
      current.runs.push(run);
    } else {
      flush();
      current = { batchId: run.batchId, runs: [run] };
    }
  }
  flush();
  return groups;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/flow/runGroups.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/flow/runGroups.ts src/lib/flow/runGroups.test.ts
git commit -m "feat: add run-grouping helper for CSV batches"
```

---

### Task 6: CSV run panel (upload, column picker, sequential loop, progress, results)

**Files:**
- Create: `src/app/flows/CsvRunPanel.tsx`
- Modify: `src/app/flows/FlowEditor.tsx` (add Text/CSV toggle in the Test section; render `CsvRunPanel` in CSV mode)

**Interfaces:**
- Consumes: `parseCsv` (Task 4); `POST /api/flows/[id]/run` accepting `{ input, batchId }` (Tasks 1–3).
- Produces: `CsvRunPanel` component — `export default function CsvRunPanel({ flowId, onComplete }: { flowId: string; onComplete: () => void })`.

This task has no unit test (client UI); it ends with a manual verification step. Keep all CSV state inside `CsvRunPanel` so `FlowEditor`'s change is small.

- [ ] **Step 1: Create the CSV run panel**

Create `src/app/flows/CsvRunPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { parseCsv } from "@/lib/flow/csv";

const MAX_ROWS = 50;

type RowResult = {
  input: string;
  status: "success" | "error";
  output: unknown;
  error: string | null;
};

export default function CsvRunPanel({ flowId, onComplete }: { flowId: string; onComplete: () => void }) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [column, setColumn] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [results, setResults] = useState<RowResult[]>([]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setParseError(null);
    setResults([]);
    setDone(0);
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const { headers, rows } = parseCsv(text);
    if (rows.length === 0) {
      setHeaders([]);
      setRows([]);
      setColumn("");
      setParseError("No rows found in the CSV.");
      return;
    }
    if (rows.length > MAX_ROWS) {
      setHeaders([]);
      setRows([]);
      setColumn("");
      setParseError(`CSV has ${rows.length} rows; the limit is ${MAX_ROWS}.`);
      return;
    }
    setHeaders(headers);
    setRows(rows);
    setColumn(headers[0] ?? "");
  }

  async function runBatch() {
    if (!column || rows.length === 0) return;
    setRunning(true);
    setResults([]);
    setDone(0);
    const batchId = crypto.randomUUID();
    const collected: RowResult[] = [];

    for (const row of rows) {
      const cell = (row[column] ?? "").trim();
      if (cell === "") {
        collected.push({ input: "", status: "error", output: null, error: "empty input" });
        setResults([...collected]);
        setDone(collected.length);
        continue;
      }
      try {
        const res = await fetch(`/api/flows/${flowId}/run`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input: cell, batchId }),
        });
        const data = await res.json();
        if (!res.ok) {
          collected.push({ input: cell, status: "error", output: null, error: JSON.stringify(data) });
        } else {
          collected.push({
            input: cell,
            status: data.status,
            output: data.output?.final ?? null,
            error: data.errorMessage ?? null,
          });
        }
      } catch (err) {
        collected.push({ input: cell, status: "error", output: null, error: (err as Error).message });
      }
      setResults([...collected]);
      setDone(collected.length);
    }

    setRunning(false);
    onComplete();
  }

  const total = rows.length;
  const succeeded = results.filter((r) => r.status === "success").length;
  const failed = results.length - succeeded;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div className="space-y-3">
      <input type="file" accept=".csv,text/csv" onChange={onFile} className="block text-sm" />
      {parseError && <p className="text-sm text-red-600">{parseError}</p>}

      {headers.length > 0 && (
        <label className="block">
          <span className="text-xs text-gray-500">Input column</span>
          <select
            value={column}
            onChange={(e) => setColumn(e.target.value)}
            className="mt-1 block w-full rounded border px-3 py-2 text-sm"
          >
            {headers.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </label>
      )}

      {rows.length > 0 && (
        <button
          type="button"
          onClick={runBatch}
          disabled={running || !column}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {running ? `Running… ${done}/${total}` : `Run ${total} rows`}
        </button>
      )}

      {(running || results.length > 0) && (
        <div className="space-y-2">
          <div className="h-2 w-full overflow-hidden rounded bg-gray-200 dark:bg-gray-800">
            <div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-sm">
            {done}/{total} · <span className="text-green-600">✓ {succeeded}</span> ·{" "}
            <span className="text-red-600">✗ {failed}</span>
          </p>

          {results.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="py-1 pr-3">Input</th>
                    <th className="py-1 pr-3">Status</th>
                    <th className="py-1 pr-3">Output / Error</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} className="border-b align-top">
                      <td className="max-w-[12rem] truncate py-1 pr-3">{r.input}</td>
                      <td className="py-1 pr-3">{r.status}</td>
                      <td className="py-1 pr-3">
                        <pre className="max-w-md overflow-x-auto">
                          {r.status === "success" ? JSON.stringify(r.output) : r.error}
                        </pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire the Text/CSV toggle into FlowEditor**

In `src/app/flows/FlowEditor.tsx`, add the import near the top (after the existing imports):

```tsx
import CsvRunPanel from "./CsvRunPanel";
```

Add an input-mode state alongside the other Test-panel state (near `const [input, setInput] = useState("")`):

```tsx
  const [inputMode, setInputMode] = useState<"text" | "csv">("text");
```

Replace the Test section's textarea + run button + result block (the `mode === "edit" && flow` block starting at the `<h2>Test</h2>`) so it renders a toggle and switches panels. The `<h2>Test</h2>` heading is followed by:

```tsx
          <div className="flex gap-2 text-sm">
            <button
              type="button"
              onClick={() => setInputMode("text")}
              className={`rounded border px-3 py-1 ${inputMode === "text" ? "bg-gray-200 dark:bg-gray-800" : ""}`}
            >
              Text
            </button>
            <button
              type="button"
              onClick={() => setInputMode("csv")}
              className={`rounded border px-3 py-1 ${inputMode === "csv" ? "bg-gray-200 dark:bg-gray-800" : ""}`}
            >
              CSV
            </button>
          </div>

          {inputMode === "csv" ? (
            <CsvRunPanel flowId={flow.id} onComplete={() => router.refresh()} />
          ) : (
            <>
              {/* existing textarea, Run button, and result block stay here unchanged */}
            </>
          )}
```

Keep the existing text-mode textarea, `run()` button, and `result` rendering exactly as they are — just move them inside the `inputMode === "text"` branch (`<>…</>`). Do not delete the `input`, `running`, `result`, `run` state/handlers; text mode still uses them.

- [ ] **Step 3: Typecheck and build**

Run: `npm run build`
Expected: compiles with no type errors. (If `crypto.randomUUID` types complain, it is available in the browser and in Node ≥ 16 lib DOM — no change needed for a client component.)

- [ ] **Step 4: Manual verification**

Start the app (`npm run dev`), open a saved flow, in the Test panel click **CSV**. Prepare a small CSV, e.g.:

```
text,note
"Ada Lovelace, ada@x.com",a
"Grace Hopper, grace@y.com",b
```

- Upload it → the column picker lists `text`, `note`; select `text`.
- Click **Run 2 rows** → progress bar fills to 100%, counts show `2/2 · ✓ N · ✗ M`, and a results table renders one row per CSV row.
- Confirm each row also appears in Run history (Task 7 groups them).
- Upload a CSV with an empty cell in the chosen column → that row shows status `error`, "empty input", and no request is sent for it.
- Upload a CSV with 51+ rows → the "limit is 50" message shows and Run is not offered.

- [ ] **Step 5: Commit**

```bash
git add src/app/flows/CsvRunPanel.tsx src/app/flows/FlowEditor.tsx
git commit -m "feat: CSV run panel with column picker, progress bar, and results table"
```

---

### Task 7: Group CSV batches in Run history

**Files:**
- Modify: `src/app/flows/[id]/page.tsx` (raise `take`, group runs, render batch entries)

**Interfaces:**
- Consumes: `groupRuns` + `RunGroup` (Task 5); `Run.batchId` (Task 2).
- Produces: nothing downstream.

This task ends with manual verification (server-component rendering). The grouping logic it relies on is already unit-tested in Task 5.

- [ ] **Step 1: Raise the run fetch limit**

In `src/app/flows/[id]/page.tsx`, change the runs query so a full 50-row batch is never truncated:

```tsx
    include: { runs: { orderBy: { createdAt: "desc" }, take: 100 } },
```

- [ ] **Step 2: Group and render**

Add the import at the top of `src/app/flows/[id]/page.tsx`:

```tsx
import { groupRuns } from "@/lib/flow/runGroups";
```

Compute groups before the return (after `flow` is confirmed non-null):

```tsx
  const runGroups = groupRuns(flow.runs);
```

Replace the `<tbody>` of the run-history table so it iterates `runGroups`. A `single` group renders exactly the existing row; a `batch` group renders one summary row with a `<details>` of its rows:

```tsx
              <tbody>
                {runGroups.map((group) => {
                  if (group.kind === "single") {
                    const run = group.run;
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
                  }
                  return (
                    <tr key={group.batchId} className="border-b align-top">
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {group.runs[0].createdAt.toLocaleString()}
                      </td>
                      <td className="py-2 pr-4">CSV batch</td>
                      <td className="py-2 pr-4">
                        <details>
                          <summary className="cursor-pointer text-xs">
                            {group.total} rows · {group.succeeded} ✓ / {group.failed} ✗
                          </summary>
                          <div className="mt-1 space-y-1">
                            {group.runs.map((run) => {
                              const trace = run.output as unknown as RunTrace | null;
                              return (
                                <pre key={run.id} className="max-w-md overflow-x-auto text-xs">
                                  {run.status === "success" ? JSON.stringify(trace?.final) : run.errorMessage}
                                </pre>
                              );
                            })}
                          </div>
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
```

Note: `groupRuns` is generic over `RunLike`; the Prisma `Run` objects satisfy it (they have `batchId: string | null` and `status: string`), so no cast is needed.

- [ ] **Step 3: Typecheck and build**

Run: `npm run build`
Expected: compiles with no type errors.

- [ ] **Step 4: Manual verification**

With the app running, on a flow that has both single text runs and a CSV batch:
- Single runs render as before (When / Status / Output).
- The CSV batch renders as one row labeled **CSV batch** with a `N rows · X ✓ / Y ✗` summary that expands to per-row outputs.
- Run a fresh 50-row batch and confirm the summary says `50 rows` (not truncated).

- [ ] **Step 5: Commit**

```bash
git add "src/app/flows/[id]/page.tsx"
git commit -m "feat: group CSV batch runs in run history"
```

---

### Task 8: Update project docs

**Files:**
- Modify: `docs/PROJECT-HISTORY.md` (add Phase 5; remove the CSV to-do item)

**Interfaces:** none.

- [ ] **Step 1: Add the phase and remove the to-do**

In `docs/PROJECT-HISTORY.md`, add a new phase after Phase 4:

```markdown
## Phase 5 — CSV input

*Spec & plan: `2026-07-18-flowforge-csv-input`. Merged 2026-07-18.*

- `Run.batchId` column groups rows from one CSV upload
- Client-side CSV parsing (papaparse) behind `parseCsv`
- Test panel Text/CSV toggle: file upload, column picker, sequential per-row run loop
- Live progress bar with succeeded/failed counts and an inline results table (50-row cap)
- Run history groups a batch's rows into one collapsible entry
```

And remove this line from the **To do** list:

```markdown
- [ ] CSV input with row-by-row processing + progress bar
```

- [ ] **Step 2: Commit**

```bash
git add docs/PROJECT-HISTORY.md
git commit -m "docs: record CSV input phase"
```

---

## Final verification

- [ ] Run the whole suite: `npm test` → all pass, no live network calls.
- [ ] Build: `npm run build` → succeeds.
- [ ] Re-read the spec (`docs/superpowers/specs/2026-07-18-flowforge-csv-input-design.md`) and confirm every section maps to a completed task.
</content>
