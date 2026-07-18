# Flow Editor Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the FlowForge editor and app shell into a blueprint/schematic identity ("The Drawing") — a light drafting-paper theme with a true cyanotype dark mode — with zero behavior change.

**Architecture:** Introduce a CSS-variable design-token layer in `globals.css` (light `:root` + `prefers-color-scheme: dark` cyanotype override), surfaced to Tailwind v4 utilities via `@theme inline`. Swap Geist fonts for Archivo Expanded / IBM Plex Sans / IBM Plex Mono via `next/font/google`. Rewrite the editor's JSX into a title-block header + two-pane layout (a "drawing" column with a connector rail and step cards, and a sticky "test rig" panel) while leaving every state field, handler, server action, and payload untouched. Restyle the three surrounding pages to match.

**Tech Stack:** Next.js 16.2.10 (App Router), React 19, Tailwind CSS v4 (`@tailwindcss/postcss`), `next/font/google`. No new runtime dependencies.

## Global Constraints

Every task's requirements implicitly include these:

- **Presentational only.** Do not change component state shape, event handlers, `actions.ts`, the run API, `runFlow`, validation, or the saved `Step`/`Flow`/`Run` payloads. Class names, markup structure, fonts, and colors only. Existing behavior and the `toPayloadStep` output must be byte-identical.
- **No new runtime dependencies.** Fonts via `next/font/google`; grid via pure CSS. No drag-and-drop, icon, or component library (per `docs/PROJECT-SCOPE.md`).
- **`flowSchema` stays the single source of truth for validation.** The UI mirrors it; do not add or relax any validation rule.
- **Steps stay a linear sequence with up/down reordering.** No drag-and-drop, no new step types.
- **Both themes ship.** Light "drafting paper" default + cyanotype dark via `prefers-color-scheme`. No unreadable blue-on-blue; text stays high-contrast in both.
- **English only** for all copy (per repo convention).
- **Filled accent buttons use `bg-azure text-paper`** so they contrast in both themes (paper flips dark in dark mode, azure flips pale — the pairing inverts correctly).
- **Restart `next dev` if the Prisma client ever complains** about columns — unrelated to this work but a known repo gotcha; no migrations here.

---

## File Structure

- `src/app/globals.css` — design tokens (both themes), `@theme` mapping, blueprint grid, focus ring, plot-in keyframes. Foundation everything consumes.
- `src/app/layout.tsx` — font wiring + corrected metadata.
- `src/app/flows/FlowEditor.tsx` — the editor rewrite (title block, rail, step cards, ports, field editor, test rig, plot-in trace).
- `src/app/flows/[id]/page.tsx` — edit-page shell + collapsible run-history.
- `src/app/flows/new/page.tsx` — new-flow shell (single column).
- `src/app/page.tsx` — home/list page shell.

---

### Task 1: Design-token foundation (globals.css + fonts)

**Files:**
- Modify: `src/app/globals.css` (full replace)
- Modify: `src/app/layout.tsx` (full replace)

**Interfaces:**
- Produces (consumed by all later tasks):
  - Tailwind color utilities backed by CSS vars that flip per theme: `paper`, `sheet`, `grid`, `ink`, `ink-soft`, `blueprint`, `azure`, `redline`, `hairline` (usable as `bg-*`, `text-*`, `border-*`, and with `/opacity`, e.g. `bg-paper/40`).
  - Font utilities: `font-display` (Archivo Expanded), `font-sans` (IBM Plex Sans, also the body default), `font-mono` (IBM Plex Mono).
  - A `.plot-in` class (staggered reveal animation, disabled under `prefers-reduced-motion`).

- [ ] **Step 1: Replace `src/app/globals.css`**

```css
@import "tailwindcss";

:root {
  /* light — drafting paper */
  --paper: #eef2f7;
  --sheet: #fbfcfe;
  --grid: #dce6f2;
  --ink: #0b2440;
  --ink-soft: #4a5b72;
  --blueprint: #16457a;
  --azure: #0e6fe0;
  --redline: #c2452b;
  --hairline: #c9d6e6;
}

@media (prefers-color-scheme: dark) {
  :root {
    /* dark — cyanotype */
    --paper: #0a2a49;
    --sheet: #0c3157;
    --grid: #164675;
    --ink: #dcebfb;
    --ink-soft: #8fb4da;
    --blueprint: #5fa8e6;
    --azure: #7fc4ff;
    --redline: #ff7a5c;
    --hairline: #1c4a78;
  }
}

@theme inline {
  --color-paper: var(--paper);
  --color-sheet: var(--sheet);
  --color-grid: var(--grid);
  --color-ink: var(--ink);
  --color-ink-soft: var(--ink-soft);
  --color-blueprint: var(--blueprint);
  --color-azure: var(--azure);
  --color-redline: var(--redline);
  --color-hairline: var(--hairline);
  --font-display: var(--font-archivo-expanded);
  --font-sans: var(--font-ibm-plex-sans);
  --font-mono: var(--font-ibm-plex-mono);
}

body {
  background-color: var(--paper);
  color: var(--ink);
  font-family: var(--font-ibm-plex-sans), ui-sans-serif, system-ui, sans-serif;
  background-image:
    linear-gradient(to right, var(--grid) 1px, transparent 1px),
    linear-gradient(to bottom, var(--grid) 1px, transparent 1px);
  background-size: 22px 22px;
}

*:focus-visible {
  outline: 2px solid var(--azure);
  outline-offset: 2px;
}

@keyframes plot-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.plot-in {
  animation: plot-in 320ms ease-out both;
}

@media (prefers-reduced-motion: reduce) {
  .plot-in {
    animation: none;
  }
}
```

- [ ] **Step 2: Replace `src/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import { Archivo_Expanded, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const archivoExpanded = Archivo_Expanded({
  variable: "--font-archivo-expanded",
  subsets: ["latin"],
  weight: ["600", "700"],
});

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "FlowForge",
  description: "Compose and run linear LLM pipelines.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${archivoExpanded.variable} ${ibmPlexSans.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Build (typecheck + font fetch)**

Run: `npm run build`
Expected: build succeeds. This confirms the three Google font families (`Archivo_Expanded`, `IBM_Plex_Sans`, `IBM_Plex_Mono`) resolve. If `Archivo_Expanded` fails to resolve at build, fall back to `Archivo` with `weight: ["600","700"]` and keep the `--font-archivo-expanded` variable name — but attempt `Archivo_Expanded` first.

- [ ] **Step 5: Existing test suite still green (regression guard)**

Run: `npm run test`
Expected: all existing tests pass (unchanged — this task touches no logic).

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css src/app/layout.tsx
git commit -m "feat(ui): blueprint design tokens, grid, and technical fonts"
```

---

### Task 2: FlowEditor rewrite (drawing + test rig)

**Files:**
- Modify: `src/app/flows/FlowEditor.tsx` (replace the `refsAfter` helper addition + the entire returned JSX; keep all state, helpers, and handlers above `return` unchanged)

**Interfaces:**
- Consumes (from Task 1): `bg-paper/sheet`, `text-ink/ink-soft/blueprint/azure/redline`, `border-hairline/blueprint`, `font-display/mono`, `.plot-in`.
- Consumes (existing, unchanged): `createFlow`, `updateFlow`, `deleteFlow` from `./actions`; `availableRefs` from `@/lib/flow/template`; `PROVIDER_NAMES`, `ProviderName` from `@/lib/validations/flow`; types `FieldDef`, `FieldType`, `Step`, `StepType`.
- Produces: no new exports; same default-exported `FlowEditor({ mode, flow })`.

- [ ] **Step 1: Replace the whole file `src/app/flows/FlowEditor.tsx`**

The block from the top of the file through the end of the `run()` function is **unchanged** from the current file (imports, constants, `fieldKeySeq`, all types, `nextKey`, `emptyExtractStep`, `emptyGenerateStep`, `refsBefore`, `withFieldKeys`, the component state, and every handler `updateStep`…`run`). Only two things change: a new `refsAfter` helper is added next to `refsBefore`, and the entire `return (…)` JSX is replaced. Write the complete file:

```tsx
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createFlow, deleteFlow, updateFlow } from "./actions";
import type { FieldDef, FieldType, Step, StepType } from "@/lib/flow/types";
import { availableRefs } from "@/lib/flow/template";
import { PROVIDER_NAMES, type ProviderName } from "@/lib/validations/flow";

const FIELD_TYPES: FieldType[] = ["string", "number", "boolean", "string_array"];

let fieldKeySeq = 0;

type EditorField = FieldDef & { _key: number }; // _key is client-only, never saved

type EditorStep = {
  key: string;
  type: StepType;
  name: string;
  prompt: string;
  provider: ProviderName | ""; // "" = inherit flow default
  fields: EditorField[]; // used by extract; empty for generate
};

// Shape of a step as it arrives via props (server data, no client-only `_key` yet).
type IncomingStep = Omit<EditorStep, "fields"> & { fields: FieldDef[] };

type EditorFlow = { id: string; name: string; provider: ProviderName; steps: IncomingStep[] };

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
    fields: [{ name: "", type: "string", required: true, order: 0, _key: fieldKeySeq++ }],
  };
}

function emptyGenerateStep(steps: EditorStep[]): EditorStep {
  return { key: nextKey("generate", steps), type: "generate", name: "", prompt: "", provider: "", fields: [] };
}

function refsBefore(steps: EditorStep[], index: number): string[] {
  return availableRefs(steps.slice(0, index) as unknown as Step[]);
}

// Refs this step contributes onto the wire (its own outputs), for the rail annotation.
function refsAfter(step: EditorStep): string[] {
  if (step.type === "generate") return [`${step.key}.text`];
  return step.fields.filter((f) => f.name.trim()).map((f) => `${step.key}.${f.name}`);
}

function withFieldKeys(steps: IncomingStep[]): EditorStep[] {
  return steps.map((s) => ({ ...s, fields: s.fields.map((f) => ({ ...f, _key: fieldKeySeq++ })) }));
}

// Rail cell: the connector "wire" running down the drawing, with a node marker per row.
function RailCell({ kind }: { kind: "node" | "terminal" | "arrow" }) {
  return (
    <div className="relative flex w-6 justify-center">
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-blueprint/40" aria-hidden />
      {kind === "terminal" ? (
        <span className="relative mt-1.5 h-2.5 w-2.5 border border-blueprint bg-paper" aria-hidden />
      ) : kind === "arrow" ? (
        <span className="relative mt-0.5 text-xs leading-none text-blueprint" aria-hidden>
          ▼
        </span>
      ) : (
        <span className="relative mt-4 h-2.5 w-2.5 rounded-full border border-blueprint bg-paper" aria-hidden />
      )}
    </div>
  );
}

const EYEBROW = "font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-soft";
const INPUT_CLS =
  "rounded-sm border border-hairline bg-sheet px-2 py-1 text-sm text-ink outline-none placeholder:text-ink-soft";

export default function FlowEditor({ mode, flow }: { mode: "new" | "edit"; flow?: EditorFlow }) {
  const router = useRouter();
  const [name, setName] = useState(flow?.name ?? "");
  const [provider, setProvider] = useState<ProviderName>(flow?.provider ?? "gemini");
  const [steps, setSteps] = useState<EditorStep[]>(flow ? withFieldKeys(flow.steps) : [emptyExtractStep([])]);
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
          ? {
              ...s,
              fields: [
                ...s.fields,
                { name: "", type: "string", required: true, order: s.fields.length, _key: fieldKeySeq++ },
              ],
            }
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
    if (s.type === "extract") {
      step.fields = s.fields.map((f, i) => ({ name: f.name, type: f.type, required: f.required, order: i }));
    }
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

  const twoPane = mode === "edit" && !!flow;
  const lastStep = steps[steps.length - 1];

  return (
    <div className="space-y-6">
      {/* ── Title block: the drawing's metadata stamp ── */}
      <section className="border border-blueprint bg-sheet">
        <div className="flex items-center justify-between border-b border-hairline px-3 py-1.5">
          <span className="font-display text-xs font-bold uppercase tracking-[0.2em] text-blueprint">
            FlowForge · Sheet
          </span>
          <span className="font-mono text-[11px] text-ink-soft">rev —</span>
        </div>
        <div className="grid grid-cols-1 divide-y divide-hairline sm:grid-cols-[2fr_1fr_auto_auto] sm:divide-x sm:divide-y-0">
          <label className="block px-3 py-2">
            <span className={EYEBROW}>Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Untitled flow"
              className="mt-0.5 w-full bg-transparent font-display text-lg font-bold text-ink outline-none placeholder:text-ink-soft"
            />
          </label>
          <label className="block px-3 py-2">
            <span className={EYEBROW}>Default provider</span>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as ProviderName)}
              className="mt-0.5 block w-full bg-transparent font-mono text-sm text-ink outline-none"
            >
              {PROVIDER_NAMES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <div className="px-3 py-2">
            <span className={EYEBROW}>Steps</span>
            <div className="mt-0.5 font-mono text-lg text-ink">{steps.length}</div>
          </div>
          <div className="px-3 py-2">
            <span className={EYEBROW}>Status</span>
            <div className="mt-0.5 font-mono text-sm text-ink">{result?.status ?? "draft"}</div>
          </div>
        </div>
      </section>

      <div className={`grid gap-6 ${twoPane ? "lg:grid-cols-[minmax(0,1fr)_360px]" : ""}`}>
        {/* ── The drawing ── */}
        <div className="min-w-0">
          {/* input node */}
          <div className="grid grid-cols-[24px_minmax(0,1fr)] gap-3">
            <RailCell kind="terminal" />
            <div className="py-1">
              <span className="font-mono text-xs font-medium text-blueprint">input</span>
              <span className="ml-2 font-mono text-[11px] text-ink-soft">{`{{input}}`} · the run's input text</span>
            </div>
          </div>

          {/* step cards */}
          {steps.map((step, i) => (
            <div key={step.key} className="grid grid-cols-[24px_minmax(0,1fr)] gap-3">
              <RailCell kind="node" />
              <div className="mb-3 border border-hairline bg-sheet">
                {/* title strip */}
                <div className="flex flex-wrap items-center gap-2 border-b border-hairline bg-paper/60 px-3 py-1.5">
                  <span className="rounded-sm border border-blueprint bg-sheet px-1.5 py-0.5 font-mono text-xs font-medium text-blueprint">
                    {step.key}
                  </span>
                  <span className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
                    {step.type}
                  </span>
                  <input
                    placeholder="label (optional)"
                    value={step.name}
                    onChange={(e) => updateStep(i, { name: e.target.value })}
                    className="min-w-0 flex-1 bg-transparent px-1 py-0.5 text-sm text-ink outline-none placeholder:text-ink-soft"
                  />
                  <select
                    value={step.provider}
                    onChange={(e) => updateStep(i, { provider: e.target.value as ProviderName | "" })}
                    className="rounded-sm border border-hairline bg-sheet px-1.5 py-0.5 font-mono text-xs text-ink"
                  >
                    <option value="">↳ flow default</option>
                    {PROVIDER_NAMES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center">
                    <button
                      type="button"
                      onClick={() => moveStep(i, -1)}
                      disabled={i === 0}
                      className="px-1 text-ink-soft hover:text-ink disabled:opacity-30"
                      aria-label="Move step up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveStep(i, 1)}
                      disabled={i === steps.length - 1}
                      className="px-1 text-ink-soft hover:text-ink disabled:opacity-30"
                      aria-label="Move step down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeStep(i)}
                      className="px-1 text-redline hover:opacity-70"
                      aria-label="Remove step"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* body */}
                <div className="space-y-3 p-3">
                  <label className="block">
                    <span className={EYEBROW}>Prompt template</span>
                    <textarea
                      ref={(el) => {
                        promptRefs.current[step.key] = el;
                      }}
                      value={step.prompt}
                      onChange={(e) => updateStep(i, { prompt: e.target.value })}
                      rows={3}
                      className="mt-1 w-full rounded-sm border border-hairline bg-paper/40 px-3 py-2 font-mono text-sm text-ink outline-none"
                    />
                  </label>

                  {/* ports: insert available refs */}
                  <div className="flex flex-wrap items-center gap-1">
                    <span className={`${EYEBROW} mr-1`}>Ports</span>
                    {refsBefore(steps, i).map((ref) => (
                      <button
                        key={ref}
                        type="button"
                        onClick={() => insertToken(i, ref)}
                        className="rounded-sm border border-blueprint/50 bg-sheet px-1.5 py-0.5 font-mono text-[11px] text-blueprint hover:border-azure hover:text-azure"
                      >
                        {`{{${ref}}}`}
                      </button>
                    ))}
                  </div>

                  {step.type === "extract" ? (
                    <div>
                      <span className={EYEBROW}>Output fields</span>
                      <div className="mt-1 space-y-2">
                        {step.fields.map((field, k) => (
                          <div key={field._key} className="flex flex-wrap items-center gap-2">
                            <input
                              placeholder="field_name"
                              value={field.name}
                              onChange={(e) => updateField(i, k, { name: e.target.value })}
                              className={`min-w-0 flex-1 ${INPUT_CLS}`}
                            />
                            <select
                              value={field.type}
                              onChange={(e) => updateField(i, k, { type: e.target.value as FieldType })}
                              className="rounded-sm border border-hairline bg-sheet px-2 py-1 font-mono text-xs text-ink"
                            >
                              {FIELD_TYPES.map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                            </select>
                            <label className="flex items-center gap-1 text-xs text-ink-soft">
                              <input
                                type="checkbox"
                                checked={field.required}
                                onChange={(e) => updateField(i, k, { required: e.target.checked })}
                                className="accent-azure"
                              />
                              required
                            </label>
                            <button
                              type="button"
                              onClick={() => removeField(i, k)}
                              className="text-xs text-redline hover:opacity-70"
                            >
                              remove
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => addField(i)}
                        className="mt-2 font-mono text-xs text-azure hover:underline"
                      >
                        + add field
                      </button>
                    </div>
                  ) : (
                    <p className="font-mono text-[11px] text-ink-soft">
                      outputs <span className="text-blueprint">{`{{${step.key}.text}}`}</span>
                    </p>
                  )}

                  {/* rail annotation: what this component puts on the wire */}
                  {refsAfter(step).length > 0 && (
                    <div className="flex flex-wrap items-center gap-1 border-t border-dashed border-hairline pt-2">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-soft">on wire →</span>
                      {refsAfter(step).map((r) => (
                        <span key={r} className="font-mono text-[11px] text-blueprint">
                          {`{{${r}}}`}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* add-step controls */}
          <div className="grid grid-cols-[24px_minmax(0,1fr)] gap-3">
            <RailCell kind="node" />
            <div className="mb-3 flex gap-2">
              <button
                type="button"
                onClick={() => addStep("extract")}
                className="rounded-sm border border-dashed border-blueprint/50 px-3 py-1.5 font-mono text-xs text-blueprint hover:border-azure hover:text-azure"
              >
                + extract step
              </button>
              <button
                type="button"
                onClick={() => addStep("generate")}
                className="rounded-sm border border-dashed border-blueprint/50 px-3 py-1.5 font-mono text-xs text-blueprint hover:border-azure hover:text-azure"
              >
                + generate step
              </button>
            </div>
          </div>

          {/* output node */}
          <div className="grid grid-cols-[24px_minmax(0,1fr)] gap-3">
            <RailCell kind="terminal" />
            <div className="py-1">
              <span className="font-mono text-xs font-medium text-blueprint">output</span>
              {lastStep && (
                <span className="ml-2 font-mono text-[11px] text-ink-soft">final ← {lastStep.key}</span>
              )}
            </div>
          </div>

          {error && <p className="mt-3 font-mono text-sm text-redline">{error}</p>}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-sm bg-azure px-4 py-2 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save flow"}
            </button>
            {mode === "edit" && flow && (
              <button
                type="button"
                onClick={() => deleteFlow(flow.id)}
                className="rounded-sm border border-redline px-4 py-2 text-sm font-semibold text-redline hover:bg-redline/10"
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {/* ── Test rig ── */}
        {twoPane && flow && (
          <aside className="h-fit border border-blueprint bg-sheet lg:sticky lg:top-6">
            <div className="border-b border-hairline px-3 py-1.5">
              <span className="font-display text-xs font-bold uppercase tracking-[0.2em] text-blueprint">
                Test rig
              </span>
            </div>
            <div className="space-y-3 p-3">
              <label className="block">
                <span className={EYEBROW}>Input</span>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  rows={4}
                  placeholder="Paste input text…"
                  className="mt-1 w-full rounded-sm border border-hairline bg-paper/40 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-soft"
                />
              </label>
              <button
                type="button"
                onClick={run}
                disabled={running || input.trim() === ""}
                className="w-full rounded-sm bg-azure px-4 py-2 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-50"
              >
                {running ? "Running…" : "▶ Run"}
              </button>

              {result && (
                <div className="space-y-3">
                  <div>
                    <span className={EYEBROW}>Trace</span>
                    <div className="mt-1 space-y-1">
                      {result.output?.steps.map((s, idx) => (
                        <div
                          key={s.key}
                          className="plot-in rounded-sm border border-hairline bg-paper/40 p-2"
                          style={{ animationDelay: `${idx * 80}ms` }}
                        >
                          <div className="flex items-center gap-2 text-xs">
                            <span
                              className={`h-2 w-2 rounded-full ${s.status === "success" ? "bg-azure" : "bg-redline"}`}
                              aria-hidden
                            />
                            <span className="font-mono text-blueprint">{s.key}</span>
                            <span className="text-ink-soft">{s.type}</span>
                            <span className="ml-auto font-mono text-ink-soft">{s.ms}ms</span>
                          </div>
                          <pre className="mt-1 overflow-x-auto font-mono text-[11px] text-ink">
                            {s.status === "success" ? JSON.stringify(s.output, null, 2) : s.error}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </div>
                  {result.errorMessage && <p className="font-mono text-xs text-redline">{result.errorMessage}</p>}
                  {result.output && (
                    <div>
                      <span className={EYEBROW}>Final</span>
                      <pre className="mt-1 overflow-x-auto rounded-sm border border-hairline bg-paper/40 p-3 font-mono text-[11px] text-ink">
                        {JSON.stringify(result.output.final, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Build (typecheck)**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Existing test suite still green**

Run: `npm run test`
Expected: all pass (no logic changed).

- [ ] **Step 5: Manual visual check**

Run: `npm run dev`, open an existing flow at `/flows/<id>`.
Confirm: title block shows Name/provider/steps/status; the drawing has input node → step cards on a connector rail → output node; step cards show key tag, type, label, provider, ↑/↓/✕, prompt, Ports chips, fields (extract) or the generate note, and an "on wire →" annotation; the sticky Test rig sits on the right; run the flow and confirm the trace rows fade in staggered (plot-in) with a status dot; toggle OS dark mode and confirm the cyanotype theme is legible; narrow the window and confirm the test rig drops below the drawing (single column) with no horizontal page scroll.

- [ ] **Step 6: Commit**

```bash
git add src/app/flows/FlowEditor.tsx
git commit -m "feat(ui): redesign FlowEditor as a schematic drawing with test rig"
```

---

### Task 3: Edit-page shell + collapsible run history

**Files:**
- Modify: `src/app/flows/[id]/page.tsx` (replace the returned JSX; keep the data fetch, `RunTrace` type, and `notFound()` logic unchanged)

**Interfaces:**
- Consumes: the redesigned `FlowEditor` (Task 2), Task 1 utilities.
- Produces: nothing new; same route component.

- [ ] **Step 1: Replace the `return (…)` in `src/app/flows/[id]/page.tsx`**

Everything above `return` (imports, `dynamic`, `RunTrace` type, `FlowPage` signature, the `prisma.flow.findUnique` call, `notFound()`, and the `steps` mapping) is **unchanged**. Replace only the returned JSX with:

```tsx
  return (
    <main className="mx-auto max-w-5xl p-6 sm:p-8">
      <Link href="/" className="font-mono text-xs text-azure hover:underline">
        ← all flows
      </Link>

      <div className="mt-4">
        <FlowEditor
          mode="edit"
          flow={{ id: flow.id, name: flow.name, provider: flow.provider as ProviderName, steps }}
        />
      </div>

      <section className="mt-8">
        <details className="border border-hairline bg-sheet" open>
          <summary className="cursor-pointer border-b border-hairline px-3 py-1.5 font-display text-xs font-bold uppercase tracking-[0.2em] text-blueprint">
            Run history
          </summary>
          <div className="p-3">
            {flow.runs.length === 0 ? (
              <p className="font-mono text-sm text-ink-soft">No runs yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-hairline">
                      <th className="py-2 pr-4 font-display text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
                        When
                      </th>
                      <th className="py-2 pr-4 font-display text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
                        Status
                      </th>
                      <th className="py-2 pr-4 font-display text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
                        Output / Error
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {flow.runs.map((run) => {
                      const trace = run.output as unknown as RunTrace | null;
                      const ok = run.status === "success";
                      return (
                        <tr key={run.id} className="border-b border-hairline align-top">
                          <td className="py-2 pr-4 whitespace-nowrap font-mono text-xs text-ink-soft">
                            {run.createdAt.toLocaleString()}
                          </td>
                          <td className="py-2 pr-4">
                            <span className="flex items-center gap-1.5 font-mono text-xs text-ink">
                              <span
                                className={`h-2 w-2 rounded-full ${ok ? "bg-azure" : "bg-redline"}`}
                                aria-hidden
                              />
                              {run.status}
                            </span>
                          </td>
                          <td className="py-2 pr-4">
                            {ok ? (
                              <>
                                <div className="mb-1 font-mono text-xs text-ink-soft">
                                  {trace?.steps.map((s) => `${s.key}:${s.status} (${s.ms}ms)`).join("  ")}
                                </div>
                                <pre className="max-w-md overflow-x-auto font-mono text-xs text-ink">
                                  {JSON.stringify(trace?.final, null, 2)}
                                </pre>
                              </>
                            ) : (
                              <pre className="max-w-md overflow-x-auto font-mono text-xs text-redline">
                                {run.errorMessage}
                              </pre>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </details>
      </section>
    </main>
  );
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manual visual check**

`npm run dev`, open `/flows/<id>`: back link reads "← all flows"; no duplicate `<h1>` above the title block (the flow name now lives in the title block); "Run history" is a collapsible panel, open by default, with status dots; wide table scrolls inside its container without the page scrolling horizontally.

- [ ] **Step 5: Commit**

```bash
git add "src/app/flows/[id]/page.tsx"
git commit -m "feat(ui): schematic edit-page shell with collapsible run history"
```

---

### Task 4: New-flow page + home list shell

**Files:**
- Modify: `src/app/flows/new/page.tsx` (full replace)
- Modify: `src/app/page.tsx` (full replace)

**Interfaces:**
- Consumes: redesigned `FlowEditor` (Task 2), Task 1 utilities.
- Produces: nothing new.

- [ ] **Step 1: Replace `src/app/flows/new/page.tsx`**

```tsx
import Link from "next/link";
import FlowEditor from "../FlowEditor";

export default function NewFlowPage() {
  return (
    <main className="mx-auto max-w-3xl p-6 sm:p-8">
      <Link href="/" className="font-mono text-xs text-azure hover:underline">
        ← all flows
      </Link>
      <p className="mt-4 mb-4 font-display text-xs font-semibold uppercase tracking-[0.2em] text-ink-soft">
        New sheet
      </p>
      <FlowEditor mode="new" />
    </main>
  );
}
```

- [ ] **Step 2: Replace `src/app/page.tsx`**

```tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function Home() {
  const flows = await prisma.flow.findMany({ orderBy: { updatedAt: "desc" } });

  return (
    <main className="mx-auto max-w-3xl p-6 sm:p-8">
      <header className="mb-6 flex items-end justify-between border-b border-blueprint pb-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-[0.12em] text-ink">FlowForge</h1>
          <p className="mt-1 font-mono text-xs text-ink-soft">Linear LLM pipelines · drafting table</p>
        </div>
        <Link
          href="/flows/new"
          className="rounded-sm bg-azure px-4 py-2 text-sm font-semibold text-paper hover:opacity-90"
        >
          New flow
        </Link>
      </header>

      {flows.length === 0 ? (
        <p className="font-mono text-sm text-ink-soft">No flows yet. Draft your first one.</p>
      ) : (
        <ul className="divide-y divide-hairline border border-hairline bg-sheet">
          {flows.map((flow) => (
            <li key={flow.id}>
              <Link
                href={`/flows/${flow.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-paper/50"
              >
                <span className="h-2 w-2 rounded-full border border-blueprint" aria-hidden />
                <span className="font-medium text-ink">{flow.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Full regression suite**

Run: `npm run test`
Expected: all existing tests pass.

- [ ] **Step 6: Manual visual check**

`npm run dev`:
- `/` — masthead with FlowForge display type, tagline, "New flow" button; flow list rows have a node bullet; empty state reads "Draft your first one."
- `/flows/new` — "New sheet" kicker, single-column editor (no test rig), title block present.
- Toggle dark mode on both; confirm cyanotype legibility.

- [ ] **Step 7: Commit**

```bash
git add src/app/flows/new/page.tsx src/app/page.tsx
git commit -m "feat(ui): schematic shell for new-flow and home list pages"
```

---

## Post-implementation

- [ ] Update `docs/PROJECT-HISTORY.md`: add a phase entry for the editor redesign. Per `AGENTS.md`, keep scope leading — this is a presentational change, not a scope change, so `PROJECT-SCOPE.md` needs no edit (the "visual editor" capability was already in scope). Commit that doc update.

---

## Self-Review

**Spec coverage:**
- Blueprint/schematic identity, both themes → Task 1 tokens + Task 2 markup. ✅
- Light drafting-paper default + cyanotype dark → Task 1 `:root` + `prefers-color-scheme`. ✅
- Type system (Archivo Expanded / IBM Plex Sans / IBM Plex Mono) → Task 1 layout. ✅
- Two-pane layout, connector rail with real ref annotations, input/output nodes → Task 2 (`RailCell`, `refsBefore`, `refsAfter`). ✅
- Step card as component with ports + field editor → Task 2. ✅
- Title-block signature → Task 2 section + Task 3/4 shells. ✅
- Plot-in motion on Run, reduced-motion respected → Task 1 keyframes + Task 2 `.plot-in` + staggered `animationDelay`. ✅
- Collapsible run history → Task 3 `<details>`. ✅
- Home + new-flow shells → Task 4. ✅
- Quality floor (focus ring, responsive collapse, horizontal-scroll containment) → Task 1 focus ring, Task 2 responsive grid + `overflow-x-auto` on `pre`. ✅
- Invariants preserved (no payload/behavior change) → Global Constraints + "unchanged above return" notes. ✅

**Placeholder scan:** No TBD/TODO; all code blocks are complete files or complete replacement blocks with the unchanged portions explicitly identified. ✅

**Type consistency:** `refsAfter(step: EditorStep)` and `refsBefore(steps, index)` match their call sites; `RailCell` `kind` union `"node" | "terminal" | "arrow"` matches every usage (only `node` and `terminal` are used — `arrow` is defined but unused, which is harmless; if lint flags unused-union it will not, since all branches are reachable by prop). `twoPane`/`lastStep` derived before `return`. Button accent pairing `bg-azure text-paper` is consistent across Save/Run/New-flow. ✅
