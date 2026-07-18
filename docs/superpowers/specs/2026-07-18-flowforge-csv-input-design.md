# FlowForge — CSV Input (Design)

**Date:** 2026-07-18
**Phase:** CSV input with row-by-row processing + progress bar
**Scope reference:** [`PROJECT-SCOPE.md`](../../PROJECT-SCOPE.md) — "Text and CSV input, with CSV
processed row by row behind a progress bar."

## Problem

Today a run takes a single pasted `input` string. The scope calls for CSV input: a user uploads a
CSV, picks the column that feeds the flow, and the flow runs once per row, with a live progress bar.
Each execution must still persist a `Run` (invariant #2), and the non-goals forbid background jobs,
queues, async execution, and streaming — execution stays synchronous, inside the request.

## Approach

Keep the CSV concern entirely **client-side** in the Test panel. The server contract barely
changes: it still executes one `input` and persists one `Run`. The browser parses the CSV, extracts
the chosen column's cell for each row, and drives a **sequential loop** over the existing per-row
run endpoint. Rows of one upload share a `batchId` so run history can group them.

This fits the non-goals precisely: every request is a single synchronous run (no background jobs,
no streaming); the progress bar is driven client-side by responses returning one at a time.

### Data flow

1. User switches the Test panel to **CSV mode** and selects a file.
2. Browser parses it with **papaparse** (first row = headers), producing rows keyed by header.
3. A **column picker** (populated from the headers) chooses which column feeds `{{input}}`.
4. On **Run**, the client generates one `batchId` (`crypto.randomUUID()`), then loops rows in
   order, calling `POST /api/flows/[id]/run` with `{ input: <cell value>, batchId }` for each.
5. Each response advances the progress bar and updates live succeeded/failed counts.
6. A failing row is recorded (as an error `Run`, as today) and the loop **continues**.
7. When the loop finishes, an inline results table and a summary are shown.

The server never sees CSV, headers, or columns — only `input` + `batchId`, exactly as it handles a
single run today.

## Data model

One nullable column added to `Run`:

```prisma
model Run {
  // ... existing fields ...
  batchId String?   // groups rows from one CSV upload; null for single runs
  @@index([flowId])
  @@index([batchId])
}
```

This requires a Prisma migration. Per project convention, dev data is throwaway (no backfill), and
the dev server must be restarted after the migration so Prisma doesn't serve a stale client.

## Server changes (minimal)

- **`runInputSchema`** (`src/lib/validations/flow.ts`) gains `batchId: z.string().optional()`.
- **`runFlow`** (`src/lib/flow/runFlow.ts`) accepts an optional `batchId` and stores it on the
  created `Run`. Signature: `runFlow(flowId, input, deps?, batchId?)`.
- **Run route** (`src/app/api/flows/[id]/run/route.ts`) threads `parsed.data.batchId` through.

No new endpoint. No change to step execution, providers, templating, or retry.

## CSV parsing

Use **papaparse** (add `papaparse` + `@types/papaparse`). Parse with `header: true` and
`skipEmptyLines: true`. papaparse handles RFC-4180 edge cases (quoted fields, embedded commas and
newlines, CRLF) that a hand-rolled parser would get wrong.

A thin wrapper (`src/lib/flow/csv.ts`) exposes a typed `parseCsv(text)` returning
`{ headers: string[]; rows: Record<string, string>[] }`, so the parsing library stays behind one
seam and is unit-testable.

## Batch behavior

- **Header row required.** The first row supplies column names for the picker. A file with no data
  rows shows "No rows found."
- **Empty input cell.** If the selected column's cell for a row is empty/whitespace, the row is
  marked failed client-side ("empty input") with **no** request sent — it never reaches the server.
- **Row cap: 50.** This is a demo; a CSV over 50 rows is rejected up front with a clear message
  ("CSV has N rows; the limit is 50"). Prevents a runaway of synchronous per-row requests.
- **Failures don't stop the batch.** A row whose run returns `status: "error"` (step error, or
  invalid output after retries) is counted as failed; the loop proceeds to the next row. Invariant
  #6 (halt on first step error) still holds *within* each row.

## UI

Test panel (`src/app/flows/FlowEditor.tsx`) gains a **Text / CSV** input-mode toggle.

- **Text mode:** unchanged — today's textarea + Run.
- **CSV mode:**
  - File input; on select, parse and show the **column `<select>`** (header names).
  - **Run** is enabled once a file is parsed and a column chosen.
  - **During the run:** a progress bar (`12 / 50`) with live `✓ N succeeded · ✗ M failed`.
  - **After the run:** an inline **results table** — one row per CSV row showing the input cell
    value, status, and final output (or error). This table is the surface the later *Export* phase
    will reuse.

**Run history** (`src/app/flows/[id]/page.tsx`): consecutive runs sharing a non-null `batchId`
collapse into a single entry — e.g. *"CSV batch · 50 rows · 47 ✓ / 3 ✗"* — with per-row detail
available. Runs with `batchId = null` render exactly as they do now.

The page currently fetches `take: 20` runs. A batch of up to 50 rows would be truncated, making the
grouped count wrong. So the query's `take` is raised to comfortably hold at least one full batch
(e.g. `take: 100`) — cheap at demo scale — so a recent batch's succeeded/failed counts are accurate.
(Grouping remains a client-of-the-query concern; no `groupBy` aggregation is needed at this size.)

## Testing (no live LLM — invariant #4)

- **`csv.ts` wrapper:** parses headers + rows; handles quoted fields, embedded commas/newlines,
  CRLF, and empty-line skipping (papaparse behavior, verified through our wrapper).
- **`runInputSchema`:** accepts a `batchId`, accepts its absence, rejects a non-string `batchId`.
- **`runFlow`:** persists `batchId` on the created `Run` when supplied, and `null` when not
  (mocked provider).
- **Run route:** threads `batchId` from body to `runFlow`.
- **Run-history grouping:** consecutive same-`batchId` runs group; `null`-batch runs stay separate;
  succeeded/failed counts are correct.

Client loop / progress-bar UI is exercised manually (the run screen) rather than unit-tested, in
keeping with the project's existing test surface.

## Out of scope (this phase)

- **Export of results** — its own later phase; this phase only renders the on-screen table.
- **Columns as template variables** — the flow still has one `{{input}}`; the chosen column fills
  it. No template-system change.
- **Concurrency** — the loop is strictly sequential (one request in flight).
- **Resume / partial re-run** — a failed batch is simply re-uploaded.

## Invariants upheld

- **#2 Every execution persists a `Run`** — one per row, success or error.
- **#4 No live LLM in tests** — providers mocked; the loop and parser are the only new surfaces.
- **#6 Halt on first step error** — unchanged, and scoped to a single row; independent rows continue.
- **#7 `flowSchema` single source of validation** — untouched; only `runInputSchema` grows an
  optional field.
</content>
